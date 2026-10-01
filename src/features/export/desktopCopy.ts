import { createStore, del, entries as idbEntries, get, set, type UseStore } from 'idb-keyval'
import { create } from 'zustand'
import { useDocuments } from '../../store/documents'
import { flushPendingEdits } from '../../store/pendingEdits'
import { createCopyScheduler, type CopyScheduler, type CopySchedulerState, type FlushOutcome } from './copyScheduler'
import { buildExport, isExportKind, type CopyKind } from './formats'
import { errorName, hasNativeSaveDialog, queryWritePermission, requestWritePermission } from './fsAccess'
import { pickSaveFile, writeToHandle } from './saveToComputer'
import { backUpOriginalFile } from '../backups/backups'

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
  /** When Thunder Writer last wrote the file (shown as "saved 12:04"). */
  lastWrittenAt: number | null
  /**
   * The file's own lastModified as of Thunder Writer's last write (or when it
   * was opened and linked). A later one means it was changed elsewhere, so it
   * is kept in Backups and the writer chooses before anything is written.
   * Missing on copies set up before this was tracked, until their next write.
   */
  fileModifiedAt?: number | null
  /** The manuscript's updatedAt that the file holds (last written, or linked from it). */
  docUpdatedAtWritten?: number | null
}

/** A file this much newer than Thunder Writer's last write of it was changed elsewhere (file times are coarse). */
export const CHANGED_SLACK_MS = 2000

/** The write was stopped because the file changed outside Thunder Writer (see holdForChoice). */
const CHANGED_ERROR = 'ChangedElsewhereError'

/**
 * Whether the file was changed by something other than Thunder Writer since
 * its last write. Compared with the file's own time as recorded right after
 * that write, any difference counts, older too (a sync client or a restore
 * brings the other copy's time with it). Records from before that time was kept
 * only have the write's clock time, so for those only a newer file counts.
 */
export function changedSince(rec: Pick<CopyRecord, 'fileModifiedAt' | 'lastWrittenAt'>, lastModified: number): boolean {
  if (rec.fileModifiedAt != null) return Math.abs(lastModified - rec.fileModifiedAt) > CHANGED_SLACK_MS
  if (rec.lastWrittenAt != null) return lastModified > rec.lastWrittenAt + CHANGED_SLACK_MS
  return false
}

/** Two versions of a file are the same one: same time and size. */
const sameFile = (a: File, b: File) => a.lastModified === b.lastModified && a.size === b.size

/**
 * The newest record any tab wrote: another tab's write updates the file and
 * the stored record, and must not look like an outside change here.
 */
async function latestRecord(entry: Entry): Promise<Pick<CopyRecord, 'fileModifiedAt' | 'lastWrittenAt'>> {
  let stored: unknown
  try {
    stored = await get(entry.record.docId, db())
  } catch {
    stored = null
  }
  const mine = entry.record
  if (!isRecord(stored)) return mine
  const newest = (a?: number | null, b?: number | null) => (a == null ? (b ?? null) : b == null ? a : Math.max(a, b))
  return { fileModifiedAt: newest(mine.fileModifiedAt, stored.fileModifiedAt), lastWrittenAt: newest(mine.lastWrittenAt, stored.lastWrittenAt) }
}

export type CopyPhase = 'ready' | 'writing' | 'needs-permission' | 'error' | 'missing' | 'changed'

export interface CopyStatus {
  kind: CopyKind
  fileName: string
  phase: CopyPhase
  lastWrittenAt: number | null
  /** Changes not yet in the file. */
  pending: boolean
  error: string | null
  /** phase 'changed': the file as it now is on the computer, and whether it was kept in Backups. */
  changed?: { file: File; kept: boolean } | null
}

interface DesktopCopyStore {
  byDoc: Record<string, CopyStatus>
  /** The Desktop copy panel is open (any component may open it). */
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  /** The manuscript whose file changed elsewhere and is waiting for the writer to pick a version (shows the dialog). */
  choiceFor: string | null
}

