import type { ThunderDoc } from '../../types'
import { resolveFormat, type ResolvedFormat } from '../editor/presets'
import { wordFontName, SCENE_BREAK_TEXT } from './toDocx'
import { alignOf, children, docBlocks, headingLevel, isIndentBreaker, markAttr, markSet, type PMNode } from './pm'

/**
 * Rich Text Format, saved as the Word 97–2003 (.doc) download. Every version
 * of Word (and Pages, LibreOffice and TextEdit) opens an RTF file named .doc
 * as a Word document, which is how web apps have long written .doc. It keeps
 * the book's page size and margins, font, size and line spacing, chapters
 * (Heading 1, starting a new page when set), bold, italic, underline,
 * strikethrough, highlight, alignment, first-line indents, scene breaks,
 * quotes and lists, with page numbers at the foot. Running heads aren't
 * written: the .docx export has those.
 */
export function toRtf(doc: Pick<ThunderDoc, 'title' | 'content' | 'format'>): string {
  const f = resolveFormat(doc.format)
  const w = new Writer(f)
  const body = w.blocks(docBlocks(doc.content), { quoteDepth: 0, listDepth: 0, topLevel: true })
  const pt = f.fontSizePt
  const m = f.marginIn
  const title = doc.title?.trim() || 'Untitled Manuscript'
  // The alternative name goes before the font's name ({\f0\froman{\*\falt Palatino} Palatino Linotype;}).
  const fonts = w.fonts
    .map((font, i) => `{\\f${i}\\${font.family}\\fcharset0${font.alt ? `{\\*\\falt ${escape(font.alt)}}` : ''} ${escape(font.name)};}`)
    .join('')
  const line = w.lineSpacing
  return [
    '{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1',
    `{\\fonttbl${fonts}}`,
    '{\\colortbl;\\red255\\green255\\blue0;}',
    '{\\stylesheet',
    `{\\s0\\ql\\sl${line}\\slmult1\\f0\\fs${hp(pt)} Normal;}`,
    `{\\s1\\qc\\sb${em(2.2 * 1.7, pt)}\\sa${em(1.2 * 1.7, pt)}\\keepn\\keep\\outlinelevel0\\f0\\fs${hp(pt * 1.7)} \\sbasedon0\\snext0 heading 1;}`,
    `{\\s2\\qc\\sb${em(1.2 * 1.2, pt)}\\sa${em(0.6 * 1.2, pt)}\\keepn\\keep\\outlinelevel1\\f0\\i\\fs${hp(pt * 1.2)} \\sbasedon0\\snext0 heading 2;}`,
    `{\\s3\\sb${em(0.8, pt)}\\sa${em(0.2, pt)}\\keepn\\outlinelevel2\\f0\\b\\scaps\\fs${hp(pt)} \\sbasedon0\\snext0 heading 3;}`,
    '}',
    `{\\info{\\title ${escape(title)}}{\\doccomm Exported from Thunder Writer}}`,
    // Page size and margins in twips; a two-sided book has mirrored margins (inside at the spine).
    `\\paperw${tw(f.widthIn)}\\paperh${tw(f.heightIn)}\\margl${tw(m.left)}\\margr${tw(m.right)}\\margt${tw(m.top)}\\margb${tw(m.bottom)}\\margmirror\\facingp\\widowctrl`,
    `\\sectd\\pgwsxn${tw(f.widthIn)}\\pghsxn${tw(f.heightIn)}\\headery${tw(Math.max(0.2, m.top / 2))}\\footery${tw(Math.max(0.2, m.bottom / 2))}\\titlepg`,
    `{\\footer\\pard\\plain\\qc\\f0\\fs${hp(pt * 0.85)}{\\field{\\*\\fldinst PAGE}{\\fldrslt 1}}\\par}`,
    body || `\\pard\\plain\\s0\\f0\\fs${hp(pt)}\\par`,
    '}',
    '',
  ].join('\n')
}

interface Font {
  name: string
  /** RTF font family, so a reader without the font picks a similar one. */
  family: 'froman' | 'fswiss' | 'fmodern'
  /** Another font from the stack, for readers without the first. */
  alt: string | null
}

