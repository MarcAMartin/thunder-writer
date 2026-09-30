/**
 * Edits that live briefly outside the documents store (the editor debounces
 * keystrokes before calling updateContent). Code that is about to persist,
 * compare or replace a document calls flushPendingEdits() first so the store
 * holds the writer's latest words.
 */
const flushers = new Set<() => void>()

/** Registers a synchronous flush; returns the unregister function. */
export function registerPendingFlush(fn: () => void): () => void {
  flushers.add(fn)
  return () => {
    flushers.delete(fn)
  }
}

/** Pushes every pending edit into the documents store, synchronously. */
export function flushPendingEdits(): void {
  for (const fn of [...flushers]) {
    try {
      fn()
    } catch (e) {
      console.error('[thunder-writer] Could not flush pending edits', e)
    }
  }
}

/**
 * Writes that are queued for the browser's own storage (IndexedDB). Storage
 * registers one persister; it returns null once everything is written, or a
 * writer-facing message when the browser refused the write.
 */
type Persister = () => Promise<string | null>
const persisters = new Set<Persister>()

/** Registers the local-storage flush; returns the unregister function. */
export function registerBrowserPersister(fn: Persister): () => void {
  persisters.add(fn)
  return () => {
    persisters.delete(fn)
  }
}

/**
 * Pushes pending editor edits into the store and writes everything queued to
 * IndexedDB now. Resolves with null when the browser holds the latest words,
 * or with an error message. The IndexedDB write starts synchronously, so a
 * caller in a key press can still open a permission prompt afterwards.
 */
export function saveInBrowserNow(): Promise<string | null> {
  flushPendingEdits()
  const runs = [...persisters].map((fn) =>
    fn().catch((e: unknown) => (e instanceof Error && e.message ? e.message : 'Could not save in this browser.')),
  )
  return Promise.all(runs).then((errors) => errors.find((e) => e !== null) ?? null)
}
