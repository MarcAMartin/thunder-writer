import { create } from 'zustand'
import { useDocuments, type DocumentsState } from '../../store/documents'
import { flushPendingEdits } from '../../store/pendingEdits'
import type { ThunderDoc } from '../../types'
import { downloadBlob } from '../export/saveToComputer'
import { toBackupJson } from '../export/backup'
import { sanitizeBaseName } from '../export/filename'
import { isUntouchedDoc } from '../import/importFlow'
import { importManuscript } from '../import/importManuscript'
import { parseEnvelope } from '../storage/schema'
import { backupsToPrune, type BackupMeta, type BackupReason } from './retention'
import * as idb from './store'

/**
 * Backups of every manuscript, kept in this browser so a writer can always
 * step back: automatic ones while writing, and a safety copy just before
 * anything replaces or deletes a manuscript. Restoring never overwrites
 * anything; a backup opens as a new manuscript.
 */

interface BackupsState {
  /** Every backup's details, newest first (loaded on first use). */
  list: BackupMeta[]
  loaded: boolean
  /** Why backups can't be read here at all (e.g. a private window), if so. */
  error: string | null
  /** The last backup couldn't be saved (e.g. storage is full); cleared by the next one that is. */
  writeError: string | null
}

export const useBackups = create<BackupsState>()(() => ({ list: [], loaded: false, error: null, writeError: null }))

export const WRITE_FAILED = 'The latest backup couldn’t be saved in this browser (its storage may be full).'

const UNAVAILABLE = 'This browser blocked local storage (private window?), so backups can’t be kept here.'

let loading: Promise<void> | null = null

/** Loads (or reloads) the list for the Backups menu. */
export function refreshBackups(): Promise<void> {
  loading ??= idb
    .listBackups()
    .then(
      (list) => useBackups.setState({ list, loaded: true, error: null }),
      () => useBackups.setState({ loaded: true, error: UNAVAILABLE }),
    )
    .finally(() => {
      loading = null
    })
  return loading
}

/** A backup still unfinished after this long no longer holds up the ones after it. */
const STALL_MS = 15_000

/** Serializes writes and pruning so two backups never race on the list. */
let chain: Promise<unknown> = Promise.resolve()
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  // A write the browser never finishes (a stuck database) mustn't block every later backup in this tab.
  const previous = Promise.race([chain, new Promise((r) => setTimeout(r, STALL_MS))])
  const next = previous.then(fn, fn)
  chain = next.catch(() => undefined)
  return next
}

/**
 * Saves a backup of `doc` and prunes old ones (backupsToPrune). Skips a doc
 * whose latest backup already holds the same version, unless it is a safety
 * copy with a different reason. Rejects if the browser can't store it.
 */
export function backUpDoc(doc: ThunderDoc, reason: BackupReason, now = Date.now()): Promise<BackupMeta | null> {
  return serialized(async () => {
    if (!useBackups.getState().loaded) await refreshBackups()
    const latest = useBackups.getState().list.find((m) => m.docId === doc.id)
    if (latest && latest.docUpdatedAt === doc.updatedAt && (reason === 'auto' || latest.reason === reason)) return null
    let meta: BackupMeta
    try {
      meta = await idb.writeBackup(doc, reason, now)
    } catch (e) {
      useBackups.setState({ writeError: WRITE_FAILED })
      throw e
    }
    const list = [meta, ...useBackups.getState().list].sort((a, b) => b.savedAt - a.savedAt)
    const doomed = new Set(backupsToPrune(list, now))
    await idb.deleteBackups([...doomed]).catch(() => undefined)
    useBackups.setState({ list: list.filter((m) => !doomed.has(m.id)), loaded: true, error: null, writeError: null })
    return meta
  })
}

/** A safety copy that hasn't been stored after this long counts as failed, so the action it guards doesn't hang. */
export const SAFETY_BACKUP_TIMEOUT_MS = 4000

/**
 * A safety copy before something replaces or deletes a manuscript. Resolves
 * true once it is stored (or wasn't needed: nothing written in it, or its
 * latest backup already holds this version), false if the browser couldn't
 * store it in time. Never throws; the caller decides whether to go ahead.
 */
