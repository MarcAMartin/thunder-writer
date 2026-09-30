import type { JSONContent } from '@tiptap/core'
import { isBareChapterNumber, isChapterHeading, isSceneBreak } from './chapters'

/**
 * The manuscript-aware pass every import goes through, on TipTap JSON:
 * - standalone chapter lines ("Chapter 1", "Prologue"…) become H1 (Chapter)
 *   headings, so book-size page breaks work; "## Chapter 3" is raised to H1;
 * - scene-break lines ("* * *", "#", "§"…) become the editor's scene break
 *   (StarterKit's horizontalRule, the toolbar's "Scene break" button);
 * - runs of empty paragraphs collapse to one, and none are kept around
 *   headings and breaks or at the start and end;
 * - trailing whitespace and trailing line breaks inside paragraphs are trimmed.
 * The writer's words are never changed: no quote, dash or spacing rewrites.
 */

export interface ShapeResult {
  doc: JSONContent
  wordCount: number
  /** H1 headings, not counting a leading title heading. */
  chapterCount: number
  /** Plain lines promoted to chapter headings. */
  promotedChapters: number
  sceneBreaks: number
}

const TEXTBLOCKS = new Set(['paragraph', 'heading'])

/** Text of a textblock; hard breaks read as newlines. */
export function blockText(node: JSONContent): string {
  return (node.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : c.type === 'hardBreak' ? '\n' : '')).join('')
}

/** Removes trailing hard breaks and whitespace from a textblock (and its nested blocks). */
function trimTrailing(node: JSONContent): JSONContent {
  if (!node.content) return node
  if (!TEXTBLOCKS.has(node.type ?? '')) return { ...node, content: node.content.map(trimTrailing) }
  const content = [...node.content]
  while (content.length) {
    const last = content[content.length - 1]
    if (last.type === 'hardBreak') {
      content.pop()
      continue
    }
    if (last.type === 'text') {
      const text = (last.text ?? '').replace(/\s+$/u, '')
      if (!text) {
        content.pop()
        continue
      }
      if (text !== last.text) content[content.length - 1] = { ...last, text }
    }
    break
  }
  // Leading whitespace (typed indentation) goes too; the page indents paragraphs itself.
  const first = content[0]
  if (first?.type === 'text') {
    const text = (first.text ?? '').replace(/^[ \t\u3000]+/u, '')
    if (!text) content.shift()
    else if (text !== first.text) content[0] = { ...first, text }
  }
  const out: JSONContent = { ...node }
  if (content.length) out.content = content
  else delete out.content
  return out
}

const isEmptyPara = (n: JSONContent | undefined) => !!n && n.type === 'paragraph' && blockText(n).trim() === ''
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

function toChapter(node: JSONContent): JSONContent {
  return { ...node, type: 'heading', attrs: { ...(node.attrs ?? {}), level: 1 } }
}

export function countWords(doc: JSONContent): number {
  const parts: string[] = []
  const walk = (n: JSONContent) => {
    if (n.type === 'text') parts.push(n.text ?? '')
    else if (n.type === 'hardBreak') parts.push(' ')
    else {
      n.content?.forEach(walk)
      parts.push(' ')
    }
  }
  walk(doc)
  const text = parts.join('')
  // Tokens with at least one letter or digit, so stray dashes and asterisks aren't words.
  return text.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

export function shapeManuscript(doc: JSONContent, opts: { titleText?: string } = {}): ShapeResult {
  const blocks = (doc.content ?? []).map(trimTrailing)
  let promotedChapters = 0
  let sceneBreaks = 0

  // 1. Classify top-level blocks.
  const bare: number[] = []
  const shaped: JSONContent[] = blocks.map((b, i) => {
    if (b.type === 'paragraph') {
      const text = blockText(b)
      const t = text.trim()
      if (!t) return { type: 'paragraph' }
      if (text.includes('\n')) return b
      if (isSceneBreak(t)) {
        sceneBreaks++
        return { type: 'horizontalRule' }
      }
      if (isChapterHeading(t)) {
        promotedChapters++
        return toChapter(b)
      }
      if (isBareChapterNumber(t)) bare.push(i)
      return b
    }
    if (b.type === 'heading') {
      const t = blockText(b).trim()
      if (!t) return { type: 'paragraph' }
      const level = Number(b.attrs?.level ?? 1)
      if (level > 1 && isChapterHeading(t)) return toChapter(b)
      return b
    }
    return b
  })

  // 2. "I", "II", "III" (or "1", "2") alone on lines: chapters only when there are several.
  if (bare.length >= 2) {
    for (const i of bare) {
      shaped[i] = toChapter(shaped[i])
      promotedChapters++
    }
  }

  // 3. Collapse empty paragraphs and doubled breaks.
  const out: JSONContent[] = []
  for (const b of shaped) {
    const prev = out[out.length - 1]
    if (isEmptyPara(b)) {
      if (!prev || isEmptyPara(prev) || prev.type === 'heading' || prev.type === 'horizontalRule') continue
      out.push({ type: 'paragraph' })
      continue
    }
    if (b.type === 'heading' || b.type === 'horizontalRule') {
      while (isEmptyPara(out[out.length - 1])) out.pop()
      if (b.type === 'horizontalRule' && out[out.length - 1]?.type === 'horizontalRule') continue
    }
    out.push(b)
  }
  while (isEmptyPara(out[out.length - 1])) out.pop()
  if (out.length === 0) out.push({ type: 'paragraph' })

  const result: JSONContent = { ...doc, type: 'doc', content: out }
  const h1s = out.filter((b) => b.type === 'heading' && Number(b.attrs?.level) === 1)
  let chapterCount = h1s.length
  const firstBlock = out[0]
  if (
    opts.titleText &&
    firstBlock?.type === 'heading' &&
    Number(firstBlock.attrs?.level) === 1 &&
    norm(blockText(firstBlock)) === norm(opts.titleText)
  ) {
    chapterCount--
  }
  return { doc: result, wordCount: countWords(result), chapterCount, promotedChapters, sceneBreaks }
}
