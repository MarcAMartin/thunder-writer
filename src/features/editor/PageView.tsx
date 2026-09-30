import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { EditorContent, type Editor } from '@tiptap/react'
import { pageGeometry, trimLabel, FONT_OPTIONS, type ResolvedFormat } from './presets'
import { usePagination } from './usePagination'

/** Visual gap between sheets, in unscaled px. */
export const SHEET_GAP = 28
const SIDE_PADDING = 32
const MIN_SCALE = 0.5

/** Largest scale (<= 1) at which a page fits the available width. */
export function fitScale(available: number, pageWidth: number): number {
  if (!(available > 0) || !(pageWidth > 0)) return 1
  return Math.max(MIN_SCALE, Math.min(1, (available - SIDE_PADDING * 2) / pageWidth))
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
export function PageView({ editor, format }: { editor: Editor | null; format: ResolvedFormat }) {
  const geo = useMemo(() => pageGeometry(format), [format])
  const pitch = geo.pageHeight + SHEET_GAP
  const [scrollRef, scrollSize] = useElementSize<HTMLDivElement>()
  const [flowRef, flowSize] = useElementSize<HTMLDivElement>()
  const scale = fitScale(scrollSize.width, geo.pageWidth)

  const pageCount = usePagination(editor, {
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
    width: geo.pageWidth,
    height: stackHeight,
    transform: scale === 1 ? undefined : `scale(${scale})`,
    '--ed-font': format.fontFamily,
    '--ed-size': `${geo.fontSizePx}px`,
    '--ed-lh': String(format.lineHeight),
    '--ed-page-h': `${geo.pageHeight}px`,
    '--ed-pitch': `${pitch}px`,
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
      <div className="ed-zoom" style={{ width: geo.pageWidth * scale, height: stackHeight * scale }}>
        <div className="ed-stack" style={stackStyle} onMouseDown={onMouseDown}>
          <div className="ed-sheets" aria-hidden="true">
            {Array.from({ length: sheets }, (_, i) => (
              <div key={i} className="ed-sheet" style={{ top: i * pitch, height: geo.pageHeight }}>
                <span className="ed-folio" style={{ bottom: Math.max(8, geo.margin.bottom / 2 - 8) }}>
                  {i + 1}
                </span>
              </div>
            ))}
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
