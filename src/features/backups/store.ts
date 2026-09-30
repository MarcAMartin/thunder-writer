import { clear, createStore, delMany, get, getMany, keys, setMany, type UseStore } from 'idb-keyval'
import type { ThunderDoc } from '../../types'
import { parseDoc, withoutDriveLink } from '../storage/schema'
import type { BackupMeta, BackupReason } from './retention'

/**
 * Backups kept in this browser (IndexedDB), in their own database so loading
 * the manuscripts at startup never reads them. Each backup is two records:
 * "meta:<id>" (small, listed in the Backups menu) and "data:<id>" (the whole
 * manuscript, read only when the writer opens or downloads it).
 */
export const BACKUP_DB_NAME = 'thunder-writer-backups'
const STORE_NAME = 'backups'
const META = 'meta:'
const DATA = 'data:'

/** Set while Settings › Clear all local data runs, so a backup in flight can't outlive it. */
let writesSuspended = false
export function suspendBackupWrites() {
  writesSuspended = true
}

let store: UseStore | null = null
function db(): UseStore {
  if (!store) store = createStore(BACKUP_DB_NAME, STORE_NAME)
  return store
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

type Node = { type?: string; text?: string; content?: Node[] }

/** Words in a manuscript's content (TipTap JSON), for the Backups menu. */
export function countWords(content: unknown): number {
  let words = 0
  const walk = (n: Node | null | undefined) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'text' && typeof n.text === 'string') words += n.text.match(/\S+/g)?.length ?? 0
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  // Text nodes of adjacent blocks never share a word, so counting per node is exact enough here.
  walk(content as Node)
  return words
}

/** Writes a backup of `doc` (its Drive link removed, so restoring it can't write over a Drive file). */
export async function writeBackup(doc: ThunderDoc, reason: BackupReason, now = Date.now()): Promise<BackupMeta> {
  const meta: BackupMeta = {
    id: newId(),
    docId: doc.id,
    title: doc.title || 'Untitled Manuscript',
    savedAt: now,
    docUpdatedAt: doc.updatedAt,
    words: countWords(doc.content),
    reason,
  }
  if (writesSuspended) return meta
  await setMany(
    [
      [DATA + meta.id, withoutDriveLink(doc)],
      [META + meta.id, meta],
    ],
    db(),
  )
  return meta
}

const isMeta = (v: unknown): v is BackupMeta => {
  const m = v as Partial<BackupMeta> | null
  return !!m && typeof m.id === 'string' && typeof m.docId === 'string' && typeof m.savedAt === 'number'
}

/** Every backup's details, newest first. */
export async function listBackups(): Promise<BackupMeta[]> {
  const metaKeys = (await keys(db())).filter((k): k is string => typeof k === 'string' && k.startsWith(META))
  const values = await getMany<unknown>(metaKeys, db())
  return values.filter(isMeta).sort((a, b) => b.savedAt - a.savedAt)
}

/** The backed-up manuscript, or null if it is missing or unreadable. */
export async function readBackup(id: string): Promise<ThunderDoc | null> {
  return parseDoc(await get<unknown>(DATA + id, db()))
}

export async function deleteBackups(ids: readonly string[]): Promise<void> {
  if (!ids.length) return
  await delMany(ids.flatMap((id) => [META + id, DATA + id]), db())
}

/** Removes every backup (Settings › Clear all local data). */
export async function clearBackups(): Promise<void> {
  await clear(db())
}
