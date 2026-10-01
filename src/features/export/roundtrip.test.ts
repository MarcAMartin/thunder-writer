// Round trips: a manuscript saved to the computer (Word, Markdown, plain text)
// and imported again (src/features/import) must come back with the same words,
// chapters, scene breaks and, where the format carries them, the same marks.
import { describe, expect, it } from 'vitest'
import { importManuscript } from '../import/importManuscript'
import type { ImportFormat } from '../import/types'
import { DOCX_MIME } from './formats'
import { br, h, hr, li, makeExportDoc, ol, p, quote, t, ul } from './testFixtures'
import { toDocx } from './toDocx'
import { toMarkdown } from './toMarkdown'
import { toPlainText } from './toPlainText'

const TITLE = 'The Lighthouse Keeper'

const LONG = Array.from(
  { length: 400 },
  (_, i) => `Sentence ${i + 1} of the long paragraph rolls on — “quoted,” it’s said — past rocks & reefs where 3 < 4.`,
).join(' ')

/** A representative manuscript: 3 chapters, sections, every mark, lists, a quote, scene breaks and awkward characters. */
function manuscript() {
  return makeExportDoc(
    [
      h(1, 'Chapter One: The Storm'),
      p(t('“It’s coming,” she said — and it was. The wind didn’t wait.')),
      p(
        t('She felt '),
        t('bold', 'bold'),
        t(', then '),
        t('italic', 'italic'),
        t(', then '),
        t('underlined', 'underline'),
        t(' and '),
        t('struck', 'strike'),
        t(' and '),
        t('both at once', 'bold', 'italic'),
        t(', a '),
        t('highlighted', 'highlight'),
        t(' word and an '),
        t('underlined bold', 'bold', 'underline'),
        t(' pair.'),
      ),
      h(2, 'Night'),
      p(t('Fish & chips cost < £5, and 3 > 2 — obviously. AT&T <b>isn’t</b> a tag.')),
      hr(),
      p(t(LONG)),
      quote(p(t('“Keep the light burning,” the old keeper wrote.'))),
      h(1, 'Chapter Two'),
      p(t('She packed:')),
      ul(li(p(t('a lantern'))), li(p(t('two ropes'))), li(p(t('bread & salt')))),
      p(t('Then, in order:')),
      ol([li(p(t('Climb the stairs.'))), li(p(t('Light the lamp.')))]),
      hr(),
      p(t('A line'), br(), t('broken by hand.')),
      h(1, 'Chapter Three: Home'),
      h(2, 'Morning'),
      p(t('The sea was calm… at last.')),
      hr(),
      p(t('The end.')),
    ],
    { title: TITLE },
  )
}

/* ------------------------------ comparison helpers ------------------------------ */

type J = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: J[]; marks?: { type: string }[] }

function walk(n: J, fn: (n: J) => void) {
  fn(n)
  for (const c of n.content ?? []) walk(c, fn)
}

const textIn = (n: J): string =>
  n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(textIn).join('')

/**
 * Every word, block by block (scene breaks excluded). `listMarkers` spells out
 * the bullets/numbers a plain-text file writes as characters.
 */
function words(content: unknown, opts: { listMarkers?: boolean } = {}): string {
  const out: string[] = []
  const visit = (n: J, marker = '') => {
    if (n.type === 'horizontalRule') return
    if (n.type === 'paragraph' || n.type === 'heading') {
      out.push(marker + textIn(n))
      return
    }
    if (opts.listMarkers && (n.type === 'bulletList' || n.type === 'orderedList')) {
      const start = Number(n.attrs?.start ?? 1)
      ;(n.content ?? []).forEach((item, i) => {
        const m = n.type === 'bulletList' ? '• ' : `${start + i}. `
        ;(item.content ?? []).forEach((c, j) => visit(c, j === 0 ? m : ''))
      })
      return
    }
    for (const c of n.content ?? []) visit(c)
  }
  visit(content as J)
  // Only whitespace is normalised: line breaks vs spaces, runs of blanks.
  return out.join('\n').replace(/\s+/g, ' ').trim()
}

const count = (content: unknown, type: string) => {
  let n = 0
  walk(content as J, (x) => void (x.type === type && n++))
  return n
}

const chapterTitles = (content: unknown) =>
  ((content as J).content ?? []).filter((b) => b.type === 'heading' && Number(b.attrs?.level) === 1).map((b) => textIn(b).trim())

const sectionTitles = (content: unknown) =>
  ((content as J).content ?? []).filter((b) => b.type === 'heading' && Number(b.attrs?.level) === 2).map((b) => textIn(b).trim())

/** "text|mark+mark" for every marked run (adjacent runs with the same marks merged). */
function markedRuns(content: unknown): string[] {
  const runs: string[] = []
  walk(content as J, (n) => {
    if (!n.content?.some((c) => c.type === 'text')) return
    let cur: { text: string; key: string } | null = null
    for (const c of n.content) {
      const key = c.type === 'text' ? (c.marks ?? []).map((m) => m.type).filter((m) => m !== 'textStyle').sort().join('+') : ''
      if (cur && cur.key === key) cur.text += c.text ?? ''
      else {
        if (cur?.key) runs.push(`${cur.text}|${cur.key}`)
        cur = { text: c.text ?? '', key }
      }
    }
    if (cur?.key) runs.push(`${cur.text}|${cur.key}`)
  })
  return runs
}

