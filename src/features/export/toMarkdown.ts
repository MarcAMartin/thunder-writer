import type { ThunderDoc } from '../../types'
import { children, docBlocks, headingLevel, MARK_ORDER, markSet, type KnownMark, type PMNode } from './pm'

/**
 * Markdown (CommonMark + the common `==highlight==` / `~~strike~~` extensions).
 * Chapters are `#`, sections `##`, scene breaks `* * *`. Underline has no
 * Markdown syntax, so it is written as `<u>…</u>`. Every character of the
 * writer's text that Markdown would treat as syntax is backslash-escaped.
 */
export function toMarkdown(doc: Pick<ThunderDoc, 'content'>): string {
  const body = renderBlocks(docBlocks(doc.content))
  return body ? `${body}\n` : ''
}

const DELIM: Record<KnownMark, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  underline: ['<u>', '</u>'],
  strike: ['~~', '~~'],
  highlight: ['==', '=='],
}

const isList = (n: PMNode) => n.type === 'bulletList' || n.type === 'orderedList'

/** Blocks separated by blank lines; inside list items a nested list follows its text directly (tight list). */
function renderBlocks(blocks: PMNode[], inItem = false): string {
  let out = ''
  for (const b of blocks) {
    const s = renderBlock(b)
    if (s === null || s === '') continue
    if (out) out += inItem && isList(b) ? '\n' : '\n\n'
    out += s
  }
  return out
}

function renderBlock(n: PMNode): string | null {
  switch (n.type) {
    case 'paragraph':
      return escapeLineStarts(inline(n, '\\\n'))
    case 'heading': {
      const text = inline(n, ' ', true).trim()
      return text ? `${'#'.repeat(headingLevel(n))} ${text}` : null
    }
    case 'horizontalRule':
      return '* * *'
    case 'blockquote': {
      const body = renderBlocks(children(n))
      return body ? prefixLines(body, '> ', '>') : null
    }
    case 'bulletList':
      return list(n, () => '- ')
    case 'orderedList': {
      const start = Number.isInteger(n.attrs?.start) ? (n.attrs!.start as number) : 1
      return list(n, (i) => `${start + i}. `)
    }
    default: {
      // Unknown block: keep its words.
      const kids = children(n)
      if (kids.some((c) => c.type === 'text' || c.type === 'hardBreak')) return escapeLineStarts(inline(n, '\\\n'))
      return renderBlocks(kids) || null
    }
  }
}

function list(n: PMNode, marker: (i: number) => string): string | null {
  const items = children(n).map((li, i) => {
    const m = marker(i)
    const body = renderBlocks(li.type === 'listItem' ? children(li) : [li], true)
    if (!body) return m.trimEnd()
    const [first, ...rest] = body.split('\n')
    const pad = ' '.repeat(m.length)
    return [m + first, ...rest.map((l) => (l ? pad + l : ''))].join('\n')
  })
  return items.length ? items.join('\n') : null
}

function prefixLines(s: string, prefix: string, empty: string): string {
  return s
    .split('\n')
    .map((l) => (l ? prefix + l : empty))
    .join('\n')
}

/** Inline content with marks. Whitespace is kept outside delimiters so emphasis stays valid. */
function inline(n: PMNode, br: string, inHeading = false): string {
  let out = ''
  const open: KnownMark[] = []

  const closeFrom = (keep: number) => {
    if (keep >= open.length) return
    const trail = /\s*$/.exec(out)![0]
    out = out.slice(0, out.length - trail.length)
    for (let i = open.length - 1; i >= keep; i--) out += DELIM[open[i]][1]
    open.length = keep
    out += trail
  }

  for (const c of children(n)) {
    if (c.type === 'hardBreak') {
      out += br
      continue
    }
    const t = c.type === 'text' ? (c.text ?? '') : plainOf(c)
    if (!t) continue
    const esc = (s: string) => escapeMarkdown(s, inHeading)
    if (/^\s+$/.test(t)) {
      out += esc(t)
      continue
    }
    const marks = markSet(c)
    let keep = 0
    while (keep < open.length && marks.has(open[keep])) keep++
    closeFrom(keep)
    const toOpen = MARK_ORDER.filter((m) => marks.has(m) && !open.includes(m))
    if (toOpen.length) {
      const lead = /^\s*/.exec(t)![0]
      out += esc(lead)
      for (const m of toOpen) {
        out += DELIM[m][0]
        open.push(m)
      }
      out += esc(t.slice(lead.length))
    } else {
      out += esc(t)
    }
  }
  closeFrom(0)
  return out
}

const plainOf = (n: PMNode): string =>
  n.type === 'text' ? (n.text ?? '') : children(n).map(plainOf).join('')

/** Backslash-escapes Markdown syntax characters inside text. */
export function escapeMarkdown(s: string, inHeading = false): string {
  let r = s
    .replace(/[\\`*_[\]<~|]/g, '\\$&')
    .replace(/=(?==)|(?<==)=/g, '\\=')
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&')
  if (inHeading) r = r.replace(/#/g, '\\#')
  return r
}

/** Escapes what would turn a line into a heading, quote, list or rule; drops leading indentation (code blocks). */
function escapeLineStarts(s: string): string {
  return s
    .split('\n')
    .map((line) => {
      let l = line.replace(/^[ \t]+/, '')
      if (/^[-=]+\s*$/.test(l)) return `\\${l}`
      l = l
        .replace(/^([#>])/, '\\$1')
        .replace(/^([-+])(?=\s|$)/, '\\$1')
        .replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2')
      return l
    })
    .join('\n')
}
