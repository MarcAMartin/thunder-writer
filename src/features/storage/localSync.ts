import type { ThunderDoc } from '../../types'

export interface DocsSnapshot {
  docs: Record<string, ThunderDoc>
  currentId: string | null
}

export interface DocsDiff {
  saved: ThunderDoc[]
  deleted: string[]
  currentChanged: boolean
}

/** Which docs changed between two store snapshots (store updates are immutable, so identity is enough). */
export function diffDocs(prev: DocsSnapshot, next: DocsSnapshot): DocsDiff {
  const saved: ThunderDoc[] = []
  const deleted: string[] = []
  if (prev.docs !== next.docs) {
    for (const [id, doc] of Object.entries(next.docs)) if (prev.docs[id] !== doc) saved.push(doc)
    for (const id of Object.keys(prev.docs)) if (!(id in next.docs)) deleted.push(id)
  }
  return { saved, deleted, currentChanged: prev.currentId !== next.currentId }
}

export type LocalSaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface LocalSyncDeps {
  saveDoc: (doc: ThunderDoc) => Promise<void>
  deleteDoc: (id: string) => Promise<void>
  setLastOpenedId: (id: string | null) => Promise<void>
  onState?: (state: LocalSaveState, error?: unknown) => void
  /** Called after docs were written/deleted successfully (e.g. to tell other tabs). */
  onWritten?: (saved: ThunderDoc[], deleted: string[]) => void
  debounceMs?: number
}

/**
 * Debounced write-behind queue from the in-memory document store to IndexedDB.
 * Only the latest version of each doc is written; flush() writes immediately.
 */
export function createLocalSync(deps: LocalSyncDeps) {
  const debounceMs = deps.debounceMs ?? 500
  const pendingSave = new Map<string, ThunderDoc>()
  const pendingDelete = new Set<string>()
  let pendingCurrent: { id: string | null } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let chain: Promise<void> = Promise.resolve()

  const hasPending = () => pendingSave.size > 0 || pendingDelete.size > 0 || pendingCurrent !== null

  function schedule() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, debounceMs)
  }

  function queue(diff: DocsDiff, currentId: string | null) {
    for (const d of diff.saved) {
      pendingSave.set(d.id, d)
      pendingDelete.delete(d.id)
    }
    for (const id of diff.deleted) {
      pendingSave.delete(id)
      pendingDelete.add(id)
    }
    if (diff.currentChanged) pendingCurrent = { id: currentId }
    if (hasPending()) schedule()
  }

  function observe(prev: DocsSnapshot, next: DocsSnapshot) {
    queue(diffDocs(prev, next), next.currentId)
  }

  /** Writes everything pending now. Writes are serialized so they never interleave. */
  function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!hasPending()) return chain
    const saves = [...pendingSave.values()]
    const deletes = [...pendingDelete]
    const current = pendingCurrent
    pendingSave.clear()
    pendingDelete.clear()
    pendingCurrent = null
    deps.onState?.('saving')
    chain = chain
      .then(async () => {
        await Promise.all([
          ...saves.map((d) => deps.saveDoc(d)),
          ...deletes.map((id) => deps.deleteDoc(id)),
          ...(current ? [deps.setLastOpenedId(current.id)] : []),
        ])
        deps.onState?.('saved')
        deps.onWritten?.(saves, deletes)
      })
      .catch((err: unknown) => {
        // Re-queue what failed (unless something newer arrived) so the next change retries it.
        for (const d of saves) if (!pendingSave.has(d.id) && !pendingDelete.has(d.id)) pendingSave.set(d.id, d)
        for (const id of deletes) if (!pendingSave.has(id)) pendingDelete.add(id)
        if (current && !pendingCurrent) pendingCurrent = current
        deps.onState?.('error', err)
      })
    return chain
  }

  function dispose() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  return { observe, queue, flush, dispose, hasPending }
}

export type LocalSync = ReturnType<typeof createLocalSync>

/** Merge docs loaded from disk with any created in memory before hydration finished. */
export function mergeHydration(
  loaded: ThunderDoc[],
  inMemory: Record<string, ThunderDoc>,
): { docs: ThunderDoc[]; memoryOnly: ThunderDoc[] } {
  const byId = new Map(loaded.map((d) => [d.id, d]))
  const memoryOnly: ThunderDoc[] = []
  for (const d of Object.values(inMemory)) {
    const disk = byId.get(d.id)
    if (!disk || disk.updatedAt < d.updatedAt) {
      byId.set(d.id, d)
      memoryOnly.push(d)
    }
  }
  return { docs: [...byId.values()], memoryOnly }
}
