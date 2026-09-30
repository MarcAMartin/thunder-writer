import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  autoDecision,
  changedCharCount,
  effectiveCooldownMs,
  manualDecision,
  mergeLastTriviaAt,
  requestCount,
  SuggestionScheduler,
  triviaDue,
  type GateConfig,
  type GateState,
  type TriviaClock,
} from './scheduler'

const cfg: GateConfig = { autoEnabled: true, hasKey: true, idleMs: 4_000, cooldownMs: 45_000, maxOpen: 2 }
const fresh = (): GateState => ({ lastEditAt: null, lastRequestAt: null, lastRequestText: '', inFlight: false, errorStreak: 0 })
const TEXT = 'The rain came down in sheets over the harbor, and nobody spoke.'

describe('pure gates', () => {
  it('changedCharCount measures the differing span', () => {
    expect(changedCharCount('abc', 'abc')).toBe(0)
    expect(changedCharCount('', 'hello')).toBe(5)
    expect(changedCharCount('hello world', 'hello brave world')).toBe(6)
    expect(changedCharCount('the cat sat', 'the dog sat')).toBe(3)
    expect(changedCharCount('abcdef', 'abc')).toBe(3)
  })

  it('requestCount fills up to maxOpen, max 2 per request', () => {
    expect(requestCount(2, 0)).toBe(2)
    expect(requestCount(2, 1)).toBe(1)
    expect(requestCount(2, 2)).toBe(0)
    expect(requestCount(5, 0)).toBe(2)
    expect(requestCount(0, 0)).toBe(1)
  })

  it('backs off exponentially on errors, capped', () => {
    expect(effectiveCooldownMs(10, 0)).toBe(10)
    expect(effectiveCooldownMs(10, 2)).toBe(40)
    expect(effectiveCooldownMs(10, 9)).toBe(80)
  })

  it('auto waits for key, enablement, an edit, idle, cooldown, length and change', () => {
    const s = fresh()
    const t = () => TEXT
    expect(autoDecision(0, { ...cfg, hasKey: false }, s, 0, t)).toMatchObject({ reason: 'no_key' })
    expect(autoDecision(0, { ...cfg, autoEnabled: false }, s, 0, t)).toMatchObject({ reason: 'disabled' })
    expect(autoDecision(0, cfg, s, 0, t)).toMatchObject({ reason: 'no_edit' })
    s.lastEditAt = 1_000
    expect(autoDecision(2_000, cfg, s, 0, t)).toMatchObject({ reason: 'typing', retryInMs: 3_000 })
    expect(autoDecision(5_000, cfg, s, 2, t)).toMatchObject({ reason: 'full' })
    expect(autoDecision(5_000, cfg, s, 0, () => 'short')).toMatchObject({ reason: 'too_short' })
    expect(autoDecision(5_000, cfg, s, 1, t)).toEqual({ fire: true, count: 1, trivia: false })
    s.lastRequestAt = 5_000
    s.lastRequestText = TEXT
    s.lastEditAt = 6_000
    expect(autoDecision(20_000, cfg, s, 0, t)).toMatchObject({ reason: 'cooldown' })
    expect(autoDecision(60_000, cfg, s, 0, t)).toMatchObject({ reason: 'unchanged' })
    expect(autoDecision(60_000, cfg, s, 0, () => TEXT + ' Then the lighthouse went dark, all at once.')).toEqual({ fire: true, count: 2, trivia: false })
  })

  it('does not evaluate text when cheap gates fail', () => {
    const getText = vi.fn(() => TEXT)
    autoDecision(0, cfg, fresh(), 0, getText)
    expect(getText).not.toHaveBeenCalled()
  })

  it('manual bypasses idle/cooldown but not the lock, fullness or the 5s gap', () => {
    const s = fresh()
    expect(manualDecision(0, cfg, s, 0, TEXT)).toEqual({ fire: true, count: 2, trivia: false })
    expect(manualDecision(0, { ...cfg, autoEnabled: false }, s, 0, TEXT)).toEqual({ fire: true, count: 2, trivia: false })
    expect(manualDecision(0, cfg, s, 0, '   ')).toMatchObject({ reason: 'too_short' })
    expect(manualDecision(0, cfg, s, 2, TEXT)).toMatchObject({ reason: 'full' })
    s.inFlight = true
    expect(manualDecision(0, cfg, s, 0, TEXT)).toMatchObject({ reason: 'in_flight' })
    s.inFlight = false
    s.lastRequestAt = 10_000
    expect(manualDecision(12_000, cfg, s, 0, TEXT)).toMatchObject({ reason: 'too_soon', retryInMs: 3_000 })
    expect(manualDecision(15_000, cfg, s, 0, TEXT)).toEqual({ fire: true, count: 2, trivia: false })
  })
})

