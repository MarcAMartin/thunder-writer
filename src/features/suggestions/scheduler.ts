// Pure timing/gating logic for suggestion requests. No React, no SDKs: the
// hook wires this to the editor and providers, tests drive it with fake timers.

import {
  MANUAL_MIN_GAP_MS,
  MAX_BACKOFF_EXPONENT,
  MAX_PER_REQUEST,
  MIN_DOC_CHARS,
  MIN_NEW_CHARS,
  SCHEDULER_TICK_MS,
} from './constants'

export interface GateConfig {
  /** Automatic (background) suggestions switch. Manual requests ignore it. */
  autoEnabled: boolean
  hasKey: boolean
  idleMs: number
  cooldownMs: number
  maxOpen: number
  minNewChars?: number
  minDocChars?: number
  manualMinGapMs?: number
  /**
   * Web-searched trivia is possible right now: the writer's toggle is on and the
   * provider/model can search. Grammar, style and other suggestions never search.
   */
  triviaSearch?: boolean
  /** Minimum gap between web-searched trivia requests. */
  triviaCooldownMs?: number
}

export interface GateState {
  lastEditAt: number | null
  lastRequestAt: number | null
  /** Text the last request was built from ('' before any request). */
  lastRequestText: string
  inFlight: boolean
  /** Consecutive failed requests; doubles the automatic cooldown. */
  errorStreak: number
  /** When the last request that included a web-searched trivia attempt started. */
  lastTriviaAt?: number | null
}

export type BlockReason =
  | 'no_key'
  | 'disabled'
  | 'in_flight'
  | 'full'
  | 'no_edit'
  | 'typing'
  | 'cooldown'
  | 'too_short'
  | 'unchanged'
  | 'too_soon'

/** `trivia`: this request should also try one web-searched current-events trivia item. */
export type Decision = { fire: true; count: number; trivia: boolean } | { fire: false; reason: BlockReason; retryInMs?: number }

/**
 * Number of characters that differ between two texts, measured as the span
 * left after stripping the common prefix and suffix. Cheap (O(n)) and catches
 * insertions, deletions, and in-place rewrites.
 */
export function changedCharCount(prev: string, next: string): number {
  if (prev === next) return 0
  const minLen = Math.min(prev.length, next.length)
  let start = 0
  while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev--
    endNext--
  }
  return Math.max(endPrev - start, endNext - start)
}

/** How many to ask for: fill up to maxOpen, never more than MAX_PER_REQUEST. */
export function requestCount(maxOpen: number, openCount: number): number {
  const cap = Math.max(1, Math.floor(maxOpen))
  return Math.max(0, Math.min(MAX_PER_REQUEST, cap - openCount))
}

export function effectiveCooldownMs(cooldownMs: number, errorStreak: number): number {
  return cooldownMs * 2 ** Math.min(Math.max(0, errorStreak), MAX_BACKOFF_EXPONENT)
}

/**
 * Is a web-searched trivia attempt due? Only when search is available and the
 * trivia cooldown has passed since the last attempt. Only consulted once the
 * normal gates have already decided to fire, so a search never causes a
 * request on its own and never changes the normal cadence.
 */
export function triviaDue(now: number, cfg: GateConfig, state: GateState): boolean {
  if (!cfg.triviaSearch) return false
  const last = state.lastTriviaAt ?? null
  if (last === null) return true
  return now - last >= (cfg.triviaCooldownMs ?? Number.POSITIVE_INFINITY)
}

/** Should the background engine fire right now? `getText` is only called if the cheap checks pass. */
export function autoDecision(
  now: number,
  cfg: GateConfig,
  state: GateState,
  openCount: number,
  getText: () => string,
): Decision {
  if (!cfg.hasKey) return { fire: false, reason: 'no_key' }
  if (!cfg.autoEnabled) return { fire: false, reason: 'disabled' }
  if (state.inFlight) return { fire: false, reason: 'in_flight' }
  const count = requestCount(cfg.maxOpen, openCount)
  if (count === 0) return { fire: false, reason: 'full' }
  if (state.lastEditAt === null) return { fire: false, reason: 'no_edit' }
  // Nothing typed since the last request: skip without reading the document.
  if (state.lastRequestAt !== null && state.lastEditAt < state.lastRequestAt) return { fire: false, reason: 'unchanged' }
  const idleFor = now - state.lastEditAt
  if (idleFor < cfg.idleMs) return { fire: false, reason: 'typing', retryInMs: cfg.idleMs - idleFor }
  if (state.lastRequestAt !== null) {
    const cooldown = effectiveCooldownMs(cfg.cooldownMs, state.errorStreak)
    const since = now - state.lastRequestAt
    if (since < cooldown) return { fire: false, reason: 'cooldown', retryInMs: cooldown - since }
  }
  const text = getText()
  if (text.trim().length < (cfg.minDocChars ?? MIN_DOC_CHARS)) return { fire: false, reason: 'too_short' }
  if (changedCharCount(state.lastRequestText, text) < (cfg.minNewChars ?? MIN_NEW_CHARS)) {
    return { fire: false, reason: 'unchanged' }
  }
  return { fire: true, count, trivia: triviaDue(now, cfg, state) }
}

/** Should a click on "Generate Suggestions" go through? Bypasses idle/cooldown, not the lock. */
export function manualDecision(now: number, cfg: GateConfig, state: GateState, openCount: number, text: string): Decision {
  if (!cfg.hasKey) return { fire: false, reason: 'no_key' }
  if (state.inFlight) return { fire: false, reason: 'in_flight' }
  const count = requestCount(cfg.maxOpen, openCount)
  if (count === 0) return { fire: false, reason: 'full' }
  if (text.trim().length === 0) return { fire: false, reason: 'too_short' }
  if (state.lastRequestAt !== null) {
    const gap = cfg.manualMinGapMs ?? MANUAL_MIN_GAP_MS
    const since = now - state.lastRequestAt
    if (since < gap) return { fire: false, reason: 'too_soon', retryInMs: gap - since }
  }
  return { fire: true, count, trivia: triviaDue(now, cfg, state) }
}

