import { memo, useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { folioOf, resolveHeaderFooter, sideOfFolio, type HeaderFooterSettings, type PageInfo, type Slots } from './headerFooter'
import { sideMargins, type BookLayout } from './layout'
import { textVars } from './measure'
import type { Fragment } from './paginateBook'
import { leafElements, renderBlockElement, type RenderBlock } from './renderModel'
import type { Schema } from '@tiptap/pm/model'

/** The first page that isn't blank: it opens the book, so it never carries a running head. */
function firstTextPage(layout: BookLayout): number {
  const i = layout.pages.findIndex((p) => !p.isBlank)
  return i < 0 ? 0 : i
}

export function pageInfoOf(layout: BookLayout, settings: HeaderFooterSettings, index: number): PageInfo {
  const page = layout.pages[index]
  const chapter = page && page.chapter >= 0 ? layout.chapters[page.chapter] : undefined
  return {
    index,
    side: sideOfFolio(folioOf(settings, index)),
    chapterTitle: chapter?.title ?? '',
    // Text before the first chapter (a prologue, an epigraph) still opens the book.
    isChapterOpener: (page?.isChapterOpener ?? false) || (!!page && !page.isBlank && index === firstTextPage(layout)),
    isBlank: page?.isBlank ?? false,
  }
}

/**
 * One block slice: the block is rendered and clipped to [clipTop, clipBottom).
 * For a list or quote, paragraphs outside the slice are emptied (keeping their
 * height), so a long quote's text isn't repeated on every page it crosses.
 */
const Slice = memo(function Slice({ block, schema, frag }: { block: RenderBlock; schema: Schema; frag: Fragment }) {
  const host = useRef<HTMLDivElement>(null)
  const leaves = frag.leaves
  const text = frag.text
  useLayoutEffect(() => {
    // Schema-serialized DOM (DOMSerializer), never an HTML string.
    let el: HTMLElement
    if (text) {
      // Only this page's lines of a very long paragraph, cut at line starts so the lines break as measured.
      const node = block.node
      const cut = node.cut(text.from, text.to ?? node.content.size)
      el = renderBlockElement({ ...block, node: cut, noIndent: block.noIndent || text.from > 0 }, schema)
      if (text.to !== null) el.classList.add('bp-cut-end')
    } else el = renderBlockElement(block, schema)
    if (leaves) {
      leafElements(el).forEach((leaf, i) => {
        if (i >= leaves.from && i <= leaves.to) return
        const box = leaves.boxes[i]
        leaf.replaceChildren()
        leaf.style.height = `${box ? Math.max(0, box.bottom - box.top) : 0}px`
      })
    }
    host.current?.replaceChildren(el)
  }, [block, schema, leaves, text])
  return (
    <div className="bp-slice" style={{ top: frag.y, height: Math.max(0, frag.clipBottom - frag.clipTop) }}>
      <div className="bp-slice-in" style={{ top: -(frag.clipTop - (text?.top ?? 0)) }} ref={host} />
    </div>
  )
})

/** Smallest a running head or footer line is scaled to before it is allowed to be clipped (no ellipsis, ever). */
const MIN_FIT = 0.72

/**
 * Shrinks any slot text that doesn't fit its column, so a head is never cut
 * off with an ellipsis. Measuring forces a layout, so it only runs when a line
 * could overflow at all (`mayOverflow`): ordinary heads never pay for it, and a
 * page mounting mid-turn doesn't stall a frame.
 */
function useFitSlots(ref: RefObject<HTMLDivElement | null>, key: string, mayOverflow: boolean) {
  useLayoutEffect(() => {
    const root = ref.current
    if (!root || !mayOverflow) {
      root?.querySelectorAll<HTMLElement>('.bp-slot, .bp-note').forEach((el) => {
        el.style.removeProperty('font-size')
        el.style.removeProperty('letter-spacing')
      })
      return
    }
    for (const el of root.querySelectorAll<HTMLElement>('.bp-slot, .bp-note')) {
      el.style.removeProperty('font-size')
      el.style.removeProperty('letter-spacing')
      if (!el.textContent || el.clientWidth <= 0 || el.scrollWidth <= el.clientWidth + 0.5) continue
      el.style.letterSpacing = '0'
      if (el.scrollWidth <= el.clientWidth + 0.5) continue
      el.style.fontSize = `${Math.max(MIN_FIT, el.clientWidth / el.scrollWidth) * 100}%`
    }
  }, [ref, key, mayOverflow])
}

/** Upper bound of a band line's width per character, in ems (wide small caps plus their letter-spacing). */
const MAX_EM_PER_CHAR = 0.8
/** Folio columns on each side of the band, in ems (see `.bp-band` in preview.css). */
const SIDE_EMS = 2.6

function SlotsRow({ slots, note, className, style, width }: { slots: Slots; note?: string; className: string; style: CSSProperties; width: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const em = Number(style.fontSize) || 12
  const longest = Math.max(slots.center.length, (note ?? '').length, slots.left.length * 2, slots.right.length * 2)
  const mayOverflow = longest * MAX_EM_PER_CHAR * em > width - 2 * SIDE_EMS * em
  useFitSlots(ref, `${slots.left}|${slots.center}|${slots.right}|${note ?? ''}|${em}|${width}`, mayOverflow)
  if (!slots.left && !slots.center && !slots.right && !note) return null
  return (
    <div className={className} style={style} ref={ref}>
      <span className="bp-slot bp-slot-l">{slots.left}</span>
      <span className="bp-slot bp-slot-c">{slots.center}</span>
      <span className="bp-slot bp-slot-r">{slots.right}</span>
      {note ? <span className="bp-note">{note}</span> : null}
    </div>
  )
}

export interface BookPageProps {
  layout: BookLayout
  index: number
  settings: HeaderFooterSettings
  title: string
  className?: string
}

/** A printed page at trim size (unscaled CSS px): running head, text block, footer. */
export const BookPage = memo(function BookPage({ layout, index, settings, title, className }: BookPageProps) {
  const geo = layout.geometry
  const page = layout.pages[index]
  const info = pageInfoOf(layout, settings, index)
  const furniture = resolveHeaderFooter(settings, { title }, info)
  const m = sideMargins(geo, info.side)
  const bandFont = geo.fontSizePx * settings.fontScale
  const vars = textVars({ fontFamily: layout.format.fontFamily, fontSizePx: geo.fontSizePx, lineHeight: layout.format.lineHeight })
  const pageStyle = { width: geo.pageWidth, height: geo.pageHeight, ...vars } as CSSProperties
  /** A band of `rows` lines centred on `middle` (the middle of the top or bottom margin). */
  const band = (middle: number, rows = 1): CSSProperties => ({
    top: Math.max(4, middle - bandFont * 0.7 * rows),
    left: m.left,
    right: m.right,
    fontSize: bandFont,
    lineHeight: `${bandFont * 1.4}px`,
  })
  const label = info.isBlank ? 'Blank page' : `Page ${folioOf(settings, index)}`

  return (
    <div
      className={`bp-page bp-${info.side}${info.isBlank ? ' bp-blank' : ''}${className ? ` ${className}` : ''}`}
      style={pageStyle}
      data-page={index}
      aria-label={label}
      role="group"
    >
      <SlotsRow
        slots={furniture.header}
        className={`bp-band bp-head${furniture.smallCaps ? ' bp-smallcaps' : ''}`}
        style={band(geo.top / 2)}
        width={geo.contentWidth}
      />
      <div
        className={`bp-text bp-body${layout.options.justify ? ' bp-justify' : ''}`}
        style={{ top: geo.top, left: m.left, width: geo.contentWidth, height: geo.contentHeight }}
      >
        {page?.fragments.map((f) => (
          <Slice key={`${f.block}:${f.clipTop}`} block={layout.model.blocks[f.block]} schema={layout.model.schema} frag={f} />
        ))}
      </div>
      <SlotsRow
        slots={furniture.footer}
        note={furniture.footerNote}
        className="bp-band bp-foot"
        style={band(geo.pageHeight - geo.bottom / 2, furniture.footerNote ? 2 : 1)}
        width={geo.contentWidth}
      />
    </div>
  )
})