describe('SuggestionScheduler (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => vi.useRealTimers())

  function setup(overrides: Partial<GateConfig> = {}, triviaClock?: TriviaClock) {
    let text = TEXT
    let open = 0
    const pending: Array<(ok: boolean) => void> = []
    const signals: AbortSignal[] = []
    const run = vi.fn((_count: number, _text: string, signal: AbortSignal, _trivia: boolean) => {
      signals.push(signal)
      return new Promise<boolean>((resolve) => pending.push(resolve))
    })
    const inFlight = vi.fn()
    const scheduler = new SuggestionScheduler({
      getConfig: () => ({ ...cfg, ...overrides }),
      getOpenCount: () => open,
      getText: () => text,
      run,
      onInFlightChange: inFlight,
      triviaClock,
    })
    return {
      scheduler,
      run,
      inFlight,
      signals,
      resolveNext: async (ok = true) => {
        pending.shift()?.(ok)
        await vi.advanceTimersByTimeAsync(0)
      },
      setText: (t: string) => (text = t),
      setOpen: (n: number) => (open = n),
    }
  }

  it('fires once after the idle period, then respects the cooldown', async () => {
    const h = setup()
    h.scheduler.start()
    h.scheduler.noteEdit()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(h.run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.run).toHaveBeenCalledTimes(1)
    expect(h.run.mock.calls[0][0]).toBe(2)
    expect(h.inFlight).toHaveBeenLastCalledWith(true)

    // In flight: no second request even with more edits.
    h.setText(TEXT + ' More words arrive here, quite a few of them in fact.')
    h.scheduler.noteEdit()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(h.run).toHaveBeenCalledTimes(1)

    await h.resolveNext(true)
    expect(h.inFlight).toHaveBeenLastCalledWith(false)
    // Still inside the 45s cooldown measured from request start (t=4s).
    await vi.advanceTimersByTimeAsync(20_000)
    expect(h.run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(h.run).toHaveBeenCalledTimes(2)
    h.scheduler.stop()
  })

  it('keeps quiet while the writer keeps typing', async () => {
    const h = setup()
    h.scheduler.start()
    for (let i = 0; i < 10; i++) {
      h.scheduler.noteEdit()
      await vi.advanceTimersByTimeAsync(2_000)
    }
    expect(h.run).not.toHaveBeenCalled()
    h.scheduler.stop()
  })

  it('does not fire while the pane is full', async () => {
    const h = setup()
    h.setOpen(2)
    h.scheduler.start()
    h.scheduler.noteEdit()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.run).not.toHaveBeenCalled()
    h.scheduler.stop()
  })

  it('doubles the cooldown after a failure', async () => {
    const h = setup({ cooldownMs: 10_000 })
    h.scheduler.start()
    h.scheduler.noteEdit()
    await vi.advanceTimersByTimeAsync(4_000)
    expect(h.run).toHaveBeenCalledTimes(1)
    await h.resolveNext(false)
    h.setText(TEXT + ' A fresh paragraph with plenty of brand-new characters.')
    h.scheduler.noteEdit()
    await vi.advanceTimersByTimeAsync(12_000) // > 10s but < 20s since the request
    expect(h.run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(h.run).toHaveBeenCalledTimes(2)
    h.scheduler.stop()
  })

  it('manual request goes immediately, then enforces the minimum gap', async () => {
    const h = setup()
    expect(h.scheduler.requestNow()).toEqual({ fire: true, count: 2, trivia: false })
    expect(h.scheduler.requestNow()).toMatchObject({ reason: 'in_flight' })
    await h.resolveNext(true)
    expect(h.scheduler.requestNow()).toMatchObject({ reason: 'too_soon' })
    vi.advanceTimersByTime(5_000)
    expect(h.scheduler.requestNow()).toEqual({ fire: true, count: 2, trivia: false })
    expect(h.run).toHaveBeenCalledTimes(2)
  })

  it('stop() aborts the in-flight request', () => {
    const h = setup()
    h.scheduler.requestNow()
    expect(h.signals[0].aborted).toBe(false)
    h.scheduler.stop()
    expect(h.signals[0].aborted).toBe(true)
  })

  it('includes web-searched trivia at most once per trivia cooldown, riding on normal requests', async () => {
    // Normal cadence 45s; trivia at most every 10 minutes.
    const t0 = Date.now()
    const h = setup({ triviaSearch: true, triviaCooldownMs: 600_000 })
    h.scheduler.start()
    let body = TEXT
    const edit = (i: number) => {
      body += ` Paragraph ${i}: the tide went out and took the bells with it, again and again.`
      h.setText(body)
      h.scheduler.noteEdit()
    }
    edit(0)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(h.run).toHaveBeenCalledTimes(1)
    expect(h.run.mock.calls[0][3]).toBe(true) // first request: trivia due
    await h.resolveNext(true)

    // Keep writing; the normal cadence continues without searching.
    for (let i = 1; i <= 12; i++) {
      edit(i)
      await vi.advanceTimersByTimeAsync(46_000)
      await h.resolveNext(true)
    }
    const calls = h.run.mock.calls
    expect(calls.length).toBeGreaterThan(5)
    const triviaAt = calls.map((c, i) => (c[3] ? i : -1)).filter((i) => i >= 0)
    expect(triviaAt).toEqual([0]) // 12 × 46s ≈ 9.2 min: still inside the 10-minute trivia cooldown

    // Past 10 minutes since the first trivia attempt: the next normal request carries trivia again.
    await h.resolveNext(true)
    const firstTriviaAt = t0 + 4_000
    expect(Date.now() - firstTriviaAt).toBeLessThan(600_000)
    await vi.advanceTimersByTimeAsync(firstTriviaAt + 600_000 - Date.now())
    const before = h.run.mock.calls.length
    edit(99)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(h.run.mock.calls.length).toBe(before + 1)
    const last = h.run.mock.calls[h.run.mock.calls.length - 1]
    expect(last[3]).toBe(true)
    expect(h.scheduler.snapshot.lastTriviaAt! - firstTriviaAt).toBeGreaterThanOrEqual(600_000)
    h.scheduler.stop()
  })

  it('never searches when trivia search is off, and a search never fires a request by itself', async () => {
    const off = setup({ triviaSearch: false, triviaCooldownMs: 120_000 })
    expect(off.scheduler.requestNow()).toEqual({ fire: true, count: 2, trivia: false })
    await off.resolveNext(true)

    const on = setup({ triviaSearch: true, triviaCooldownMs: 120_000 })
    on.scheduler.start()
    // No edits: trivia being due must not trigger anything.
    await vi.advanceTimersByTimeAsync(300_000)
    expect(on.run).not.toHaveBeenCalled()
    on.scheduler.stop()
  })

  it('a failed trivia request still starts the trivia cooldown', async () => {
    const h = setup({ triviaSearch: true, triviaCooldownMs: 600_000 })
    expect(h.scheduler.requestNow()).toMatchObject({ fire: true, trivia: true })
    await h.resolveNext(false)
    vi.advanceTimersByTime(60_000)
    expect(h.scheduler.requestNow()).toMatchObject({ fire: true, trivia: false })
  })
})

