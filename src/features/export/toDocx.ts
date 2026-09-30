import type { ThunderDoc } from '../../types'
import { resolveFormat, type ResolvedFormat } from '../editor/presets'
import { DOCX_MIME } from './formats'
import {
  normalizeBookLayout,
  normalizeHeaderFooter,
  resolveHeaderFooter,
  sideOfFolio,
  type HeaderFooterSettings,
  type PageFurniture,
  type PageSide,
  type Slots,
} from '../preview/headerFooter'
import {
  alignOf,
  children,
  docBlocks,
  headingLevel,
  chapterParts,
  isIndentBreaker,
  markAttr,
  markSet,
  stripIllegalXml,
  type Align,
  type PMNode,
} from './pm'

type DocxLib = typeof import('docx')
type Paragraph = import('docx').Paragraph
type ParagraphOptions = Exclude<ConstructorParameters<DocxLib['Paragraph']>[0], string>
type RunOptions = Exclude<ConstructorParameters<DocxLib['TextRun']>[0], string>
type SectionOptions = import('docx').ISectionOptions
type HeaderFooterGroup<T> = { default?: T; first?: T; even?: T }

/** Word paragraph style ids this exporter writes (real styles, so Word's navigation pane and re-imports work). */
export const DOCX_STYLES = {
  body: 'BodyText',
  first: 'FirstParagraph',
  quote: 'Quote',
  sceneBreak: 'SceneBreak',
} as const

export const SCENE_BREAK_TEXT = '* * *'

const TWIPS_PER_IN = 1440
const twips = (inches: number) => Math.round(inches * TWIPS_PER_IN)
/** Twips for a length in "em" of a font of `pt` points. */
const emTwips = (em: number, pt: number) => Math.round(em * pt * 20)
const halfPoints = (pt: number) => Math.max(2, Math.round(pt * 2))

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace'])
// Web fonts from the editor's stacks that desktop Word rarely has; the next family in the stack is used instead.
const WEB_ONLY = new Set(['eb garamond', 'libre baskerville', 'bitstream charter', 'sitka text', 'adobe garamond pro'])