const familyNames = (stack: string) =>
  stack
    .split(',')
    .map((f) => f.trim().replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean)

function fontOf(stack: string | null | undefined): Font {
  const names = familyNames(stack ?? '')
  const lower = names.map((n) => n.toLowerCase())
  const family = lower.includes('sans-serif') || lower.includes('system-ui') ? 'fswiss' : lower.includes('monospace') ? 'fmodern' : 'froman'
  const name = wordFontName(stack)
  const alt = names.find((n) => n !== name && !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)$/i.test(n)) ?? null
  return { name, family, alt }
}

const tw = (inches: number) => Math.round(inches * 1440)
/** Twips for `n` em of a `pt`-point font. */
const em = (n: number, pt: number) => Math.round(n * pt * 20)
/** Half-points (RTF font sizes). */
const hp = (pt: number) => Math.max(2, Math.round(pt * 2))

/** RTF text: control characters escaped, and anything beyond ASCII as \uN (with "?" for readers that can't). */
export function escape(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ch = s[i]
    if (ch === '\\' || ch === '{' || ch === '}') out += `\\${ch}`
    else if (ch === '\t') out += '\\tab '
    else if (ch === '\n') out += '\\line '
    else if (c < 0x20) continue
    else if (c < 0x80) out += ch
    // Each UTF-16 unit (surrogate halves too) is a signed 16-bit \u.
    else out += `\\u${c > 32767 ? c - 65536 : c}?`
  }
  return out
}

interface Ctx {
  quoteDepth: number
  listDepth: number
  topLevel: boolean
}

class Writer {
  /** Font table; the book's font is \f0. */
  readonly fonts: Font[]
  readonly lineSpacing: number
  private readonly f: ResolvedFormat
  private firstBlock = true

  constructor(f: ResolvedFormat) {
    this.f = f
    this.fonts = [fontOf(f.fontFamily)]
    this.lineSpacing = Math.round(240 * f.lineHeight)
  }

  private font(stack: string): number {
    const font = fontOf(stack)
    const i = this.fonts.findIndex((f) => f.name === font.name)
    if (i >= 0) return i
    this.fonts.push(font)
    return this.fonts.length - 1
  }

  blocks(blocks: PMNode[], c: Ctx): string {
    return blocks.map((b, i) => this.block(b, blocks[i - 1], i === 0, c)).join('')
  }

  private para(opts: { style?: number; align?: string | null; extra?: string; text: string }) {
    const pt = this.f.fontSizePt
    const q = opts.align === 'center' ? '\\qc' : opts.align === 'right' ? '\\qr' : opts.align === 'justify' ? '\\qj' : ''
    const style = opts.style ?? 0
    let base = `\\s0\\sl${this.lineSpacing}\\slmult1\\f0\\fs${hp(pt)}`
    if (style === 1) base = `\\s1\\qc\\sb${em(2.2 * 1.7, pt)}\\sa${em(1.2 * 1.7, pt)}\\keepn\\keep\\outlinelevel0\\f0\\fs${hp(pt * 1.7)}`
    if (style === 2) base = `\\s2\\qc\\sb${em(1.2 * 1.2, pt)}\\sa${em(0.6 * 1.2, pt)}\\keepn\\keep\\outlinelevel1\\f0\\i\\fs${hp(pt * 1.2)}`
    if (style === 3) base = `\\s3\\sb${em(0.8, pt)}\\sa${em(0.2, pt)}\\keepn\\outlinelevel2\\f0\\b\\scaps\\fs${hp(pt)}`
    this.firstBlock = false
    return `\\pard\\plain${base}${q}${opts.extra ?? ''} ${opts.text}\\par\n`
  }

