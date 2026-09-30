import type { JSONContent } from '@tiptap/core'
import { isChapterHeading, isSceneBreak } from './chapters'

/**
 * Plain text → paragraphs. Two conventions are common for manuscripts:
 * - blank lines between paragraphs (possibly hard-wrapped at ~70 columns);
 * - one line per paragraph with no blank lines (what most apps export as .txt).
 * The second is detected from how rarely blank lines occur and how long lines
 * get; either way the writer's text is kept exactly (only surrounding
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

/** True when the text puts each paragraph on its own line with (almost) no blank lines. */
export function usesLinePerParagraph(lines: string[]): boolean {
  const nonBlank = lines.filter((l) => l.trim() !== '')
  if (nonBlank.length < 2) return false
  let separators = 0
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '' && lines[i - 1].trim() !== '') separators++
  // Trailing blank lines at the end of the file aren't separators.
  if (lines.length && lines[lines.length - 1].trim() === '') separators = Math.max(0, separators - 1)
  if (separators === 0) return true
  const longRatio = nonBlank.filter((l) => l.trim().length > LONG_LINE).length / nonBlank.length
  return separators / nonBlank.length < 0.1 && longRatio >= 0.1
}

export function textToDoc(input: string): JSONContent {
  const lines = normalizeNewlines(input)
    .split('\n')
    .map((l) => l.replace(/\s+$/u, '').replace(/^[ \t\u3000]+/u, ''))
  const content: JSONContent[] = []

  if (usesLinePerParagraph(lines)) {
    let blank = false
    for (const l of lines) {
      if (!l) {
        if (!blank && content.length) content.push({ type: 'paragraph' })
        blank = true
        continue
      }
      blank = false
      content.push(textPara(l))
    }
    return { type: 'doc', content }
  }

  let block: string[] = []
  const flush = () => {
    if (!block.length) return
    // Chapter titles and scene breaks sometimes sit directly above the text.
    let rest = block
    if (rest.length > 1 && isChapterHeading(rest[0])) {
      content.push(textPara(rest[0]))
      rest = rest.slice(1)
    }
    let run: string[] = []
    const emit = () => {
      if (!run.length) return
      const mode = blockLineMode(run)
      if (mode === 'join') content.push(textPara(run.join(' ')))
      else if (mode === 'separate') run.forEach((l) => content.push(textPara(l)))
      else content.push(brokenPara(run))
      run = []
    }
    for (const l of rest) {
      if (isSceneBreak(l)) {
        emit()
        content.push(textPara(l))
      } else run.push(l)
    }
    emit()
    block = []
  }
  for (const l of lines) {
    if (l) block.push(l)
    else flush()
  }
  flush()
  return { type: 'doc', content }
}
