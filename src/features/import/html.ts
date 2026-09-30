import type { JSONContent } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { editorSchema } from '../editor/contentCheck'

/**
 * HTML (a saved web page, Word's "Save as Web Page", a Google Docs export, or
 * mammoth's .docx output) → sanitised DOM → TipTap JSON.
 *
 * Safety: the HTML is parsed with DOMParser into an inert document that has no
 * browsing context, so nothing in it runs or loads, and it is never inserted
 * into the page. Scripts, styles, frames, embeds, forms, images and every
 * attribute except a paragraph's text alignment are removed; links keep only
 * their text.
 *
 * Google Docs exports carry formatting in CSS classes (`.c3{font-weight:700}`)
 * and inline styles rather than <b>/<i>, so those are turned into
 * <strong>/<em>/<u>/<s> before styles are stripped. The "Title" paragraph
 * style becomes an H1 and is remembered as the manuscript title.
 */

export interface HtmlStats {
  images: number
  comments: number
  footnotes: number
  tables: number
}

export interface HtmlResult {
  doc: JSONContent
  /** <title> of the page, if any. */
  metaTitle?: string
  /** Text of the first paragraph styled as a document title. */
  titleText?: string
  stats: HtmlStats
}

type Decls = Record<string, string>

const REMOVE =
  'script,style,iframe,frame,frameset,object,embed,applet,link,meta,base,noscript,template,svg,math,canvas,video,audio,source,track,map,area,input,button,select,textarea,option,datalist,head,title,dialog'

const BLOCK_CHILDREN = 'p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,div,table,hr,pre'
const TEXT_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'LI', 'TD', 'TH', 'DIV', 'BLOCKQUOTE'])
const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

function parseDecls(style: string | null | undefined): Decls {
  const out: Decls = {}
  if (!style) return out
  for (const part of style.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const prop = part.slice(0, i).trim().toLowerCase()
    const value = part
      .slice(i + 1)
      .replace(/!important/i, '')
      .trim()
      .toLowerCase()
    if (prop) out[prop] = value
  }
  return out
}

/** Removes CSS comments in one pass (an unclosed comment runs to the end, as in a browser). */
function stripCssComments(css: string): string {
  let out = ''
  let at = 0
  for (;;) {
    const open = css.indexOf('/*', at)
    if (open < 0) return out + css.slice(at)
    out += css.slice(at, open)
    const close = css.indexOf('*/', open + 2)
    if (close < 0) return out
    at = close + 2
  }
}

/**
 * `.c3{font-weight:700}` and `p.MsoTitle{…}` rules from <style> blocks, keyed
 * by class name. A single linear pass (split on braces), so a huge or
 * malformed <style> can't stall the import.
 */
export function classStyles(doc: Document): Map<string, Decls> {
  const map = new Map<string, Decls>()
  for (const el of doc.querySelectorAll('style')) {
    const css = stripCssComments(el.textContent ?? '')
    // Each "}" closes a rule: the text after the last "{" is its declarations,
    // and the text between the previous "{" or "}" and that "{" its selectors.
    for (const piece of css.split('}')) {
      const open = piece.lastIndexOf('{')
      if (open < 0) continue
      const before = piece.slice(0, open)
      const selectors = before.slice(before.lastIndexOf('{') + 1)
      if (!selectors.trim()) continue
      const decls = parseDecls(piece.slice(open + 1))
      for (const sel of selectors.split(',')) {
        const cls = /^\s*[a-z0-9]*\.([\w-]+)\s*$/i.exec(sel)
        if (cls) map.set(cls[1], { ...(map.get(cls[1]) ?? {}), ...decls })
      }
    }
  }
  return map
}

function effectiveStyle(el: Element, classes: Map<string, Decls>): Decls {
  let decls: Decls = {}
  for (const c of el.classList) {
    const d = classes.get(c)
    if (d) decls = { ...decls, ...d }
  }
  return { ...decls, ...parseDecls(el.getAttribute('style')) }
}