/** The Word font name for a CSS font stack: its first family a desktop word processor is likely to have. */
export function wordFontName(stack: string | undefined | null): string {
  const families = (stack ?? '')
    .split(',')
    .map((f) => f.trim().replace(/^['"]|['"]$/g, '').trim())
    .filter((f) => f && !GENERIC.has(f.toLowerCase()))
  return families.find((f) => !WEB_ONLY.has(f.toLowerCase())) ?? families[0] ?? 'Times New Roman'
}

/**
 * A Word document laid out like the manuscript's book format: trim size,
 * mirrored margins (gutter at the spine), font, size and line spacing,
 * chapters as Heading 1, and the running heads, footer line and page numbers
 * chosen in Headers & footers (different on left and right pages).
 *
 * When chapters start a new page, each chapter is its own Word section: the
 * section break starts the page (an odd-page break when chapters open on a
 * right-hand page), and the section's "different first page" header and
 * footer drop the running head from the chapter opening and move the page
 * number to its foot. Word's own widow control decides where pages break, so
 * the preview's balanced spreads aren't reproduced; the preview's
 * Print / PDF is the exact typeset book.
 * The `docx` library is loaded on first use so it stays out of the main bundle.
 */
export async function toDocx(doc: Pick<ThunderDoc, 'title' | 'content' | 'format'>): Promise<Blob> {
  const lib = await import('docx')
  const file = buildDocxDocument(lib, doc)
  const buf = await lib.Packer.toArrayBuffer(file)
  return new Blob([buf], { type: DOCX_MIME })
}

export function buildDocxDocument(lib: DocxLib, doc: Pick<ThunderDoc, 'title' | 'content' | 'format'>) {
  const f = resolveFormat(doc.format)
  const hf = normalizeHeaderFooter(doc.format?.headerFooter)
  const book = normalizeBookLayout(doc.format?.bookLayout)
  const title = doc.title?.trim() || 'Untitled Manuscript'
  const blocks = docBlocks(doc.content)
  // Chapters that start a new page are Word sections (see above); otherwise the book is one section.
  const sectioned = f.chapterStartsNewPage
  const parts = sectioned ? chapterParts(blocks) : [{ from: 0, to: blocks.length, chapterTitle: '' }]
  if (parts.length === 0) parts.push({ from: 0, to: 0, chapterTitle: '' })
  const ctx = new Ctx(lib, f, sectioned)
  const bodies = parts.map((part) => ctx.topLevel(blocks, part.from, part.to))
  if (bodies[0].length === 0 && bodies.length === 1) bodies[0].push(new lib.Paragraph({ style: DOCX_STYLES.first }))

  const { AlignmentType, LevelFormat, LineRuleType, SectionType } = lib
  const font = wordFontName(f.fontFamily)
  const pt = f.fontSizePt
  const line = Math.round(240 * f.lineHeight)
  const m = f.marginIn

  const bulletGlyphs = ['•', '◦', '▪']
  const numberFormats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN]
  const listLevels = (bullet: boolean, start = 1) =>
    Array.from({ length: 9 }, (_, level) => ({
      level,
      format: bullet ? LevelFormat.BULLET : numberFormats[level % 3],
      text: bullet ? bulletGlyphs[level % 3] : `%${level + 1}.`,
      alignment: AlignmentType.LEFT,
      start: level === 0 ? start : 1,
      style: { paragraph: { indent: { left: twips(0.3 * (level + 1)), hanging: twips(0.25) } } },
    }))

  const band: BandCtx = {
    lib,
    hf,
    size: halfPoints(pt * hf.fontScale),
    width: twips(f.widthIn - m.left - m.right),
    chapterField: !sectioned,
  }
  const page = {
    size: { width: twips(f.widthIn), height: twips(f.heightIn) },
    // Left is the inside (gutter) margin and right the outside: mirrored on left-hand pages (mirrorMargins).
    margin: {
      top: twips(m.top),
      right: twips(m.right),
      bottom: twips(m.bottom),
      left: twips(m.left),
      header: twips(Math.max(0.2, m.top / 2)),
      footer: twips(Math.max(0.2, m.bottom / 2)),
      gutter: 0,
    },
  }
  const startsRecto = sectioned && book.chaptersStartRecto
  const firstSide = sideOfFolio(hf.firstPageNumber)
  const usesChapter = hf.versoHead === 'chapter' || hf.rectoHead === 'chapter'
  let prevKey = ''
  const sections: SectionOptions[] = parts.map((part, i) => {
    const openerSide: PageSide | null = i === 0 ? firstSide : startsRecto ? 'recto' : null
    // A section repeats headers and footers only when they differ from the previous
    // section's (a chapter head, or the opener's side); otherwise Word links it to the previous one.
    const key = JSON.stringify([usesChapter ? part.chapterTitle : '', openerSide])
    const furniture = i === 0 || key !== prevKey ? sectionFurniture(band, title, part.chapterTitle, openerSide) : null
    prevKey = key
    return {
      properties: {
        ...(i > 0 ? { type: startsRecto ? SectionType.ODD_PAGE : SectionType.NEXT_PAGE } : {}),
        // The chapter opening (and the book's first page) has no running head: a "different first page".
        titlePage: hf.suppressOnChapterOpeners,
        page: i === 0 ? { ...page, pageNumbers: { start: hf.firstPageNumber } } : page,
      },
      ...(furniture ? { headers: furniture.headers, footers: furniture.footers } : {}),
      children: bodies[i],
    }
  })

  const file = new lib.Document({
    title,
    evenAndOddHeaderAndFooters: true,
    creator: 'Thunder Writer',
    description: 'Exported from Thunder Writer',
    styles: {
      default: {
        document: {
          run: { font, size: halfPoints(pt) },
          paragraph: { spacing: { line, lineRule: LineRuleType.AUTO, before: 0, after: 0 } },
        },
        heading1: {
          run: { font, size: halfPoints(pt * 1.7), bold: false },
          paragraph: {
            alignment: AlignmentType.CENTER,
            spacing: { before: emTwips(2.2 * 1.7, pt), after: emTwips(1.2 * 1.7, pt), line: 288, lineRule: LineRuleType.AUTO },
            keepNext: true,
            keepLines: true,
            outlineLevel: 0,
          },
        },
        heading2: {
          run: { font, size: halfPoints(pt * 1.2), bold: false, italics: true },
          paragraph: {
            alignment: AlignmentType.CENTER,
            spacing: { before: emTwips(1.2 * 1.2, pt), after: emTwips(0.6 * 1.2, pt), line: 312, lineRule: LineRuleType.AUTO },
            keepNext: true,
            keepLines: true,
            outlineLevel: 1,
          },
        },
        heading3: {
          run: { font, size: halfPoints(pt), bold: true, smallCaps: true },
          paragraph: {
            spacing: { before: emTwips(0.8, pt), after: emTwips(0.2, pt) },
            keepNext: true,
            outlineLevel: 2,
          },
        },
        listParagraph: { paragraph: { indent: { firstLine: 0 } } },
      },
      paragraphStyles: [
        {
          id: DOCX_STYLES.body,
          name: 'Body Text',
          basedOn: 'Normal',
          next: DOCX_STYLES.body,
          quickFormat: true,
          paragraph: { indent: { firstLine: emTwips(1.5, pt) } },
        },
        {
          id: DOCX_STYLES.first,
          name: 'First Paragraph',
          basedOn: DOCX_STYLES.body,
          next: DOCX_STYLES.body,
          quickFormat: true,
          paragraph: { indent: { firstLine: 0 } },
        },
        {
          id: DOCX_STYLES.quote,
          name: 'Quote',
          basedOn: 'Normal',
          next: DOCX_STYLES.body,
          quickFormat: true,
          run: { italics: true },
          paragraph: {
            indent: { left: emTwips(1.4, pt), firstLine: 0 },
            spacing: { before: emTwips(0.25, pt), after: emTwips(0.25, pt) },
          },
        },
        {
          id: DOCX_STYLES.sceneBreak,
          name: 'Scene Break',
          basedOn: 'Normal',
          next: DOCX_STYLES.first,
          quickFormat: true,
          paragraph: {
            alignment: AlignmentType.CENTER,
            spacing: { before: Math.round((pt * f.lineHeight * 20) / 2), after: Math.round((pt * f.lineHeight * 20) / 2) },
            keepNext: true,
          },
        },
      ],
    },
    numbering: {
      config: [
        { reference: 'tw-bullet', levels: listLevels(true) },
        ...[...ctx.orderedStarts].map((start) => ({ reference: numberRef(start), levels: listLevels(false, start) })),
      ],
    },
    sections,
  })
  // Two-sided book: Word's "mirror margins" puts the left (inside) margin at the
  // spine on every page. The docx library has no option for it, so the setting
  // is added to its settings part, after w:displayBackgroundShape (schema order).
  addSetting(file, lib, 'w:mirrorMargins')
  // Each section but the last ends in a paragraph of its own holding the section
  // break; move the break onto the chapter's last paragraph instead.
  mergeSectionBreaks(file, lib, bodies.slice(0, -1).map((b) => b.at(-1)))
  return file
}

/**
 * The docx library ends every section except the last with a new, empty
 * paragraph whose properties hold the section break (w:pPr/w:sectPr). In Word
 * that paragraph mark is a full line of Normal text: when a chapter exactly
 * fills its last page it spills onto a page of its own, blank but for the
 * running head and number (two blank pages before a right-hand chapter). So the
 * break goes on the section's last real paragraph and the empty one is dropped,
 * as Word itself stores a section break. A section with no paragraphs keeps its
 * own. If the library's internals ever differ from what is expected here, the
 * document is left as the library built it (still valid, just with the extra lines).
 */
function mergeSectionBreaks(file: InstanceType<DocxLib['Document']>, lib: DocxLib, lastOfSection: (Paragraph | undefined)[]) {
  type Node = { root?: unknown[]; rootKey?: string }
  const body = (file.Document as unknown as { View?: { Body?: Node & { sectionParagraphs?: Map<unknown, unknown> } } }).View?.Body
  const root = body?.root
  if (!Array.isArray(root)) return
  for (const last of lastOfSection) {
    if (!last) continue
    const i = root.indexOf(last)
    const holder = root[i + 1] as Node | undefined
    if (i < 0 || !(holder instanceof lib.Paragraph)) continue
    // The holder is a paragraph with nothing but paragraph properties: its own
    // (empty) and the one holding the w:sectPr.
    const holderKids = (holder.root ?? []) as Node[]
    if (!holderKids.every((k) => k?.rootKey === 'w:pPr')) continue
    const withSect = holderKids.filter((k) => (k.root?.length ?? 0) > 0)
    const sect = withSect.length === 1 && withSect[0].root?.length === 1 ? (withSect[0].root[0] as Node | undefined) : undefined
    if (sect?.rootKey !== 'w:sectPr') continue
    const props = (last as unknown as { properties?: Node & { push?: (x: unknown) => void } }).properties
    if (!props || typeof props.push !== 'function' || props.root?.some((c) => (c as Node)?.rootKey === 'w:sectPr')) continue
    props.push(sect)
    root.splice(i + 1, 1)
    const map = body?.sectionParagraphs
    if (map instanceof Map && map.has(holder)) {
      map.set(last, map.get(holder))
      map.delete(holder)
    }
  }
}

/** Inserts an on/off element into word/settings.xml right after w:displayBackgroundShape. */
function addSetting(file: InstanceType<DocxLib['Document']>, lib: DocxLib, name: string) {
  const root = (file.Settings as unknown as { root?: unknown[] }).root
  if (!Array.isArray(root)) return
  const i = root.findIndex((c) => (c as { rootKey?: string })?.rootKey === 'w:displayBackgroundShape')
  root.splice(i >= 0 ? i + 1 : Math.min(1, root.length), 0, new lib.OnOffElement(name, true))
}

interface BandCtx {
  lib: DocxLib
  hf: HeaderFooterSettings
  /** Running head / folio size (half-points). */
  size: number
  /** Width of the text block (twips), for the centre and right tab stops. */
  width: number
  /** In a single-section book, a 'chapter' head is Word's STYLEREF field (the chapter in effect on the page). */
  chapterField: boolean
}

/**
 * One header or footer line from the page furniture's three slots. The page
 * number is Word's PAGE field; running heads are in small caps when set.
 */
function bandParagraph(c: BandCtx, slots: Slots, numberSlot: keyof Slots | null, kind: 'header' | 'footer', chapterSlot: keyof Slots | null) {
  const { lib } = c
  const { AlignmentType, PageNumber, Paragraph, SimpleField, Tab, TabStopType, TextRun } = lib
  const caps = kind === 'header' && c.hf.smallCapsRunningHeads ? { smallCaps: true } : {}
  const runs = (slot: keyof Slots) => {
    if (slot === numberSlot) return [new TextRun({ children: [PageNumber.CURRENT], size: c.size })]
    if (slot === chapterSlot) {
      // Word shows the text of the last Heading 1 on or before the page.
      return [new TextRun({ children: [new SimpleField('STYLEREF "Heading 1"', stripIllegalXml(slots[slot]))], size: c.size, ...caps })]
    }
    const text = stripIllegalXml(slots[slot])
    return text ? [new TextRun({ text, size: c.size, ...caps })] : []
  }
  const used = (['left', 'center', 'right'] as const).filter((k) => slots[k] || k === numberSlot)
  if (used.length <= 1) {
    const k = used[0] ?? 'center'
    const alignment = k === 'left' ? AlignmentType.LEFT : k === 'right' ? AlignmentType.RIGHT : AlignmentType.CENTER
    return new Paragraph({ alignment, children: used.length ? runs(k) : [new TextRun({ text: '', size: c.size })] })
  }
  // Several slots on one line: centre and right tab stops across the text block.
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    tabStops: [
      { type: TabStopType.CENTER, position: Math.round(c.width / 2) },
      { type: TabStopType.RIGHT, position: c.width },
    ],
    children: [
      ...runs('left'),
      new TextRun({ children: [new Tab()], size: c.size }),
      ...runs('center'),
      new TextRun({ children: [new Tab()], size: c.size }),
      ...runs('right'),
    ],
  })
}

