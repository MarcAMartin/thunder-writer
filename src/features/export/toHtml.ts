import type { ThunderDoc } from '../../types'
import { resolveFormat, type ResolvedFormat } from '../editor/presets'
import {
  normalizeBookLayout,
  normalizeHeaderFooter,
  resolveHeaderFooter,
  sideOfFolio,
  type BookLayoutOptions,
  type HeaderFooterSettings,
  type PageFurniture,
  type PageSide,
} from '../preview/headerFooter'
import {
  alignOf,
  chapterParts,
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
 * A CSS string literal that can't end the declaration, the rule or the
 * <style> element: backslash, quote and line breaks escaped, `<` as `\3c `.
 */
export function cssString(s: string): string {
  const body = stripIllegalXml(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n|\f/g, '\\A ')
    .replace(/</g, '\\3c ')
  return `"${body}"`
}

/**
 * A standalone, print-ready HTML file. Opening it and choosing Print → Save
 * as PDF gives a PDF at the manuscript's trim size, with mirrored margins
 * (gutter at the spine), each chapter on a new page (a right-hand one when the
 * book layout says so) and the running heads, footer line and page numbers
 * chosen in Headers & footers, printed in the page margins (CSS @page margin
 * boxes, Chrome 131+).
 */
export function toHtml(doc: Pick<ThunderDoc, 'title' | 'content' | 'format'>): string {
  const f = resolveFormat(doc.format)
  const hf = normalizeHeaderFooter(doc.format?.headerFooter)
  const book = normalizeBookLayout(doc.format?.bookLayout)
  const plainTitle = doc.title?.trim() || 'Untitled Manuscript'
  const blocks = docBlocks(doc.content)
  // Chapters that start a new page are <section>s on named pages (one per
  // chapter), so each chapter's pages can carry its own running head and opening.
  // Otherwise the book is one flow and a 'chapter' head prints the book title:
  // Chrome has no string-set, and a named page per chapter would force a page
  // break before each one (Word uses a STYLEREF field; the panel says so).
  const parts = f.chapterStartsNewPage ? chapterParts(blocks) : []
  const chapters = parts.filter((p) => blocks[p.from]?.type === 'heading')
  const named = chapters.length > 0
  const body = named
    ? parts
        .map((p) => {
          const n = chapters.indexOf(p)
          const attrs = n >= 0 ? ` class="tw-chapter" style="page: ${pageName(n)}"` : ' class="tw-front"'
          return `<section${attrs}>\n${renderRange(blocks, p.from, p.to)}\n</section>`
        })
        .join('\n')
    : renderBlocks(blocks)
  const title = escapeHtml(plainTitle)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Thunder Writer">
<title>${title}</title>
<style>
${printCss(f)}
${pageFurnitureCss(f, hf, book, plainTitle, named ? chapters.map((c) => c.chapterTitle) : [], named && parts[0] === chapters[0])}
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
.tw-book > h1:first-child, .tw-book > section:first-child > h1:first-child { break-before: auto; page-break-before: auto; }`
    : ''
  return `@page {
  size: ${w}in ${h}in;
  margin: ${margin};
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

/** Top-level blocks [from, to), each seeing the block before it (even across sections) for indents. */
function renderRange(blocks: PMNode[], from: number, to: number): string {
  const out: string[] = []
  for (let i = from; i < to; i++) out.push(renderBlock(blocks[i], blocks[i - 1], i === 0))
  return out.join('\n')
}

/* ------------------------- running heads and folios ------------------------- */

const pageName = (i: number) => `tw-ch${i + 1}`

const BOXES = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const
type Box = (typeof BOXES)[number]

/**
 * The six margin boxes of one page from its furniture (see resolveHeaderFooter):
 * header slots across the top, footer slots across the bottom, the page number
 * as counter(page), and the footer line on its own row below a centred number.
 */
function marginBoxes(p: PageFurniture, side: PageSide): Record<Box, string> {
  const val = (text: string, isNumber: boolean) => (isNumber ? 'counter(page)' : text ? cssString(text) : 'none')
  const inHeader = p.numberIn === 'header'
  const inFooter = p.numberIn === 'footer'
  const out: Record<Box, string> = {
    'top-left': val(p.header.left, inHeader && side === 'verso'),
    'top-center': val(p.header.center, false),
    'top-right': val(p.header.right, inHeader && side === 'recto'),
    'bottom-left': val(p.footer.left, inFooter && p.align === 'left'),
    'bottom-center': val(p.footer.center, inFooter && p.align === 'center'),
    'bottom-right': val(p.footer.right, inFooter && p.align === 'right'),
  }
  if (p.footerNote) out['bottom-center'] = `${out['bottom-center'] === 'none' ? '' : `${out['bottom-center']} "\\A " `}${cssString(p.footerNote)}`
  return out
}

function boxRules(boxes: Record<Box, string>, only?: readonly Box[]): string {
  return (only ?? BOXES).map((b) => `  @${b} { content: ${boxes[b]}; }`).join('\n')
}

const NO_BOXES = Object.fromEntries(BOXES.map((b) => [b, 'none'])) as Record<Box, string>

/**
 * Print CSS for mirrored margins and the Headers & footers settings:
 *  - `@page :left / :right`: margins mirrored (the inside margin at the spine),
 *    each side with its own running head and page number;
 *  - `@page :first`: the book's first page opens it, so no running head (drop folio);
 *  - named pages, one per chapter (`<section style="page: tw-chN">`), carry the
 *    chapter's running head and its opening page (`tw-chN:first`);
 *  - `@page :blank`: nothing on the blank pages a right-hand chapter start inserts;
 *  - `html { counter-reset: page N-1 }` so the first page is numbered N.
 * `:left` / `:right` go by physical position (the first page is always
 * `:right`), not by the page counter. When the first page number is even that
 * page is a verso, so every physical side carries the other folio side's
 * margins and furniture: `:right` gets the verso rules and `:left` the recto ones.
 * Chrome (131+) prints the margin boxes, mirrored margins, named pages and the
 * first page number; it treats `break-before: right` as a plain page break and
 * `:first` as the document's first page only, so there chapters may open on a
 * left-hand page with a running head. The preview's Print / PDF is exact.
 */
function pageFurnitureCss(
  f: ResolvedFormat,
  hf: HeaderFooterSettings,
  book: BookLayoutOptions,
  title: string,
  chapterTitles: readonly string[],
  /** The first chapter is the first thing in the book (no text before it). */
  firstChapterOpensBook: boolean,
): string {
  const m = f.marginIn
  const inside = `${num(m.left, 0.75)}in`
  const outside = `${num(m.right, 0.75)}in`
  const at = (side: PageSide, chapterTitle: string, opener: boolean) =>
    marginBoxes(resolveHeaderFooter(hf, { title }, { index: side === 'recto' ? 0 : 1, side, chapterTitle, isChapterOpener: opener, isBlank: false }), side)
  const firstSide = sideOfFolio(hf.firstPageNumber)
  const size = num(f.fontSizePt * hf.fontScale, 9)
  const font = safeFontFamily(f.fontFamily)
  const style = (b: Box) =>
    `  @${b} { font-family: ${font}; font-size: ${size}pt; color: #333; white-space: pre; ${
      b.startsWith('top') && hf.smallCapsRunningHeads ? 'font-variant: small-caps; letter-spacing: 0.06em; ' : ''
    }vertical-align: middle; }`
  const usesChapter = hf.versoHead === 'chapter' || hf.rectoHead === 'chapter'
  // Which folio side each physical side is: the first page is :right and is folio N.
  const sideAt = (phys: 'left' | 'right'): PageSide => ((phys === 'right') === (firstSide === 'recto') ? 'recto' : 'verso')
  const marginsOf = (side: PageSide) =>
    side === 'recto' ? `  margin-left: ${inside};\n  margin-right: ${outside};` : `  margin-left: ${outside};\n  margin-right: ${inside};`
  const rules: string[] = []
  rules.push(`@page {\n${BOXES.map(style).join('\n')}\n}`)
  for (const phys of ['left', 'right'] as const) {
    rules.push(`@page :${phys} {\n${marginsOf(sideAt(phys))}\n${boxRules(at(sideAt(phys), '', false))}\n}`)
  }
  const opener = (chapterTitle: string, side: PageSide) => (hf.suppressOnChapterOpeners ? at(side, chapterTitle, true) : at(side, chapterTitle, false))
  rules.push(`@page :first {\n${boxRules(opener('', firstSide))}\n}`)
  if (hf.suppressOnBlankPages) rules.push(`@page :blank {\n${boxRules(NO_BOXES)}\n}`)
  chapterTitles.forEach((t, i) => {
    const name = pageName(i)
    if (usesChapter) {
      for (const phys of ['left', 'right'] as const) rules.push(`@page ${name}:${phys} {\n${boxRules(at(sideAt(phys), t, false))}\n}`)
    }
    // The chapter's opening page (a right-hand page when chapters start recto).
    // Chrome matches it only when the chapter opens the book; engines with page groups (e.g. Prince) at every chapter.
    rules.push(`@page ${name}:first {\n${boxRules(opener(t, i === 0 && firstChapterOpensBook ? firstSide : 'recto'))}\n}`)
    if (usesChapter && hf.suppressOnBlankPages) rules.push(`@page ${name}:blank {\n${boxRules(NO_BOXES)}\n}`)
  })
  if (hf.firstPageNumber !== 1) rules.push(`html { counter-reset: page ${hf.firstPageNumber - 1}; }`)
  if (f.chapterStartsNewPage && book.chaptersStartRecto) {
    // A right-hand (odd-numbered) page is physically :left when the book starts on an even number.
    const rectoPhys = firstSide === 'recto' ? 'right' : 'left'
    rules.push(`h1, .tw-chapter { break-before: ${rectoPhys}; page-break-before: ${rectoPhys}; }
.tw-book > h1:first-child, .tw-book > section:first-child, .tw-book > section:first-child > h1:first-child { break-before: auto; page-break-before: auto; }`)
  }
  return rules.join('\n')
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
