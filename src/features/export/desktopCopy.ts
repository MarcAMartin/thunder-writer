import { createStore, del, get, set, type UseStore } from 'idb-keyval'
import { create } from 'zustand'
import { useDocuments } from '../../store/documents'
import { flushPendingEdits } from '../../store/pendingEdits'
import { createCopyScheduler, type CopyScheduler, type CopySchedulerState, type FlushOutcome } from './copyScheduler'
import { buildExport, isExportKind, type CopyKind } from './formats'
import { errorName, hasNativeSaveDialog, queryWritePermission, requestWritePermission } from './fsAccess'
import { pickSaveFile, writeToHandle } from './saveToComputer'

/**
 * "Keep a copy on my computer": the writer picks a file once and the app
 * rewrites it whenever the manuscript changes. Chromium only (File System
 * Access API). The file handle is kept in IndexedDB so the copy survives a
 * reload; after a reload the browser asks for write permission again, which
 * needs a click ("Resume desktop copy").
 */

export const EXPORT_DB = 'thunder-writer-export'
export const HANDLE_STORE = 'handles'
/** Remembered folder for the desktop copy (separate from one-off saves). */
export const COPY_PICKER_ID = 'thunder-writer-copy'

export interface CopyRecord {
  docId: string
  kind: CopyKind
  fileName: string
  handle: FileSystemFileHandle
  setUpAt: number
  lastWrittenAt: number | null
}

export type CopyPhase = 'ready' | 'writing' | 'needs-permission' | 'error' | 'missing'

export interface CopyStatus {
  kind: CopyKind
  fileName: string
  phase: CopyPhase
  lastWrittenAt: number | null
  /** Changes not yet in the file. */
  pending: boolean
  error: string | null
}

interface DesktopCopyStore {
  byDoc: Record<string, CopyStatus>
  /** The Desktop copy panel is open (any component may open it). */
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
}

export const useDesktopCopy = create<DesktopCopyStore>()((setState) => ({
  byDoc: {},
  panelOpen: false,
  setPanelOpen: (panelOpen) => setState({ panelOpen }),
}))

export const isDesktopCopySupported = hasNativeSaveDialog

let idb: UseStore | null = null
const db = () => (idb ??= createStore(EXPORT_DB, HANDLE_STORE))

interface Entry {
  record: CopyRecord
  scheduler: CopyScheduler | null
}

const entries = new Map<string, Entry>()
const restoring = new Map<string, Promise<void>>()

function patchStatus(docId: string, patch: Partial<CopyStatus> | null) {
  useDesktopCopy.setState((s) => {
    const byDoc = { ...s.byDoc }
    if (patch === null) delete byDoc[docId]
    else {
      const e = entries.get(docId)
      const base: CopyStatus = byDoc[docId] ?? {
        kind: e?.record.kind ?? 'docx',
        fileName: e?.record.fileName ?? '',
        phase: 'ready',
        lastWrittenAt: e?.record.lastWrittenAt ?? null,
        pending: false,
        error: null,
      }
      byDoc[docId] = { ...base, ...patch }
    }
    return { byDoc }
  })
}

/** Errors that need the writer before another write can work. */
function blockingPhase(e: unknown): CopyPhase | null {
  const n = errorName(e)
  if (n === 'NotFoundError') return 'missing'
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'needs-permission'
  return null
}

export function copyErrorMessage(e: unknown): string {
  const n = errorName(e)
  if (n === 'NotFoundError') return 'The file was moved, renamed or deleted.'
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'The browser needs your permission to update the file.'
  if (n === 'NoModificationAllowedError') return 'The file is busy (maybe open in another tab or app). Will retry.'
  if (n === 'QuotaExceededError') return 'Your disk is full.'
  return e instanceof Error && e.message ? e.message : 'The file could not be written.'
}

