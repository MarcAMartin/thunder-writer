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