const listShape = (content: unknown) => ({
  bullet: count(content, 'bulletList'),
  ordered: count(content, 'orderedList'),
  items: count(content, 'listItem'),
  quotes: count(content, 'blockquote'),
})

async function reimport(name: string, data: ArrayBuffer | string, mimeType?: string, format?: ImportFormat) {
  return importManuscript({ name, data, mimeType, format })
}

/* ----------------------------------- tests ----------------------------------- */

describe('round trip: Export to computer → Import', () => {
  const doc = manuscript()
  const original = doc.content

  it('Word (.docx) keeps words, chapters, sections, scene breaks, marks, lists and the quote', async () => {
    const blob = await toDocx(doc)
    const r = await reimport(`${TITLE}.docx`, await blob.arrayBuffer(), DOCX_MIME)
    expect(r.title).toBe(TITLE)
    expect(words(r.content)).toBe(words(original))
    expect(r.chapterCount).toBe(3)
    expect(chapterTitles(r.content)).toEqual(chapterTitles(original))
    expect(sectionTitles(r.content)).toEqual(['Night', 'Morning'])
    expect(count(r.content, 'horizontalRule')).toBe(3)
    expect(markedRuns(r.content)).toEqual(markedRuns(original))
    expect(listShape(r.content)).toEqual(listShape(original))
    expect(count(r.content, 'hardBreak')).toBe(1)
  })

  it('Markdown (.md) keeps words, chapters, sections, scene breaks, marks, lists and the quote', async () => {
    const md = toMarkdown(doc)
    const r = await reimport(`${TITLE}.md`, md)
    expect(r.title).toBe(TITLE)
    expect(words(r.content)).toBe(words(original))
    expect(r.chapterCount).toBe(3)
    expect(chapterTitles(r.content)).toEqual(chapterTitles(original))
    expect(sectionTitles(r.content)).toEqual(['Night', 'Morning'])
    expect(count(r.content, 'horizontalRule')).toBe(3)
    expect(markedRuns(r.content)).toEqual(markedRuns(original))
    expect(listShape(r.content)).toEqual(listShape(original))
    expect(count(r.content, 'hardBreak')).toBe(1)
  })

  it('plain text (.txt) keeps words (list markers as typed), chapters and scene breaks', async () => {
    const txt = toPlainText(doc)
    const r = await reimport(`${TITLE}.txt`, txt)
    expect(r.title).toBe(TITLE)
    expect(words(r.content)).toBe(words(original, { listMarkers: true }))
    expect(r.chapterCount).toBe(3)
    expect(chapterTitles(r.content)).toEqual(chapterTitles(original))
    expect(count(r.content, 'horizontalRule')).toBe(3)
  })

  it('keeps every character of the writer’s text in all three formats (no entity or escape leaks)', async () => {
    const docx = await reimport('x.docx', await (await toDocx(doc)).arrayBuffer(), DOCX_MIME)
    const md = await reimport('x.md', toMarkdown(doc))
    const txt = await reimport('x.txt', toPlainText(doc))
    for (const r of [docx, md, txt]) {
      const all = words(r.content)
      expect(all).toContain('Fish & chips cost < £5, and 3 > 2 — obviously. AT&T <b>isn’t</b> a tag.')
      expect(all).toContain('“It’s coming,” she said — and it was.')
      expect(all).not.toMatch(/&(amp|lt|gt|quot|#\d+);|\\[&<*_#>-]/)
      expect(all).toContain(LONG)
    }
  })

  it('Word with running heads, footer line and page numbers imports cleanly: none of it leaks into the text', async () => {
    const withHeads = {
      ...doc,
      format: {
        ...doc.format,
        headerFooter: {
          authorName: 'Zelda Quillfeather',
          versoHead: 'author' as const,
          rectoHead: 'chapter' as const,
          shortHeads: { 'Chapter One: The Storm': 'Stormhead' },
          footer: 'custom' as const,
          footerCustom: 'Advance Reader Copy XYZZY',
          pageNumbers: 'header-outside' as const,
          firstPageNumber: 3,
        },
        bookLayout: { chaptersStartRecto: true },
      },
    }
    const blob = await toDocx(withHeads)
    const r = await reimport(`${TITLE}.docx`, await blob.arrayBuffer(), DOCX_MIME)
    const all = words(r.content)
    expect(all).toBe(words(original))
    for (const leak of ['Zelda', 'Quillfeather', 'Stormhead', 'XYZZY', 'Advance Reader']) expect(all).not.toContain(leak)
    // Section breaks don't turn into empty paragraphs or scene breaks.
    expect(count(r.content, 'paragraph')).toBe(count(original, 'paragraph'))
    expect(count(r.content, 'horizontalRule')).toBe(3)
    expect(r.chapterCount).toBe(3)
    expect(chapterTitles(r.content)).toEqual(chapterTitles(original))
    expect(markedRuns(r.content)).toEqual(markedRuns(original))
    expect(listShape(r.content)).toEqual(listShape(original))
  })

  it('round-trips a whole novel through Word quickly', async () => {
    const { makeBigDoc } = await import('./testFixtures')
    const big = makeBigDoc()
    const started = performance.now()
    const r = await reimport('big.docx', await (await toDocx(big)).arrayBuffer(), DOCX_MIME)
    expect(performance.now() - started).toBeLessThan(15_000)
    expect(r.chapterCount).toBe(40)
    expect(words(r.content)).toBe(words(big.content))
    expect(count(r.content, 'horizontalRule')).toBe(count(big.content, 'horizontalRule'))
  })
})
