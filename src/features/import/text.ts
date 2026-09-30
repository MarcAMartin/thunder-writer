import type { JSONContent } from '@tiptap/core'
import { isChapterHeading, isSceneBreak } from './chapters'

/**
 * Plain text → paragraphs. Two conventions are common for manuscripts:
 * - blank lines between paragraphs (possibly hard-wrapped at ~70 columns);
 * - one line per paragraph with no blank lines (what most apps export as .txt).
 * Which one applies, and whether lines were hard-wrapped, is judged across the
 * whole file (see detectWrapWidth); either way the writer’s text is kept exactly (only surrounding
 * whitespace and line wrapping change).
 */

/** A line longer than this can't be hard-wrapped prose. */
const LONG_LINE = 100
/** Wrapped lines are all at least this long (except a paragraph's last). */
const WRAPPED_MIN = 45

export const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, '\n').replace(/\u2029/g, '\n')

export const textPara = (text: string): JSONContent =>
  text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }

/** Paragraph with hard breaks between lines. */
function brokenPara(lines: string[]): JSONContent {
  const content: JSONContent[] = []
  lines.forEach((l, i) => {
    if (i) content.push({ type: 'hardBreak' })
    if (l) content.push({ type: 'text', text: l })
  })
  return { type: 'paragraph', content }
}

export type LineMode = 'join' | 'separate' | 'breaks'

/**
 * How to read the lines of one blank-line-separated block: hard-wrapped prose
 * is joined with spaces, long lines are separate paragraphs, and short lines
 * (a poem, a letter's address) keep their line breaks.
 */
export function blockLineMode(lines: string[]): LineMode {
  if (lines.length < 2) return 'join'
  const body = lines.slice(0, -1)
  if (lines.some((l) => l.length > LONG_LINE)) return 'separate'
  if (body.every((l) => l.length >= WRAPPED_MIN)) return 'join'
  return 'breaks'
}

/**
 * True when blank lines are rare (fewer than one per ten lines of text), so
 * each line is its own paragraph and a blank line is deliberate space (a
 * scene gap), rather than the separator between paragraphs.
 */
export function usesLinePerParagraph(lines: string[]): boolean {
  const nonBlank = lines.filter((l) => l.trim() !== '').length
  if (nonBlank < 2) return false
  let separators = 0
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '' && lines[i - 1].trim() !== '') separators++
  // Trailing blank lines at the end of the file aren't separators.
  if (lines.length && lines[lines.length - 1].trim() === '') separators = Math.max(0, separators - 1)
  return separators / nonBlank < 0.1
}

