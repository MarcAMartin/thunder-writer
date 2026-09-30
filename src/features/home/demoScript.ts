// Pure timeline for the home-page "demo loop" that stands in for a GIF of the app.
// Kept free of React so every frame of the animation is unit-testable.

export const DEMO_HEADING = 'Chapter One'
export const DEMO_TEXT =
  'The storm came in low over the harbor. Mara stood at the end of the pier and new, before the first bell rang, that the boats would not make it home.'
export const DEMO_TYPO = 'new'
export const DEMO_FIX = 'knew'
/** Index of the typo inside DEMO_TEXT. */
export const TYPO_INDEX = DEMO_TEXT.indexOf(` ${DEMO_TYPO},`) + 1

export const MS_PER_CHAR = 30

export type DemoPhase =
  | 'idle' // blank page, blinking caret
  | 'typing' // characters appear
  | 'thinking' // pane shows the AI reading along
  | 'suggest' // typo highlighted, suggestion card slides in
  | 'accepting' // Accept button pressed
  | 'accepted' // text fixed, card confirms
  | 'idea' // a second, contextual idea card slides in
  | 'fade' // everything fades before the loop restarts

export const DEMO_PHASES: ReadonlyArray<{ phase: DemoPhase; ms: number }> = [
  { phase: 'idle', ms: 700 },
  { phase: 'typing', ms: DEMO_TEXT.length * MS_PER_CHAR },
  { phase: 'thinking', ms: 1200 },
  { phase: 'suggest', ms: 2200 },
  { phase: 'accepting', ms: 500 },
  { phase: 'accepted', ms: 1500 },
  { phase: 'idea', ms: 3200 },
  { phase: 'fade', ms: 700 },
]

export const DEMO_LOOP_MS = DEMO_PHASES.reduce((sum, p) => sum + p.ms, 0)

export interface DemoFrame {
  phase: DemoPhase
  /** 0..1 progress within the current phase. */
  progress: number
  /** Number of DEMO_TEXT characters visible on the page. */
  typedChars: number
  /** Typo is marked in the text (the writer clicked / AI referenced it). */
  highlight: boolean
  /** Typo has been replaced by the fix. */
  fixed: boolean
  /** Spelling suggestion card is in the pane. */
  cardVisible: boolean
  /** Accept button shows its pressed state. */
  acceptPressed: boolean
  /** Spelling card shows its "accepted" confirmation. */
  cardAccepted: boolean
  /** Contextual idea card is in the pane. */
  ideaVisible: boolean
  /** The whole demo is fading out. */
  fading: boolean
  acceptedCount: number
  openSuggestions: number
  wordCount: number
  costUsd: number
}

const PHASE_INDEX: Record<DemoPhase, number> = Object.fromEntries(
  DEMO_PHASES.map((p, i) => [p.phase, i]),
) as Record<DemoPhase, number>

export function countWords(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

/** Normalise any elapsed time (including negative) into one loop iteration. */
export function loopTime(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) return 0
  return ((elapsedMs % DEMO_LOOP_MS) + DEMO_LOOP_MS) % DEMO_LOOP_MS
}

/** Start offset (ms into the loop) of a phase. */
export function phaseStart(phase: DemoPhase): number {
  let t = 0
  for (const p of DEMO_PHASES) {
    if (p.phase === phase) return t
    t += p.ms
  }
  return t
}

export function getDemoFrame(elapsedMs: number): DemoFrame {
  const t = loopTime(elapsedMs)
  let start = 0
  let current = DEMO_PHASES[DEMO_PHASES.length - 1]
  for (const p of DEMO_PHASES) {
    if (t < start + p.ms) {
      current = p
      break
    }
    start += p.ms
  }
  const { phase } = current
  const progress = Math.min(1, Math.max(0, (t - start) / current.ms))
  const idx = PHASE_INDEX[phase]
  const after = (p: DemoPhase) => idx >= PHASE_INDEX[p]

  const typedChars =
    phase === 'idle'
      ? 0
      : phase === 'typing'
        ? Math.min(DEMO_TEXT.length, Math.floor((t - start) / MS_PER_CHAR))
        : DEMO_TEXT.length

  const fixed = after('accepted')
  const cardVisible = after('suggest') && idx <= PHASE_INDEX.accepted
  const ideaVisible = after('idea')
  const acceptedCount = fixed ? 1 : 0
  const openSuggestions = (cardVisible && !fixed ? 1 : 0) + (ideaVisible ? 1 : 0)
  const text = fixed ? applyFix(DEMO_TEXT) : DEMO_TEXT.slice(0, typedChars)

  return {
    phase,
    progress,
    typedChars,
    highlight: phase === 'suggest' || phase === 'accepting',
    fixed,
    cardVisible,
    acceptPressed: phase === 'accepting',
    cardAccepted: phase === 'accepted',
    ideaVisible,
    fading: phase === 'fade',
    acceptedCount,
    openSuggestions,
    wordCount: countWords(`${DEMO_HEADING} ${text}`),
    // Rough per-call cost of a cheap model reading a paragraph; purely illustrative.
    costUsd: after('suggest') ? (ideaVisible ? 0.0007 : 0.0003) : 0,
  }
}

function applyFix(text: string): string {
  return text.slice(0, TYPO_INDEX) + DEMO_FIX + text.slice(TYPO_INDEX + DEMO_TYPO.length)
}

export interface DemoSegments {
  before: string
  target: string
  after: string
  targetState: 'plain' | 'marked' | 'fixed'
}

/** Split the visible text around the typo so the view can mark/replace it. */
export function getDemoSegments(frame: DemoFrame): DemoSegments {
  if (frame.fixed) {
    return {
      before: DEMO_TEXT.slice(0, TYPO_INDEX),
      target: DEMO_FIX,
      after: DEMO_TEXT.slice(TYPO_INDEX + DEMO_TYPO.length),
      targetState: 'fixed',
    }
  }
  const typed = DEMO_TEXT.slice(0, frame.typedChars)
  const end = TYPO_INDEX + DEMO_TYPO.length
  return {
    before: typed.slice(0, TYPO_INDEX),
    target: typed.slice(TYPO_INDEX, end),
    after: typed.slice(end),
    targetState: frame.highlight ? 'marked' : 'plain',
  }
}

/** Frame shown when the viewer prefers reduced motion: the most explanatory moment. */
export const STATIC_FRAME_MS = phaseStart('suggest') + 1000
