import type { ThunderDoc } from '../../types'
import { resolveFormat, type ResolvedFormat } from '../editor/presets'
import {
  alignOf,
  children,
  docBlocks,
  headingLevel,
  isIndentBreaker,
  MARK_ORDER,
  markSet,
  stripIllegalXml,
  type KnownMark,
  type PMNode,
} from './pm'

const TAG: Record<KnownMark, string> = { bold: 'strong', italic: 'em', underline: 'u', strike: 's', highlight: 'mark' }

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(s: string): string {
  return stripIllegalXml(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** A CSS font-family list with nothing that could end the declaration or the <style> element. */
export function safeFontFamily(stack: string): string {
  const cleaned = stack.replace(/[^\p{L}\p{N} ,'".-]/gu, '').trim()
  return cleaned || 'serif'
}

const num = (n: number, fallback: number) => (Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : fallback)

/**
 * A standalone, print-ready HTML file. Opening it and choosing Print → Save
 * as PDF gives a PDF at the manuscript's trim size and margins, with each
 * chapter on a new page (when the book format asks for that) and page numbers.
 */
export function toHtml(doc: Pick<ThunderDoc, 'title' | 'content' | 'format'>): string {
  const f = resolveFormat(doc.format)
  const body = renderBlocks(docBlocks(doc.content))
  const title = escapeHtml(doc.title?.trim() || 'Untitled Manuscript')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Thunder Writer">
<title>${title}</title>
<style>
${printCss(f)}
</style>
</head>
<body>
<article class="tw-book">
${body}
</article>
</body>
</html>
`
}

function printCss(f: ResolvedFormat): string {
  const w = num(f.widthIn, 6)
  const h = num(f.heightIn, 9)
  const m = f.marginIn
  const margin = [m.top, m.right, m.bottom, m.left].map((v) => `${num(v, 0.75)}in`).join(' ')
  const size = num(f.fontSizePt, 11)
  const lh = num(f.lineHeight, 1.4)
  const chapterBreak = f.chapterStartsNewPage
    ? `h1 { break-before: page; page-break-before: always; }
.tw-book > h1:first-child { break-before: auto; page-break-before: auto; }`
    : ''
  return `@page {
  size: ${w}in ${h}in;
  margin: ${margin};
  @bottom-center { content: counter(page); font-family: ${safeFontFamily(f.fontFamily)}; font-size: ${num(size * 0.8, 9)}pt; }
}
html { background: #e9e6df; }
body { margin: 0; color: #1a1a1a; }
.tw-book {
  box-sizing: content-box;
  width: ${num(w - m.left - m.right, 4.5)}in;
  min-height: ${num(h - m.top - m.bottom, 7.5)}in;
  margin: 24px auto;
  padding: ${margin};
  background: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  font-family: ${safeFontFamily(f.fontFamily)};
  font-size: ${size}pt;
  line-height: ${lh};
  font-kerning: normal;
  hyphens: manual;
}
@media print {
  html { background: none; }
  .tw-book { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
}
.tw-book p, .tw-book h1, .tw-book h2, .tw-book h3, .tw-book ul, .tw-book ol, .tw-book blockquote { margin: 0; }
.tw-book p { text-indent: 1.5em; orphans: 2; widows: 2; }
.tw-book p.first, .tw-book li p, .tw-book blockquote > p:first-child { text-indent: 0; }
.tw-book p.empty { min-height: 1lh; }
h1 { font-size: 1.7em; font-weight: 500; line-height: 1.2; text-align: center; letter-spacing: 0.02em; padding: 2.2em 0 1.2em; break-after: avoid; page-break-after: avoid; }
h2 { font-size: 1.2em; font-weight: 500; font-style: italic; line-height: 1.3; text-align: center; padding: 1.2em 0 0.6em; break-after: avoid; page-break-after: avoid; }
h3 { font-size: 1em; font-weight: 600; font-variant: small-caps; letter-spacing: 0.06em; padding: 0.8em 0 0.2em; break-after: avoid; page-break-after: avoid; }
${chapterBreak}
blockquote { padding: 0.5em 0 0.5em 1.4em; font-style: italic; }
ul, ol { padding: 0.25em 0 0.25em 1.6em; }
hr.scene-break { border: 0; height: ${num(lh * 2, 2.8)}em; margin: 0; display: flex; align-items: center; justify-content: center; }
hr.scene-break::after { content: '*\\00a0\\00a0\\00a0*\\00a0\\00a0\\00a0*'; letter-spacing: 0.1em; }
mark { background: #ffe58a; color: inherit; }`
}

function renderBlocks(blocks: PMNode[]): string {
  return blocks.map((b, i) => renderBlock(b, blocks[i - 1], i === 0)).join('\n')
}

function alignStyle(n: PMNode): string {
  const a = alignOf(n)
  return a ? ` style="text-align: ${a}"` : ''
}

function renderBlock(n: PMNode, prev: PMNode | undefined, first: boolean): string {
  switch (n.type) {
    case 'paragraph': {
      const inner = inline(n)
      const a = alignOf(n)
      const classes: string[] = []
      if (first || isIndentBreaker(prev) || a === 'center' || a === 'right') classes.push('first')
      if (!inner) classes.push('empty')
      const cls = classes.length ? ` class="${classes.join(' ')}"` : ''
      return `<p${cls}${alignStyle(n)}>${inner || '<br>'}</p>`
    }
    case 'heading': {
      const l = headingLevel(n)
      return `<h${l}${alignStyle(n)}>${inline(n)}</h${l}>`
    }
    case 'horizontalRule':
      return '<hr class="scene-break">'
    case 'blockquote':
      return `<blockquote>\n${renderBlocks(children(n))}\n</blockquote>`
    case 'bulletList':
      return `<ul>\n${items(n)}\n</ul>`
    case 'orderedList': {
      const start = Number.isInteger(n.attrs?.start) ? (n.attrs!.start as number) : 1
      return `<ol${start !== 1 ? ` start="${start}"` : ''}>\n${items(n)}\n</ol>`
    }
    default: {
      const kids = children(n)
      if (kids.some((c) => c.type === 'text' || c.type === 'hardBreak')) return `<p>${inline(n)}</p>`
      return renderBlocks(kids)
    }
  }
}

function items(list: PMNode): string {
  return children(list)
    .map((li) => `<li>${renderBlocks(li.type === 'listItem' ? children(li) : [li])}</li>`)
    .join('\n')
}

function inline(n: PMNode): string {
  let out = ''
  for (const c of children(n)) {
    if (c.type === 'hardBreak') {
      out += '<br>'
      continue
    }
    if (c.type !== 'text') {
      out += inline(c)
      continue
    }
    let s = escapeHtml(c.text ?? '')
    if (!s) continue
    const marks = markSet(c)
    for (let i = MARK_ORDER.length - 1; i >= 0; i--) {
      const m = MARK_ORDER[i]
      if (marks.has(m)) s = `<${TAG[m]}>${s}</${TAG[m]}>`
    }
    out += s
  }
  return out
}
