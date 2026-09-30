import { memo, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { BookLayout } from './layout'
import type { View } from './spreads'

export interface OverviewGridProps {
  layout: BookLayout
  views: View[]
  current: number
  /** Printed label for a view ("Pages 44–45"). */
  labelOf: (view: number) => string
  onPick: (view: number) => void
}

const THUMB_H = 150
const LABEL_H = 34
const GAP = 18
const OVERSCAN_ROWS = 2

/**
 * Every spread as a small schematic (text blocks as ruled bars, chapter
 * headings as bold bars), virtualized by row so a 400-page book mounts only
 * the thumbnails in view.
 */
export function OverviewGrid({ layout, views, current, labelOf, onPick }: OverviewGridProps) {
  const geo = layout.geometry
  const scroller = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 900, height: 600, top: 0 })
  /** Roving focus: the one thumbnail in the tab order, moved with the arrow keys. */
  const [focus, setFocus] = useState(() => Math.min(Math.max(0, current), Math.max(0, views.length - 1)))
  const wantFocus = useRef(false)
  const pagesPerView = views.some((v) => v.left !== null && v.right !== null) || views.length === 0 ? 2 : 1
  const thumbPageW = (THUMB_H * geo.pageWidth) / geo.pageHeight
  const cellW = thumbPageW * pagesPerView + 12
  const cols = Math.max(1, Math.floor((box.width - GAP) / (cellW + GAP)))
  const rowH = THUMB_H + LABEL_H + GAP
  const rows = Math.ceil(views.length / cols)
  const first = Math.max(0, Math.floor(box.top / rowH) - OVERSCAN_ROWS)
  const last = Math.min(rows - 1, Math.ceil((box.top + box.height) / rowH) + OVERSCAN_ROWS)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setBox({ width: el.clientWidth || 900, height: el.clientHeight || 600, top: el.scrollTop })
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])

  // Open scrolled to the current spread (columns from the real width), and focus it.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const c = Math.max(1, Math.floor(((el.clientWidth || 900) - GAP) / (cellW + GAP)))
    const row = Math.floor(current / c)
    el.scrollTop = Math.max(0, row * rowH - el.clientHeight / 2 + rowH / 2)
    setBox({ width: el.clientWidth || 900, height: el.clientHeight || 600, top: el.scrollTop })
    const f = requestAnimationFrame(() => el.querySelector<HTMLElement>('[aria-current="true"]')?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // After an arrow key: scroll the new thumbnail into view (mounting its row), then focus it.
  useLayoutEffect(() => {
    if (!wantFocus.current) return
    const el = scroller.current
    if (!el) return
    const top = Math.floor(focus / cols) * rowH
    const viewH = el.clientHeight || box.height
    let st = el.scrollTop
    if (top < st) st = top
    // Bottom-align a row below the view (top-align it if it's taller than the view).
    else if (top + rowH > st + viewH) st = Math.min(top, top + rowH - viewH)
    if (st !== el.scrollTop) el.scrollTop = st
    if (Math.abs(el.scrollTop - box.top) >= rowH / 3) {
      setBox((b) => ({ ...b, top: el.scrollTop }))
      return // focus once the row is mounted
    }
    wantFocus.current = false
    el.querySelector<HTMLElement>(`[data-v="${focus}"]`)?.focus({ preventScroll: true })
  }, [focus, cols, rowH, box.top])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const n = views.length
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: cols,
      ArrowUp: -cols,
      PageDown: cols * Math.max(1, Math.floor((box.height || rowH) / rowH)),
      PageUp: -cols * Math.max(1, Math.floor((box.height || rowH) / rowH)),
    }
    let to: number
    if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = n - 1
    else if (e.key in moves) to = focus + moves[e.key]
    else return
    e.preventDefault()
    e.stopPropagation()
    to = Math.min(n - 1, Math.max(0, to))
    wantFocus.current = true
    setFocus(to)
  }

  const cells = []
  for (let r = first; r <= last; r++) {
    for (let c = 0; c < cols; c++) {
      const v = r * cols + c
      if (v >= views.length) break
      const view = views[v]
      cells.push(
        <button
          key={v}
          type="button"
          className="bp-thumb"
          data-v={v}
          tabIndex={v === focus ? 0 : -1}
          onFocus={() => v !== focus && setFocus(v)}
          aria-current={v === current ? 'true' : undefined}
          aria-label={labelOf(v)}
          style={{ top: r * rowH, left: GAP + c * (cellW + GAP), width: cellW, height: THUMB_H + LABEL_H }}
          onClick={() => onPick(v)}
        >
          <span className="bp-thumb-spread" style={{ height: THUMB_H }}>
            {pagesPerView === 2 && <ThumbPage layout={layout} index={view.left} width={thumbPageW} />}
            <ThumbPage layout={layout} index={view.right} width={thumbPageW} />
          </span>
          <span className="bp-thumb-label">{labelOf(v)}</span>
        </button>,
      )
    }
  }

  return (
    <div
      className="bp-overview"
      ref={scroller}
      role="group"
      aria-label="All pages. Use the arrow keys to move between spreads."
      onKeyDown={onKeyDown}
      onScroll={(e) => {
        const top = e.currentTarget.scrollTop
        setBox((b) => (Math.abs(b.top - top) < rowH / 3 ? b : { ...b, top }))
      }}
    >
      <div className="bp-overview-inner" style={{ height: rows * rowH + GAP }}>
        {cells}
      </div>
    </div>
  )
}

const ThumbPage = memo(function ThumbPage({ layout, index, width }: { layout: BookLayout; index: number | null; width: number }) {
  if (index === null) return <span className="bp-thumb-page bp-thumb-none" style={{ width }} />
  const geo = layout.geometry
  const page = layout.pages[index]
  const k = THUMB_H / geo.pageHeight
  const recto = page ? (index % 2 === 0) === layout.firstIsRecto : true
  const left = (recto ? geo.inside : geo.outside) * k
  const lineGap = Math.max(2, geo.lineHeightPx * k)
  return (
    <span className={`bp-thumb-page${page?.isBlank ? ' bp-thumb-blank' : ''}`} style={{ width }}>
      {page?.fragments.map((f, i) => {
        const block = layout.model.blocks[f.block]
        const style: CSSProperties = {
          top: (geo.top + f.y) * k,
          left,
          width: geo.contentWidth * k,
          height: Math.max(1, (f.clipBottom - f.clipTop) * k),
        }
        const kind = block?.kind ?? 'text'
        if (kind === 'text' || kind === 'container') (style as Record<string, string | number>)['--bp-thumb-line'] = `${lineGap}px`
        return <span key={i} className={`bp-thumb-block bp-thumb-${kind}`} style={style} />
      })}
    </span>
  )
})