describe('trivia cooldown persisted across scheduler instances (remount / reload / other tab)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => vi.useRealTimers())

  function clock(initial: number | null = null) {
    let at = initial
    return { load: vi.fn(() => at), save: vi.fn((t: number) => void (at = t)) } satisfies TriviaClock
  }

  function make(c: TriviaClock) {
    const run = vi.fn(async () => true)
    const scheduler = new SuggestionScheduler({
      getConfig: () => ({ ...cfg, triviaSearch: true, triviaCooldownMs: 600_000 }),
      getOpenCount: () => 0,
      getText: () => TEXT,
      run,
      triviaClock: c,
    })
    return { scheduler, run }
  }

  it('a new scheduler inside the cooldown does not search again; after it, it does', async () => {
    const c = clock()
    const first = make(c)
    expect(first.scheduler.requestNow()).toMatchObject({ fire: true, trivia: true })
    expect(c.save).toHaveBeenCalledWith(1_000_000)
    first.scheduler.stop()

    // One minute later the engine remounts (Settings and back, a reload, another tab).
    vi.advanceTimersByTime(60_000)
    const second = make(c)
    expect(second.scheduler.requestNow()).toMatchObject({ fire: true, trivia: false })
    await vi.advanceTimersByTimeAsync(0)
    second.scheduler.stop()

    vi.advanceTimersByTime(540_000) // 10 minutes after the first search
    const third = make(c)
    expect(third.scheduler.requestNow()).toMatchObject({ fire: true, trivia: true })
    third.scheduler.stop()
  })

  it('picks up a search made elsewhere while it is running', () => {
    const c = clock()
    const h = make(c)
    c.save(Date.now()) // another tab searched just now
    expect(h.scheduler.requestNow()).toMatchObject({ fire: true, trivia: false })
    h.scheduler.stop()
  })

  it('mergeLastTriviaAt keeps the later time and restarts a future one from now', () => {
    expect(mergeLastTriviaAt(100, null, null)).toBeNull()
    expect(mergeLastTriviaAt(100, 50, null)).toBe(50)
    expect(mergeLastTriviaAt(100, null, 40)).toBe(40)
    expect(mergeLastTriviaAt(100, 50, 60)).toBe(60)
    expect(mergeLastTriviaAt(100, 70, 60)).toBe(70)
    expect(mergeLastTriviaAt(100, null, 10 ** 12)).toBe(100)
    expect(mergeLastTriviaAt(100, null, Number.NaN)).toBeNull()
  })
})