function headerOf(c: BandCtx, p: PageFurniture, side: PageSide, head: 'chapter' | 'other') {
  const numberSlot = p.numberIn === 'header' ? (side === 'verso' ? 'left' : 'right') : null
  const chapterSlot = c.chapterField && head === 'chapter' && p.headerText ? 'center' : null
  return new c.lib.Header({ children: [bandParagraph(c, p.header, numberSlot, 'header', chapterSlot)] })
}

function footerOf(c: BandCtx, p: PageFurniture, centreNumber = false) {
  const { lib } = c
  let slots = p.footer
  let numberSlot: keyof Slots | null = p.numberIn === 'footer' ? p.align : null
  let note = p.footerNote
  if (centreNumber && numberSlot && numberSlot !== 'center') {
    // The side of this page isn't known in Word: its number goes in the middle.
    slots = { left: '', center: p.numberText, right: '' }
    note = p.footerText
    numberSlot = 'center'
  }
  const rows = [bandParagraph(c, slots, numberSlot, 'footer', null)]
  // The footer line gets a full-width row of its own below a centred number (as in the preview).
  if (note) rows.push(new lib.Paragraph({ alignment: lib.AlignmentType.CENTER, children: [new lib.TextRun({ text: stripIllegalXml(note), size: c.size })] }))
  return new lib.Footer({ children: rows })
}