function statusFromScheduler(docId: string, s: CopySchedulerState) {
  const blocked = s.paused ? (blockingPhase(s.lastError) ?? 'needs-permission') : null
  const phase: CopyPhase = s.writing ? 'writing' : blocked ? blocked : s.lastError ? 'error' : 'ready'
  const e = entries.get(docId)
  patchStatus(docId, {
    phase,
    pending: s.dirty,
    lastWrittenAt: s.lastWrittenAt ?? e?.record.lastWrittenAt ?? null,
    error: s.lastError ? copyErrorMessage(s.lastError) : null,
  })
}

async function writeCopy(docId: string): Promise<void> {
  const entry = entries.get(docId)
  if (!entry) throw new Error('This desktop copy was stopped.')
  const doc = useDocuments.getState().docs[docId]
  if (!doc) throw new Error('This manuscript is no longer in this browser.')
  const { handle, kind } = entry.record
  if ((await queryWritePermission(handle)) !== 'granted') {
    throw new DOMException('Write permission is needed again.', 'NotAllowedError')
  }
  const blob = await buildExport(doc, kind)
  await writeToHandle(handle, blob)
  entry.record = { ...entry.record, lastWrittenAt: Date.now() }
  set(docId, entry.record, db()).catch(() => undefined)
}

function activate(docId: string): CopyScheduler {
  const entry = entries.get(docId)!
  entry.scheduler?.dispose()
  const scheduler = createCopyScheduler({
    write: () => writeCopy(docId),
    shouldPause: (e) => blockingPhase(e) !== null,
    onState: (s) => {
      if (entries.get(docId)?.scheduler === scheduler) statusFromScheduler(docId, s)
    },
  })
  entry.scheduler = scheduler
  patchStatus(docId, { phase: 'ready', error: null, kind: entry.record.kind, fileName: entry.record.fileName })
  return scheduler
}

function isRecord(v: unknown): v is CopyRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.docId === 'string' &&
    isExportKind(r.kind) &&
    r.kind !== 'html' &&
    typeof r.fileName === 'string' &&
    typeof r.handle === 'object' &&
    r.handle !== null
  )
}

/** Loads a saved desktop copy for `docId` (after a reload or when the doc is opened). Safe to call repeatedly. */
export function restoreDesktopCopy(docId: string): Promise<void> {
  if (entries.has(docId) || !isDesktopCopySupported()) return Promise.resolve()
  const running = restoring.get(docId)
  if (running) return running
  const p = (async () => {
    let rec: unknown
    try {
      rec = await get(docId, db())
    } catch {
      return
    }
    if (!isRecord(rec) || entries.has(docId)) return
    entries.set(docId, { record: rec, scheduler: null })
    patchStatus(docId, { kind: rec.kind, fileName: rec.fileName, lastWrittenAt: rec.lastWrittenAt, phase: 'ready' })
    let perm: PermissionState = 'prompt'
    try {
      perm = await queryWritePermission(rec.handle)
    } catch {
      perm = 'prompt'
    }
    if (entries.get(docId)?.record !== rec) return
    if (perm === 'granted') {
      const s = activate(docId)
      const doc = useDocuments.getState().docs[docId]
      if (doc && doc.updatedAt > (rec.lastWrittenAt ?? 0)) s.notifyChange()
    } else {
      patchStatus(docId, { phase: 'needs-permission' })
    }
  })().finally(() => restoring.delete(docId))
  restoring.set(docId, p)
  return p
}

export type SetUpOutcome = 'ok' | 'cancelled' | 'failed'

/**
 * Asks where to keep the copy (native Save dialog, starting on the Desktop),
 * then writes it straight away. Call directly from a click or key press.
 */
