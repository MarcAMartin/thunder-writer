import type { Schema } from '@tiptap/pm/model'
import type { LineBox, MeasuredBookBlock } from './paginateBook'
import { leafElements, renderBlockElement, type RenderBlock } from './renderModel'

/**
 * Line measurement is injectable: the layout engine asks a BlockMeasurer for
 * block heights and line boxes, and tests (jsdom has no layout) supply
 * synthetic ones. The DOM measurer lays blocks out in an offscreen, inert
 * container with exactly the page text-block width and the same CSS as the
 * rendered pages (`.bp-text` in preview.css).
 */
export interface MeasureSetup {
  schema: Schema
  /** Text-block width in CSS px. */
  contentWidth: number
  fontFamily: string
  fontSizePx: number
  lineHeight: number
  justify: boolean
}

export interface BlockMeasurer {
  /**
   * Mounts blocks [start, end) and measures them. Heights are read at once; each
   * block's `lines()` reads line boxes lazily and is exact only until the next
   * `measure` call (after that it falls back to height / line pitch).
   */
  measure(blocks: readonly RenderBlock[], start: number, end: number): MeasuredBookBlock[]
  dispose(): void
}

export type MeasurerFactory = (setup: MeasureSetup) => BlockMeasurer

/** Custom properties the `.bp-text` rules read. Shared by the measurer and the page renderer. */
export function textVars(s: Pick<MeasureSetup, 'fontFamily' | 'fontSizePx' | 'lineHeight'>): Record<string, string> {
  return {
    '--bp-font': s.fontFamily,
    '--bp-size': `${s.fontSizePx}px`,
    '--bp-lh': String(s.lineHeight),
  }
}

export const createDomMeasurer: MeasurerFactory = (setup) => {
  const host = document.createElement('div')
  host.className = `bp-text bp-measure${setup.justify ? ' bp-justify' : ''}`
  host.setAttribute('aria-hidden', 'true')
  host.setAttribute('inert', '')
  const st = host.style
  st.position = 'fixed'
  st.left = '-20000px'
  st.top = '0'
  st.width = `${setup.contentWidth}px`
  st.visibility = 'hidden'
  st.pointerEvents = 'none'
  st.contain = 'layout style'
  for (const [k, v] of Object.entries(textVars(setup))) st.setProperty(k, v)
  document.body.appendChild(host)

  let generation = 0
  const padTopByTag = new Map<string, number>()
  let pitch = 0

  const linePitch = () => {
    if (!pitch) {
      const v = parseFloat(getComputedStyle(host).lineHeight)
      pitch = Number.isFinite(v) && v > 0 ? v : setup.fontSizePx * setup.lineHeight
    }
    return pitch
  }

  return {
    measure(blocks, start, end) {
      const gen = ++generation
      const els: HTMLElement[] = []
      for (let i = start; i < end; i++) els.push(renderBlockElement(blocks[i], setup.schema))
      host.replaceChildren(...els)
      // One layout for the whole chunk, then reads only.
      const rects = els.map((el) => el.getBoundingClientRect())
      return els.map((el, k) => {
        const b = blocks[start + k]
        const height = rects[k].height
        let padTop: number | undefined
        if (b.kind === 'chapter' || b.kind === 'heading') {
          const tag = el.tagName
          padTop = padTopByTag.get(tag)
          if (padTop === undefined) {
            padTop = parseFloat(getComputedStyle(el).paddingTop) || 0
            padTopByTag.set(tag, padTop)
          }
        }
        let cached: LineBox[] | null = null
        const lines = () => {
          if (cached) return cached
          cached = gen === generation && el.isConnected ? measureLines(el) : approximateLines(height, linePitch())
          return cached
        }
        const m: MeasuredBookBlock = { kind: b.kind, height, lines }
        if (b.title !== undefined) m.title = b.title
        if (padTop !== undefined) m.padTop = padTop
        return m
      })
    },
    dispose() {
      generation++
      host.remove()
    },
  }
}

/** Evenly spaced lines when the DOM is gone (stale call) or unmeasurable. */
export function approximateLines(height: number, pitch: number): LineBox[] {
  if (!(height > 0) || !(pitch > 0)) return []
  const n = Math.max(1, Math.round(height / pitch))
  const p = height / n
  return Array.from({ length: n }, (_, i) => ({ top: i * p, bottom: (i + 1) * p, leaf: 0 }))
}

interface Span {
  top: number
  bottom: number
}

/**
 * Line boxes of a mounted block, relative to its top. Text rects from
 * Range.getClientRects are grouped into lines by vertical centre; the boundary
 * between two lines is the midpoint between their glyph boxes. With half-leading
 * split evenly, that is exactly the line-box edge, and it works when a line
 * holds a larger inline font. Each paragraph's first and last line reach its
 * content-box edges, so its lines tile it.
 */
export function measureLines(el: HTMLElement): LineBox[] {
  const blockTop = el.getBoundingClientRect().top
  const out: LineBox[] = []
  const range = document.createRange()
  leafElements(el).forEach((leaf, li) => {
    const r = leaf.getBoundingClientRect()
    const cs = getComputedStyle(leaf)
    const top = r.top + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.borderTopWidth) || 0) - blockTop
    const bottom = r.bottom - (parseFloat(cs.paddingBottom) || 0) - (parseFloat(cs.borderBottomWidth) || 0) - blockTop
    const spans = groupLines(textRects(leaf, range), blockTop)
    if (spans.length === 0) {
      out.push({ top, bottom: Math.max(top, bottom), leaf: li })
      return
    }
    for (let i = 0; i < spans.length; i++) {
      const lt = i === 0 ? top : (spans[i - 1].bottom + spans[i].top) / 2
      const lb = i === spans.length - 1 ? bottom : (spans[i].bottom + spans[i + 1].top) / 2
      out.push({ top: lt, bottom: Math.max(lt, lb), leaf: li })
    }
  })
  range.detach?.()
  return out
}

function textRects(leaf: HTMLElement, range: Range): Span[] {
  const rects: Span[] = []
  const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue) continue
    range.selectNodeContents(n)
    const list = range.getClientRects()
    for (let i = 0; i < list.length; i++) {
      const q = list[i]
      if (q.height > 0 && q.width >= 0) rects.push({ top: q.top, bottom: q.bottom })
    }
  }
  return rects
}

/** Groups glyph rects (viewport coords) into lines, returned relative to `origin`. */
export function groupLines(rects: readonly Span[], origin = 0): Span[] {
  const sorted = [...rects].sort((a, b) => a.top + a.bottom - (b.top + b.bottom))
  const lines: Span[] = []
  for (const r of sorted) {
    const c = (r.top + r.bottom) / 2
    const cur = lines[lines.length - 1]
    if (cur && c <= cur.bottom) {
      cur.top = Math.min(cur.top, r.top)
      cur.bottom = Math.max(cur.bottom, r.bottom)
    } else lines.push({ top: r.top, bottom: r.bottom })
  }
  return lines.map((l) => ({ top: l.top - origin, bottom: l.bottom - origin }))
}
