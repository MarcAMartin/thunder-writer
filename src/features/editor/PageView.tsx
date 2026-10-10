import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type RefObject, type WheelEvent } from 'react'
import { EditorContent, type Editor } from '@tiptap/react'
import { NARROW_QUERY, useMediaQuery } from '../../shell/useMediaQuery'
import { clampSetting, useSettings } from '../../store/settings'
import type { HeaderFooterSettings } from '../../types'
import { folioOf, normalizeHeaderFooter, resolveHeaderFooter, sideOfFolio, type PageFurniture } from '../preview/headerFooter'
import {
  COLUMN_GAP,
  describeSpread,
  effectiveLayout,
  layoutFitScale,
  pageAtPoint,
  sheetPosition,
  spreadOffset,
  spreadOfPage,
  stackSize,
  supportsSpread,
  visibleWidth,
} from './pageLayouts'
import { pageGeometry, trimLabel, FONT_OPTIONS, type ResolvedFormat } from './presets'
import { usePagination, type SheetInfo } from './usePagination'

/** Visual gap between sheets, in unscaled px. */
export const SHEET_GAP = 28
const SIDE_PADDING = 32
/** Phones: just enough room around the page to see its edge. */
const NARROW_SIDE_PADDING = 10
const MIN_SCALE = 0.5
/** Room the flip view leaves for the page details bar and a little air below the spread. */
const FLIP_CHROME_PX = 76
/** How far a swipe or the wheel travels before the flip view turns the page. */
const WHEEL_TURN_PX = 40

/** Largest scale (<= 1) at which a page fits the available width. */
export function fitScale(available: number, pageWidth: number): number {
  if (!(available > 0) || !(pageWidth > 0)) return 1
  return Math.max(MIN_SCALE, Math.min(1, (available - SIDE_PADDING * 2) / pageWidth))
}

/** The page's scale at a zoom level (status bar slider): 100% is the page fitted to the width. */
export function pageScale(available: number, pageWidth: number, zoomPercent: number): number {
  return fitScale(available, pageWidth) * (clampSetting('pageZoom', zoomPercent) / 100)
}

/**
 * Keeps the writer's place when the page scale changes: the line at the middle
 * of the window stays there, and a page wider than the window is centered.
 */
function useKeepPlaceOnZoom(scrollRef: RefObject<HTMLDivElement | null>, zoomRef: RefObject<HTMLDivElement | null>, scale: number) {
  const prev = useRef(scale)
  useLayoutEffect(() => {
    const from = prev.current
    prev.current = scale
    const el = scrollRef.current
    const zoom = zoomRef.current
    if (!el || !zoom || from === scale || !(from > 0)) return
    const top = zoom.offsetTop
    const middle = el.scrollTop + el.clientHeight / 2 - top
    el.scrollTop = Math.max(0, middle * (scale / from) - el.clientHeight / 2 + top)
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
  }, [scale, scrollRef, zoomRef])
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.offsetHeight }))
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.offsetHeight })
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

