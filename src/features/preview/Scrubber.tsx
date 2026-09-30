import { useId, useState, type PointerEvent } from 'react'
import { fractionOfView, viewAtFraction } from './spreads'

export interface ScrubberTick {
  view: number
  title: string
}

export interface ScrubberProps {
  count: number
  value: number
  label: string
  /** "Pages 44–45 of 389, Chapter 3" style text for assistive tech. */
  valueText: string
  ticks: ScrubberTick[]
  /** Tooltip text for a view (page numbers and chapter). */
  describe: (view: number) => string
  onScrub: (view: number) => void
}

/**
 * A range slider across the whole book with a tick for each chapter and a
 * hover tooltip naming the chapter under the pointer. Moving it jumps without
 * animation (a quick cross-fade), since turning through every page would be slow.
 */
export function Scrubber({ count, value, label, valueText, ticks, describe, onScrub }: ScrubberProps) {
  const id = useId()
  const [hover, setHover] = useState<{ x: number; view: number } | null>(null)
  const max = Math.max(0, count - 1)

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width <= 0) return
    const f = (e.clientX - r.left) / r.width
    setHover({ x: Math.min(1, Math.max(0, f)), view: viewAtFraction(f, count) })
  }

  return (
    <div className="bp-scrub">
      <div className="bp-scrub-track" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <div className="bp-scrub-ticks" aria-hidden="true">
          {ticks.map((t, i) => (
            <span key={`${t.view}-${i}`} className="bp-tick" style={{ left: `${fractionOfView(t.view, count) * 100}%` }} />
          ))}
        </div>
        <input
          id={id}
          type="range"
          className="bp-range"
          min={0}
          max={max}
          step={1}
          value={Math.min(value, max)}
          disabled={count <= 1}
          aria-label="Position in book"
          aria-valuetext={valueText}
          onChange={(e) => onScrub(Number(e.target.value))}
          onKeyDown={(e) => {
            // A native range moves *back* on Page Down; in a book, Page Down goes on.
            if (e.key !== 'PageDown' && e.key !== 'PageUp') return
            e.preventDefault()
            const next = Math.min(max, Math.max(0, value + (e.key === 'PageDown' ? 1 : -1)))
            if (next !== value) onScrub(next)
          }}
        />
        {hover && count > 1 && (
          <div className="bp-scrub-tip" style={{ left: `${hover.x * 100}%` }} role="presentation">
            {describe(hover.view)}
          </div>
        )}
      </div>
      <output className="bp-scrub-label" htmlFor={id}>
        {label}
      </output>
    </div>
  )
}
