import type { JSONContent } from '@tiptap/core'
import { isSceneBreak } from './chapters'
import { blockLineMode, normalizeNewlines } from './text'

/**
 * A small Markdown reader covering what manuscripts use: ATX and setext
 * headings, paragraphs, *emphasis*, **strong**, ~~strike~~, blockquotes,
 * bullet and numbered lists (nested by indentation), and thematic breaks /
 * scene breaks. Code is kept as plain text, links keep their text, images are
 * dropped (counted). It builds TipTap JSON directly, so no HTML is involved.
 */

export interface MarkdownResult {
  doc: JSONContent
  /** From YAML front matter (`title: …`), if present. */
  title?: string
  images: number
}

type MarkName = 'bold' | 'italic' | 'strike'
interface Ctx {
  images: number
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const QUOTE = /^ {0,3}>[ ]?/
const FENCE = /^ {0,3}(`{3,})/
const BULLET = /^( *)([-*+])[ \t]+(.*)$/
const ORDERED = /^( *)(\d{1,9})([.)])[ \t]+(.*)$/
const SETEXT_1 = /^ {0,3}=+[ \t]*$/
const SETEXT_2 = /^ {0,3}-+[ \t]*$/
/** Sentinel for a hard line break while inline text is parsed. */
const HARD_BREAK = '\u0000'

interface ListMatch {
  indent: number
  ordered: boolean
  start: number
  text: string
  /** Column where the item's content starts. */
  contentIndent: number
}

function matchListItem(line: string): ListMatch | null {
  if (isSceneBreak(line)) return null
  const b = BULLET.exec(line)
  if (b) return { indent: b[1].length, ordered: false, start: 1, text: b[3], contentIndent: line.length - b[3].length }
  const o = ORDERED.exec(line)
  if (o) return { indent: o[1].length, ordered: true, start: Number(o[2]), text: o[4], contentIndent: line.length - o[4].length }
  return null
}

const startsBlock = (line: string) =>
  ATX.test(line) || QUOTE.test(line) || FENCE.test(line) || isSceneBreak(line) || BULLET.test(line)

const looksLikeTitle = (t: string) => t.length <= 80 && !/[.,;:!?"”’)]$/.test(t)

const indentOf = (l: string) => l.length - l.trimStart().length

/** Strips up to `n` leading spaces. */
const dedent = (l: string, n: number) => l.slice(Math.min(n, indentOf(l)))

function parseBlocks(lines: string[], ctx: Ctx): JSONContent[] {
  const out: JSONContent[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const t = line.trim()
    if (!t) {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) {
        if (lines[i].trim()) out.push(textParagraph(lines[i].trim()))
        i++
      }
      i++
      continue
    }

    if (isSceneBreak(t)) {
      out.push({ type: 'horizontalRule' })
      i++
      continue
    }

    const atx = ATX.exec(line)
    if (atx) {
      const text = (atx[2] ?? '').trim()
      if (text) out.push({ type: 'heading', attrs: { level: Math.min(atx[1].length, 3) }, content: parseInline(text, ctx) })
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const inner: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(lines[i++].replace(QUOTE, ''))
      const content = parseBlocks(inner, ctx)
      if (content.length) out.push({ type: 'blockquote', content })
      continue
    }

    const item = matchListItem(line)
    if (item) {
      i = parseList(lines, i, item, out, ctx)
      continue
    }

    // Paragraph (or a setext heading).
    const para: string[] = [line]
    i++
    // A setext underline ("===" / "---") only makes a heading of a short, title-like line;
    // under a sentence it is a manuscript scene break.
    if (i < lines.length && (SETEXT_1.test(lines[i]) || SETEXT_2.test(lines[i])) && looksLikeTitle(t)) {
      out.push({ type: 'heading', attrs: { level: SETEXT_1.test(lines[i]) ? 1 : 2 }, content: parseInline(t, ctx) })
      i++
      continue
    }
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i++])
    out.push(...paragraphs(para, ctx))
  }
  return out
}

function parseList(lines: string[], i: number, first: ListMatch, out: JSONContent[], ctx: Ctx): number {
  const items: JSONContent[] = []
  let current: ListMatch | null = first
  while (current) {
    const itemLines = [current.text]
    const inner = current.contentIndent
    i++
    let next: ListMatch | null = null
    while (i < lines.length) {
      const l = lines[i]
      if (!l.trim()) {
        // A blank line continues the item only if indented content follows.
        let j = i + 1
        while (j < lines.length && !lines[j].trim()) j++
        if (j < lines.length && indentOf(lines[j]) >= inner) {
          itemLines.push('')
          i++
          continue
        }
        break
      }
      const m = matchListItem(l)
      if (m && m.indent < inner) {
        if (m.indent <= first.indent + 1 && m.ordered === first.ordered) next = m
        break
      }
      if (indentOf(l) >= inner || m) itemLines.push(dedent(l, inner))
      else if (!startsBlock(l)) itemLines.push(l.trim())
      else break
      i++
    }
    const content = parseBlocks(itemLines, ctx)
    if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph' })
    items.push({ type: 'listItem', content })
    current = next
  }
  out.push(
    first.ordered
      ? { type: 'orderedList', attrs: { start: first.start }, content: items }
      : { type: 'bulletList', content: items },
  )
  return i
}

const textParagraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })

/** Lines of one paragraph: soft breaks become spaces unless each line is clearly its own paragraph. */
function paragraphs(lines: string[], ctx: Ctx): JSONContent[] {
  const trimmed = lines.map((l) => l.replace(/^[ \t]+/, ''))
  if (blockLineMode(trimmed.map((l) => l.trimEnd())) === 'separate') {
    return trimmed.map((l) => ({ type: 'paragraph', content: parseInline(l.trimEnd(), ctx) }))
  }
  let text = ''
  trimmed.forEach((l, idx) => {
    const last = idx === trimmed.length - 1
    const hard = !last && (/ {2,}$/.test(l) || /\\$/.test(l))
    const body = hard && /\\$/.test(l) ? l.slice(0, -1) : l.trimEnd()
    text += body + (last ? '' : hard ? HARD_BREAK : ' ')
  })
  return [{ type: 'paragraph', content: parseInline(text, ctx) }]
}

/* ------------------------------------------------------------------------- */
/* Inline                                                                     */
/* ------------------------------------------------------------------------- */

type Rule = { re: RegExp; kind: 'escape' | 'code' | 'image' | 'link' | 'autolink' | 'mark'; marks?: MarkName[] }

const inner = (d: string) => `(?:\\\\[\\s\\S]|[^${d}\\\\])`
const RULES: Rule[] = [
  { kind: 'escape', re: /\\([!-/:-@[-`{-~])/g },
  { kind: 'code', re: /(`+)([\s\S]*?[^`])\1(?!`)/g },
  { kind: 'image', re: /!\[([^\]]*)\]\((?:[^()\s]|\([^()]*\))*(?:\s+"[^"]*")?\)/g },
  { kind: 'link', re: /\[([^\]]+)\]\((?:[^()\s]|\([^()]*\))*(?:\s+"[^"]*")?\)/g },
  { kind: 'autolink', re: /<((?:https?|mailto):[^<>\s]+)>/g },
  { kind: 'mark', marks: ['bold', 'italic'], re: new RegExp(`\\*\\*\\*(?![\\s*])(${inner('*')}+?)(?<!\\s)\\*\\*\\*`, 'g') },
  {
    kind: 'mark',
    marks: ['bold', 'italic'],
    re: new RegExp(`(?<![\\p{L}\\p{N}_])___(?![\\s_])(${inner('_')}+?)(?<!\\s)___(?![\\p{L}\\p{N}_])`, 'gu'),
  },
  {
    kind: 'mark',
    marks: ['bold'],
    re: new RegExp(`\\*\\*(?![\\s*])((?:\\\\[\\s\\S]|\\*(?!\\*)|[^*\\\\])+?)(?<!\\s)\\*\\*`, 'g'),
  },
  {
    kind: 'mark',
    marks: ['bold'],
    re: new RegExp(`(?<![\\p{L}\\p{N}_])__(?![\\s_])((?:\\\\[\\s\\S]|_(?!_)|[^_\\\\])+?)(?<!\\s)__(?![\\p{L}\\p{N}_])`, 'gu'),
  },
  {
    kind: 'mark',
    marks: ['italic'],
    re: new RegExp(`\\*(?![\\s*])((?:\\\\[\\s\\S]|\\*\\*${inner('*')}+?\\*\\*|[^*\\\\])+?)(?<!\\s)\\*(?!\\*)`, 'g'),
  },
  {
    kind: 'mark',
    marks: ['italic'],
    re: new RegExp(
      `(?<![\\p{L}\\p{N}_])_(?![\\s_])((?:\\\\[\\s\\S]|__${inner('_')}+?__|[^_\\\\])+?)(?<!\\s)_(?![\\p{L}\\p{N}_])`,
      'gu',
    ),
  },
  { kind: 'mark', marks: ['strike'], re: /~~(?![\s~])([\s\S]+?)(?<!\s)~~/g },
]

function pushText(out: JSONContent[], text: string, marks: MarkName[]) {
  if (!text) return
  const parts = text.split(HARD_BREAK)
  parts.forEach((part, i) => {
    if (i) out.push({ type: 'hardBreak' })
    if (!part) return
    const prev = out[out.length - 1]
    const markJson = marks.map((type) => ({ type }))
    const same =
      prev?.type === 'text' &&
      (prev.marks ?? []).map((m) => m.type).join() === marks.join()
    if (same) prev.text = (prev.text ?? '') + part
    else out.push(markJson.length ? { type: 'text', text: part, marks: markJson } : { type: 'text', text: part })
  })
}

export function parseInline(text: string, ctx: Ctx, marks: MarkName[] = [], out: JSONContent[] = []): JSONContent[] {
  let pos = 0
  const next: Array<RegExpExecArray | null | undefined> = RULES.map(() => undefined)
  while (pos < text.length) {
    let best = -1
    let m: RegExpExecArray | null = null
    for (let r = 0; r < RULES.length; r++) {
      let found = next[r]
      if (found === undefined || (found && found.index < pos)) {
        RULES[r].re.lastIndex = pos
        found = RULES[r].re.exec(text)
        next[r] = found
      }
      if (found && (!m || found.index < m.index)) {
        best = r
        m = found
      }
    }
    if (!m) break
    const rule = RULES[best]
    pushText(out, text.slice(pos, m.index), marks)
    switch (rule.kind) {
      case 'escape':
        pushText(out, m[1], marks)
        break
      case 'code':
        pushText(out, m[2].replace(/^ (.*) $/s, '$1'), marks)
        break
      case 'image':
        ctx.images++
        break
      case 'link':
        parseInline(m[1], ctx, marks, out)
        break
      case 'autolink':
        pushText(out, m[1], marks)
        break
      case 'mark': {
        const add = (rule.marks ?? []).filter((mk) => !marks.includes(mk))
        const order: MarkName[] = ['bold', 'italic', 'strike']
        const merged = order.filter((mk) => marks.includes(mk) || add.includes(mk))
        parseInline(m[1], ctx, merged, out)
        break
      }
    }
    pos = m.index + m[0].length
  }
  pushText(out, text.slice(pos), marks)
  return out
}

/** YAML front matter (`---` … `---`) at the very top: read its title and remove it. */
function frontMatter(lines: string[]): { title?: string; body: string[] } {
  if (lines[0]?.trim() !== '---') return { body: lines }
  for (let i = 1; i < Math.min(lines.length, 60); i++) {
    const l = lines[i].trim()
    if (l === '---' || l === '...') {
      const meta = lines.slice(1, i)
      if (!meta.some((m) => /^[A-Za-z_][\w-]*\s*:/.test(m))) return { body: lines }
      const t = meta.map((m) => /^title\s*:\s*(.*)$/i.exec(m)).find(Boolean)
      const title = t?.[1].trim().replace(/^(["'])(.*)\1$/, '$2').trim()
      return { title: title || undefined, body: lines.slice(i + 1) }
    }
    if (!l) continue
  }
  return { body: lines }
}

export function markdownToDoc(src: string): MarkdownResult {
  const ctx: Ctx = { images: 0 }
  const { title, body } = frontMatter(normalizeNewlines(src).split('\n'))
  const content = parseBlocks(
    body.map((l) => l.replace(/^\t+/, (tabs) => '    '.repeat(tabs.length))),
    ctx,
  )
  return { doc: { type: 'doc', content }, title, images: ctx.images }
}
