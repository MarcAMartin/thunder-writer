import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDocuments } from '../../store/documents'
import { resolveFormat, trimLabel } from '../editor/presets'
import { usePrefersReducedMotion } from '../home/usePrefersReducedMotion'
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
import { Scrubber } from './Scrubber'
import { buildViews, chapterAtPage, pagesOfView, viewLabel, viewOfPage, type ViewMode } from './spreads'
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
  /** Page index to open at (e.g. the page the writer's cursor is on). */
  initialPage?: number
  /** Called as the layout progresses (page count, done, timings). */
  onLayoutUpdate?: (info: LayoutUpdate) => void
  /** Test seam: replace line measurement / scheduling. */
  layoutEnv?: Partial<LayoutEnv>
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

type ModePref = 'auto' | ViewMode
type Panel = 'toc' | 'settings' | null

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
  const [modePref, setModePref] = useState<ModePref>('auto')
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit')
  const [panel, setPanel] = useState<Panel>(null)
  const [overview, setOverview] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [goValue, setGoValue] = useState('')
  const reducedMotion = usePrefersReducedMotion()

  const format = useMemo(() => resolveFormat(doc?.format), [doc?.format])
  const title = doc?.title?.trim() || 'Untitled Manuscript'
  const { layout, error } = useBookLayout(
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
    if (layout)
      onLayoutUpdate.current?.({
        pages: layout.pages.length,
        chapters: layout.chapters.length,
        done: layout.done,
        progress: layout.progress,
        timings: layout.timings,
      })
  }, [layout])

  const pageCount = layout?.pages.length ?? 0
  const firstIsRecto = sideOfFolio(hf.firstPageNumber) === 'recto'
  const pageW = layout?.geometry.pageWidth ?? format.widthIn * 96
  const pageH = layout?.geometry.pageHeight ?? format.heightIn * 96

  /* ------------------------------ sizing ------------------------------ */
  const [stageRef, stage] = useElementSize<HTMLDivElement>()
  const fitFor = (m: ViewMode) => {
    const w = stage.width || 1200
    const h = stage.height || 800
    const bookW = (m === 'spread' ? 2 : 1) * pageW
    return Math.max(0.15, Math.min(2.5, (w - STAGE_PAD * 2) / bookW, (h - STAGE_PAD) / pageH))
  }
  const autoMode: ViewMode = fitFor('spread') * pageW >= MIN_SPREAD_PAGE_PX && (stage.width || 1200) >= 640 ? 'spread' : 'single'
  const mode: ViewMode = modePref === 'auto' ? autoMode : modePref
  const scale = zoom === 'fit' ? fitFor(mode) : 1

  /* ---------------------------- navigation ---------------------------- */
  const views = useMemo(() => buildViews(pageCount, firstIsRecto, mode), [pageCount, firstIsRecto, mode])
  const [nav, dispatch] = useReducer(navReducer, undefined, () => initialNav(0, 0, reducedMotion))

  const prevMode = useRef({ mode, firstIsRecto, views })
  useLayoutEffect(() => {
    const prev = prevMode.current
    if (prev.mode !== mode || prev.firstIsRecto !== firstIsRecto) {
      // Keep the same page in view across a mode switch.
      const v = prev.views[nav.current]
      const anchor = v ? (v.right ?? v.left ?? 0) : 0
      dispatch({ type: 'setCount', count: views.length, current: viewOfPage(anchor, pageCount, firstIsRecto, mode) })
    } else if (views.length !== nav.count) {
      dispatch({ type: 'setCount', count: views.length })
    }
    prevMode.current = { mode, firstIsRecto, views }
  }, [views, mode, firstIsRecto, pageCount, nav.count, nav.current])

  useEffect(() => {
    dispatch({ type: 'setMotion', reduced: reducedMotion })
  }, [reducedMotion])

  const initialApplied = useRef(props.initialPage === undefined)
  useEffect(() => {
    if (initialApplied.current || !layout) return
    const want = props.initialPage ?? 0
    if (pageCount > want || layout.done) {
      initialApplied.current = true
      dispatch({ type: 'jump', to: viewOfPage(want, pageCount, firstIsRecto, mode), animate: false })
    }
  }, [layout, pageCount, props.initialPage, firstIsRecto, mode])

  const folioOf = useCallback((page: number) => hf.firstPageNumber + page, [hf.firstPageNumber])
  const lastFolio = pageCount > 0 ? folioOf(pageCount - 1) : 0
  const chapters = useMemo(() => layout?.chapters ?? [], [layout])
  const labelOfView = useCallback(
    (v: number) => {
      const view = views[v]
      return view ? viewLabel(pagesOfView(view).map(folioOf), lastFolio) : ''
    },
    [views, folioOf, lastFolio],
  )
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

  /* ---------------------------- dialog focus --------------------------- */
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const html = document.documentElement
    html.classList.add('bp-open')
    return () => {
      html.classList.remove('bp-open')
      if (previouslyFocused?.isConnected) previouslyFocused.focus?.()
    }
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
        if (e.target === dialogRef.current || (e.target as HTMLElement).classList?.contains('bp-stage')) go(e.shiftKey ? -1 : 1)
        return
      case 'Home':
        e.preventDefault()
        return dispatch({ type: 'jump', to: 0 })
      case 'End':
        e.preventDefault()
        return dispatch({ type: 'jump', to: views.length - 1 })
    }
  }

  const goToPage = () => {
    const n = Math.round(Number(goValue))
    if (!Number.isFinite(n) || pageCount === 0) return
    const page = Math.min(pageCount - 1, Math.max(0, n - hf.firstPageNumber))
    dispatch({ type: 'jump', to: viewOfPage(page, pageCount, firstIsRecto, mode) })
    setGoValue('')
    // Back to the book, so the arrow keys turn pages again.
    dialogRef.current?.focus()
  }

  /* ------------------------------- render ------------------------------ */
  const done = layout?.done ?? false
  const progress = Math.round((layout?.progress ?? 0) * 100)
  const pagesText = done ? `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}` : `${pageCount}+ pages`
  const unit = mode === 'spread' ? 'spread' : 'page'
  const atStart = shown <= 0
  const atEnd = shown >= views.length - 1
  const ticks = useMemo(
    () => chapters.map((c) => ({ view: viewOfPage(c.page, pageCount, firstIsRecto, mode), title: c.title })),
    [chapters, pageCount, firstIsRecto, mode],
  )
  const currentChapterIndex = shownChapter ? chapters.indexOf(shownChapter) : -1

  let body: ReactNode
  if (!doc) body = <p className="bp-message">This manuscript is no longer available.</p>
  else if (error) body = <p className="bp-message">The book preview couldn’t be laid out: {error}</p>
  else if (!layout || pageCount === 0)
    body = (
      <p className="bp-message" role="status">
        Setting type…
      </p>
    )
  else if (overview)
    body = (
      <OverviewGrid
        layout={layout}
        views={views}
        current={shown}
        labelOf={(v) => {
          const ch = chapterOfView(v)
          return ch && views[v] && pagesOfView(views[v]).includes(ch.page) ? `${labelOfView(v).replace(/ of \d+$/, '')} · ${ch.title}` : labelOfView(v).replace(/ of \d+$/, '')
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
        <button
          type="button"
          className="bp-turn bp-turn-prev"
          aria-label={`Previous ${unit}`}
          disabled={atStart}
          onClick={() => dispatch({ type: 'go', delta: -1 })}
        >
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <FlipBook
          layout={layout}
          views={views}
          mode={mode}
          nav={nav}
          dispatch={dispatch}
          scale={scale}
          settings={hf}
          title={title}
          reducedMotion={reducedMotion}
        />
        <button
          type="button"
          className="bp-turn bp-turn-next"
          aria-label={`Next ${unit}`}
          disabled={atEnd}
          onClick={() => dispatch({ type: 'go', delta: 1 })}
        >
          <Icon d="M9 5l7 7-7 7" />
        </button>
      </>
    )

  return createPortal(
    <div
      className="bp-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Book preview: ${title}`}
      ref={dialogRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="bp-bar">
        <div className="bp-bar-title">
          <h2 id={titleId}>{title}</h2>
          <span className="bp-bar-meta">
            {trimLabel(format)} · {pagesText}
            {!done && layout && (
              <span className="bp-progress" role="status">
                {' '}
                · Setting type… {progress}%
              </span>
            )}
          </span>
        </div>
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
            aria-pressed={mode === 'single'}
            title={mode === 'single' ? 'Show two-page spreads' : 'Show one page at a time'}
            onClick={() => setModePref(mode === 'single' ? 'spread' : 'single')}
          >
            <Icon d={mode === 'single' ? 'M6 4h12v16H6z' : 'M3 5h8v14H3zM13 5h8v14h-8z'} /> <span className="bp-btn-text">Single page</span>
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
            onClick={() => setPrinting(true)}
            disabled={!done || printing}
            title={done ? 'Print, or choose “Save as PDF” in the print dialog' : 'Available when the layout finishes'}
          >
            <Icon d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z" />{' '}
            <span className="bp-btn-text">Print / PDF</span>
          </button>
          <button type="button" className="bp-btn bp-close" aria-label="Close preview" onClick={() => closeRef.current()}>
            <Icon d="M6 6l12 12M18 6L6 18" />
          </button>
        </div>
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
                      onClick={() => dispatch({ type: 'jump', to: viewOfPage(c.page, pageCount, firstIsRecto, mode) })}
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
        >
          {body}
        </div>

        {panel === 'settings' && (
          <aside className="bp-panel bp-settings" id={`${titleId}-settings`} aria-label="Headers and footers">
            <HeaderFooterPanel value={hf} onChange={changeHf} title={title} sampleChapter={chapters[0]?.title || 'Chapter One'} />
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
            const l = labelOfView(v).replace(/ of \d+$/, '')
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
            min={hf.firstPageNumber}
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

      {printing && layout?.done && <PrintBook layout={layout} settings={hf} title={title} onDone={() => setPrinting(false)} />}
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
