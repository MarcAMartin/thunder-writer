/**
 * When to rewrite the desktop copy. Free of React, IndexedDB and file APIs.
 *
 * Rules:
 *  - A change schedules a write `debounceMs` after the LAST change (typing pause).
 *  - While changes keep coming, a write still happens `maxIntervalMs` after the
 *    first unwritten change (non-stop typing is never left unsaved for long).
 *  - Automatic writes start at most once every `maxIntervalMs`.
 *  - Single-flight: never two writes at once. Changes made during a write stay
 *    pending and schedule another write after it.
 *  - A failed write is retried after `retryDelayMs`, unless `shouldPause(error)`
 *    says it can't succeed without the writer (permission lost, file gone):
 *    then the scheduler pauses until resume().
 *  - flush() (Cmd/Ctrl+S) writes now, ignoring the debounce and rate limit.
 */
export interface CopySchedulerOptions {
  write: () => Promise<void>
  debounceMs?: number
  maxIntervalMs?: number
  retryDelayMs?: number
  shouldPause?: (error: unknown) => boolean
  onState?: (s: CopySchedulerState) => void
  now?: () => number
}

export interface CopySchedulerState {
  /** Changes not yet in the file. */
  dirty: boolean
  writing: boolean
  paused: boolean
  lastWrittenAt: number | null
  lastError: unknown
}

export type FlushOutcome = 'written' | 'clean' | 'paused' | 'failed' | 'disposed'

export interface CopyScheduler {
  notifyChange(): void
  /** Writes now if there are unwritten changes (or always, with force). */
  flush(opts?: { force?: boolean }): Promise<FlushOutcome>
  pause(): void
  resume(): void
  dispose(): void
  getState(): CopySchedulerState
}

export const COPY_DEBOUNCE_MS = 15_000
export const COPY_MAX_INTERVAL_MS = 30_000
export const COPY_RETRY_MS = 60_000

export function createCopyScheduler(opts: CopySchedulerOptions): CopyScheduler {
  const debounceMs = opts.debounceMs ?? COPY_DEBOUNCE_MS
  const maxIntervalMs = opts.maxIntervalMs ?? COPY_MAX_INTERVAL_MS
  const retryDelayMs = opts.retryDelayMs ?? COPY_RETRY_MS
  const now = opts.now ?? Date.now

  let seq = 0
  let writtenSeq = 0
  let firstDirtyAt: number | null = null
  let lastChangeAt = 0
  let lastStartAt = Number.NEGATIVE_INFINITY
  let retryAfter = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<boolean> | null = null
  let paused = false
  let disposed = false
  let lastWrittenAt: number | null = null
  let lastError: unknown = null

  const dirty = () => seq > writtenSeq

  const state = (): CopySchedulerState => ({ dirty: dirty(), writing: inFlight !== null, paused, lastWrittenAt, lastError })
  const emit = () => {
    if (!disposed) opts.onState?.(state())
  }

  function clearTimer() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function schedule() {
    clearTimer()
    if (disposed || paused || inFlight || !dirty() || firstDirtyAt === null) return
    const due = Math.max(
      Math.min(lastChangeAt + debounceMs, firstDirtyAt + maxIntervalMs),
      lastStartAt + maxIntervalMs,
      retryAfter,
    )
    timer = setTimeout(() => {
      timer = null
      void run()
    }, Math.max(0, due - now()))
  }

  function run(): Promise<boolean> {
    if (inFlight) return inFlight
    clearTimer()
    const target = seq
    lastStartAt = now()
    // Changes from here on are "new" relative to this write.
    firstDirtyAt = null
    inFlight = (async () => {
      try {
        await opts.write()
        writtenSeq = Math.max(writtenSeq, target)
        lastWrittenAt = now()
        lastError = null
        retryAfter = 0
        return true
      } catch (e) {
        lastError = e
        if (opts.shouldPause?.(e)) paused = true
        else retryAfter = now() + retryDelayMs
        // The unwritten changes still count from when the write started.
        if (firstDirtyAt === null) firstDirtyAt = lastStartAt
        return false
      } finally {
        inFlight = null
      }
    })()
    emit()
    return inFlight.then((ok) => {
      if (!disposed) {
        emit()
        schedule()
      }
      return ok
    })
  }

  return {
    notifyChange() {
      if (disposed) return
      seq++
      lastChangeAt = now()
      if (firstDirtyAt === null) firstDirtyAt = lastChangeAt
      schedule()
      emit()
    },

    async flush({ force = false } = {}) {
      if (disposed) return 'disposed'
      if (paused) return 'paused'
      if (force) {
        seq++
        lastChangeAt = now()
        if (firstDirtyAt === null) firstDirtyAt = lastChangeAt
      }
      if (inFlight) {
        const ok = await inFlight
        if (disposed) return 'disposed'
        if (!dirty()) return ok ? 'written' : 'failed'
        if (paused) return 'paused'
      }
      if (!dirty()) return 'clean'
      const ok = await run()
      if (disposed) return 'disposed'
      return ok ? 'written' : paused ? 'paused' : 'failed'
    },

    pause() {
      paused = true
      clearTimer()
      emit()
    },

    resume() {
      if (disposed) return
      paused = false
      retryAfter = 0
      schedule()
      emit()
    },

    dispose() {
      disposed = true
      clearTimer()
    },

    getState: state,
  }
}
