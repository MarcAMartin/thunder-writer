import type { DocumentsState } from '../../store/documents'
import type { ThunderDoc } from '../../types'

/**
 * Drive autosave scheduling, kept free of React and network code.
 *
 * Rules:
 *  - A change schedules a save `debounceMs` after the LAST change (typing pause).
 *  - Saves start at most once every `intervalMs` (driveAutosaveSec); a debounced
 *    save that arrives early waits for the gate.
 *  - While still dirty, the interval also triggers a save (covers non-stop typing).
 *  - Single-flight: never two uploads at once; a trigger during an upload re-runs after it.
 *  - After a failure, automatic attempts back off for `retryDelayMs`.
 *  - intervalMs = 0 means "only on the change debounce": no gate, no interval.
 */
export interface AutosaveOptions {
  save: () => Promise<void>
  isDirty: () => boolean
  debounceMs?: number
  intervalMs: number
  retryDelayMs?: number
  now?: () => number
}

export interface AutosaveScheduler {
  notifyChange(): void
  /** Manual save: ignores the gate/backoff but still single-flight. Rejects on failure. */
  saveNow(): Promise<void>
  setIntervalMs(ms: number): void
  readonly inFlight: boolean
  dispose(): void
}

export function createAutosaveScheduler(opts: AutosaveOptions): AutosaveScheduler {
  const debounceMs = opts.debounceMs ?? 5000
  const retryDelayMs = opts.retryDelayMs ?? 30_000
  const now = opts.now ?? Date.now
  let intervalMs = Math.max(0, opts.intervalMs)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let gateTimer: ReturnType<typeof setTimeout> | null = null
  let gateAt = 0
  let intervalTimer: ReturnType<typeof setInterval> | null = null
  let inFlight: Promise<void> | null = null
  let rerun = false
  let lastStart = Number.NEGATIVE_INFINITY
  let blockedUntil = 0
  let disposed = false

  function clearGate() {
    if (gateTimer) clearTimeout(gateTimer)
    gateTimer = null
    gateAt = 0
  }

  function startInterval() {
    if (intervalTimer) clearInterval(intervalTimer)
    intervalTimer = null
    if (intervalMs > 0) intervalTimer = setInterval(attempt, intervalMs)
  }

  function run(): Promise<void> {
    clearGate()
    lastStart = now()
    const p = opts.save()
    inFlight = p.then(
      () => {
        blockedUntil = 0
      },
      () => {
        blockedUntil = now() + retryDelayMs
      },
    )
    void inFlight.then(() => {
      inFlight = null
      if (rerun && !disposed) {
        rerun = false
        attempt()
      }
    })
    return p
  }

  function attempt() {
    if (disposed || !opts.isDirty()) return
    if (inFlight) {
      rerun = true
      return
    }
    const earliest = Math.max(intervalMs > 0 ? lastStart + intervalMs : 0, blockedUntil)
    const t = now()
    if (t < earliest) {
      if (!gateTimer || earliest < gateAt) {
        clearGate()
        gateAt = earliest
        gateTimer = setTimeout(() => {
          gateTimer = null
          gateAt = 0
          attempt()
        }, earliest - t)
      }
      return
    }
    void run().catch(() => {
      // Errors are reported by the save function itself; backoff is applied above.
    })
  }

  startInterval()

  return {
    notifyChange() {
      if (disposed) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        attempt()
      }, debounceMs)
    },
    async saveNow() {
      if (disposed) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = null
      blockedUntil = 0
      while (inFlight) await inFlight
      await run()
    },
    setIntervalMs(ms: number) {
      const next = Math.max(0, ms)
      if (next === intervalMs) return
      intervalMs = next
      startInterval()
      if (gateTimer) {
        clearGate()
        attempt()
      }
    },
    get inFlight() {
      return inFlight !== null
    },
    dispose() {
      disposed = true
      if (debounceTimer) clearTimeout(debounceTimer)
      if (intervalTimer) clearInterval(intervalTimer)
      clearGate()
    },
  }
}