export async function setUpDesktopCopy(docId: string, kind: CopyKind): Promise<SetUpOutcome> {
  const doc = useDocuments.getState().docs[docId]
  if (!doc) return 'failed'
  const previous = entries.get(docId)
  // The picker must be the first await so it still counts as part of the click.
  const handle = await pickSaveFile(previous?.record.fileName ? stripExt(previous.record.fileName) : doc.title, kind, {
    id: COPY_PICKER_ID,
  })
  if (!handle) return 'cancelled'
  previous?.scheduler?.dispose()
  const record: CopyRecord = { docId, kind, fileName: handle.name, handle, setUpAt: Date.now(), lastWrittenAt: null }
  entries.set(docId, { record, scheduler: null })
  useDesktopCopy.setState((s) => {
    const byDoc = { ...s.byDoc }
    delete byDoc[docId]
    return { byDoc }
  })
  try {
    await set(docId, record, db())
  } catch {
    // Private windows may block IndexedDB: the copy still works until the tab closes.
  }
  const s = activate(docId)
  flushPendingEdits()
  const outcome = await s.flush({ force: true })
  return outcome === 'written' ? 'ok' : 'failed'
}

const stripExt = (name: string) => name.replace(/(\.thunder)?\.[A-Za-z0-9]+$/, '')

/** Grants write permission again after a reload. Call directly from a click or key press. */
export async function resumeDesktopCopy(docId: string): Promise<boolean> {
  const entry = entries.get(docId)
  if (!entry) return false
  let perm: PermissionState
  try {
    perm = await requestWritePermission(entry.record.handle)
  } catch {
    perm = 'denied'
  }
  if (entries.get(docId) !== entry) return false
  if (perm !== 'granted') {
    patchStatus(docId, { phase: 'needs-permission' })
    return false
  }
  const s = entry.scheduler ?? activate(docId)
  s.resume()
  flushPendingEdits()
  return (await s.flush({ force: true })) === 'written'
}

/** Stops updating the file. The file already on the computer is left as it is. */
export async function stopDesktopCopy(docId: string): Promise<void> {
  const entry = entries.get(docId)
  entry?.scheduler?.dispose()
  entries.delete(docId)
  patchStatus(docId, null)
  try {
    await del(docId, db())
  } catch {
    // Nothing to clean up if IndexedDB is unavailable.
  }
}

export type WriteNowOutcome = FlushOutcome | 'none' | 'needs-permission'

/** Cmd/Ctrl+S: write the copy now if anything changed. */
export async function writeDesktopCopyNow(docId: string, opts: { force?: boolean } = {}): Promise<WriteNowOutcome> {
  const entry = entries.get(docId)
  if (!entry) return 'none'
  if (!entry.scheduler) return 'needs-permission'
  flushPendingEdits()
  return entry.scheduler.flush(opts)
}

export const hasDesktopCopy = (docId: string) => entries.has(docId)

export function getDesktopCopyStatus(docId: string | null | undefined): CopyStatus | undefined {
  return docId ? useDesktopCopy.getState().byDoc[docId] : undefined
}

let serviceRefs = 0
let unsubscribeDocs: (() => void) | null = null

const onVisibility = () => {
  if (document.visibilityState !== 'hidden') return
  // Leaving the tab: don't leave changes waiting for the debounce.
  for (const e of entries.values()) if (e.scheduler?.getState().dirty) void e.scheduler.flush()
}

/**
 * Watches the documents store and schedules rewrites of every active desktop
 * copy. Reference-counted: call once per mount; the returned function stops it.
 */
export function startDesktopCopyService(): () => void {
  serviceRefs++
  if (serviceRefs === 1) {
    unsubscribeDocs = useDocuments.subscribe((s, prev) => {
      if (s.docs === prev.docs) return
      for (const [id, e] of entries) {
        const a = s.docs[id]
        const b = prev.docs[id]
        if (!a && b) {
          void stopDesktopCopy(id)
          continue
        }
        if (a && b && (a.content !== b.content || a.title !== b.title || a.format !== b.format)) e.scheduler?.notifyChange()
      }
    })
    document.addEventListener('visibilitychange', onVisibility)
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    serviceRefs--
    if (serviceRefs === 0) {
      unsubscribeDocs?.()
      unsubscribeDocs = null
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }
}

/** Test-only: forget every in-memory copy (IndexedDB is left alone). */
export function __resetDesktopCopyForTests() {
  for (const e of entries.values()) e.scheduler?.dispose()
  entries.clear()
  restoring.clear()
  useDesktopCopy.setState({ byDoc: {}, panelOpen: false })
}
