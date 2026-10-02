import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type RefObject } from 'react'
import { EditorContent, type Editor } from '@tiptap/react'
import { clampSetting, useSettings } from '../../store/settings'
import type { HeaderFooterSettings } from '../../types'
import { folioOf, normalizeHeaderFooter, resolveHeaderFooter, sideOfFolio, type PageFurniture } from '../preview/headerFooter'
import { pageGeometry, trimLabel, FONT_OPTIONS, type ResolvedFormat } from './presets'
import { usePagination, type SheetInfo } from './usePagination'

/** Visual gap between sheets, in unscaled px. */
export const SHEET_GAP = 28
const SIDE_PADDING = 32
const MIN_SCALE = 0.5

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
  const [scrollRef, scrollSize] = useElementSize<HTMLDivElement>()
  const [flowRef, flowSize] = useElementSize<HTMLDivElement>()
  const zoomRef = useRef<HTMLDivElement>(null)
  const zoom = useSettings((s) => s.pageZoom)
  const scale = pageScale(scrollSize.width, geo.pageWidth, zoom)
  useKeepPlaceOnZoom(scrollRef, zoomRef, scale)

  const [sheetInfo, setSheetInfo] = useState<SheetInfo[]>([])
  const pageCount = usePagination(editor, {
    onSheets: (next) => setSheetInfo((prev) => (sameSheets(prev, next) ? prev : next)),
    contentHeight: geo.contentHeight,
    pagePitch: pitch,
    chapterStartsNewPage: format.chapterStartsNewPage,
    lineHeightPx: geo.lineHeightPx,
    scale,
  })

  // A different document opens at its first page.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [editor, scrollRef])

  const stackHeight = Math.max(pageCount * pitch - SHEET_GAP, flowSize.height)
  const sheets = Math.max(pageCount, Math.ceil((stackHeight + SHEET_GAP) / pitch))

  const stackStyle = {
    left: SIDE_PADDING,
    width: geo.pageWidth,
    height: stackHeight,
    transform: scale === 1 ? undefined : `scale(${scale})`,
    '--ed-font': format.fontFamily,
    '--ed-size': `${geo.fontSizePx}px`,
    '--ed-lh': String(format.lineHeight),
    '--ed-page-h': `${geo.pageHeight}px`,
    '--ed-pitch': `${pitch}px`,
    '--ed-band-size': `${Math.max(9, Math.round(geo.fontSizePx * hf.fontScale * 10) / 10)}px`,
  } as CSSProperties

  /** Clicks in the margins or below the text put the caret at the nearest spot. */
  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (!editor || editor.isDestroyed || e.button !== 0) return
    const dom = editor.view.dom as HTMLElement
    if (dom.contains(e.target as Node)) return
    e.preventDefault()
    const r = dom.getBoundingClientRect()
    const hit = editor.view.posAtCoords({
      left: Math.min(Math.max(e.clientX, r.left + 1), r.right - 1),
      top: Math.min(Math.max(e.clientY, r.top + 1), r.bottom - 1),
    })
    if (hit) editor.chain().focus().setTextSelection(hit.pos).run()
    else editor.commands.focus('end')
  }

  return (
    <div className="ed-scroll" ref={scrollRef}>
      <p className="ed-pageinfo" aria-live="polite">
        <span>{format.label.replace(/\s*\(.*\)$/, '')}</span>
        <span aria-hidden="true">·</span>
        <span>{trimLabel(format)}</span>
        <span aria-hidden="true">·</span>
        <span>
          {fontLabel(format.fontFamily)} {format.fontSizePt} pt / {format.lineHeight}
        </span>
        <span aria-hidden="true">·</span>
        <strong>
          {pageCount} {pageCount === 1 ? 'page' : 'pages'}
        </strong>
      </p>
      {/* The side padding travels with the page, so a zoomed page wider than the window keeps a margin when scrolled. */}
      <div className="ed-zoom" ref={zoomRef} style={{ width: geo.pageWidth * scale + SIDE_PADDING * 2, height: stackHeight * scale }}>
        <div className="ed-stack" style={stackStyle} onMouseDown={onMouseDown}>
          <div className="ed-sheets" aria-hidden="true">
            {Array.from({ length: sheets }, (_, i) => {
              const fur = sheetFurniture(hf, title, i, sheetInfo[i])
              const side = { left: geo.margin.left, right: geo.margin.right }
              return (
                <div key={i} className={`ed-sheet ed-sheet-${sideOfFolio(folioOf(hf, i))}`} style={{ top: i * pitch, height: geo.pageHeight }}>
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
    </div>
  )
}