export const useDesktopCopy = create<DesktopCopyStore>()((setState) => ({
  byDoc: {},
  panelOpen: false,
  setPanelOpen: (panelOpen) => setState({ panelOpen }),
  choiceFor: null,
}))

export const isDesktopCopySupported = hasNativeSaveDialog

let idb: UseStore | null = null
const db = () => (idb ??= createStore(EXPORT_DB, HANDLE_STORE))

interface Entry {
  record: CopyRecord
  scheduler: CopyScheduler | null
  /** The file changed elsewhere: nothing is written until the writer chooses (holdForChoice). */
  awaitingChoice?: { file: File; kept: boolean }
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
  if (n === CHANGED_ERROR) return 'changed'
  if (n === 'NotFoundError') return 'missing'
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'needs-permission'
  return null
}

export function copyErrorMessage(e: unknown): string {
  const n = errorName(e)
  if (n === CHANGED_ERROR) return 'The file was changed outside Thunder Writer. Choose which version to keep.'
  if (n === 'NotFoundError') return 'The file was moved, renamed or deleted.'
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'The browser needs your permission to update the file.'
  if (n === 'NoModificationAllowedError') return 'The file is busy (maybe open in another tab or app). Will retry.'
  if (n === 'QuotaExceededError') return 'Your disk is full.'
  return e instanceof Error && e.message ? e.message : 'The file could not be written.'
}

