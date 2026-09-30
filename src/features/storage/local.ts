import { clear, createStore, del, entries, get, set, type UseStore } from 'idb-keyval'
import type { ThunderDoc } from '../../types'
import { parseDoc } from './schema'

/**
 * Browser-local persistence (IndexedDB via idb-keyval). One object store holds
 * both documents ("doc:<id>") and small metadata values ("meta:<name>").
 */
export const DB_NAME = 'thunder-writer'
export const STORE_NAME = 'docs'

const DOC_PREFIX = 'doc:'
const LAST_OPENED_KEY = 'meta:lastOpenedId'

let store: UseStore | null = null
/** Lazily open the store so importing this module never touches IndexedDB. */
function db(): UseStore {
  if (!store) store = createStore(DB_NAME, STORE_NAME)
  return store
}

/** When true, writes are dropped (used while clearing all data before a reload). */
let writesSuspended = false
export function suspendWrites() {
  writesSuspended = true
}

export async function saveDoc(doc: ThunderDoc): Promise<void> {
  if (writesSuspended) return
  await set(DOC_PREFIX + doc.id, doc, db())
}

export async function deleteDoc(id: string): Promise<void> {
  if (writesSuspended) return
  await del(DOC_PREFIX + id, db())
}

/** Loads every valid doc, newest first. Corrupt records are skipped, not thrown. */
export async function loadAllDocs(): Promise<ThunderDoc[]> {
  const all = await entries<IDBValidKey, unknown>(db())
  const docs: ThunderDoc[] = []
  for (const [key, value] of all) {
    if (typeof key !== 'string' || !key.startsWith(DOC_PREFIX)) continue
    const doc = parseDoc(value)
    if (doc) docs.push(doc)
    else console.warn(`[thunder-writer] Skipping unreadable local document ${key}`)
  }
  return docs.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getLastOpenedId(): Promise<string | null> {
  const v = await get<unknown>(LAST_OPENED_KEY, db())
  return typeof v === 'string' ? v : null
}

export async function setLastOpenedId(id: string | null): Promise<void> {
  if (writesSuspended) return
  if (id) await set(LAST_OPENED_KEY, id, db())
  else await del(LAST_OPENED_KEY, db())
}

/** Removes every document and metadata value from this browser's store. */
export async function clearLocalStore(): Promise<void> {
  await clear(db())
}