/**
 * Headers and footers of one section: left (even) and right (default) pages,
 * and a chapter-opening first page when heads are suppressed there.
 */
function sectionFurniture(
  c: BandCtx,
  title: string,
  chapterTitle: string,
  /** Side of the section's first page, or null when Word decides (a plain page break). */
  openerSide: PageSide | null,
) {
  const at = (side: PageSide, opener: boolean) =>
    resolveHeaderFooter(c.hf, { title }, { index: side === 'recto' ? 0 : 1, side, chapterTitle, isChapterOpener: opener, isBlank: false })
  const recto = at('recto', false)
  const verso = at('verso', false)
  const headKind = (side: PageSide) => ((side === 'recto' ? c.hf.rectoHead : c.hf.versoHead) === 'chapter' ? 'chapter' : 'other')
  const headers: HeaderFooterGroup<InstanceType<DocxLib['Header']>> = {
    default: headerOf(c, recto, 'recto', headKind('recto')),
    even: headerOf(c, verso, 'verso', headKind('verso')),
  }
  const footers: HeaderFooterGroup<InstanceType<DocxLib['Footer']>> = { default: footerOf(c, recto), even: footerOf(c, verso) }
  if (c.hf.suppressOnChapterOpeners) {
    const side = openerSide ?? 'recto'
    const opener = at(side, true)
    headers.first = headerOf(c, opener, side, headKind(side))
    footers.first = footerOf(c, opener, openerSide === null)
  }
  return { headers, footers }
}