describe('triviaDue', () => {
  const base = { ...cfg, triviaSearch: true, triviaCooldownMs: 600_000 }
  it('is due when search is on and the cooldown has passed', () => {
    expect(triviaDue(0, base, fresh())).toBe(true)
    expect(triviaDue(599_999, base, { ...fresh(), lastTriviaAt: 0 })).toBe(false)
    expect(triviaDue(600_000, base, { ...fresh(), lastTriviaAt: 0 })).toBe(true)
  })
  it('is never due when search is off or unavailable', () => {
    expect(triviaDue(10 ** 9, { ...base, triviaSearch: false }, fresh())).toBe(false)
    expect(triviaDue(10 ** 9, cfg, fresh())).toBe(false)
  })
  it('manual and automatic decisions carry it only when the normal gates pass', () => {
    const s = { ...fresh(), lastEditAt: 0 }
    expect(autoDecision(5_000, base, s, 0, () => TEXT)).toEqual({ fire: true, count: 2, trivia: true })
    expect(autoDecision(1_000, base, s, 0, () => TEXT)).toMatchObject({ fire: false, reason: 'typing' })
    expect(manualDecision(0, base, fresh(), 2, TEXT)).toMatchObject({ fire: false, reason: 'full' })
    expect(manualDecision(0, base, { ...fresh(), lastTriviaAt: -1 }, 0, TEXT)).toEqual({ fire: true, count: 2, trivia: false })
  })
})