/** A line ending a sentence: . ! ? … (then any closing quotes or brackets), or a closing quote. */
const ENDS_SENTENCE = /(?:[.!?…]["”’'»)\]]*|["”’»])$/u
/** A line starting a sentence: a capital or digit, after any opening quotes, brackets or dashes. */
const STARTS_SENTENCE = /^["“‘'«(\[—–-]*[\p{Lu}\d]/u
/** Lines of hard-wrapped text end within this many characters of the wrap width. */
const WRAP_SLACK = 20
/** A block of at most this many short lines (a poem stanza, an address) keeps its line breaks. */
const MAX_SHORT_BLOCK = 16

interface Line {
  text: string
  /** Began with spaces or a tab (a typed paragraph indent). */
  indented: boolean
}

interface Block {
  lines: Line[]
  /** Blank lines between this block and the previous one. */
  blanksBefore: number
}

const isStructural = (t: string) => isSceneBreak(t) || isChapterHeading(t)

/**
 * The wrap width when the file is hard-wrapped (every line broken at about the
 * same column, as old editors and e-mail did), else null. Judged across the
 * whole file: lines that continue into the next line cluster just under one
 * width, and rarely end a sentence right before a line that starts a new one.
 * Text with one paragraph (or line of dialogue) per line fails the second test
 * even when its lines happen to be of similar length.
 */
export function detectWrapWidth(blocks: Array<{ lines: Array<{ text: string }> }>): number | null {
  const pairs: Array<[string, string]> = []
  let longest = 0
  for (const b of blocks) {
    b.lines.forEach((l, i) => {
      if (!isStructural(l.text)) longest = Math.max(longest, l.text.length)
      const next = b.lines[i + 1]
      if (next && !isStructural(l.text) && !isSceneBreak(next.text)) pairs.push([l.text, next.text])
    })
  }
  if (pairs.length === 0) return null
  const width = Math.max(...pairs.map(([a]) => a.length))
  if (width < WRAPPED_MIN || width > LONG_LINE || longest > width + 2) return null
  const near = pairs.filter(([a]) => a.length >= width - WRAP_SLACK).length / pairs.length
  const sentenceBreaks = pairs.filter(([a, c]) => ENDS_SENTENCE.test(a) && STARTS_SENTENCE.test(c)).length / pairs.length
  return near >= 0.7 && sentenceBreaks < 0.4 ? width : null
}

export interface PlainTextResult {
  doc: JSONContent
  /** Set when hard-wrapped lines were joined: the column they were wrapped at. */
  wrapWidth?: number
  /** How many line breaks were replaced by spaces. */
  joinedLines: number
}

/** The most common value (the smaller one on a tie). */
function mode(values: number[]): number {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = values[0] ?? 0
  for (const [v, c] of counts) if (c > (counts.get(best) ?? 0) || (c === counts.get(best) && v < best)) best = v
  return best
}

export function readPlainText(input: string): PlainTextResult {
  const raw = normalizeNewlines(input).split('\n')
  const blocks: Block[] = []
  let current: Line[] | null = null
  let blanks = 0
  for (const r of raw) {
    const text = r.replace(/\s+$/u, '').replace(/^[ \t\u3000]+/u, '')
    if (!text) {
      current = null
      blanks++
      continue
    }
    if (!current) {
      current = []
      blocks.push({ lines: current, blanksBefore: blocks.length ? blanks : 0 })
      blanks = 0
    }
    current.push({ text, indented: /^[ \t\u3000]/u.test(r) })
  }

  const nonBlank = blocks.reduce((n, b) => n + b.lines.length, 0)
  const gaps = blocks.slice(1).map((b) => b.blanksBefore)
  // Blank lines are rare: each line is a paragraph, and any blank line is deliberate space.
  const rareBlanks = nonBlank >= 2 && gaps.length / nonBlank < 0.1
  // Otherwise blank lines separate paragraphs; a longer run than usual is deliberate space.
  const usualGap = mode(gaps)
  const width = detectWrapWidth(blocks)
  const content: JSONContent[] = []
  let joinedLines = 0

  const emitWrapped = (run: Line[], w: number) => {
    const near = (l: Line) => l.text.length >= w - WRAP_SLACK
    // A short line mid-block that doesn't end a sentence: a poem or an address, not prose.
    if (run.slice(0, -1).some((l) => !near(l) && !ENDS_SENTENCE.test(l.text))) {
      content.push(brokenPara(run.map((l) => l.text)))
      return
    }
    const mixedIndent = run.some((l) => l.indented) && run.some((l) => !l.indented)
    let para: string[] = []
    const flush = () => {
      if (!para.length) return
      joinedLines += para.length - 1
      content.push(textPara(para.join(' ')))
      para = []
    }
    run.forEach((l, i) => {
      // A paragraph ends at a line well short of the width, and starts at an indented line.
      if (i > 0 && (!near(run[i - 1]) || (mixedIndent && l.indented))) flush()
      para.push(l.text)
    })
    flush()
  }

  const emit = (run: Line[]) => {
    if (!run.length) return
    if (run.length === 1) content.push(textPara(run[0].text))
    else if (width) emitWrapped(run, width)
    else if (!rareBlanks && run.length <= MAX_SHORT_BLOCK && run.every((l) => l.text.length < WRAPPED_MIN)) {
      content.push(brokenPara(run.map((l) => l.text)))
    } else run.forEach((l) => content.push(textPara(l.text)))
  }

  blocks.forEach((block, k) => {
    if (k > 0 && (rareBlanks ? block.blanksBefore >= 1 : block.blanksBefore > usualGap)) content.push({ type: 'paragraph' })
    // Chapter titles and scene breaks sometimes sit directly above the text.
    let rest = block.lines
    if (rest.length > 1 && isChapterHeading(rest[0].text)) {
      content.push(textPara(rest[0].text))
      rest = rest.slice(1)
    }
    let run: Line[] = []
    for (const l of rest) {
      if (isSceneBreak(l.text)) {
        emit(run)
        run = []
        content.push(textPara(l.text))
      } else run.push(l)
    }
    emit(run)
  })

  return { doc: { type: 'doc', content }, joinedLines, ...(joinedLines > 0 && width ? { wrapWidth: width } : {}) }
}

export const textToDoc = (input: string): JSONContent => readPlainText(input).doc
