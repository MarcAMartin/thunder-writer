import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent as RWheelEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useDocuments } from '../../store/documents'
import { resolveFormat, trimLabel } from '../editor/presets'
import { usePrefersReducedMotion } from '../home/usePrefersReducedMotion'
import { anchorOfPages, pageOfAnchor } from './anchor'
import { checkFit, NO_FIT_ISSUES } from './fitText'
import { TURN_GROWTH } from './flip'
import { FlipBook } from './FlipBook'
import {
  normalizeBookLayout,
  normalizeHeaderFooter,
  sideOfFolio,
  type BookLayoutOptions,
  type HeaderFooterSettings,
} from './headerFooter'
import { HeaderFooterPanel } from './HeaderFooterPanel'
import type { BookLayout, LayoutEnv } from './layout'
import { initialNav, navReducer, shownView } from './navigation'
import { OverviewGrid } from './OverviewGrid'
import { PrintBook } from './PrintBook'
import { describePrint, INK_CHOICES, normalizePrint, PAPER_CHOICES, paperAllowed, type PrintChoice, type PrintSettings } from './printSettings'
import { Scrubber } from './Scrubber'
import { buildViews, chapterAtPage, pagesOfView, viewLabel, viewOfPage, viewPages, type ViewMode } from './spreads'
import { useBookLayout } from './useBookLayout'
import './preview.css'

export interface BookPreviewProps {
  docId: string
  onClose: () => void
  /** Saved header/footer settings (e.g. DocFormat.headerFooter). Missing fields get defaults. */
  headerFooter?: Partial<HeaderFooterSettings> | null
  /** Called on every change in the Headers & footers panel, so the host can persist it. */
  onHeaderFooterChange?: (next: HeaderFooterSettings) => void
  layoutOptions?: Partial<BookLayoutOptions> | null
  onLayoutOptionsChange?: (next: BookLayoutOptions) => void
  /** Paper & ink (e.g. DocFormat.print): how the pages look here. Missing fields get defaults. */
  print?: Partial<PrintSettings> | null
  /** Called on every Paper & ink change, so the host can persist it. */
  onPrintChange?: (next: PrintSettings) => void
  /**
   * Top-level block index to open at (e.g. the block holding the writer's
   * cursor: `editor.state.doc.resolve(pos).index(0)`). Preferred over
   * `initialPage`: the editor's page numbers are manuscript pages, not book pages.
   */
  initialBlock?: number
  /** Book page index to open at. */
  initialPage?: number
  /** Called as the layout progresses (page count, done, timings). */
  onLayoutUpdate?: (info: LayoutUpdate) => void
  /**
   * Export › PDF: print as soon as the layout is done, then close
   * (the print dialog's "Save as PDF" makes the file).
   */
  printOnOpen?: boolean
  /** Test seam: replace line measurement / scheduling. */
  layoutEnv?: Partial<LayoutEnv>
  /**
   * Phones: a reading view. The toolbar is just one button back to writing
   * (`closeLabel`); pages still turn by swipe, buttons and the page slider.
   */
  compact?: boolean
  /** Label of the compact view's button that closes the preview. */
  closeLabel?: string
}

export interface LayoutUpdate {
  pages: number
  chapters: number
  done: boolean
  progress: number
  timings: BookLayout['timings']
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Book narrower than this (per page, px) in spread mode switches "auto" to single pages. */
const MIN_SPREAD_PAGE_PX = 250
const STAGE_PAD = 40
/** Space kept above and below a turning leaf at its tallest (px). */
const TURN_MARGIN = 8
/** Wheel / trackpad travel (px) that turns one page. */
const WHEEL_STEP = 60
/** A wheel gesture ends after this long without events (ms). */
const WHEEL_QUIET_MS = 220

type ModePref = 'auto' | ViewMode
type Panel = 'toc' | 'settings' | 'paper' | null

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    read()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read)
      return () => window.removeEventListener('resize', read)
    }
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))

/** The parts of a keyboard event the key handler reads (React's and the DOM's both fit). */
interface KeyLike {
  key: string
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  target: EventTarget | null
  preventDefault(): void
  stopPropagation(): void
}