const numberRef = (start: number) => (start === 1 ? 'tw-number' : `tw-number-${start}`)

interface BlockCtx {
  /** -1 outside lists. */
  listLevel: number
  quoteDepth: number
  topLevel: boolean
}

class Ctx {
  /** Distinct `start` values of ordered lists (each needs a numbering definition). */
  readonly orderedStarts = new Set<number>([1])
  private instance = 0
  private readonly lib: DocxLib
  private readonly f: ResolvedFormat
  /** Top-level chapters start Word sections, whose break starts the page. */
  private readonly sectioned: boolean

  constructor(lib: DocxLib, f: ResolvedFormat, sectioned = false) {
    this.lib = lib
    this.f = f
    this.sectioned = sectioned
  }

  /** Top-level blocks [from, to), each seeing the block before it (even across sections) for indents. */
  topLevel(blocks: PMNode[], from: number, to: number): Paragraph[] {
    const out: Paragraph[] = []
    for (let i = from; i < to; i++) out.push(...this.block(blocks[i], blocks[i - 1], i === 0, { listLevel: -1, quoteDepth: 0, topLevel: true }))
    return out
  }

  blocks(blocks: PMNode[], c: BlockCtx): Paragraph[] {
    const out: Paragraph[] = []
    blocks.forEach((b, i) => {
      out.push(...this.block(b, blocks[i - 1], i === 0, c))
    })
    return out
  }

  private align(n: PMNode) {
    const a: Align | null = alignOf(n)
    const A = this.lib.AlignmentType
    return a === 'center' ? A.CENTER : a === 'right' ? A.RIGHT : a === 'justify' ? A.JUSTIFIED : a === 'left' ? A.LEFT : undefined
  }

  private quoteIndent(c: BlockCtx): ParagraphOptions['indent'] | undefined {
    return c.quoteDepth > 1 ? { left: emTwips(1.4 * c.quoteDepth, this.f.fontSizePt), firstLine: 0 } : undefined
  }

