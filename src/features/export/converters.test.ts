import { describe, expect, it } from 'vitest'
import { parseEnvelope } from '../storage/schema'
import { toBackupJson } from './backup'
import { br, h, hr, li, makeBigDoc, makeExportDoc, ol, p, pa, quote, t, ul } from './testFixtures'
import { safeFontFamily, toHtml } from './toHtml'
import { escapeMarkdown, toMarkdown } from './toMarkdown'
import { toPlainText } from './toPlainText'

const novel = makeExportDoc([
  h(1, 'Chapter One'),
  p(t('It was a '), t('dark', 'bold'), t(' and '), t('stormy', 'italic'), t(' night.')),
  p(t('She ran.'), br(), t('He waited.')),
  hr(),
  h(2, 'Later'),
  p(t('under', 'underline'), t(' '), t('gone', 'strike'), t(' '), t('glow', 'highlight')),
  quote(p(t('A quoted line.'))),
  ul(li(p(t('apples'))), li(p(t('pears')), ul(li(p(t('green')))))),
  ol([li(p(t('first'))), li(p(t('second')))], 3),
  h(1, 'Chapter Two'),
  pa('center', t('The End')),
])

describe('toMarkdown', () => {
  it('maps chapters, sections, marks, breaks, quotes and lists', () => {
    const md = toMarkdown(novel)
    expect(md).toBe(
      [
        '# Chapter One',
        'It was a **dark** and *stormy* night.',
        'She ran.\\\nHe waited.',
        '* * *',
        '## Later',
        '<u>under</u> ~~gone~~ ==glow==',
        '> A quoted line.',
        '- apples\n- pears\n  - green',
        '3. first\n4. second',
        '# Chapter Two',
        'The End',
      ].join('\n\n') + '\n',
    )
  })

  it('escapes Markdown syntax in the writer’s text', () => {
    const md = toMarkdown(
      makeExportDoc([
        p(t('2 * 3 = 6 and snake_case <b>bold</b> & [link](x) ~tilde~ a|b `code` \\ &amp; ==no==')),
        p(t('# not a heading')),
        p(t('- not a list')),
        p(t('1. not numbered')),
        p(t('> not a quote')),
        p(t('---')),
        p(t('    not code')),
        h(1, 'Chapter #1'),
      ]),
    )
    const lines = md.trim().split('\n\n')
    expect(lines[0]).toBe(
      '2 \\* 3 = 6 and snake\\_case \\<b>bold\\</b> & \\[link\\](x) \\~tilde\\~ a\\|b \\`code\\` \\\\ \\&amp; \\=\\=no\\=\\=',
    )
    expect(lines[1]).toBe('\\# not a heading')
    expect(lines[2]).toBe('\\- not a list')
    expect(lines[3]).toBe('1\\. not numbered')
    expect(lines[4]).toBe('\\> not a quote')
    expect(lines[5]).toBe('\\---')
    expect(lines[6]).toBe('not code')
    expect(lines[7]).toBe('# Chapter \\#1')
  })

  it('keeps whitespace outside emphasis and merges adjacent marked runs', () => {
    const md = toMarkdown(makeExportDoc([p(t('bold '), t('both', 'bold'), t(' and', 'bold', 'italic'), t(' plain'))]))
    expect(md).toBe('bold **both *and*** plain\n')
    expect(toMarkdown(makeExportDoc([p(t('wo'), t('rd ', 'italic'), t('next'))]))).toBe('wo*rd* next\n')
  })

  it('handles empty and missing content', () => {
    expect(toMarkdown(makeExportDoc([]))).toBe('')
    expect(toMarkdown({ content: null })).toBe('')
    expect(toMarkdown({ content: 'garbage' })).toBe('')
    expect(toMarkdown(makeExportDoc([p(), h(1, '')]))).toBe('')
  })

  it('escapeMarkdown leaves ordinary prose alone', () => {
    expect(escapeMarkdown('“Hello,” she said — and left.')).toBe('“Hello,” she said — and left.')
  })
})

describe('toPlainText', () => {
  it('writes chapters with blank lines around, scene breaks as * * *', () => {
    const txt = toPlainText(novel)
    expect(txt.startsWith('Chapter One\n\nIt was a dark and stormy night.\n\nShe ran.\nHe waited.\n\n* * *\n\nLater\n\n')).toBe(true)
    expect(txt).toContain('under gone glow')
    expect(txt).toContain('    A quoted line.')
    expect(txt).toContain('• apples\n• pears\n  • green')
    expect(txt).toContain('3. first\n4. second')
    expect(txt).toContain('4. second\n\n\nChapter Two\n\nThe End\n')
  })

  it('never alters the writer’s characters', () => {
    const raw = '<b>&amp; *not* _markdown_ # 1. — “quotes”'
    expect(toPlainText(makeExportDoc([p(t(raw))]))).toBe(`${raw}\n`)
  })

  it('handles an empty doc', () => {
    expect(toPlainText(makeExportDoc([]))).toBe('')
  })
})

