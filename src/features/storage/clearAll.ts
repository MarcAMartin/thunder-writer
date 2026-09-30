import { disconnectDrive } from './driveSession'
import { DB_NAME, clearLocalStore, suspendWrites } from './local'

const PREFIX = 'thunder-writer'

function removeKeys(storage: Storage | undefined) {
  if (!storage) return
  const doomed: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k && k.startsWith(PREFIX)) doomed.push(k)
  }
  for (const k of doomed) storage.removeItem(k)
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name)
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

/**
 * Wipes everything Thunder Writer keeps in this browser: manuscripts, context
 * files, settings and API keys. Google Drive files are untouched. The caller
 * should reload the page afterwards.
 */
export async function clearAllLocalData(): Promise<void> {
  suspendWrites()
  disconnectDrive()
  await clearLocalStore().catch(() => undefined)
  try {
    const dbs = (await indexedDB.databases?.()) ?? []
    await Promise.all(
      dbs
        .map((d) => d.name)
        .filter((n): n is string => !!n && n.startsWith(PREFIX) && n !== DB_NAME)
        .map(deleteDb),
    )
  } catch {
    // indexedDB.databases() is not available everywhere; the main store is already cleared.
  }
  removeKeys(typeof localStorage !== 'undefined' ? localStorage : undefined)
  removeKeys(typeof sessionStorage !== 'undefined' ? sessionStorage : undefined)
}
