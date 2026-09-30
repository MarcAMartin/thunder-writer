import type { Node as PMNode, Schema } from '@tiptap/pm/model'
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
        const live = () => gen === generation && el.isConnected
        const lines = () => {
          if (cached) return cached
          cached = live() ? measureLines(el) : approximateLines(height, linePitch())
          return cached
        }
        const m: MeasuredBookBlock = { kind: b.kind, height, lines }
        // A very long paragraph: where its lines start, so each page can render only its own lines.
        // Looked up only where a page breaks, and only while the block is mounted here.
        if (b.kind === 'text' && b.node.type.name === 'paragraph' && height > LONG_PARAGRAPH_LINES * linePitch()) {
          let finder: LineStartFinder | null | undefined
          const known = new Map<number, number>([[0, 0]])
          m.lineStart = (k) => {
            const hit = known.get(k)
            if (hit !== undefined) return hit
            const ls = lines()
            if (k <= 0 || k >= ls.length || !live()) return undefined
            if (finder === undefined) finder = createLineStartFinder(el, b.node)
            if (!finder) return undefined
            // Start the search from the nearest known line before k.
            let after = 0
            for (const [j, pos] of known) if (j < k && pos > after) after = pos
            const pos = finder(ls[k].top, after)
            if (pos === null) return undefined
            known.set(k, pos)
            return pos
          }
        }
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

/**
 * Paragraphs longer than this (in lines) can report where a line starts
 * (MeasuredBookBlock.lineStart), and each page renders just its own lines of
 * them rather than the whole paragraph clipped (a bad import can produce a
 * 15,000-word paragraph).
 */
export const LONG_PARAGRAPH_LINES = 60

type LineStartFinder = (y: number, after: number) => number | null

/**
 * Finds, in a mounted paragraph, the content position of the first character
 * whose vertical centre is at or below `y` (searching from content position
 * `after`). Null if the DOM text doesn't map one-to-one onto the paragraph's
 * text nodes; then pages fall back to clipping the whole paragraph.
 */
function createLineStartFinder(el: HTMLElement, node: PMNode): LineStartFinder | null {
  const pm: { pos: number; text: string }[] = []
  node.descendants((n, pos) => {
    if (n.isText && n.text) pm.push({ pos, text: n.text })
    return true
  })
  const dom: Text[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let t = walker.nextNode(); t; t = walker.nextNode()) if ((t as Text).data) dom.push(t as Text)
  if (dom.length !== pm.length || dom.some((t, i) => t.data !== pm[i].text)) return null
  const range = document.createRange()
  const runs = dom.map((t, i) => ({ length: t.data.length, pos: pm[i].pos }))
  return (y, after) => {
    const top = el.getBoundingClientRect().top
    const centre = (run: number, offset: number): number | null => {
      range.setStart(dom[run], offset)
      range.setEnd(dom[run], offset + 1)
      const rs = range.getClientRects()
      for (let i = 0; i < rs.length; i++) if (rs[i].height > 0) return (rs[i].top + rs[i].bottom) / 2 - top
      return null
    }
    // Resume in the run holding `after`.
    let r = 0
    while (r + 1 < runs.length && runs[r + 1].pos <= after) r++
    const from = Math.max(0, Math.min(runs[r].length, after - runs[r].pos))
    return findLineStarts(runs, [y], centre, { run: r, offset: from })[0]
  }
}

/**
 * For each boundary y (ascending), the content position of the first
 * character whose vertical centre is at or below it. `centre(run, offset)` is
 * the centre of one character (null if it has no box). Text runs are in reading
 * order, so positions only move forward: a narrowing binary search per boundary.
 */
export function findLineStarts(
  runs: readonly { length: number; pos: number }[],
  boundaries: readonly number[],
  centre: (run: number, offset: number) => number | null,
  startAt: { run: number; offset: number } = { run: 0, offset: 0 },
): (number | null)[] {
  // A character's centre, or the next measurable one's (a zero-width character has no box).
  const at = (r: number, o: number): number | null => {
    for (let k = o; k < runs[r].length && k < o + 4; k++) {
      const c = centre(r, k)
      if (c !== null) return c
    }
    return null
  }
  const out: (number | null)[] = []
  let r = startAt.run
  let from = startAt.offset
  for (const y of boundaries) {
    let found: number | null = null
    while (r < runs.length) {
      const len = runs[r].length
      const last = at(r, Math.max(from, len - 1))
      if (from >= len || last === null || last < y) {
        r++
        from = 0
        continue
      }
      let lo = from
      let hi = len - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const c = at(r, mid)
        if (c !== null && c >= y) hi = mid
        else lo = mid + 1
      }
      found = runs[r].pos + lo
      from = lo
      break
    }
    out.push(found)
  }
  return out
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