  private block(n: PMNode, prev: PMNode | undefined, first: boolean, c: Ctx): string {
    const pt = this.f.fontSizePt
    const quote = c.quoteDepth > 0 ? `\\li${em(1.4 * c.quoteDepth, pt)}\\sb${em(0.25, pt)}\\sa${em(0.25, pt)}` : ''
    switch (n.type) {
      case 'paragraph': {
        const a = alignOf(n)
        const noIndent = c.quoteDepth > 0 || c.listDepth > 0 || first || isIndentBreaker(prev) || a === 'center' || a === 'right'
        const indent = noIndent ? '' : `\\fi${em(1.5, pt)}`
        const italic = c.quoteDepth > 0 ? '\\i' : ''
        return this.para({ align: a, extra: `${indent}${quote}\\widctlpar${italic}`, text: this.runs(n) })
      }
      case 'heading': {
        const level = headingLevel(n)
        // A chapter starts a new page, except at the very start of the book.
        const pageBreak = level === 1 && this.f.chapterStartsNewPage && !this.firstBlock ? '\\pagebb' : ''
        return this.para({ style: level, align: alignOf(n), extra: `${pageBreak}${quote}`, text: this.runs(n) })
      }
      case 'horizontalRule': {
        const half = Math.round((pt * this.f.lineHeight * 20) / 2)
        return this.para({ align: 'center', extra: `\\sb${half}\\sa${half}\\keepn`, text: escape(SCENE_BREAK_TEXT) })
      }
      case 'blockquote':
        return this.blocks(children(n), { ...c, quoteDepth: c.quoteDepth + 1, topLevel: false })
      case 'bulletList':
      case 'orderedList':
        return this.list(n, c)
      default: {
        const kids = children(n)
        if (kids.some((k) => k.type === 'text' || k.type === 'hardBreak')) return this.para({ text: this.runs(n) })
        return this.blocks(kids, { ...c, topLevel: false })
      }
    }
  }

  /** Lists as indented paragraphs led by their bullet or number (a hanging indent). */
  private list(n: PMNode, c: Ctx): string {
    const pt = this.f.fontSizePt
    const depth = c.listDepth + 1
    const ordered = n.type === 'orderedList'
    const raw = n.attrs?.start
    const start = Number.isInteger(raw) && (raw as number) >= 0 ? (raw as number) : 1
    const left = Math.round(1440 * 0.3 * depth) + (c.quoteDepth ? em(1.4 * c.quoteDepth, pt) : 0)
    const hang = Math.round(1440 * 0.25)
    const inner: Ctx = { ...c, listDepth: depth, topLevel: false }
    let out = ''
    children(n).forEach((li, i) => {
      const marker = ordered ? `${start + i}.` : ['\\u8226?', '\\u9702?', '\\u9642?'][(depth - 1) % 3]
      let numbered = false
      for (const k of li.type === 'listItem' ? children(li) : [li]) {
        if (k.type === 'bulletList' || k.type === 'orderedList') {
          out += this.list(k, inner)
          continue
        }
        if (!numbered && (k.type === 'paragraph' || k.type === 'heading')) {
          numbered = true
          out += this.para({ align: alignOf(k), extra: `\\li${left}\\fi-${hang}\\tx${left}`, text: `${marker}\\tab ${this.runs(k)}` })
          continue
        }
        out += this.block(k, undefined, true, { ...inner, quoteDepth: c.quoteDepth })
      }
      if (!numbered) out += this.para({ extra: `\\li${left}\\fi-${hang}\\tx${left}`, text: `${marker}\\tab ` })
    })
    return out
  }

  /** A paragraph's text, each run in a group with its marks. */
  private runs(n: PMNode): string {
    let out = ''
    const walk = (node: PMNode) => {
      if (node.type === 'hardBreak') {
        out += '\\line '
        return
      }
      if (node.type !== 'text') {
        children(node).forEach(walk)
        return
      }
      const text = escape(node.text ?? '')
      if (!text) return
      const marks = markSet(node)
      let codes = ''
      if (marks.has('bold')) codes += '\\b'
      if (marks.has('italic')) codes += '\\i'
      if (marks.has('underline')) codes += '\\ul'
      if (marks.has('strike')) codes += '\\strike'
      if (marks.has('highlight')) codes += '\\highlight1'
      const family = markAttr(node, 'textStyle', 'fontFamily')
      if (typeof family === 'string' && family.trim()) codes += `\\f${this.font(family)}`
      out += codes ? `{${codes} ${text}}` : text
    }
    children(n).forEach(walk)
    return out
  }
}
