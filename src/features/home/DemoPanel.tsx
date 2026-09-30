import { useEffect, useRef, useState } from 'react'
import { BoltMark } from './BoltMark'
import {
  DEMO_FIX,
  DEMO_HEADING,
  DEMO_TYPO,
  STATIC_FRAME_MS,
  getDemoFrame,
  getDemoSegments,
  loopTime,
} from './demoScript'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

const TICK_MS = 40
/** Cap per-tick advance so a backgrounded tab doesn't skip whole phases on return. */
const MAX_STEP_MS = 250

/**
 * Animated stand-in for a "GIF of operation": a writer types on a page, the AI
 * flags a word, a suggestion card slides in and is accepted, then an idea card
 * follows. Loops forever; freezes on a single explanatory frame for
 * prefers-reduced-motion, and can be paused (WCAG 2.2.2).
 */
export function DemoPanel() {
  const reducedMotion = usePrefersReducedMotion()
  const [paused, setPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const last = useRef<number>(0)

  const animating = !reducedMotion && !paused

  useEffect(() => {
    if (!animating) return
    last.current = Date.now()
    const id = window.setInterval(() => {
      const now = Date.now()
      const step = Math.min(MAX_STEP_MS, Math.max(0, now - last.current))
      last.current = now
      setElapsed((e) => loopTime(e + step))
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [animating])

  const frame = getDemoFrame(reducedMotion ? STATIC_FRAME_MS : elapsed)
  const seg = getDemoSegments(frame)
  const showCaret = !frame.fixed && frame.phase !== 'fade'

  return (
    <figure className="hm-demo-figure">
      <div
        className="hm-demo"
        data-phase={frame.phase}
        data-testid="hm-demo"
        data-animating={animating ? 'true' : 'false'}
        aria-hidden="true"
      >
        <div className="hm-demo-chrome">
          <span className="hm-demo-dot" />
          <span className="hm-demo-dot" />
          <span className="hm-demo-dot" />
          <span className="hm-demo-tools">
            <b>B</b>
            <i>I</i>
            <u>U</u>
            <span className="hm-demo-sep" />
            <span>Chapter</span>
            <span className="hm-demo-sep" />
            <span>6 × 9 in</span>
          </span>
        </div>

        <div className={`hm-demo-body${frame.fading ? ' is-fading' : ''}`}>
          <div className="hm-demo-desk">
            <div className="hm-demo-page">
              <div className="hm-demo-heading">{DEMO_HEADING}</div>
              <p className="hm-demo-text">
                {seg.before}
                {seg.target && (
                  <span
                    className={
                      seg.targetState === 'marked'
                        ? 'hm-demo-mark'
                        : seg.targetState === 'fixed'
                          ? 'hm-demo-fixed'
                          : undefined
                    }
                  >
                    {seg.target}
                  </span>
                )}
                {seg.after}
                {showCaret && <span className="hm-demo-caret" />}
              </p>
              <div className="hm-demo-folio">1</div>
            </div>
          </div>

          <div className="hm-demo-pane">
            <div className="hm-demo-pane-title">Suggestions</div>
            <div
              className={`hm-demo-empty${
                frame.phase === 'idle' || frame.phase === 'typing' ? ' is-in' : ''
              }`}
            >
              Ideas appear here, one or two at a time.
            </div>
            <div
              className={`hm-demo-thinking${frame.phase === 'thinking' ? ' is-in' : ''}`}
            >
              <BoltMark size={14} />
              Reading along…
            </div>

            <div
              className={[
                'hm-demo-card',
                frame.cardVisible ? 'is-in' : '',
                frame.cardAccepted ? 'is-accepted' : '',
              ].join(' ')}
            >
              <div className="hm-demo-kind hm-demo-kind-spelling">Spelling</div>
              <div className="hm-demo-card-title">
                “{DEMO_TYPO}” → “{DEMO_FIX}”
              </div>
              {frame.cardAccepted ? (
                <div className="hm-demo-accepted">✓ Accepted</div>
              ) : (
                <>
                  <div className="hm-demo-card-detail">
                    Past tense of <em>know</em> fits here.
                  </div>
                  <div className="hm-demo-actions">
                    <span className={`hm-demo-btn hm-demo-accept${frame.acceptPressed ? ' is-pressed' : ''}`}>
                      Accept
                    </span>
                    <span className="hm-demo-btn">Decline</span>
                  </div>
                </>
              )}
            </div>

            <div className={`hm-demo-card hm-demo-card-idea${frame.ideaVisible ? ' is-in' : ''}`}>
              <div className="hm-demo-kind hm-demo-kind-idea">Idea</div>
              <div className="hm-demo-card-title">Let the bell carry the dread</div>
              <div className="hm-demo-card-detail">
                Harbor towns rang storm bells to call boats home. What does Mara hear first?
              </div>
            </div>
          </div>
        </div>

        <div className={`hm-demo-status${frame.fading ? ' is-fading' : ''}`}>
          <span>{frame.wordCount} words</span>
          <span>{frame.openSuggestions} available</span>
          <span>{frame.acceptedCount} accepted</span>
          <span>${frame.costUsd.toFixed(4)}</span>
        </div>
      </div>

      <figcaption className="hm-demo-caption">
        <span>
          You write. Thunder Writer reads along, flags a slip, and offers an idea — one or two at a
          time. You accept or decline.
        </span>
        {!reducedMotion && (
          <button
            type="button"
            className="tw-btn tw-btn-ghost hm-demo-toggle"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Play the demo animation' : 'Pause the demo animation'}
          >
            {paused ? '▶ Play' : '❚❚ Pause'}
          </button>
        )}
      </figcaption>
    </figure>
  )
}