function statusFromScheduler(docId: string, s: CopySchedulerState) {
  const e = entries.get(docId)
  const blocked = e?.awaitingChoice ? 'changed' : s.paused ? (blockingPhase(s.lastError) ?? 'needs-permission') : null
  const phase: CopyPhase = s.writing ? 'writing' : blocked ? blocked : s.lastError ? 'error' : 'ready'
  patchStatus(docId, {
    changed: e?.awaitingChoice ?? null,
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
  if (entry.awaitingChoice) throw new DOMException('Waiting for the writer to choose a version.', CHANGED_ERROR)
  // Never write over changes made elsewhere (in Word, say): keep them and ask first.
  if (await checkChangedElsewhere(docId, entry)) {
    throw new DOMException(`${entry.record.fileName} was changed outside Thunder Writer.`, CHANGED_ERROR)
  }
  const blob = await buildExport(doc, kind)
  await writeToHandle(handle, blob)
  const written = await readFile(handle)
  entry.record = {
    ...entry.record,
    lastWrittenAt: Date.now(),
    fileModifiedAt: written?.lastModified ?? Date.now(),
    docUpdatedAtWritten: doc.updatedAt,
  }
  set(docId, entry.record, db()).catch(() => undefined)
}

/** If the file changed outside Thunder Writer, holds it for the writer's choice (holdForChoice) and says so. */
async function checkChangedElsewhere(docId: string, entry: Entry): Promise<boolean> {
  const known = await latestRecord(entry)
  if (known.fileModifiedAt == null && known.lastWrittenAt == null) return false
  const current = await readFile(entry.record.handle)
  if (!current || !changedSince(known, current.lastModified)) return false
  await holdForChoice(docId, current)
  return true
}

/** The file as it is on disk now, or null if it can't be read (a missing file still throws, so it shows as moved). */
async function readFile(handle: FileSystemFileHandle): Promise<File | null> {
  try {
    return await handle.getFile()
  } catch (e) {
    if (errorName(e) === 'NotFoundError') throw e
    return null
  }
}

/**
 * The file changed outside Thunder Writer: keep it in Backups (byte for byte),
 * stop writing to it, and ask the writer which version to keep. Saving stays
 * paused until they choose (keepBrowserVersionInFile, acceptFileVersion).
 */
export async function holdForChoice(docId: string, file: File): Promise<void> {
  const entry = entries.get(docId)
  if (!entry) return
  entry.scheduler?.pause()
  // Changed again while the question waited: keep this version too.
  if (!entry.awaitingChoice || !sameFile(entry.awaitingChoice.file, file)) {
    const doc = useDocuments.getState().docs[docId]
    const kept = doc ? await backUpOriginalFile(doc, file, Date.now(), { wordsFromFile: true }) : false
    // Stopped or replaced while the backup was being kept: nothing to ask about any more.
    if (entries.get(docId) !== entry) return
    entry.awaitingChoice = { file, kept }
  }
  patchStatus(docId, { phase: 'changed', changed: entry.awaitingChoice })
  useDesktopCopy.setState({ choiceFor: docId })
}

function clearChoice(docId: string) {
  const entry = entries.get(docId)
  if (entry) delete entry.awaitingChoice
  patchStatus(docId, { changed: null })
  if (useDesktopCopy.getState().choiceFor === docId) useDesktopCopy.setState({ choiceFor: null })
}

/**
 * "Keep this browser's version": write it over the changed file now (the file's
 * own version was kept in Backups, or the writer agreed to go on without).
 * Call from a click: the browser may need to allow writing again.
 */
export async function keepBrowserVersionInFile(docId: string): Promise<'written' | 'denied' | 'failed' | 'changed-again'> {
  const entry = entries.get(docId)
  if (!entry?.awaitingChoice) return 'failed'
  let perm: PermissionState
  try {
    perm = await requestWritePermission(entry.record.handle)
  } catch {
    perm = 'denied'
  }
  if (entries.get(docId) !== entry || !entry.awaitingChoice) return 'failed'
  if (perm !== 'granted') return 'denied'
  const current = await readFile(entry.record.handle).catch(() => null)
  if (current && !sameFile(current, entry.awaitingChoice.file)) {
    // Changed again since the question was asked: keep that version too, and ask again.
    await holdForChoice(docId, current)
    return 'changed-again'
  }
  // The outside change is being replaced on purpose: it no longer counts as "changed elsewhere".
  const waiting = entry.awaitingChoice
  entry.record = { ...entry.record, fileModifiedAt: current?.lastModified ?? Date.now() }
  delete entry.awaitingChoice
  const s = entry.scheduler ?? activate(docId)
  s.resume()
  flushPendingEdits()
  if ((await s.flush({ force: true })) === 'written') {
    clearChoice(docId)
    return 'written'
  }
  // Not written: the question stands, with its error shown.
  if (entries.get(docId) === entry && !entry.awaitingChoice) entry.awaitingChoice = waiting
  s.pause()
  patchStatus(docId, { phase: 'changed', changed: entry.awaitingChoice ?? waiting })
  useDesktopCopy.setState({ choiceFor: docId })
  return 'failed'
}

/**
 * "Use the file's version", once it has been loaded into the manuscript: the
 * file and the manuscript now match, so nothing is rewritten until the next edit.
 */
export function acceptFileVersion(docId: string, fileModifiedAt: number, docUpdatedAt: number): void {
  const entry = entries.get(docId)
  if (!entry) return
  entry.record = { ...entry.record, fileModifiedAt, docUpdatedAtWritten: docUpdatedAt }
  set(docId, entry.record, db()).catch(() => undefined)
  clearChoice(docId)
  if (entry.scheduler) {
    entry.scheduler.markClean()
    entry.scheduler.resume()
  } else {
    // After a reload, before the browser has allowed writing again.
    patchStatus(docId, { phase: 'needs-permission', error: null })
  }
}

/** The writer closed the question without choosing: saving stays paused, and the badge can bring it back. */
export const postponeChoice = () => useDesktopCopy.setState({ choiceFor: null })

/** Shows the question again (header badge, Cmd/Ctrl+S). */
export const showChoice = (docId: string) => useDesktopCopy.setState({ choiceFor: docId })

/** The file the copy writes to (to re-read it when loading its version). */
export const getDesktopCopyHandle = (docId: string) => entries.get(docId)?.record.handle ?? null

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
    // Deleted while the handle was loading: don't bring its copy back.
    if (!useDocuments.getState().docs[docId]) return
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
      // Compare manuscript versions, not the file's clock with the manuscript's.
      if (doc && doc.updatedAt > (rec.docUpdatedAtWritten ?? rec.lastWrittenAt ?? 0)) s.notifyChange()
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

/**
 * File › Open from computer › Keep saving to it: makes the file the writer
 * opened the manuscript's desktop copy. The caller already has write
 * permission (asked from a click). The file holds this version, so nothing is
 * written until the manuscript changes; `fileModifiedAt` (File.lastModified)
 * lets a later open tell whether it was changed elsewhere since.
 */
export async function linkDesktopCopy(docId: string, handle: FileSystemFileHandle, kind: CopyKind, fileModifiedAt: number): Promise<void> {
  entries.get(docId)?.scheduler?.dispose()
  const doc = useDocuments.getState().docs[docId]
  const record: CopyRecord = {
    docId,
    kind,
    fileName: handle.name,
    handle,
    setUpAt: Date.now(),
    lastWrittenAt: null,
    fileModifiedAt,
    docUpdatedAtWritten: doc?.updatedAt ?? null,
  }
  entries.set(docId, { record, scheduler: null })
  try {
    await set(docId, record, db())
  } catch {
    // Private windows may block IndexedDB: saving back still works until the tab closes.
  }
  activate(docId)
}

/**
 * The manuscript that already saves to this very file (FileSystemHandle.isSameEntry),
 * so opening it again goes back to that manuscript instead of making a second one.
 */
export async function findDocForFile(
  handle: FileSystemFileHandle,
): Promise<{ docId: string; fileModifiedAt: number | null; lastWrittenAt: number | null } | null> {
  const records: CopyRecord[] = [...entries.values()].map((e) => e.record)
  try {
    for (const [, v] of await idbEntries<IDBValidKey, unknown>(db())) {
      if (isRecord(v) && !records.some((r) => r.docId === v.docId)) records.push(v)
    }
  } catch {
    // No stored copies to compare with.
  }
  for (const r of records) {
    try {
      if (await handle.isSameEntry(r.handle)) return { docId: r.docId, fileModifiedAt: r.fileModifiedAt ?? null, lastWrittenAt: r.lastWrittenAt }
    } catch {
      // A handle from another browser profile or a stale record: not this file.
    }
  }
  return null
}

/** Grants write permission again after a reload. Call directly from a click or key press. */
export async function resumeDesktopCopy(docId: string): Promise<boolean> {
  const entry = entries.get(docId)
  if (!entry) return false
  // A file changed elsewhere waits for the writer's choice; resuming must not write over it.
  if (entry.awaitingChoice) {
    showChoice(docId)
    return false
  }
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

export type WriteNowOutcome = FlushOutcome | 'none' | 'needs-permission' | 'missing'

/** Cmd/Ctrl+S: write the copy now if anything changed. */
export async function writeDesktopCopyNow(docId: string, opts: { force?: boolean } = {}): Promise<WriteNowOutcome> {
  const entry = entries.get(docId)
  if (!entry) return 'none'
  if (!entry.scheduler) return 'needs-permission'
  flushPendingEdits()
  // Nothing to write: still, "up to date" must not hide a file changed elsewhere.
  if (!opts.force && !entry.scheduler.getState().dirty && !entry.awaitingChoice) {
    try {
      if (await checkChangedElsewhere(docId, entry)) return 'paused'
    } catch (e) {
      if (errorName(e) === 'NotFoundError') return 'missing'
    }
  }
  return entry.scheduler.flush(opts)
}

export const hasDesktopCopy = (docId: string) => entries.has(docId)

/**
 * Switching away from a manuscript: write its copy now if it has changes
 * waiting for the debounce, so the file is current before the writer moves on.
 */
export function flushPendingDesktopCopy(docId: string): void {
  const scheduler = entries.get(docId)?.scheduler
  if (scheduler?.getState().dirty) void scheduler.flush()
}

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
      // A deleted manuscript stops its copy, including one not loaded yet this session
      // (its saved file handle is forgotten too). The file on the computer stays.
      for (const id of Object.keys(prev.docs)) if (!s.docs[id]) void stopDesktopCopy(id)
      for (const [id, e] of entries) {
        const a = s.docs[id]
        const b = prev.docs[id]
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
