import type { ThunderDoc } from '../../types'
import { resolveFormat, type ResolvedFormat } from '../editor/presets'
import { DOCX_MIME } from './formats'
import { alignOf, children, docBlocks, headingLevel, isIndentBreaker, markAttr, markSet, stripIllegalXml, type Align, type PMNode } from './pm'

type DocxLib = typeof import('docx')
type Paragraph = import('docx').Paragraph
type ParagraphOptions = Exclude<ConstructorParameters<DocxLib['Paragraph']>[0], string>
type RunOptions = Exclude<ConstructorParameters<DocxLib['TextRun']>[0], string>

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
 * margins, font, size and line spacing, chapters as Heading 1 (starting on a
 * new page when the format says so), page numbers in the footer.
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
  const ctx = new Ctx(lib, f)
  const blocks = docBlocks(doc.content)
  const body = ctx.blocks(blocks, { listLevel: -1, quoteDepth: 0, topLevel: true })
  if (body.length === 0) body.push(new lib.Paragraph({ style: DOCX_STYLES.first }))

  const { AlignmentType, Footer, LevelFormat, LineRuleType, PageNumber, TextRun } = lib
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

  return new lib.Document({
    title: doc.title?.trim() || 'Untitled Manuscript',
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
    sections: [
      {
        properties: {
          page: {
            size: { width: twips(f.widthIn), height: twips(f.heightIn) },
            margin: {
              top: twips(m.top),
              right: twips(m.right),
              bottom: twips(m.bottom),
              left: twips(m.left),
              header: twips(Math.max(0.2, m.top / 2)),
              footer: twips(Math.max(0.2, m.bottom / 2)),
              gutter: 0,
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new lib.Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT], size: halfPoints(pt * 0.8) })],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  })
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

  constructor(lib: DocxLib, f: ResolvedFormat) {
    this.lib = lib
    this.f = f
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
        const breakBefore = level === 1 && this.f.chapterStartsNewPage && !(c.topLevel && first)
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
