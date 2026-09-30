/**
 * Page-turn state machine for the viewer. Pure; the component runs the
 * animation and reports back with `flipDone`.
 *
 * A turn is always drawn as one leaf hinged at the spine, between a lower view
 * `lo` and a higher view `hi`. Progress 0 shows `lo`, 1 shows `hi`. Forward
 * turns animate 0 → 1 and backward turns 1 → 0, so a backward turn is the
 * forward turn played in reverse. That is how a real page moves, and it
 * keeps the rendering to one case. A far jump is a single turn between
 * non-adjacent views, so it never animates through every page in between.
 *
 * Presses that arrive during a turn are queued in `target`. When the
 * current turn finishes, the next one runs faster. If the target is more than
 * a few views away, one quick turn goes straight there.
 */

export const FLIP_MS = 600
export const QUEUED_FLIP_MS = 300
export const LAST_QUEUED_FLIP_MS = 420
export const JUMP_FLIP_MS = 650
/** A queue longer than this is served by one jump rather than step by step. */
export const MAX_STEPPED_QUEUE = 3

export interface Flip {
  lo: number
  hi: number
  /** Progress at the start and end of the animation (0 = lo, 1 = hi). */
  from: number
  to: number
  /** View shown once the turn completes. */
  dest: number
  duration: number
  /** Pointer-driven: progress follows the pointer until dragEnd. */
  drag: boolean
  /** Changes for every new animation (keys effects). */
  id: number
}

export interface NavState {
  count: number
  /** View at rest (the origin while a turn runs). */
  current: number
  /** Where the reader has asked to end up. */
  target: number
  flip: Flip | null
  reducedMotion: boolean
  seq: number
}

export type NavAction =
  | { type: 'go'; delta: number }
  | { type: 'jump'; to: number; animate?: boolean }
  | { type: 'flipDone' }
  | { type: 'dragStart'; dir: 1 | -1 }
  | { type: 'dragEnd'; commit: boolean; progress: number }
  | { type: 'setCount'; count: number; current?: number }
  | { type: 'setMotion'; reduced: boolean }

export function initialNav(count: number, current = 0, reducedMotion = false): NavState {
  const c = Math.max(0, count)
  const cur = clampView(current, c)
  return { count: c, current: cur, target: cur, flip: null, reducedMotion, seq: 0 }
}

const clampView = (v: number, count: number) => Math.min(Math.max(0, count - 1), Math.max(0, Math.round(v)))

function startFlip(s: NavState, dest: number, duration: number): NavState {
  if (dest === s.current) return { ...s, target: dest, flip: null }
  if (s.reducedMotion || duration <= 0) return { ...s, current: dest, target: dest, flip: null }
  const forward = dest > s.current
  const seq = s.seq + 1
  return {
    ...s,
    seq,
    flip: {
      lo: Math.min(s.current, dest),
      hi: Math.max(s.current, dest),
      from: forward ? 0 : 1,
      to: forward ? 1 : 0,
      dest,
      duration,
      drag: false,
      id: seq,
    },
  }
}

export function navReducer(s: NavState, a: NavAction): NavState {
  switch (a.type) {
    case 'go': {
      if (s.count === 0 || a.delta === 0) return s
      if (s.flip?.drag) return s
      const target = clampView(s.target + a.delta, s.count)
      if (s.flip) return target === s.target ? s : { ...s, target }
      if (target === s.current) return s
      return startFlip({ ...s, target }, target, FLIP_MS)
    }
    case 'jump': {
      if (s.count === 0) return s
      const to = clampView(a.to, s.count)
      if (a.animate === false) return { ...s, current: to, target: to, flip: null }
      if (s.flip?.drag) return s
      if (s.flip) return to === s.target ? s : { ...s, target: to }
      if (to === s.current) return s
      const far = Math.abs(to - s.current) > 1
      return startFlip({ ...s, target: to }, to, far ? JUMP_FLIP_MS : FLIP_MS)
    }
    case 'flipDone': {
      if (!s.flip || s.flip.drag) return s
      const current = s.flip.dest
      const rest: NavState = { ...s, current, flip: null }
      // A cancelled drag lands back where it began, with nothing queued.
      if (s.target === current) return rest
      const dist = Math.abs(s.target - current)
      if (dist > MAX_STEPPED_QUEUE) return startFlip(rest, s.target, QUEUED_FLIP_MS)
      const step = current + Math.sign(s.target - current)
      return startFlip(rest, step, dist > 1 ? QUEUED_FLIP_MS : LAST_QUEUED_FLIP_MS)
    }
    case 'dragStart': {
      if (s.flip || s.reducedMotion) return s
      const dest = clampView(s.current + a.dir, s.count)
      if (dest === s.current) return s
      const p = a.dir > 0 ? 0 : 1
      const seq = s.seq + 1
      return {
        ...s,
        seq,
        flip: { lo: Math.min(s.current, dest), hi: Math.max(s.current, dest), from: p, to: p, dest: s.current, duration: 0, drag: true, id: seq },
      }
    }
    case 'dragEnd': {
      const f = s.flip
      if (!f || !f.drag) return s
      const forward = f.from === 0
      const other = forward ? f.hi : f.lo
      const p = Math.min(1, Math.max(0, a.progress))
      const to = a.commit === forward ? 1 : 0
      const dest = a.commit ? other : s.current
      const seq = s.seq + 1
      return {
        ...s,
        seq,
        target: dest,
        flip: { ...f, from: p, to, dest, drag: false, duration: Math.max(120, Math.round(FLIP_MS * Math.abs(to - p))), id: seq },
      }
    }
    case 'setCount': {
      const count = Math.max(0, a.count)
      if (a.current !== undefined) {
        const c = clampView(a.current, count)
        return { ...s, count, current: c, target: c, flip: null }
      }
      const current = clampView(s.current, count)
      const flip = s.flip && s.flip.hi < count ? s.flip : null
      // Invariant: at rest, target === current.
      return { ...s, count, current, target: flip ? clampView(s.target, count) : current, flip }
    }
    case 'setMotion': {
      if (a.reduced === s.reducedMotion) return s
      if (a.reduced && s.flip) return { ...s, reducedMotion: true, current: s.target, flip: null }
      return { ...s, reducedMotion: a.reduced }
    }
  }
}

/** The view to name in labels and the scrubber: where the reader is heading. */
export const shownView = (s: NavState) => (s.flip && !s.flip.drag ? s.target : s.current)