export function blockReasonMessage(reason: BlockReason, retryInMs?: number): string {
  switch (reason) {
    case 'no_key':
      return 'Add an API key in Settings to get suggestions.'
    case 'disabled':
      return 'Automatic suggestions are off.'
    case 'in_flight':
      return 'Already working on a suggestion…'
    case 'full':
      return 'Resolve an open suggestion to get another.'
    case 'no_edit':
    case 'typing':
    case 'unchanged':
      return 'Suggestions appear when you pause after writing a bit more.'
    case 'cooldown':
      return 'Taking a breather between suggestions.'
    case 'too_short':
      return 'Write a little first, then ask for suggestions.'
    case 'too_soon':
      return `One moment — try again in ${Math.max(1, Math.ceil((retryInMs ?? 0) / 1000))}s.`
  }
}

/**
 * Runs a request for `count` suggestions from `text`; when `trivia` is true one
 * of those slots may be filled by a web-searched trivia item. Resolves true on success.
 */
export type RunFn = (count: number, text: string, signal: AbortSignal, trivia: boolean) => Promise<boolean>

export interface SchedulerDeps {
  getConfig: () => GateConfig
  getOpenCount: () => number
  getText: () => string
  run: RunFn
  now?: () => number
  tickMs?: number
  /** Notified when a request starts or ends. */
  onInFlightChange?: (inFlight: boolean) => void
  /**
   * Durable record of the last web-searched trivia attempt, so the trivia
   * cooldown survives remounts, reloads and other tabs. Without it the
   * scheduler only remembers attempts it launched itself.
   */
  triviaClock?: TriviaClock
}

export interface TriviaClock {
  load: () => number | null
  save: (at: number) => void
}

/**
 * Merge a persisted last-trivia time into the in-memory one (the later wins).
 * A persisted time in the future (clock changed) restarts the cooldown from now
 * rather than blocking searched trivia until the clock catches up.
 */
export function mergeLastTriviaAt(now: number, current: number | null, persisted: number | null): number | null {
  const p = persisted !== null && Number.isFinite(persisted) ? Math.min(persisted, now) : null
  if (p === null) return current
  if (current === null) return p
  return Math.max(current, p)
}

/**
 * Stateful wrapper: tracks edits and requests, ticks on an interval to fire
 * automatic requests, holds the single in-flight lock and its AbortController.
 */
export class SuggestionScheduler {
  private state: GateState = {
    lastEditAt: null,
    lastRequestAt: null,
    lastRequestText: '',
    inFlight: false,
    errorStreak: 0,
    lastTriviaAt: null,
  }
  private timer: ReturnType<typeof setInterval> | null = null
  private controller: AbortController | null = null
  private readonly deps: SchedulerDeps
  private readonly now: () => number

  constructor(deps: SchedulerDeps) {
    this.deps = deps
    this.now = deps.now ?? (() => Date.now())
  }

  get snapshot(): Readonly<GateState> {
    return { ...this.state }
  }

  /** Call on every document change. */
  noteEdit(): void {
    this.state.lastEditAt = this.now()
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.tick(), this.deps.tickMs ?? SCHEDULER_TICK_MS)
  }

  /** Stop ticking and abort any in-flight request. */
  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.controller?.abort()
    this.controller = null
  }

  /** Cancel the in-flight request (if any) but keep ticking. Not counted as a failure. */
  abort(): void {
    this.controller?.abort()
  }

  /** Pick up a searched-trivia attempt made by an earlier engine instance or another tab. */
  private syncTrivia(): void {
    const clock = this.deps.triviaClock
    if (!clock) return
    this.state.lastTriviaAt = mergeLastTriviaAt(this.now(), this.state.lastTriviaAt ?? null, clock.load())
  }

  tick(): Decision {
    this.syncTrivia()
    const d = autoDecision(this.now(), this.deps.getConfig(), this.state, this.deps.getOpenCount(), this.deps.getText)
    if (d.fire) this.launch(d.count, this.deps.getText(), d.trivia)
    return d
  }

  requestNow(): Decision {
    this.syncTrivia()
    const text = this.deps.getText()
    const d = manualDecision(this.now(), this.deps.getConfig(), this.state, this.deps.getOpenCount(), text)
    if (d.fire) this.launch(d.count, text, d.trivia)
    return d
  }

  private launch(count: number, text: string, trivia: boolean): void {
    const controller = new AbortController()
    this.controller = controller
    this.state.inFlight = true
    this.state.lastRequestAt = this.now()
    // Counted at launch, success or not: a failing search must not be retried every cycle.
    if (trivia) {
      this.state.lastTriviaAt = this.state.lastRequestAt
      this.deps.triviaClock?.save(this.state.lastRequestAt)
    }
    this.state.lastRequestText = text
    this.deps.onInFlightChange?.(true)

    const finish = (ok: boolean) => {
      if (this.controller === controller) this.controller = null
      this.state.inFlight = false
      if (ok) this.state.errorStreak = 0
      else if (!controller.signal.aborted) this.state.errorStreak += 1
      this.deps.onInFlightChange?.(false)
    }
    this.deps.run(count, text, controller.signal, trivia).then(
      (ok) => finish(ok),
      () => finish(false),
    )
  }
}
