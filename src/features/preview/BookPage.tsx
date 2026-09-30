import { memo, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { folioOf, resolveHeaderFooter, sideOfFolio, type HeaderFooterSettings, type PageInfo, type Slots } from './headerFooter'
import { sideMargins, type BookLayout } from './layout'
import { textVars } from './measure'
import type { Fragment } from './paginateBook'
import { renderBlockElement, type RenderBlock } from './renderModel'
import type { Schema } from '@tiptap/pm/model'

export function pageInfoOf(layout: BookLayout, settings: HeaderFooterSettings, index: number): PageInfo {
  const page = layout.pages[index]
  const chapter = page && page.chapter >= 0 ? layout.chapters[page.chapter] : undefined
  return {
    index,
    side: sideOfFolio(folioOf(settings, index)),
    chapterTitle: chapter?.title ?? '',
    isChapterOpener: page?.isChapterOpener ?? false,
    isBlank: page?.isBlank ?? false,
  }
}

/** One block slice: the whole block is rendered and clipped to [clipTop, clipBottom). */
const Slice = memo(function Slice({ block, schema, frag }: { block: RenderBlock; schema: Schema; frag: Fragment }) {
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    // Schema-serialized DOM (DOMSerializer), never an HTML string.
    host.current?.replaceChildren(renderBlockElement(block, schema))
  }, [block, schema])
  return (
    <div className="bp-slice" style={{ top: frag.y, height: Math.max(0, frag.clipBottom - frag.clipTop) }}>
      <div className="bp-slice-in" style={{ top: -frag.clipTop }} ref={host} />
    </div>
  )
})

function SlotsRow({ slots, className, style }: { slots: Slots; className: string; style: CSSProperties }) {
  if (!slots.left && !slots.center && !slots.right) return null
  return (
    <div className={className} style={style}>
      <span className="bp-slot bp-slot-l">{slots.left}</span>
      <span className="bp-slot bp-slot-c">{slots.center}</span>
      <span className="bp-slot bp-slot-r">{slots.right}</span>
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
  const band = (top: number): CSSProperties => ({
    top: Math.max(4, top - bandFont * 0.7),
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
      />
      <div
        className={`bp-text bp-body${layout.options.justify ? ' bp-justify' : ''}`}
        style={{ top: geo.top, left: m.left, width: geo.contentWidth, height: geo.contentHeight }}
      >
        {page?.fragments.map((f) => (
          <Slice key={`${f.block}:${f.clipTop}`} block={layout.model.blocks[f.block]} schema={layout.model.schema} frag={f} />
        ))}
      </div>
      <SlotsRow slots={furniture.footer} className="bp-band bp-foot" style={band(geo.pageHeight - geo.bottom / 2)} />
    </div>
  )
})