const isBold = (w: string | undefined) => !!w && (w === 'bold' || w === 'bolder' || (/^\d+$/.test(w) && Number(w) >= 600))
const isNormalWeight = (w: string | undefined) => !!w && (w === 'normal' || w === 'lighter' || (/^\d+$/.test(w) && Number(w) < 600))
const decoration = (d: Decls) => `${d['text-decoration'] ?? ''} ${d['text-decoration-line'] ?? ''}`

function unwrap(el: Element) {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
}

function rename(el: Element, tag: string): Element {
  const next = el.ownerDocument.createElement(tag)
  while (el.firstChild) next.appendChild(el.firstChild)
  for (const a of el.getAttributeNames()) next.setAttribute(a, el.getAttribute(a) ?? '')
  el.replaceWith(next)
  return next
}

/** Wraps an element's children in the given inline tags (outermost first). */
function wrapChildren(el: Element, tags: string[]) {
  if (!tags.length || !el.firstChild) return
  const doc = el.ownerDocument
  const outer = doc.createElement(tags[0])
  let inner = outer
  for (const t of tags.slice(1)) {
    const w = doc.createElement(t)
    inner.appendChild(w)
    inner = w
  }
  while (el.firstChild) inner.appendChild(el.firstChild)
  el.appendChild(outer)
}

function removeComments(root: Node) {
  const doc = root.ownerDocument ?? (root as Document)
  const walker = doc.createTreeWalker(root, 128 /* NodeFilter.SHOW_COMMENT */)
  const found: Node[] = []
  while (walker.nextNode()) found.push(walker.currentNode)
  found.forEach((n) => n.parentNode?.removeChild(n))
}

