/**
 * The page-turn look as pure functions of progress p (0 = leaf flat on the
 * right, 1 = flat on the left). The same function drives both drag-to-turn
 * (styles applied per pointer move) and animated turns (sampled into Web
 * Animations keyframes, which run on the compositor and stay smooth while
 * layout work continues on the main thread).
 */

export interface FlipStyle {
  /** rotateY of the leaf around the spine, degrees (0 → -180). */
  angle: number
  /** Darkening of the leaf's front face as it lifts. */
  frontShade: number
  /** Darkening of the leaf's back face as it lands. */
  backShade: number
  /**
   * Shadow band the leaf casts just beyond its edge on the page being revealed:
   * opacity, and the leaf edge's distance from the spine as a fraction of the page width.
   */
  under: number
  underEdge: number
  /** The same on the left page as the leaf comes down onto it. */
  land: number
  landEdge: number
}

export const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, t))) / 2

export function flipStyleAt(pIn: number): FlipStyle {
  const p = Math.min(1, Math.max(0, pIn))
  const lift = Math.sin(Math.PI * p) // 0 flat, 1 edge-on
  const cos = Math.cos(Math.PI * p) // 1 → -1
  return {
    angle: -180 * p,
    frontShade: p < 0.5 ? 0.38 * lift : 0.38,
    backShade: p > 0.5 ? 0.3 * lift : 0.3,
    under: p < 0.5 ? 0.55 * lift : 0,
    underEdge: p < 0.5 ? Math.max(0, cos) : 0,
    land: p > 0.5 ? 0.45 * lift : 0,
    landEdge: p > 0.5 ? Math.max(0, -cos) : 0,
  }
}

export interface FlipFrames {
  leaf: Keyframe[]
  /** The leaf's back face: a separate element hinged at the spine from the left slot. */
  backLeaf: Keyframe[]
  front: Keyframe[]
  back: Keyframe[]
  under: Keyframe[]
  land: Keyframe[]
}

/** Keyframes from progress p0 to p1 with the ease baked in (use with linear timing). `width` = page width in px. */
export function flipKeyframes(p0: number, p1: number, width: number, samples = 18): FlipFrames {
  const out: FlipFrames = { leaf: [], backLeaf: [], front: [], back: [], under: [], land: [] }
  const n = Math.max(2, samples)
  for (let i = 0; i <= n; i++) {
    const offset = i / n
    const p = p0 + (p1 - p0) * easeInOut(offset)
    const s = flipStyleAt(p)
    out.leaf.push({ offset, transform: leafTransform(s.angle) })
    out.backLeaf.push({ offset, transform: backTransform(s.angle) })
    out.front.push({ offset, opacity: round3(s.frontShade) })
    out.back.push({ offset, opacity: round3(s.backShade) })
    out.under.push({ offset, opacity: round3(s.under), transform: underTransform(s, width) })
    out.land.push({ offset, opacity: round3(s.land), transform: landTransform(s, width) })
  }
  return out
}

export const leafTransform = (angle: number) => `rotateY(${round3(angle)}deg)`
/**
 * The back face sits in the left slot hinged on its right edge (the spine), so
 * rotateY(angle + 180) keeps it glued behind the front face: facing away over
 * the right page at 0°, flat on the left page at -180°.
 */
export const backTransform = (angle: number) => `rotateY(${round3(angle + 180)}deg)`
/** The under-band starts at the spine side (left edge) of the revealed page and moves out with the leaf edge. */
const underTransform = (s: FlipStyle, width: number) => `translateX(${round3(s.underEdge * width)}px)`
/** The land-band's right edge starts at the spine (right edge of the left page) and moves out. */
const landTransform = (s: FlipStyle, width: number) => `translateX(${round3(-s.landEdge * width)}px)`

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Removes the inline turn styles (when a sheet goes back to lying flat). */
export function clearFlipStyle(t: FlipTargets) {
  for (const el of Object.values(t)) {
    if (!el) continue
    el.style.removeProperty('transform')
    el.style.removeProperty('opacity')
  }
}

/** Elements of a turning leaf; any may be missing. */
export interface FlipTargets {
  leaf?: HTMLElement | null
  backLeaf?: HTMLElement | null
  front?: HTMLElement | null
  back?: HTMLElement | null
  under?: HTMLElement | null
  land?: HTMLElement | null
}

/** Applies the look at progress p directly (drag). */
export function applyFlipStyle(t: FlipTargets, p: number, width: number) {
  const s = flipStyleAt(p)
  if (t.leaf) t.leaf.style.transform = leafTransform(s.angle)
  if (t.backLeaf) t.backLeaf.style.transform = backTransform(s.angle)
  if (t.front) t.front.style.opacity = String(s.frontShade)
  if (t.back) t.back.style.opacity = String(s.backShade)
  if (t.under) {
    t.under.style.opacity = String(s.under)
    t.under.style.transform = underTransform(s, width)
  }
  if (t.land) {
    t.land.style.opacity = String(s.land)
    t.land.style.transform = landTransform(s, width)
  }
}

/**
 * Runs an animated turn. Resolves when it finishes (or immediately where the
 * Web Animations API is missing, e.g. jsdom). The returned cancel stops it.
 */
export function runFlipAnimation(
  t: FlipTargets,
  p0: number,
  p1: number,
  duration: number,
  width: number,
  onDone: () => void,
): () => void {
  applyFlipStyle(t, p0, width)
  const canAnimate = !!t.leaf && typeof t.leaf.animate === 'function'
  let finished = false
  const anims: Animation[] = []
  const done = () => {
    if (finished) return
    finished = true
    // Hold the end state inline, then drop the animations (their fill would outlive the turn).
    applyFlipStyle(t, p1, width)
    for (const a of anims) a.cancel()
    onDone()
  }
  if (!canAnimate || duration <= 0) {
    const timer = setTimeout(done, 0)
    return () => {
      finished = true
      clearTimeout(timer)
    }
  }
  const frames = flipKeyframes(p0, p1, width)
  const timing: KeyframeAnimationOptions = { duration, easing: 'linear', fill: 'forwards' }
  const add = (el: HTMLElement | null | undefined, kf: Keyframe[]) => {
    if (el) anims.push(el.animate(kf, timing))
  }
  add(t.leaf, frames.leaf)
  add(t.backLeaf, frames.backLeaf)
  add(t.front, frames.front)
  add(t.back, frames.back)
  add(t.under, frames.under)
  add(t.land, frames.land)
  anims[0].onfinish = done
  // Safety net if a finish event never arrives (tab hidden, element removed).
  const safety = setTimeout(done, duration + 400)
  return () => {
    finished = true
    clearTimeout(safety)
    for (const a of anims) a.cancel()
  }
}
