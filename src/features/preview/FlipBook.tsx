import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type PointerEvent as RPointerEvent } from 'react'
import { BookPage } from './BookPage'
import { applyFlipStyle, clearFlipStyle, runFlipAnimation, type FlipTargets } from './flip'
import type { HeaderFooterSettings } from './headerFooter'
import { setLayoutAnimating, type BookLayout } from './layout'
import type { NavAction, NavState } from './navigation'
import type { View, ViewMode } from './spreads'

export interface FlipBookProps {
  layout: BookLayout
  views: View[]
  mode: ViewMode
  nav: NavState
  dispatch: Dispatch<NavAction>
  scale: number
  settings: HeaderFooterSettings
  title: string
  reducedMotion: boolean
}

/** Pointer travel (in page widths) that turns a leaf all the way. */
const DRAG_SPAN = 1.6
const CLICK_ZONE = 0.22
const DRAG_ZONE = 0.4

export type SheetRole = 'left' | 'right' | 'front' | 'back' | 'preload'

/**
 * Where each mounted page is right now. Pages of the current view ±1 (and
 * of a running turn) stay mounted in one keyed pool; a turn only changes
 * roles, so the next spread is already laid out when a turn starts and nothing
 * remounts when it ends. See navigation.ts for why every turn is a forward
 * leaf between views `lo` and `hi`.
 */
export function sheetRoles(views: readonly View[], nav: Pick<NavState, 'current' | 'flip'>, mode: ViewMode): Map<number, SheetRole> {
  const roles = new Map<number, SheetRole>()
  const put = (page: number | null | undefined, role: SheetRole) => {
    if (page !== null && page !== undefined && !roles.has(page)) roles.set(page, role)
  }
  const flip = nav.flip
  if (flip) {
    const lo = views[flip.lo]
    const hi = views[flip.hi]
    put(lo?.right, 'front')
    if (mode === 'spread') {
      put(hi?.left, 'back')
      put(lo?.left, 'left')
    }
    put(hi?.right, 'right')
  } else {
    const v = views[nav.current]
    if (mode === 'spread') put(v?.left, 'left')
    put(v?.right, 'right')
  }
  // Neighbours, laid out but invisible, so the next turn starts at once.
  const around = flip ? [flip.lo - 1, flip.lo + 1, flip.hi - 1, flip.hi + 1] : [nav.current - 1, nav.current + 1]
  for (const i of around) {
    const v = views[i]
    if (!v) continue
    put(v.left, 'preload')
    put(v.right, 'preload')
  }
  return roles
}

interface SheetProps {
  layout: BookLayout
  index: number
  role: SheetRole
  settings: HeaderFooterSettings
  title: string
  fadeOnMount: boolean
  sheetRef: (el: HTMLDivElement | null) => void
  shadeRef: (el: HTMLDivElement | null) => void
}

const Sheet = memo(function Sheet({ layout, index, role, settings, title, fadeOnMount, sheetRef, shadeRef }: SheetProps) {
  // Read once: a sheet that arrives by a jump fades in; one that only changes role never does.
  const [fade] = useState(fadeOnMount)
  const verso = (index % 2 === 1) === layout.firstIsRecto
  return (
    <div
      ref={sheetRef}
      className={`bp-sheet bp-sheet-${role}${fade ? ' bp-fade' : ''}`}
      data-sheet={index}
      aria-hidden={role === 'left' || role === 'right' ? undefined : true}
    >
      <BookPage layout={layout} index={index} settings={settings} title={title} />
      <div className={`bp-gutter ${verso ? 'bp-gutter-l' : 'bp-gutter-r'}`} aria-hidden="true" />
      <div className="bp-face-shade" ref={shadeRef} aria-hidden="true" />
    </div>
  )
})

