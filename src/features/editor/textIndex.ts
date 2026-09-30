import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Plain-text <-> ProseMirror position mapping.
 *
 * The AI sees plain text and hands back quotes. To find them again we build a
 * *normalized* string of the whole document (whitespace collapsed, curly quotes
 * and dashes folded to ASCII, zero-width characters dropped) where every
 * normalized character remembers the document range [from, to) it came from.
 * A match in normalized space then maps straight back to document positions,
 * across text nodes, marks, hard breaks and even block boundaries.
 */
export interface NormalizedIndex {
  text: string
  from: number[]
  to: number[]
}

const ZERO_WIDTH = /[\u200b\u200c\u200d\u2060\ufeff\u00ad]/
const WHITESPACE = /[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/

/** Fold one UTF-16 code unit to its normalized form ('' drops it). */
export function foldChar(c: string): string {
  if (ZERO_WIDTH.test(c)) return ''
  if (WHITESPACE.test(c)) return ' '
  switch (c) {
    case '\u2018': case '\u2019': case '\u201a': case '\u201b': case '\u2032': case '\u02bc':
      return "'"
    case '\u201c': case '\u201d': case '\u201e': case '\u201f': case '\u2033': case '\u00ab': case '\u00bb':
      return '"'
    case '\u2010': case '\u2011': case '\u2012': case '\u2013': case '\u2014': case '\u2015': case '\u2212':
      return '-'
    case '\u2026':
      return '...'
    default:
      return c
  }
}

class Builder {
  text = ''
  from: number[] = []
  to: number[] = []
  push(folded: string, from: number, to: number) {
    for (const ch of folded) {
      if (ch === ' ') {
        // Collapse runs of whitespace (and never start with one).
        if (this.text.length === 0) continue
        if (this.text.endsWith(' ')) {
          this.to[this.to.length - 1] = to
          continue
        }
      }
      this.text += ch
      this.from.push(from)
      this.to.push(to)
    }
  }
  pushRaw(raw: string, basePos: number) {
    for (let i = 0; i < raw.length; i++) this.push(foldChar(raw[i]), basePos + i, basePos + i + 1)
  }
  finish(): NormalizedIndex {
    if (this.text.endsWith(' ')) {
      this.text = this.text.slice(0, -1)
      this.from.pop()
      this.to.pop()
    }
    return { text: this.text, from: this.from, to: this.to }
  }
}

/** Visit every textblock in document order with its absolute position. */
export function forEachTextblock(doc: PMNode, fn: (node: PMNode, pos: number) => void) {
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      fn(node, pos)
      return false
    }
    return true
  })
}

export function buildIndex(doc: PMNode): NormalizedIndex {
  const b = new Builder()
  let prevEnd: number | null = null
  forEachTextblock(doc, (block, pos) => {
    const start = pos + 1
    if (prevEnd !== null) b.push(' ', prevEnd, start)
    block.forEach((child, offset) => {
      const childPos = start + offset
      if (child.isText) b.pushRaw(child.text ?? '', childPos)
      else if (child.type.name === 'hardBreak') b.push(' ', childPos, childPos + child.nodeSize)
    })
    prevEnd = pos + block.nodeSize - 1
  })
  return b.finish()
}

/** Normalize a free-standing string the same way the index does. */
export function normalize(s: string): string {
  const b = new Builder()
  b.pushRaw(s, 0)
  return b.finish().text
}

const lower = (s: string) => {
  // Per-code-unit lowercase that preserves length so index maps stay aligned.
  let out = ''
  for (const c of s) {
    const l = c.toLowerCase()
    out += l.length === c.length ? l : c
  }
  return out
}

export interface DocRange {
  from: number
  to: number
}

/**
 * Find the first occurrence of `quote` in the document. Tries an exact
 * (normalized) match first, then a case-insensitive one.
 */
export function findQuote(doc: PMNode, quote: string, index: NormalizedIndex = buildIndex(doc)): DocRange | null {
  const needle = normalize(quote)
  if (!needle) return null
  let at = index.text.indexOf(needle)
  if (at < 0) at = lower(index.text).indexOf(lower(needle))
  if (at < 0) return null
  return { from: index.from[at], to: index.to[at + needle.length - 1] }
}

/** Plain text of the doc: one entry per non-empty textblock, joined by blank lines. */
export function plainTextOf(doc: PMNode): string {
  const parts: string[] = []
  forEachTextblock(doc, (block) => {
    const t = blockText(block)
    if (t.trim()) parts.push(t)
  })
  return parts.join('\n\n')
}

function blockText(block: PMNode): string {
  let t = ''
  block.forEach((child) => {
    if (child.isText) t += child.text ?? ''
    else if (child.type.name === 'hardBreak') t += '\n'
  })
  return t
}

/**
 * Plain text between two positions using the same rules as plainTextOf: blank
 * (empty or whitespace-only) textblocks are skipped, blocks are joined by one
 * blank line, hard breaks become '\n'. A block the range only touches at an
 * edge contributes an empty part, so the texts on either side of a block
 * boundary concatenate with the separator between them, as in plainTextOf.
 */
export function textBetween(doc: PMNode, from: number, to: number): string {
  const f = Math.max(0, Math.min(from, doc.content.size))
  const t = Math.max(f, Math.min(to, doc.content.size))
  const parts: string[] = []
  doc.nodesBetween(f, t, (node, pos) => {
    if (!node.isTextblock) return true
    const start = pos + 1
    if (!blockText(node).trim()) {
      // Skipped like in plainTextOf, but a blank block holding an edge of the
      // range (e.g. the caret on a fresh empty line) still marks the boundary.
      const end = start + node.content.size
      if ((f >= start && f <= end) || (t >= start && t <= end)) parts.push('')
      return false
    }
    const relFrom = Math.max(0, f - start)
    const relTo = Math.min(node.content.size, t - start)
    parts.push(relTo > relFrom ? node.textBetween(relFrom, relTo, undefined, leafText) : '')
    return false
  })
  return parts.join('\n\n')
}

const leafText = (leaf: PMNode) => (leaf.type.name === 'hardBreak' ? '\n' : '')

/**
 * Make a replacement use the same quote style as the text it replaces: if the
 * original passage uses curly quotes/apostrophes, straight ones in the
 * replacement are curled.
 */
export function matchQuoteStyle(original: string, replacement: string): string {
  const curlySingle = /[\u2018\u2019]/.test(original)
  const curlyDouble = /[\u201c\u201d]/.test(original)
  if (!curlySingle && !curlyDouble) return replacement
  let out = ''
  for (let i = 0; i < replacement.length; i++) {
    const c = replacement[i]
    const prev = i === 0 ? '' : replacement[i - 1]
    const opening = prev === '' || /[\s([{\u2014\u2013-]/.test(prev)
    if (c === "'" && curlySingle) out += opening ? '\u2018' : '\u2019'
    else if (c === '"' && curlyDouble) out += opening ? '\u201c' : '\u201d'
    else out += c
  }
  return out
}