  private block(n: PMNode, prev: PMNode | undefined, first: boolean, c: BlockCtx): Paragraph[] {
    const { Paragraph, HeadingLevel } = this.lib
    switch (n.type) {
      case 'paragraph': {
        const a = alignOf(n)
        let style: string
        if (c.quoteDepth > 0) style = DOCX_STYLES.quote
        else if (first || isIndentBreaker(prev) || a === 'center' || a === 'right') style = DOCX_STYLES.first
        else style = DOCX_STYLES.body
        return [
          new Paragraph({ style, alignment: this.align(n), indent: this.quoteIndent(c), widowControl: true, children: this.runs(n) }),
        ]
      }
      case 'heading': {
        const level = headingLevel(n)
        const heading = level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3
        // A top-level chapter starts a section when sectioned (the section break starts the page).
        const breakBefore = level === 1 && this.f.chapterStartsNewPage && !(c.topLevel && (first || this.sectioned))
        return [
          new Paragraph({
            heading,
            alignment: this.align(n),
            pageBreakBefore: breakBefore || undefined,
            indent: this.quoteIndent(c),
            children: this.runs(n),
          }),
        ]
      }
      case 'horizontalRule':
        return [new Paragraph({ style: DOCX_STYLES.sceneBreak, children: [new this.lib.TextRun(SCENE_BREAK_TEXT)] })]
      case 'blockquote':
        return this.blocks(children(n), { ...c, quoteDepth: c.quoteDepth + 1, topLevel: false })
      case 'bulletList':
      case 'orderedList':
        return this.list(n, c)
      default: {
        const kids = children(n)
        if (kids.some((k) => k.type === 'text' || k.type === 'hardBreak')) {
          return [new Paragraph({ style: DOCX_STYLES.first, children: this.runs(n) })]
        }
        return this.blocks(kids, { ...c, topLevel: false })
      }
    }
  }

  private list(n: PMNode, c: BlockCtx): Paragraph[] {
    const { Paragraph } = this.lib
    const level = Math.min(8, c.listLevel + 1)
    const ordered = n.type === 'orderedList'
    let reference = 'tw-bullet'
    let instance: number | undefined
    if (ordered) {
      const raw = n.attrs?.start
      const start = Number.isInteger(raw) && (raw as number) >= 0 ? (raw as number) : 1
      this.orderedStarts.add(start)
      reference = numberRef(start)
      // Every ordered list restarts its numbering.
      instance = ++this.instance
    }
    const inner: BlockCtx = { listLevel: level, quoteDepth: c.quoteDepth, topLevel: false }
    const out: Paragraph[] = []
    for (const li of children(n)) {
      const kids = li.type === 'listItem' ? children(li) : [li]
      let numbered = false
      for (const k of kids) {
        if (k.type === 'bulletList' || k.type === 'orderedList') {
          out.push(...this.list(k, inner))
          continue
        }
        if (!numbered && (k.type === 'paragraph' || k.type === 'heading')) {
          numbered = true
          out.push(
            new Paragraph({
              alignment: this.align(k),
              numbering: { reference, level, ...(instance !== undefined ? { instance } : {}) },
              children: this.runs(k),
            }),
          )
          continue
        }
        // Continuation paragraphs line up with the item's text.
        for (const p of this.block(k, undefined, true, inner)) out.push(p)
      }
      if (!numbered) out.push(new Paragraph({ numbering: { reference, level, ...(instance !== undefined ? { instance } : {}) } }))
    }
    return out
  }

  private runs(n: PMNode) {
    const { TextRun, UnderlineType, HighlightColor } = this.lib
    const out: InstanceType<DocxLib['TextRun']>[] = []
    const walk = (node: PMNode) => {
      if (node.type === 'hardBreak') {
        out.push(new TextRun({ break: 1 }))
        return
      }
      if (node.type !== 'text') {
        children(node).forEach(walk)
        return
      }
      const text = stripIllegalXml(node.text ?? '')
      if (!text) return
      const marks = markSet(node)
      const opts: { -readonly [K in keyof RunOptions]: RunOptions[K] } = { text }
      if (marks.has('bold')) opts.bold = true
      if (marks.has('italic')) opts.italics = true
      if (marks.has('underline')) opts.underline = { type: UnderlineType.SINGLE }
      if (marks.has('strike')) opts.strike = true
      if (marks.has('highlight')) opts.highlight = HighlightColor.YELLOW
      const family = markAttr(node, 'textStyle', 'fontFamily')
      if (typeof family === 'string' && family.trim()) opts.font = wordFontName(family)
      out.push(new TextRun(opts))
    }
    children(n).forEach(walk)
    return out
  }
}