const fontLabel = (family: string) => FONT_OPTIONS.find((f) => f.value === family)?.label ?? family.split(',')[0].replace(/'/g, '')

/**
 * The manuscript on page-shaped sheets. The ProseMirror column is exactly the
 * trim's text-block width; sheets are drawn behind it, and page-break spacers
 * (see usePagination) push text past the margins/gap onto the next sheet.
 */
/**
 * Running head, footer line and page number of one manuscript sheet, drawn
 * faintly in the margins so the writer sees what the printed page carries.
 * Same rules as the Book preview (resolveHeaderFooter): odd folios are
 * right-hand pages, the first page opens the book, a sheet that begins with a
 * chapter heading is a chapter opening, and chapter heads show the chapter in
 * effect. (The editor's sheets are manuscript pages: the book adds blank left
 * pages and balances spreads, so its page numbers differ.)
 */
export function sheetFurniture(settings: HeaderFooterSettings, title: string, index: number, sheet?: SheetInfo): PageFurniture {
  return resolveHeaderFooter(settings, { title }, {
    index,
    side: sideOfFolio(folioOf(settings, index)),
    chapterTitle: sheet?.chapterTitle ?? '',
    isChapterOpener: index === 0 || (sheet?.isChapterOpener ?? false),
    isBlank: false,
  })
}

const sameSheets = (a: SheetInfo[], b: SheetInfo[]) =>
  a.length === b.length && a.every((s, i) => s.chapterTitle === b[i].chapterTitle && s.isChapterOpener === b[i].isChapterOpener)

function Band({ slots, className, style }: { slots: PageFurniture['header']; className: string; style: CSSProperties }) {
  if (!slots.left && !slots.center && !slots.right) return null
  return (
    <div className={className} style={style}>
      <span className="ed-band-l">{slots.left}</span>
      <span className="ed-band-c">{slots.center}</span>
      <span className="ed-band-r">{slots.right}</span>
    </div>
  )
}

export function PageView({
  editor,
  format,
  headerFooter,
  title = '',
}: {
  editor: Editor | null
  format: ResolvedFormat
  /** The manuscript's header/footer settings (DocFormat.headerFooter); missing = defaults. */
  headerFooter?: Partial<HeaderFooterSettings>
  title?: string
}) {
  const geo = useMemo(() => pageGeometry(format), [format])
  const hf = useMemo(() => normalizeHeaderFooter(headerFooter), [headerFooter])
  const pitch = geo.pageHeight + SHEET_GAP
  const sheetGeo = useMemo(() => ({ pageWidth: geo.pageWidth, pageHeight: geo.pageHeight, pitch }), [geo, pitch])
  const [scrollRef, scrollSize] = useElementSize<HTMLDivElement>()
  const [flowRef, flowSize] = useElementSize<HTMLDivElement>()
  const zoomRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)

  const narrow = useMediaQuery(NARROW_QUERY)
  const spreadSupported = useMemo(supportsSpread, [])
  const layout = effectiveLayout(useSettings((s) => s.pageLayout), { spreadSupported, narrow })
  const sidePadding = narrow ? NARROW_SIDE_PADDING : SIDE_PADDING
  // Phones have no zoom slider (no status bar), so a zoom set on a computer doesn't carry over.
  const savedZoom = clampSetting('pageZoom', useSettings((s) => s.pageZoom)) / 100
  const zoom = narrow ? 1 : savedZoom
  // The flip view fits a whole spread in the window, below the page details bar.
  const fit = layoutFitScale(layout, { width: scrollSize.width, height: scrollSize.height - FLIP_CHROME_PX }, sheetGeo, sidePadding)
  const scale = fit * zoom
  useKeepPlaceOnZoom(scrollRef, zoomRef, layout === 'flip' ? 1 : scale)

  const [sheetInfo, setSheetInfo] = useState<SheetInfo[]>([])
  const pageCount = usePagination(editor, {
    onSheets: (next) => setSheetInfo((prev) => (sameSheets(prev, next) ? prev : next)),
    contentHeight: geo.contentHeight,
    pagePitch: pitch,
    chapterStartsNewPage: format.chapterStartsNewPage,
    lineHeightPx: geo.lineHeightPx,
    scale,
    linearize: layout !== 'scroll',
  })

  const scrollHeight = Math.max(pageCount * pitch - SHEET_GAP, flowSize.height)
  const sheets = layout === 'scroll' ? Math.max(pageCount, Math.ceil((scrollHeight + SHEET_GAP) / pitch)) : pageCount
  const size = layout === 'scroll' ? { width: geo.pageWidth, height: scrollHeight } : stackSize(layout, sheets, sheetGeo)
  const windowWidth = visibleWidth(layout, sheetGeo)

  // Flip view: which spread is showing. It may run one ahead of the sheets while a new page is being laid out.
  const [spread, setSpread] = useState(0)
  const lastSpread = spreadOfPage(sheets - 1)
  const shownSpread = Math.min(spread, lastSpread)
  const live = useRef({ scale, sheets, layout, shownSpread })
  live.current = { scale, sheets, layout, shownSpread }

  // A different document opens at its first page.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setSpread(0)
  }, [editor, scrollRef])

  // Flip view: turn to the pages where the cursor is, as it moves or the text grows.
  useEffect(() => {
    if (!editor || layout !== 'flip') return
    const follow = () => {
      const stack = stackRef.current
      if (!stack || editor.isDestroyed) return
      let caret: { left: number }
      try {
        caret = editor.view.coordsAtPos(editor.state.selection.head)
      } catch {
        return
      }
      const x = (caret.left - stack.getBoundingClientRect().left) / live.current.scale
      setSpread(spreadOfPage(Math.floor(x / (geo.pageWidth + COLUMN_GAP))))
    }
    editor.on('selectionUpdate', follow)
    editor.on('update', follow)
    return () => {
      editor.off('selectionUpdate', follow)
      editor.off('update', follow)
    }
  }, [editor, layout, geo.pageWidth])

  // Switching views keeps the same pages in front of the writer.
  const lastLayout = useRef(layout)
  useLayoutEffect(() => {
    const from = lastLayout.current
    lastLayout.current = layout
    const el = scrollRef.current
    const zoomEl = zoomRef.current
    if (from === layout || !el || !zoomEl) return
    const page =
      from === 'flip'
        ? live.current.shownSpread * 2
        : pageAtPoint(from, 0, Math.max(0, (el.scrollTop - zoomEl.offsetTop) / Math.max(0.01, scale)) + pitch / 3, sheets, sheetGeo)
    if (layout === 'flip') {
      setSpread(spreadOfPage(page))
      el.scrollTop = 0
    } else {
      // Clear of the sticky page details bar.
      const bar = el.querySelector<HTMLElement>('.ed-pageinfo')?.offsetHeight ?? 0
      el.scrollTop = page === 0 ? 0 : Math.max(0, zoomEl.offsetTop + sheetPosition(layout, page, sheetGeo).top * scale - bar - 16)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the view changes
  }, [layout])

  const turn = (by: number) => setSpread(Math.max(0, Math.min(lastSpread, shownSpread + by)))

  // Flip view: a swipe or the scroll wheel turns the pages (vertical scrolling too, when the spread fits the window).
  const wheel = useRef({ sum: 0, until: 0 })
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (layout !== 'flip') return
    const el = scrollRef.current
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY)
    if (!horizontal && el && el.scrollHeight > el.clientHeight + 1) return
    const now = performance.now()
    if (now < wheel.current.until) return
    wheel.current.sum += horizontal ? e.deltaX : e.deltaY
    if (Math.abs(wheel.current.sum) < WHEEL_TURN_PX) return
    turn(wheel.current.sum > 0 ? 1 : -1)
    wheel.current = { sum: 0, until: now + 450 }
  }

  const stackStyle = {
    width: size.width,
    height: size.height,
    transform: scale === 1 ? undefined : `scale(${scale})`,
    translate: layout === 'flip' ? `${-spreadOffset(shownSpread, sheetGeo) * scale}px 0` : undefined,
    '--ed-font': format.fontFamily,
    '--ed-size': `${geo.fontSizePx}px`,
    '--ed-lh': String(format.lineHeight),
    '--ed-page-h': `${geo.pageHeight}px`,
    '--ed-pitch': `${pitch}px`,
    '--ed-text-w': `${geo.contentWidth}px`,
    '--ed-col-gap': `${geo.pageWidth + COLUMN_GAP - geo.contentWidth}px`,
    '--ed-band-size': `${Math.max(9, Math.round(geo.fontSizePx * hf.fontScale * 10) / 10)}px`,
  } as CSSProperties

  /** Clicks in the margins or below the text put the caret at the nearest spot (on the page that was clicked). */
  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (!editor || editor.isDestroyed || e.button !== 0) return
    const dom = editor.view.dom as HTMLElement
    if (dom.contains(e.target as Node) && layout === 'scroll') return
    if ((e.target as Element).closest?.('.ed-prose > *')) return
    e.preventDefault()
    let r: { left: number; right: number; top: number; bottom: number } = dom.getBoundingClientRect()
    if (layout !== 'scroll' && stackRef.current) {
      const sr = stackRef.current.getBoundingClientRect()
      const page = pageAtPoint(layout, (e.clientX - sr.left) / scale, (e.clientY - sr.top) / scale, sheets, sheetGeo)
      const at = sheetPosition(layout, page, sheetGeo)
      const left = sr.left + (at.left + geo.margin.left) * scale
      const top = sr.top + (at.top + geo.margin.top) * scale
      r = { left, top, right: left + geo.contentWidth * scale, bottom: top + geo.contentHeight * scale }
    }
    const hit = editor.view.posAtCoords({
      left: Math.min(Math.max(e.clientX, r.left + 1), r.right - 1),
      top: Math.min(Math.max(e.clientY, r.top + 1), r.bottom - 1),
    })
    if (hit) editor.chain().focus().setTextSelection(hit.pos).run()
    else editor.commands.focus('end')
  }

  return (
    <div className={`ed-scroll ed-scroll-${layout}`} ref={scrollRef} onWheel={onWheel}>
      <p className="ed-pageinfo" aria-live="polite">
        <span>{format.label.replace(/\s*\(.*\)$/, '')}</span>
        <span aria-hidden="true">·</span>
        <span>{trimLabel(format)}</span>
        <span aria-hidden="true">·</span>
        <span>
          {fontLabel(format.fontFamily)} {format.fontSizePt} pt / {format.lineHeight}
        </span>
        <span aria-hidden="true">·</span>
        <strong>{layout === 'flip' ? describeSpread(shownSpread, sheets) : `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`}</strong>
      </p>
      {/* The side padding travels with the page, so a zoomed page wider than the window keeps a margin when scrolled. */}
      <div
        className="ed-zoom"
        ref={zoomRef}
        style={{ width: windowWidth * scale + sidePadding * 2, height: size.height * scale }}
      >
        {/* The flip view shows one spread at a time through this window; the other views show the whole stack. */}
        <div
          className={`ed-clip${layout === 'flip' ? ' ed-clip-flip' : ''}`}
          style={{ left: sidePadding, width: windowWidth * scale, height: size.height * scale }}
        >
          <div className="ed-stack" data-layout={layout} ref={stackRef} style={stackStyle} onMouseDown={onMouseDown}>
            <div className="ed-sheets" aria-hidden="true">
              {Array.from({ length: sheets }, (_, i) => {
                const fur = sheetFurniture(hf, title, i, sheetInfo[i])
                const side = { left: geo.margin.left, right: geo.margin.right }
                const at = sheetPosition(layout, i, sheetGeo)
                return (
                  <div
                    key={i}
                    className={`ed-sheet ed-sheet-${sideOfFolio(folioOf(hf, i))}`}
                    style={{ top: at.top, left: at.left, width: geo.pageWidth, height: geo.pageHeight }}
                  >
                    <Band
                      slots={fur.header}
                      className={`ed-band ed-head${fur.smallCaps ? ' ed-head-caps' : ''}`}
                      style={{ ...side, top: Math.max(6, geo.margin.top / 2 - 8) }}
                    />
                    <Band slots={fur.footer} className="ed-band ed-folio" style={{ ...side, bottom: Math.max(8, geo.margin.bottom / 2 - 8) }} />
                    {fur.footerNote && (
                      <span className="ed-band ed-folio ed-footnote" style={{ ...side, bottom: Math.max(2, geo.margin.bottom / 2 - 22) }}>
                        {fur.footerNote}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <div
              className="ed-flow"
              ref={flowRef}
              style={{
                paddingTop: geo.margin.top,
                paddingLeft: geo.margin.left,
                paddingRight: geo.margin.right,
                paddingBottom: geo.margin.bottom,
              }}
            >
              <EditorContent editor={editor} className="ed-content" />
            </div>
          </div>
        </div>
        {layout === 'flip' && (
          <>
            <button
              type="button"
              className="ed-flip ed-flip-prev"
              aria-label="Previous pages"
              title="Previous pages"
              disabled={shownSpread === 0}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => turn(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="ed-flip ed-flip-next"
              aria-label="Next pages"
              title="Next pages"
              disabled={shownSpread >= lastSpread}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => turn(1)}
            >
              ›
            </button>
          </>
        )}
      </div>
    </div>
  )
}