const cleanText = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** Parses and sanitises HTML into an inert <body>. Exported for tests. */
export function sanitizeHtml(html: string): { body: HTMLElement; metaTitle?: string; titleText?: string; stats: HtmlStats } {
  if (typeof DOMParser === 'undefined') throw new Error('HTML import needs a browser.')
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const stats: HtmlStats = { images: 0, comments: 0, footnotes: 0, tables: 0 }
  const metaTitle = cleanText(doc.querySelector('title')?.textContent) || undefined
  const classes = classStyles(doc)
  const body = doc.body

  removeComments(doc)

  // Google Docs comments: "[a]" markers in the text and the comment bodies at the end.
  for (const a of [...body.querySelectorAll('a[id^="cmnt"]')]) {
    if (!a.isConnected) continue
    if (a.id.startsWith('cmnt_ref')) (a.closest('sup') ?? a).remove()
    else {
      stats.comments++
      ;(a.closest('div') ?? a.closest('p') ?? a).remove()
    }
  }
  // Footnotes are kept as plain text: Google Docs' "[1]" note paragraphs at the end,
  // and mammoth's numbered list of notes (minus its "↑" back-links).
  stats.footnotes += body.querySelectorAll('a[id^="ftnt"]:not([id^="ftnt_ref"])').length
  stats.footnotes += body.querySelectorAll('li[id^="footnote-"], li[id^="endnote-"]').length
  body.querySelectorAll('a[href^="#footnote-ref-"], a[href^="#endnote-ref-"]').forEach((a) => a.remove())

  body.querySelectorAll(REMOVE).forEach((el) => el.remove())
  for (const img of [...body.querySelectorAll('img, picture')]) {
    if (!img.isConnected) continue
    stats.images++
    img.remove()
  }

  // Page breaks (Google Docs: <hr style="page-break-before:always;display:none">) are not scene breaks.
  for (const el of [...body.querySelectorAll('hr, br')]) {
    const d = effectiveStyle(el, classes)
    if (/always|page/.test(`${d['page-break-before'] ?? ''}${d['page-break-after'] ?? ''}${d['break-before'] ?? ''}`) || d.display === 'none') {
      el.remove()
    }
  }

  // Word "Save as Web Page": list bullets/numbers typed out in spans marked mso-list:Ignore.
  for (const el of [...body.querySelectorAll('[style]')]) {
    if (el.isConnected && /mso-list\s*:\s*ignore/i.test(el.getAttribute('style') ?? '')) el.remove()
  }

  // Tables → one paragraph per cell.
  stats.tables = body.querySelectorAll('table').length
  for (const cell of [...body.querySelectorAll('td, th')]) {
    if (cell.querySelector(BLOCK_CHILDREN)) unwrap(cell)
    else rename(cell, 'p')
  }
  body.querySelectorAll('table, thead, tbody, tfoot, tr, caption, colgroup, col').forEach((el) => {
    if (el.isConnected) unwrap(el)
  })

  // Title / subtitle paragraph styles (Google Docs "title", Word "MsoTitle", mammoth "h1.title").
  let titleText: string | undefined
  for (const el of [...body.querySelectorAll('.title, .MsoTitle, .subtitle, .MsoSubtitle')]) {
    const isTitle = el.classList.contains('title') || el.classList.contains('MsoTitle')
    if (isTitle) {
      if (!titleText) titleText = cleanText(el.textContent) || undefined
      if (el.tagName !== 'H1' && (el.tagName === 'P' || el.tagName === 'DIV')) rename(el, 'h1')
    } else if (HEADINGS.has(el.tagName)) rename(el, 'p')
  }
  for (const el of [...body.querySelectorAll('h4, h5, h6')]) rename(el, 'h3')

  // Formatting carried by CSS → semantic tags. (Snapshot first: wrapping adds elements.)
  for (const el of [...body.querySelectorAll('*')]) {
    const d = effectiveStyle(el, classes)
    const tag = el.tagName
    const w = d['font-weight']
    // Google Docs wraps copied HTML in <b style="font-weight:normal">: not bold.
    if ((tag === 'B' || tag === 'STRONG') && isNormalWeight(w)) {
      unwrap(el)
      continue
    }
    if ((tag === 'I' || tag === 'EM') && d['font-style'] === 'normal') {
      unwrap(el)
      continue
    }
    const wrap: string[] = []
    if (isBold(w) && !HEADINGS.has(tag) && tag !== 'B' && tag !== 'STRONG') wrap.push('strong')
    if ((d['font-style'] === 'italic' || d['font-style'] === 'oblique') && tag !== 'I' && tag !== 'EM') wrap.push('em')
    const deco = decoration(d)
    if (deco.includes('underline') && tag !== 'U') wrap.push('u')
    if (deco.includes('line-through') && tag !== 'S' && tag !== 'DEL' && tag !== 'STRIKE') wrap.push('s')
    // Never wrap whole sections (a bold <body> or <div>): only text-level content.
    if (wrap.length && !el.querySelector(BLOCK_CHILDREN)) wrapChildren(el, wrap)
    const align = d['text-align']
    const keepAlign = TEXT_BLOCKS.has(tag) && (align === 'center' || align === 'right') ? align : null
    for (const a of el.getAttributeNames()) {
      if (a === 'start' && tag === 'OL') continue
      el.removeAttribute(a)
    }
    if (keepAlign && (tag === 'P' || HEADINGS.has(tag))) el.setAttribute('style', `text-align: ${keepAlign}`)
  }

  // Links keep their text only; remaining wrappers ProseMirror would skip anyway.
  body.querySelectorAll('a, font, form').forEach((el) => {
    if (el.isConnected) unwrap(el)
  })

  // Spaces and tabs the writer typed are kept (the DOM parser runs with
  // preserveWhitespace). Only line breaks in the HTML source (a hand-written or
  // "Save as Web Page" file wrapping its text) are source formatting: each,
  // with the indentation around it, reads as one space, as a browser shows it.
  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */)
  const texts: Text[] = []
  while (walker.nextNode()) texts.push(walker.currentNode as Text)
  for (const t of texts) {
    if (t.parentElement?.closest('pre')) continue
    const v = t.nodeValue ?? ''
    if (/[\r\n]/.test(v)) t.nodeValue = v.replace(/[ \t]*(?:\r\n?|\n)[ \t\r\n]*/g, ' ')
  }

  return { body, metaTitle, titleText, stats }
}

/** Sanitised HTML → TipTap JSON with the editor's own schema (what generateJSON does, without re-parsing). */
export function htmlToDoc(html: string): HtmlResult {
  const { body, metaTitle, titleText, stats } = sanitizeHtml(html)
  const doc = PMDOMParser.fromSchema(editorSchema()).parse(body, { preserveWhitespace: true }).toJSON() as JSONContent
  return { doc, metaTitle, titleText, stats }
}