export async function safetyBackup(doc: ThunderDoc | undefined, reason: BackupReason): Promise<boolean> {
  if (!doc || isUntouchedDoc(doc)) return true
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out saving a backup')), SAFETY_BACKUP_TIMEOUT_MS)
    })
    await Promise.race([backUpDoc(doc, reason), timeout])
    return true
  } catch (e) {
    console.warn('[thunder-writer] Could not keep a backup before replacing a manuscript', e)
    useBackups.setState({ writeError: WRITE_FAILED })
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Keeps a file from the computer byte for byte, before Thunder Writer first
 * saves over it (File › Open from computer › Keep saving to it). Resolves
 * whether it was stored; never throws.
 */
export async function backUpOriginalFile(
  doc: ThunderDoc,
  file: File,
  now = Date.now(),
  opts: { wordsFromFile?: boolean } = {},
): Promise<boolean> {
  try {
    // A file changed elsewhere holds other words than the manuscript: count its own.
    const words = opts.wordsFromFile ? await wordsInFile(file) : idb.countWords(doc.content)
    await serialized(async () => {
      if (!useBackups.getState().loaded) await refreshBackups()
      let meta: BackupMeta
      try {
        meta = await idb.writeFileBackup(doc, file, words, now)
      } catch (e) {
        useBackups.setState({ writeError: WRITE_FAILED })
        throw e
      }
      const list = [meta, ...useBackups.getState().list].sort((a, b) => b.savedAt - a.savedAt)
      const doomed = new Set(backupsToPrune(list, now))
      await idb.deleteBackups([...doomed]).catch(() => undefined)
      useBackups.setState({ list: list.filter((m) => !doomed.has(m.id)), loaded: true, error: null, writeError: null })
    })
    return true
  } catch (e) {
    console.warn('[thunder-writer] Could not keep a backup of the original file', e)
    return false
  }
}

/** Words in a file from the computer, read the way Open from computer does; 0 if it can't be read. */
async function wordsInFile(file: File): Promise<number> {
  try {
    if (/\.json(\.bak)?$/i.test(file.name)) {
      const parsed = parseEnvelope(JSON.parse(await file.text()))
      return parsed.ok ? idb.countWords(parsed.doc.content) : 0
    }
    const r = await importManuscript({ name: file.name, mimeType: file.type || undefined, data: await file.arrayBuffer() })
    return r.wordCount
  } catch {
    return 0
  }
}

/** "Back up now" for the open manuscript. */
export async function backUpCurrentNow(): Promise<BackupMeta | null> {
  flushPendingEdits()
  const s = useDocuments.getState()
  const doc = s.currentId ? s.docs[s.currentId] : undefined
  if (!doc) return null
  return (await backUpDoc(doc, 'manual')) ?? useBackups.getState().list.find((m) => m.docId === doc.id) ?? null
}

const UNREADABLE = 'This backup can’t be read. It may have been removed, or this browser’s storage was cleared.'

/** What opening a backup puts in the new manuscript. */
async function loadForCopy(meta: BackupMeta): Promise<{ title: string; content: unknown; format?: ThunderDoc['format'] }> {
  if (meta.file) {
    // An original file: read it the way File › Open from computer does.
    const f = await idb.readFileBackup(meta.id)
    if (!f) throw new Error(UNREADABLE)
    if (/\.json(\.bak)?$/i.test(f.name)) {
      const parsed = parseEnvelope(JSON.parse(new TextDecoder().decode(f.bytes)))
      if (!parsed.ok) throw new Error(parsed.reason)
      return parsed.doc
    }
    const r = await importManuscript({ name: f.name, mimeType: f.type || undefined, data: f.bytes })
    return { title: r.title, content: r.content }
  }
  const doc = await idb.readBackup(meta.id)
  if (!doc) throw new Error(UNREADABLE)
  return doc
}

/** "Sep 30, 2026, 3:40 PM" (the same style as the Open manuscript list). */
export const formatBackupTime = (t: number) =>
  new Date(t).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

const backupLabel = (meta: BackupMeta) => `backup ${formatBackupTime(meta.savedAt)}`

/**
 * Copies opened from a backup that haven't been edited yet. Drive autosave
 * skips them (StorageProvider), so looking at an old backup doesn't add a file
 * to the writer's Drive; the first edit makes it a manuscript like any other.
 */
const untouchedCopies = new Set<string>()
export const isUntouchedCopy = (id: string) => untouchedCopies.has(id)

/** Opens a backup as a new manuscript, "<title> (backup <when>)". Nothing is overwritten. */
export async function openBackupAsCopy(meta: BackupMeta): Promise<ThunderDoc> {
  const doc = await loadForCopy(meta)
  const docs = useDocuments.getState()
  const copy = docs.createDoc({ title: `${doc.title || 'Untitled Manuscript'} (${backupLabel(meta)})`, content: doc.content, format: doc.format })
  untouchedCopies.add(copy.id)
  return copy
}

/**
 * Undo for "opened a backup as a copy": removes the copy if it is still
 * untouched and goes back to the manuscript that was open. Returns whether it did.
 */
export function undoOpenCopy(copyId: string, previousId: string | null): boolean {
  if (!untouchedCopies.has(copyId)) return false
  untouchedCopies.delete(copyId)
  const s = useDocuments.getState()
  s.deleteDoc(copyId)
  if (previousId && s.docs[previousId]) s.openDoc(previousId)
  return true
}

/**
 * Downloads a backup: an original file exactly as it was on the computer, any
 * other backup as a Thunder Writer file (File › Open from computer… opens it again).
 */
export async function downloadBackup(meta: BackupMeta): Promise<void> {
  if (meta.file) {
    const f = await idb.readFileBackup(meta.id)
    if (!f) throw new Error(UNREADABLE)
    downloadBlob(new Blob([f.bytes], { type: f.type || 'application/octet-stream' }), f.name)
    return
  }
  const doc = await idb.readBackup(meta.id)
  if (!doc) throw new Error(UNREADABLE)
  const name = sanitizeBaseName(`${doc.title || 'Untitled Manuscript'} (${backupLabel(meta)})`)
  downloadBlob(new Blob([toBackupJson(doc)], { type: 'application/json' }), `${name}.thunder.json`)
}

// ---------------------------------------------------------------------------
// Automatic backups while writing

/** At most one automatic backup of a manuscript per this many minutes of writing. */
export const AUTO_BACKUP_EVERY_MS = 10 * 60_000

/**
 * Watches the document store. The first edit to a manuscript in a session
 * backs up the version from before it; after that, a backup at most every 10
 * minutes while the writer keeps editing. Each backup holds the version just
 * before the edit that triggered it.
 */
export function createAutoBackup(opts: { now?: () => number; everyMs?: number } = {}) {
  const now = opts.now ?? Date.now
  const everyMs = opts.everyMs ?? AUTO_BACKUP_EVERY_MS
  /** When this tab last backed up each doc; absent = not yet this session. */
  const last = new Map<string, number>()

  function observe(prev: Pick<DocumentsState, 'docs'>, next: Pick<DocumentsState, 'docs'>) {
    if (prev.docs === next.docs) return
    for (const [id, doc] of Object.entries(next.docs)) {
      const before = prev.docs[id]
      // Only real edits: text, title or book format (Drive sync bookkeeping changes none of them).
      if (!before || before === doc) continue
      if (before.content === doc.content && before.title === doc.title && before.format === doc.format) continue
      // Edited: a copy opened from a backup is now a manuscript of its own (and saved to Drive).
      untouchedCopies.delete(id)
      if (isUntouchedDoc(before)) continue
      const at = now()
      const prevAt = last.get(id)
      if (prevAt !== undefined && at - prevAt < everyMs) continue
      // Set before the write: a failure (reported in the Backups menu) is retried after the same interval, not on every keystroke.
      last.set(id, at)
      backUpDoc(before, 'auto', at).catch(() => undefined)
    }
  }

  return { observe }
}