export function FlipBook({ layout, views, mode, nav, dispatch, scale, settings, title, reducedMotion }: FlipBookProps) {
  const geo = layout.geometry
  const W = geo.pageWidth
  const H = geo.pageHeight
  const spread = mode === 'spread'
  const bookW = spread ? W * 2 : W
  const flip = nav.flip

  const roles = sheetRoles(views, nav, mode)
  const entries = [...roles]
  const frontPage = entries.find(([, r]) => r === 'front')?.[0]
  const backPage = entries.find(([, r]) => r === 'back')?.[0]

  // Elements of the turning leaf, looked up by page index.
  const sheets = useRef(new Map<number, HTMLDivElement>())
  const shades = useRef(new Map<number, HTMLDivElement>())
  const underRef = useRef<HTMLDivElement>(null)
  const landRef = useRef<HTMLDivElement>(null)
  const lastTargets = useRef<FlipTargets>({})
  const targets = (): FlipTargets => ({
    leaf: frontPage !== undefined ? sheets.current.get(frontPage) : null,
    backLeaf: backPage !== undefined ? sheets.current.get(backPage) : null,
    front: frontPage !== undefined ? shades.current.get(frontPage) : null,
    back: backPage !== undefined ? shades.current.get(backPage) : null,
    under: underRef.current,
    land: landRef.current,
  })

  // A view change without a turn (scrubber, thumbnails, reduced motion, mode switch) fades new pages in.
  const fadeRef = useRef({ current: nav.current, flipping: false })
  let fadeNow = false
  if (nav.current !== fadeRef.current.current) {
    fadeNow = !fadeRef.current.flipping && !flip
    fadeRef.current.current = nav.current
  }
  fadeRef.current.flipping = !!flip

  // Run the animated part of a turn; when it ends, the sheets go back to lying flat.
  useLayoutEffect(() => {
    // Sheets from the previous turn lie flat again (any still turning get fresh styles below).
    clearFlipStyle(lastTargets.current)
    lastTargets.current = {}
    if (!flip) return
    setLayoutAnimating(true)
    const t = targets()
    lastTargets.current = t
    if (flip.drag) {
      applyFlipStyle(t, flip.from, W)
      return
    }
    return runFlipAnimation(t, flip.from, flip.to, flip.duration, W, () => dispatch({ type: 'flipDone' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flip?.id ?? null])
  useEffect(() => {
    if (!flip) setLayoutAnimating(false)
  }, [flip])
  useEffect(() => () => setLayoutAnimating(false), [])

  /* ---------------------------- pointer input ---------------------------- */
  const drag = useRef<{
    id: number
    x0: number
    y0: number
    t0: number
    rel: number
    started: boolean
    dir: 1 | -1
    p: number
  } | null>(null)
  const bookRef = useRef<HTMLDivElement>(null)

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || flip) return
    const r = bookRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    const x = (e.clientX - r.left) / r.width // 0..1 across the book
    let side: 'left' | 'right'
    let rel: number // 0 at the spine side, 1 at the outer edge of that page
    if (spread) {
      side = x < 0.5 ? 'left' : 'right'
      rel = side === 'left' ? 1 - x * 2 : (x - 0.5) * 2
    } else {
      side = x < 0.35 ? 'left' : 'right'
      rel = side === 'left' ? 1 - x / 0.35 : (x - 0.35) / 0.65
    }
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), rel, started: false, dir: side === 'right' ? 1 : -1, p: 0 }
  }

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x0
    const span = W * scale * (spread ? DRAG_SPAN : 1)
    if (!d.started) {
      const intoBook = d.dir === 1 ? -dx : dx
      const canDrag = e.pointerType === 'touch' || d.rel >= 1 - DRAG_ZONE
      if (intoBook > 8 && Math.abs(dx) > Math.abs(e.clientY - d.y0) && canDrag && !reducedMotion) {
        const target = nav.current + d.dir
        if (target < 0 || target >= views.length) return
        d.started = true
        d.p = d.dir === 1 ? 0 : 1
        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
        dispatch({ type: 'dragStart', dir: d.dir })
      }
      return
    }
    const travel = Math.min(1, Math.max(0, (d.dir === 1 ? -dx : dx) / span))
    d.p = d.dir === 1 ? travel : 1 - travel
    applyFlipStyle(targets(), d.p, W)
  }

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x0
    if (d.started) {
      const travel = d.dir === 1 ? d.p : 1 - d.p
      const velocity = Math.abs(dx) / Math.max(1, performance.now() - d.t0) // px/ms
      dispatch({ type: 'dragEnd', commit: travel > 0.3 || (velocity > 0.6 && travel > 0.08), progress: d.p })
      return
    }
    const moved = Math.hypot(dx, e.clientY - d.y0)
    if (moved > 6) {
      // A quick swipe that never became a drag (e.g. reduced motion).
      if (Math.abs(dx) > 40) dispatch({ type: 'go', delta: dx < 0 ? 1 : -1 })
      return
    }
    if (d.rel >= 1 - CLICK_ZONE || !spread) dispatch({ type: 'go', delta: d.dir })
  }

  const onPointerCancel = () => {
    const d = drag.current
    drag.current = null
    if (d?.started) dispatch({ type: 'dragEnd', commit: false, progress: d.p })
  }

  /* ------------------------------- render -------------------------------- */
  const hasLeft = spread && entries.some(([, r]) => r === 'left' || r === 'back')
  const hasRight = entries.some(([, r]) => r === 'right' || r === 'front')
  const rest = views[nav.current]
  const pageCount = layout.pages.length
  const shownRight = rest?.right ?? rest?.left ?? 0
  const readFraction = pageCount > 1 ? shownRight / (pageCount - 1) : 0
  const bookStyle = {
    width: bookW,
    height: H,
    transform: `scale(${scale})`,
    '--bp-stack-l': `${Math.round(2 + readFraction * 6)}px`,
    '--bp-stack-r': `${Math.round(2 + (1 - readFraction) * 6)}px`,
    '--bp-page-w': `${W}px`,
    '--bp-right-x': spread ? `${W}px` : '0px',
  } as CSSProperties

  // Stable callback refs per page, so memoized sheets don't re-render.
  const refCbs = useRef(new Map<number, { sheet: (el: HTMLDivElement | null) => void; shade: (el: HTMLDivElement | null) => void }>())
  const refsFor = (index: number) => {
    let r = refCbs.current.get(index)
    if (!r) {
      r = {
        sheet: (el) => void (el ? sheets.current.set(index, el) : sheets.current.delete(index)),
        shade: (el) => void (el ? shades.current.set(index, el) : shades.current.delete(index)),
      }
      refCbs.current.set(index, r)
    }
    return r
  }

  return (
    <div className="bp-book-frame" style={{ width: bookW * scale, height: H * scale }}>
      <div
        ref={bookRef}
        className={`bp-book bp-book-${mode}${flip ? ' bp-turning' : ''}${reducedMotion ? ' bp-reduced' : ''}${hasLeft ? ' bp-has-left' : ''}${
          hasRight ? ' bp-has-right' : ''
        }`}
        style={bookStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        data-view={nav.current}
      >
        {entries.map(([index, role]) => {
          const r = refsFor(index)
          return (
            <Sheet
              key={index}
              layout={layout}
              index={index}
              role={role}
              settings={settings}
              title={title}
              fadeOnMount={fadeNow && role !== 'preload'}
              sheetRef={r.sheet}
              shadeRef={r.shade}
            />
          )
        })}
        {flip && (
          <>
            <div className="bp-clip bp-clip-right" aria-hidden="true">
              <div className="bp-shadow bp-shadow-under" ref={underRef} />
            </div>
            {spread && (
              <div className="bp-clip bp-clip-left" aria-hidden="true">
                <div className="bp-shadow bp-shadow-land" ref={landRef} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