export interface PendingOptions {
  /**
   * Also include docs not yet in Drive (set while Drive is connected): those
   * edited this session, plus the open one. Their first autosave creates the
   * Drive file, so writing in a new manuscript is backed up without a manual
   * "Save to Drive". Untouched old local docs are not bulk-uploaded.
   */
  includeUnlinked?: boolean
  currentId?: string | null
  /** Docs to leave alone (e.g. in conflict, or last changed by another tab). */
  skip?: (id: string) => boolean
}

/** True when a TipTap JSON doc contains any non-whitespace text. */
export function hasWords(content: unknown): boolean {
  if (!content || typeof content !== 'object') return false
  const n = content as { text?: unknown; content?: unknown }
  if (typeof n.text === 'string' && n.text.trim()) return true
  return Array.isArray(n.content) && n.content.some(hasWords)
}

/**
 * Docs that should be (re)written to Drive: linked to a Drive file and changed
 * since the last sync (and, with includeUnlinked, new docs with words in
 * them). `dirtyForDrive` is in-memory only, so after a reload the timestamps
 * are the fallback signal for linked docs.
 */
export function pendingDriveDocs(
  s: Pick<DocumentsState, 'docs' | 'dirtyForDrive'>,
  opts: PendingOptions = {},
): ThunderDoc[] {
  return Object.values(s.docs).filter((d) => {
    if (opts.skip?.(d.id)) return false
    const dirty = s.dirtyForDrive[d.id] === true
    if (d.driveFileId) return dirty || (d.driveSyncedAt ?? 0) < d.updatedAt
    return !!opts.includeUnlinked && (dirty || d.id === opts.currentId) && hasWords(d.content)
  })
}

// ---------------------------------------------------------------------------
// Save-status wording for the header indicator.

export type LocalStatus = 'idle' | 'saving' | 'saved' | 'error'
export type DriveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface StatusInput {
  local: LocalStatus
  drive: DriveStatus
  /** Wall-clock time this doc was last written to Drive in this session. */
  driveSavedAt?: number
  driveConnected: boolean
  doc: Pick<ThunderDoc, 'driveFileId' | 'driveSyncedAt' | 'updatedAt'> | null
  docDirtyForDrive: boolean
  /** The Drive failure needs a reconnect (token expired in the background). */
  driveNeedsReconnect?: boolean
  /** This doc's Drive file changed elsewhere; autosave is paused for it. */
  docConflict?: boolean
}

export type StatusTone = 'neutral' | 'busy' | 'ok' | 'warn' | 'error'
export type StatusAction = 'retry' | 'connect' | 'resolve' | null

export interface StatusView {
  label: string
  tone: StatusTone
  action: StatusAction
}

export const formatClock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function describeSaveStatus(i: StatusInput): StatusView {
  if (i.docConflict) return { label: 'Changed in Drive — resolve', tone: 'error', action: 'resolve' }
  if (i.drive === 'saving') return { label: 'Saving to Drive…', tone: 'busy', action: null }
  if (i.drive === 'error' && i.driveNeedsReconnect && i.driveConnected) {
    return { label: 'Drive paused — reconnect', tone: 'warn', action: 'connect' }
  }
  if (i.drive === 'error') return { label: 'Drive error — retry', tone: 'error', action: 'retry' }
  if (i.local === 'error') return { label: 'Browser storage error', tone: 'error', action: null }
  const linked = !!i.doc?.driveFileId
  if (linked && !i.driveConnected) return { label: 'Saved locally · Drive paused', tone: 'warn', action: 'connect' }
  if (linked && !i.docDirtyForDrive) {
    const at = i.driveSavedAt ?? i.doc?.driveSyncedAt
    return { label: at ? `Saved to Drive ${formatClock(at)}` : 'Saved to Drive', tone: 'ok', action: null }
  }
  if (i.local === 'saving') return { label: 'Saving…', tone: 'busy', action: null }
  if (linked) return { label: 'Saved locally · Drive pending', tone: 'neutral', action: null }
  if (i.driveConnected && i.docDirtyForDrive) return { label: 'Saved locally · Drive pending', tone: 'neutral', action: null }
  return { label: 'Saved locally', tone: 'neutral', action: null }
}