/**
 * Full-screen print preview: the manuscript typeset as a book, with
 * two-page spreads, animated page turns, a scrubber, contents, page
 * thumbnails, go-to-page, running heads and page numbers, and printing.
 */
export function BookPreview(props: BookPreviewProps) {
  const { docId, onClose } = props
  const doc = useDocuments((s) => s.docs[docId])
  const titleId = useId()
  const goId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const [hf, setHf] = useState(() => normalizeHeaderFooter(props.headerFooter))
  const [opts, setOpts] = useState(() => normalizeBookLayout(props.layoutOptions))
  // Not part of the layout: changing paper never re-typesets the book.
  const [printSpec, setPrintSpec] = useState(() => normalizePrint(props.print))
  const changePrint = (patch: Partial<PrintSettings>) => {
    const next = normalizePrint({ ...printSpec, ...patch })
    setPrintSpec(next)
    props.onPrintChange?.(next)
  }
  const [modePref, setModePref] = useState<ModePref>('auto')
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit')
  const [panel, setPanel] = useState<Panel>(null)
  const [overview, setOverview] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [goValue, setGoValue] = useState('')
  const reducedMotion = usePrefersReducedMotion()

  const format = useMemo(() => resolveFormat(doc?.format), [doc?.format])
  const title = doc?.title?.trim() || 'Untitled Manuscript'
  const { layout: latest, error } = useBookLayout(
    {
      docId,
      content: doc?.content ?? null,
      format: doc?.format,
      options: opts,
      firstPageNumber: hf.firstPageNumber,
    },
    props.layoutEnv,
  )

  const onLayoutUpdate = useRef(props.onLayoutUpdate)
  onLayoutUpdate.current = props.onLayoutUpdate
  useEffect(() => {
    if (latest)
      onLayoutUpdate.current?.({
        pages: latest.pages.length,
        chapters: latest.chapters.length,
        done: latest.done,
        progress: latest.progress,
        timings: latest.timings,
      })
  }, [latest])

  /* ----------------------- the layout on screen ----------------------- */
  // A re-layout (an option changed) keeps the old pages on screen until the new
  // layout reaches the text the reader is looking at, then switches to that
  // same text, so tweaking settings never throws the reader back to page 1.
  const [layout, setLayout] = useState<BookLayout | null>(latest)
  const [nav, dispatch] = useReducer(navReducer, undefined, () => initialNav(0, 0, reducedMotion))
  /** Page to show once the layout on screen changes (set with the switch, applied with the new views). */
  const pendingPage = useRef<number | null>(null)

  const pageCount = layout?.pages.length ?? 0
  const firstIsRecto = layout ? layout.firstIsRecto : sideOfFolio(hf.firstPageNumber) === 'recto'
  // Page numbers that fit the pages on screen: while an old layout waits out a
  // first-page-number change of parity, it keeps the number it was set for.
  const shownFirst = useRef(hf.firstPageNumber)
  if ((sideOfFolio(hf.firstPageNumber) === 'recto') === firstIsRecto) shownFirst.current = hf.firstPageNumber
  const pageHf = useMemo(
    () => (hf.firstPageNumber === shownFirst.current ? hf : { ...hf, firstPageNumber: shownFirst.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hf, shownFirst.current],
  )
  const pageW = layout?.geometry.pageWidth ?? format.widthIn * 96
  const pageH = layout?.geometry.pageHeight ?? format.heightIn * 96

  /* ------------------------------ sizing ------------------------------ */
  const [stageRef, stage] = useElementSize<HTMLDivElement>()
  const fitFor = (m: ViewMode) => {
    const w = stage.width || 1200
    const h = stage.height || 800
    const bookW = (m === 'spread' ? 2 : 1) * pageW
    // Height: room for a turning leaf, which looks taller than the page as it swings toward the reader.
    const byHeight = Math.min((h - STAGE_PAD) / pageH, (h - 2 * TURN_MARGIN) / (pageH * TURN_GROWTH))
    return Math.max(0.15, Math.min(2.5, (w - STAGE_PAD * 2) / bookW, byHeight))
  }
  const autoMode: ViewMode = fitFor('spread') * pageW >= MIN_SPREAD_PAGE_PX && (stage.width || 1200) >= 640 ? 'spread' : 'single'
  const wantMode: ViewMode = modePref === 'auto' ? autoMode : modePref
  const scale = zoom === 'fit' ? fitFor(wantMode) : 1

  /* ---------------------------- navigation ---------------------------- */
  const views = useMemo(() => buildViews(pageCount, firstIsRecto, wantMode), [pageCount, firstIsRecto, wantMode])

  /** The layout, mode and views `nav` was last synced to. */
  const prevRef = useRef({ layout, mode: wantMode, views })

  useLayoutEffect(() => {
    if (!latest || latest === layout) return
    if (!layout || latest.key === layout.key) {
      setLayout(latest)
      return
    }
    const view = prevRef.current.views[nav.current]
    const anchor = view ? anchorOfPages(layout.pages, pagesOfView(view)) : null
    const page = anchor ? pageOfAnchor(latest.pages, anchor) : 0
    if (page === null && !latest.done) return // not there yet: keep the old pages
    pendingPage.current = page ?? Math.max(0, latest.pages.length - 1)
    setLayout(latest)
  }, [latest, layout, nav.current])

  useLayoutEffect(() => {
    const prev = prevRef.current
    let target: number | null = null
    if (pendingPage.current !== null && layout !== prev.layout) {
      target = pendingPage.current
      pendingPage.current = null
    } else if (prev.mode !== wantMode) {
      // Keep the same page in view across a mode switch.
      const v = prev.views[nav.current]
      target = v ? (v.right ?? v.left ?? 0) : 0
    }
    if (target !== null) dispatch({ type: 'setCount', count: views.length, current: viewOfPage(target, pageCount, firstIsRecto, wantMode) })
    else if (views.length !== nav.count) dispatch({ type: 'setCount', count: views.length })
    prevRef.current = { layout, mode: wantMode, views }
  }, [views, wantMode, layout, firstIsRecto, pageCount, nav.count, nav.current])

  useEffect(() => {
    dispatch({ type: 'setMotion', reduced: reducedMotion })
  }, [reducedMotion])

  // Open at the writer's place: a block (preferred) or a page, once the layout reaches it.
  const initialApplied = useRef(props.initialPage === undefined && props.initialBlock === undefined)
  useEffect(() => {
    if (initialApplied.current || !layout || pageCount === 0) return
    let page: number | null
    if (props.initialBlock !== undefined) page = pageOfAnchor(layout.pages, { block: Math.max(0, props.initialBlock), offset: 0 })
    else page = (props.initialPage ?? 0) < pageCount ? (props.initialPage ?? 0) : null
    if (page === null && !layout.done) return
    initialApplied.current = true
    dispatch({ type: 'jump', to: viewOfPage(page ?? pageCount - 1, pageCount, firstIsRecto, wantMode), animate: false })
  }, [layout, pageCount, props.initialPage, props.initialBlock, firstIsRecto, wantMode])

  const firstFolio = pageHf.firstPageNumber
  const folioOf = useCallback((page: number) => firstFolio + page, [firstFolio])
  const lastFolio = pageCount > 0 ? folioOf(pageCount - 1) : 0
  const chapters = useMemo(() => layout?.chapters ?? [], [layout])
  const labelOfView = useCallback(
    (v: number) => {
      const view = views[v]
      return view ? viewLabel(pagesOfView(view).map(folioOf), lastFolio, firstFolio) : ''
    },
    [views, folioOf, lastFolio, firstFolio],
  )
  const pagesOfViewText = (v: number) => (views[v] ? viewPages(pagesOfView(views[v]).map(folioOf)) : '')
  /** The chapter on the right-hand page of a view (chapters open on the right). */
  const chapterOfView = (v: number) => {
    const view = views[v]
    const pages = view ? pagesOfView(view) : []
    return pages.length ? chapterAtPage(chapters, pages[pages.length - 1]) : null
  }
  const shown = shownView(nav)
  const shownLabel = labelOfView(shown)
  const shownChapter = chapterOfView(shown)
  const valueText = shownChapter ? `${shownLabel}, ${shownChapter.title}` : shownLabel

  /* ------------------------------ settings ----------------------------- */
  const changeHf = (next: HeaderFooterSettings) => {
    setHf(next)
    props.onHeaderFooterChange?.(next)
  }
  const changeOpts = (patch: Partial<BookLayoutOptions>) => {
    const next = { ...opts, ...patch }
    setOpts(next)
    props.onLayoutOptionsChange?.(next)
  }
  // As running heads read them (an empty heading has none): the same list the exporters and Headers & footers use.
  const chapterTitles = useMemo(() => chapters.map((c) => c.headTitle).filter(Boolean), [chapters])
  const fit = useMemo(
    () =>
      panel === 'settings' && layout
        ? checkFit(hf, { title, chapterTitles, geometry: layout.geometry, fontFamily: layout.format.fontFamily })
        : NO_FIT_ISSUES,
    [panel, layout, hf, title, chapterTitles],
  )

  /* ---------------------------- keyboard ---------------------------- */
  const handleKey = (e: KeyLike) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.preventDefault()
      if (overview) setOverview(false)
      else if (panel) setPanel(null)
      else closeRef.current()
      return
    }
    if (e.key === 'Tab') {
      const root = dialogRef.current
      if (!root) return
      // Closed panels aren't rendered, so everything matching is reachable.
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
      return
    }
    if (isTypingTarget(e.target) || e.altKey || e.metaKey || e.ctrlKey || overview) return
    const go = (delta: number) => {
      e.preventDefault()
      dispatch({ type: 'go', delta })
    }
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
        return go(1)
      case 'ArrowLeft':
      case 'PageUp':
        return go(-1)
      case ' ':
        if (e.target === dialogRef.current || (e.target as HTMLElement | null)?.classList?.contains('bp-stage') || e.target === document.body)
          go(e.shiftKey ? -1 : 1)
        return
      case 'Home':
        e.preventDefault()
        return dispatch({ type: 'jump', to: 0 })
      case 'End':
        e.preventDefault()
        return dispatch({ type: 'jump', to: views.length - 1 })
    }
  }
  const keyRef = useRef(handleKey)
  keyRef.current = handleKey

  /* ---------------------------- dialog focus --------------------------- */
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const root = dialogRef.current
    root?.focus()
    const html = document.documentElement
    html.classList.add('bp-open')
    // Backstops, in case focus ever leaves the dialog (a control that disables itself, a click on
    // the page behind): keys still reach the preview, and focus comes straight back.
    const inside = (t: EventTarget | null) => !!root && t instanceof Node && root.contains(t)
    const onDocKey = (e: KeyboardEvent) => {
      if (!root || inside(e.target) || e.defaultPrevented) return
      root.focus()
      keyRef.current(e)
    }
    const onFocusIn = (e: FocusEvent) => {
      if (root && !inside(e.target)) root.focus()
    }
    document.addEventListener('keydown', onDocKey)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onDocKey)
      document.removeEventListener('focusin', onFocusIn)
      html.classList.remove('bp-open')
      if (previouslyFocused?.isConnected) previouslyFocused.focus?.()
    }
  }, [])

  const goToPage = () => {
    const n = Math.round(Number(goValue))
    if (!Number.isFinite(n) || pageCount === 0) return
    const page = Math.min(pageCount - 1, Math.max(0, n - firstFolio))
    dispatch({ type: 'jump', to: viewOfPage(page, pageCount, firstIsRecto, wantMode) })
    setGoValue('')
    // Back to the book, so the arrow keys turn pages again.
    dialogRef.current?.focus()
  }

  /* ------------------------- wheel & trackpad ------------------------- */
  // One page per gesture: a trackpad swipe (with its momentum) or a burst of wheel notches.
  const wheel = useRef({ acc: 0, locked: false, last: 0, timer: 0 as ReturnType<typeof setTimeout> | 0 })
  useEffect(() => () => void clearTimeout(wheel.current.timer || undefined), [])
  const onWheel = (e: RWheelEvent<HTMLDivElement>) => {
    if (overview || !layout || pageCount === 0 || e.ctrlKey) return
    const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY)
    // At 100% the stage scrolls up and down; only a sideways swipe turns there.
    if (zoom === 'actual' && !horizontal) return
    const d = (horizontal ? e.deltaX : e.deltaY) * px
    const w = wheel.current
    if (w.timer) clearTimeout(w.timer)
    w.timer = setTimeout(() => {
      w.acc = 0
      w.locked = false
      w.last = 0
    }, WHEEL_QUIET_MS)
    // A sharp rise during momentum is a new swipe.
    const rising = Math.abs(d) > w.last * 1.6 + 4
    w.last = Math.abs(d)
    if (w.locked && !rising) return
    if (w.locked && rising) {
      w.locked = false
      w.acc = 0
    }
    w.acc += d
    if (Math.abs(w.acc) >= WHEEL_STEP) {
      dispatch({ type: 'go', delta: Math.sign(w.acc) })
      w.locked = true
      w.acc = 0
    }
  }

  /* ------------------------------- render ------------------------------ */
  const done = !!latest?.done && latest === layout
  const progress = Math.round((latest?.progress ?? 0) * 100)
  const numbered = firstFolio !== 1 && pageCount > 0 ? `, numbered ${firstFolio}–${lastFolio}` : ''
  const pagesText = done ? `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}${numbered}` : `${pageCount}+ pages`
  const unit = wantMode === 'spread' ? 'spread' : 'page'
  const atStart = shown <= 0
  const atEnd = shown >= views.length - 1
  const ticks = useMemo(
    () => chapters.map((c) => ({ view: viewOfPage(c.page, pageCount, firstIsRecto, wantMode), title: c.title })),
    [chapters, pageCount, firstIsRecto, wantMode],
  )
  const currentChapterIndex = shownChapter ? chapters.indexOf(shownChapter) : -1
  const canPrint = done && !printing

  // Export › PDF: print once, as soon as every page is laid out.
  const printedOnOpen = useRef(false)
  useEffect(() => {
    if (!props.printOnOpen || !done || printedOnOpen.current) return
    printedOnOpen.current = true
    setPrinting(true)
  }, [props.printOnOpen, done])
  const afterPrint = () => {
    setPrinting(false)
    if (props.printOnOpen) closeRef.current()
  }

  let body: ReactNode
  if (!doc) body = <p className="bp-message">This manuscript is no longer available.</p>
  else if (error) body = <p className="bp-message">The book preview couldn’t be laid out: {error}</p>
  else if (!layout || pageCount === 0) body = <p className="bp-message">Setting type…</p>
  else if (overview)
    body = (
      <OverviewGrid
        layout={layout}
        views={views}
        current={shown}
        labelOf={(v) => {
          const ch = chapterOfView(v)
          const l = pagesOfViewText(v)
          return ch && views[v] && pagesOfView(views[v]).includes(ch.page) ? `${l} · ${ch.title}` : l
        }}
        onPick={(v) => {
          dispatch({ type: 'jump', to: v, animate: false })
          setOverview(false)
          requestAnimationFrame(() => dialogRef.current?.focus())
        }}
      />
    )
  else
    body = (
      <>
        {/* aria-disabled, not disabled: a focused button that disables itself drops focus out of the dialog. */}
        <button
          type="button"
          className="bp-turn bp-turn-prev"
          aria-label={`Previous ${unit}`}
          aria-disabled={atStart || undefined}
          onClick={() => !atStart && dispatch({ type: 'go', delta: -1 })}
        >
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <FlipBook
          layout={layout}
          views={views}
          mode={wantMode}
          nav={nav}
          dispatch={dispatch}
          scale={scale}
          settings={pageHf}
          title={title}
          reducedMotion={reducedMotion}
        />
        <button
          type="button"
          className="bp-turn bp-turn-next"
          aria-label={`Next ${unit}`}
          aria-disabled={atEnd || undefined}
          onClick={() => !atEnd && dispatch({ type: 'go', delta: 1 })}
        >
          <Icon d="M9 5l7 7-7 7" />
        </button>
      </>
    )

  return createPortal(
    <div
      className={`bp-overlay bp-paper-${printSpec.paper} bp-ink-${printSpec.ink}${props.compact ? ' bp-compact' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Book preview: ${title}`}
      ref={dialogRef}
      tabIndex={-1}
      onKeyDown={handleKey}
    >
      <header className="bp-bar">
        <div className="bp-bar-title">
          <h2 id={titleId}>{title}</h2>
          <span className="bp-bar-meta">
            {trimLabel(format)} · {pagesText}
            {!done && latest && (
              <span className="bp-progress">
                {' '}
                · Setting type… {progress}%
              </span>
            )}
          </span>
          <span className="bp-bar-meta bp-bar-print">{describePrint(printSpec)}</span>
        </div>
        {props.compact ? (
          <div className="bp-bar-tools" role="toolbar" aria-label="Preview">
            <button type="button" className="bp-btn bp-compact-close" onClick={() => closeRef.current()}>
              <Icon d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /> <span>{props.closeLabel ?? 'Close'}</span>
            </button>
          </div>
        ) : (
        <div className="bp-bar-tools" role="toolbar" aria-label="Preview">
          <button
            type="button"
            className="bp-btn"
            aria-expanded={panel === 'toc'}
            aria-controls={panel === 'toc' ? `${titleId}-toc` : undefined}
            onClick={() => setPanel(panel === 'toc' ? null : 'toc')}
            title="Contents"
          >
            <Icon d="M4 6h16M4 12h16M4 18h10" /> <span className="bp-btn-text">Contents</span>
          </button>
          <button type="button" className="bp-btn" aria-pressed={overview} onClick={() => setOverview(!overview)} disabled={!layout} title="All pages">
            <Icon d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /> <span className="bp-btn-text">All pages</span>
          </button>
          <span className="bp-bar-sep" aria-hidden="true" />
          <button
            type="button"
            className="bp-btn"
            aria-pressed={wantMode === 'single'}
            title={wantMode === 'single' ? 'Show two-page spreads' : 'Show one page at a time'}
            onClick={() => setModePref(wantMode === 'single' ? 'spread' : 'single')}
          >
            <Icon d={wantMode === 'single' ? 'M6 4h12v16H6z' : 'M3 5h8v14H3zM13 5h8v14h-8z'} /> <span className="bp-btn-text">Single page</span>
          </button>
          <div className="bp-seg" role="group" aria-label="Zoom">
            <button type="button" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>
              Fit
            </button>
            <button type="button" aria-pressed={zoom === 'actual'} onClick={() => setZoom('actual')} title="Actual size (96 px per inch)">
              100%
            </button>
          </div>
          <span className="bp-bar-sep" aria-hidden="true" />
          <button
            type="button"
            className="bp-btn"
            aria-expanded={panel === 'settings'}
            aria-controls={panel === 'settings' ? `${titleId}-settings` : undefined}
            onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
            title="Headers & footers"
          >
            <Icon d="M4 5h16M4 19h16M8 9h8M8 13h8" /> <span className="bp-btn-text">Headers &amp; footers</span>
          </button>
          <button
            type="button"
            className="bp-btn"
            aria-expanded={panel === 'paper'}
            aria-controls={panel === 'paper' ? `${titleId}-paper` : undefined}
            onClick={() => setPanel(panel === 'paper' ? null : 'paper')}
            title="Paper and ink for the printed book"
          >
            <Icon d="M6 3h8l4 4v14H6zM12 10.5c-1.4 1.9-2.3 3-2.3 4.2a2.3 2.3 0 0 0 4.6 0c0-1.2-.9-2.3-2.3-4.2z" />{' '}
            <span className="bp-btn-text">Paper &amp; ink</span>
          </button>
          <button
            type="button"
            className="bp-btn"
            onClick={() => canPrint && setPrinting(true)}
            aria-disabled={!canPrint || undefined}
            title={done ? 'Print, or choose “Save as PDF” in the print dialog' : 'Available when the layout finishes'}
          >
            <Icon d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z" />{' '}
            <span className="bp-btn-text">Print / PDF</span>
          </button>
          <button type="button" className="bp-btn bp-close" aria-label="Close preview" onClick={() => closeRef.current()}>
            <Icon d="M6 6l12 12M18 6L6 18" />
          </button>
        </div>
        )}
      </header>

      <div className="bp-main">
        {panel === 'toc' && (
          <nav className="bp-panel bp-toc" id={`${titleId}-toc`} aria-label="Contents">
            <h3 className="bp-panel-title">Contents</h3>
            {chapters.length === 0 ? (
              <p className="bp-panel-note">{done ? 'No chapters yet. Chapter headings appear here.' : 'Finding chapters…'}</p>
            ) : (
              <ol className="bp-toc-list">
                {chapters.map((c, i) => (
                  <li key={`${c.block}`}>
                    <button
                      type="button"
                      aria-current={i === currentChapterIndex ? 'true' : undefined}
                      onClick={() => dispatch({ type: 'jump', to: viewOfPage(c.page, pageCount, firstIsRecto, wantMode) })}
                    >
                      <span className="bp-toc-title">{c.title}</span>
                      <span className="bp-toc-dots" aria-hidden="true" />
                      <span className="bp-toc-page">
                        <span className="bp-sr">page </span>
                        {folioOf(c.page)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {!done && chapters.length > 0 && <p className="bp-panel-note">More chapters as the layout continues…</p>}
          </nav>
        )}

        <div
          className={`bp-stage${zoom === 'actual' ? ' bp-stage-actual' : ''}${overview ? ' bp-stage-overview' : ''}`}
          ref={stageRef}
          onWheel={onWheel}
        >
          {body}
        </div>

        {panel === 'paper' && (
          <aside className="bp-panel bp-settings bp-paper-panel" id={`${titleId}-paper`} aria-label="Paper and ink">
            <h3 className="bp-panel-title">Paper &amp; ink</h3>
            <p className="bp-panel-note">
              How the printed book will be made. The pages here take on the paper’s look; page breaks, the PDF and
              other exports stay the same.
            </p>
            <PrintChoices
              legend="Interior paper"
              name={`${titleId}-paper-stock`}
              choices={PAPER_CHOICES}
              value={printSpec.paper}
              disabled={(v) => !paperAllowed(v, printSpec.ink)}
              disabledNote="Color is printed on white paper."
              onChange={(paper) => changePrint({ paper })}
            />
            <PrintChoices
              legend="Ink and color"
              name={`${titleId}-ink`}
              choices={INK_CHOICES}
              value={printSpec.ink}
              onChange={(ink) => changePrint({ ink })}
            />
          </aside>
        )}

        {panel === 'settings' && (
          <aside className="bp-panel bp-settings" id={`${titleId}-settings`} aria-label="Headers and footers">
            <HeaderFooterPanel
              value={hf}
              onChange={changeHf}
              title={title}
              sampleChapter={chapters[0]?.title || 'Chapter One'}
              chapterTitles={chapterTitles}
              fit={fit}
              chaptersShareFlow={!format.chapterStartsNewPage}
            />
            <fieldset className="bp-hf">
              <legend className="bp-hf-legend">Book layout</legend>
              <div className="bp-hf-checks">
                <label className="bp-check">
                  <input
                    type="checkbox"
                    checked={opts.chaptersStartRecto}
                    disabled={!format.chapterStartsNewPage}
                    onChange={(e) => changeOpts({ chaptersStartRecto: e.target.checked })}
                  />
                  Chapters start on a right-hand page
                </label>
                {!format.chapterStartsNewPage && (
                  <p className="bp-hf-hint">Turn on “chapter starts new page” in the editor toolbar to use this.</p>
                )}
                <label className="bp-check">
                  <input type="checkbox" checked={opts.justify} onChange={(e) => changeOpts({ justify: e.target.checked })} />
                  Justify text
                </label>
              </div>
              <div className="bp-hf-row">
                <label htmlFor={`${titleId}-sink`}>Chapter heading position</label>
                <select
                  id={`${titleId}-sink`}
                  value={String(opts.chapterSink)}
                  onChange={(e) => changeOpts({ chapterSink: Number(e.target.value) })}
                >
                  {[
                    [0, 'Top of the page'],
                    [0.2, 'A fifth of the way down'],
                    [1 / 3, 'A third of the way down'],
                  ].map(([v, l]) => (
                    <option key={String(v)} value={String(v)}>
                      {l}
                    </option>
                  ))}
                  {![0, 0.2, 1 / 3].includes(opts.chapterSink) && <option value={String(opts.chapterSink)}>Custom</option>}
                </select>
              </div>
            </fieldset>
          </aside>
        )}
      </div>

      <footer className="bp-footbar">
        <Scrubber
          count={views.length}
          value={shown}
          label={shownLabel || (layout ? '' : 'Setting type…')}
          valueText={valueText}
          ticks={ticks}
          describe={(v) => {
            const ch = chapterOfView(v)
            const l = pagesOfViewText(v)
            return ch ? `${l} · ${ch.title}` : l
          }}
          onScrub={(v) => dispatch({ type: 'jump', to: v, animate: false })}
        />
        <form
          className="bp-goto"
          onSubmit={(e) => {
            e.preventDefault()
            goToPage()
          }}
        >
          <label htmlFor={goId}>Go to page</label>
          <input
            id={goId}
            type="number"
            inputMode="numeric"
            min={firstFolio}
            max={lastFolio || undefined}
            value={goValue}
            onChange={(e) => setGoValue(e.target.value)}
            disabled={pageCount === 0}
          />
          <button type="submit" className="bp-btn" disabled={pageCount === 0 || goValue === ''}>
            Go
          </button>
        </form>
      </footer>

      <div className="bp-sr" aria-live="polite" aria-atomic="true">
        {nav.flip ? '' : valueText}
      </div>
      {/* Layout progress is announced once when it starts and once when it's done, not at every step. */}
      <div className="bp-sr" role="status">
        {!latest ? 'Setting type…' : latest.done ? `Typeset: ${latest.pages.length} ${latest.pages.length === 1 ? 'page' : 'pages'}` : 'Setting type…'}
      </div>

      {printing && done && layout && <PrintBook layout={layout} settings={pageHf} title={title} onDone={afterPrint} />}
    </div>,
    document.body,
  )
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  )
}

/** One set of Paper & ink radio choices, each with its description. */
function PrintChoices<T extends string>(props: {
  legend: string
  name: string
  choices: PrintChoice<T>[]
  value: T
  onChange: (v: T) => void
  disabled?: (v: T) => boolean
  disabledNote?: string
}) {
  return (
    <fieldset className="bp-hf bp-print-choices">
      <legend className="bp-hf-legend">{props.legend}</legend>
      {props.choices.map((c) => {
        const off = props.disabled?.(c.value) ?? false
        const hintId = `${props.name}-${c.value}-hint`
        const labelId = `${props.name}-${c.value}-label`
        return (
          <label key={c.value} className={`bp-print-choice${off ? ' bp-print-choice-off' : ''}`}>
            <input
              type="radio"
              name={props.name}
              value={c.value}
              checked={props.value === c.value}
              disabled={off}
              aria-labelledby={labelId}
              aria-describedby={hintId}
              onChange={() => props.onChange(c.value)}
            />
            <span className="bp-print-choice-text">
              <span className="bp-print-choice-label" id={labelId}>
                <span className={`bp-swatch bp-swatch-${c.value}`} aria-hidden="true" />
                {c.label}
              </span>
              <span className="bp-print-choice-hint" id={hintId}>
                {c.hint}
                {off && props.disabledNote ? ` ${props.disabledNote}` : ''}
              </span>
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}