describe('toHtml', () => {
  it('is a standalone document with print CSS at the trim size', () => {
    const html = toHtml(novel)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<title>My Novel</title>')
    expect(html).toContain('size: 6in 9in;')
    expect(html).toContain('margin: 0.75in 0.65in 0.8in 0.85in;')
    expect(html).toContain('font-size: 11.5pt;')
    expect(html).toContain('line-height: 1.4;')
    expect(html).toContain('counter(page)')
    expect(html).toMatch(/h1 \{ break-before: page; page-break-before: always; \}/)
    expect(html).toContain('.tw-book > h1:first-child { break-before: auto;')
  })

  it('marks up structure and marks', () => {
    const html = toHtml(novel)
    expect(html).toContain('<h1>Chapter One</h1>')
    expect(html).toContain('<p class="first">It was a <strong>dark</strong> and <em>stormy</em> night.</p>')
    expect(html).toContain('<p>She ran.<br>He waited.</p>')
    expect(html).toContain('<hr class="scene-break">')
    expect(html).toContain('<h2>Later</h2>')
    expect(html).toContain('<u>under</u> <s>gone</s> <mark>glow</mark>')
    expect(html).toContain('<blockquote>\n<p class="first">A quoted line.</p>\n</blockquote>')
    expect(html).toContain('<ol start="3">')
    expect(html).toContain('<p class="first" style="text-align: center">The End</p>')
  })

  it('escapes text and title', () => {
    const html = toHtml(
      makeExportDoc([p(t('<script>alert("x")</script> & \'q\''))], { title: '</title><script>bad()</script>' }),
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62; &#38; &#39;q&#39;')
    expect(html).toContain('<title>&#60;/title&#62;&#60;script&#62;bad()&#60;/script&#62;</title>')
  })

  it('cannot break out of the style element through a custom font', () => {
    expect(safeFontFamily("Georgia; } </style><script>x()</script>")).toBe('Georgia  stylescriptxscript')
    const html = toHtml(makeExportDoc([p(t('a'))], { format: { presetId: 'trade-6x9', chapterStartsNewPage: true, fontFamily: '</style><b>' } }))
    expect(html.match(/<\/style>/g)).toHaveLength(1)
  })

  it('omits chapter page breaks when the format does not start chapters on a new page', () => {
    const html = toHtml(makeExportDoc([h(1, 'A')], { format: { presetId: 'manuscript-letter', chapterStartsNewPage: false } }))
    expect(html).not.toContain('page-break-before: always')
    expect(html).toContain('size: 8.5in 11in;')
  })

  it('renders an empty doc', () => {
    const html = toHtml(makeExportDoc([], { title: '' }))
    expect(html).toContain('<title>Untitled Manuscript</title>')
    expect(html).toContain('<article class="tw-book">\n\n</article>')
  })
})

describe('backup', () => {
  it('uses the storage envelope and strips the Drive link', () => {
    const doc = makeExportDoc([p(t('x'))], { driveFileId: 'F', driveSyncedAt: 5, driveRevisionId: 'r' })
    const json = toBackupJson(doc, 123)
    const parsed = parseEnvelope(JSON.parse(json))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.doc.content).toEqual(doc.content)
      expect(parsed.doc.driveFileId).toBeUndefined()
    }
    expect(JSON.parse(json).savedAt).toBe(123)
  })
})

describe('performance', () => {
  it('converts a 120,000-word, 40-chapter novel to text formats quickly', () => {
    const doc = makeBigDoc()
    const t0 = performance.now()
    const md = toMarkdown(doc)
    const txt = toPlainText(doc)
    const html = toHtml(doc)
    const ms = performance.now() - t0
    expect(md.split(/\s+/).length).toBeGreaterThan(120_000)
    expect(txt.match(/^Chapter \d+$/gm)).toHaveLength(40)
    expect(html.match(/<h1>/g)).toHaveLength(40)
    // Typically ~100 ms; generous bound for slow CI machines.
    expect(ms).toBeLessThan(3000)
  })
})
