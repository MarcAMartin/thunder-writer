import { describe, expect, it } from 'vitest'
import { parseEnvelope } from '../storage/schema'
import { toBackupJson } from './backup'
import { br, h, hr, li, makeBigDoc, makeExportDoc, ol, p, pa, quote, t, ul } from './testFixtures'
import { cssString, safeFontFamily, toHtml } from './toHtml'
import type { PMNode } from './pm'
import type { DocFormat, HeaderFooterSettings } from '../../types'
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

const withHf = (headerFooter: Partial<HeaderFooterSettings>, bookLayout: DocFormat['bookLayout'] = {}) =>
  makeExportDoc(novel.content ? (novel.content as { content: PMNode[] }).content : [], {
    format: { presetId: 'trade-6x9', chapterStartsNewPage: true, headerFooter, bookLayout },
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
    expect(html).toContain('.tw-book > h1:first-child, .tw-book > section:first-child > h1:first-child { break-before: auto;')
  })

  it('mirrors the margins on left and right pages, with the gutter at the spine', () => {
    const css = toHtml(novel)
    // Trade 6x9: inside (left) 0.85in, outside (right) 0.65in.
    expect(css).toMatch(/@page :left \{\n  margin-left: 0\.65in;\n  margin-right: 0\.85in;/)
    expect(css).toMatch(/@page :right \{\n  margin-left: 0\.85in;\n  margin-right: 0\.65in;/)
  })

  it('prints the default running heads (author or title / title) and a centred page number in margin boxes', () => {
    const css = toHtml(novel)
    const rule = (sel: string) => new RegExp(`@page ${sel} \\{[^]*?\\n\\}`).exec(css)?.[0] ?? ''
    expect(rule(':left')).toContain('@top-center { content: "My Novel"; }')
    expect(rule(':left')).toContain('@bottom-center { content: counter(page); }')
    expect(rule(':right')).toContain('@top-center { content: "My Novel"; }')
    // The book's first page and blank pages carry no running head.
    expect(rule(':first')).toContain('@top-center { content: none; }')
    expect(rule(':first')).toContain('@bottom-center { content: counter(page); }')
    expect(rule(':blank')).toContain('@bottom-center { content: none; }')
    expect(css).toContain('font-variant: small-caps')
    const authored = toHtml(withHf({ authorName: 'Ada Lovelace' }))
    expect(authored).toMatch(/@page :left \{[^]*?@top-center \{ content: "Ada Lovelace"; \}/)
  })

  it('starts chapters on right-hand pages on named pages, one per chapter, with chapter running heads', () => {
    const doc = withHf({ versoHead: 'title', rectoHead: 'chapter', shortHeads: { 'Chapter One': 'One' } })
    const css = toHtml(doc)
    expect(css).toContain('h1, .tw-chapter { break-before: right; page-break-before: right; }')
    expect(css).toContain('<section class="tw-chapter" style="page: tw-ch1">\n<h1>Chapter One</h1>')
    expect(css).toContain('<section class="tw-chapter" style="page: tw-ch2">\n<h1>Chapter Two</h1>')
    expect(css).toMatch(/@page tw-ch1:right \{\n[^]*?@top-center \{ content: "One"; \}/)
    expect(css).toMatch(/@page tw-ch2:right \{\n[^]*?@top-center \{ content: "Chapter Two"; \}/)
    expect(css).toMatch(/@page tw-ch2:left \{\n[^]*?@top-center \{ content: "My Novel"; \}/)
    // The chapter's opening page: no running head.
    expect(css).toMatch(/@page tw-ch2:first \{\n  @top-left \{ content: none; \}\n  @top-center \{ content: none; \}/)
    expect(css).toMatch(/@page tw-ch2:blank \{/)
    const plainBreaks = toHtml(withHf({}, { chaptersStartRecto: false }))
    expect(plainBreaks).not.toContain('break-before: right')
    expect(plainBreaks).toContain('h1 { break-before: page;')
  })

  it('places page numbers in the outside corners, top or bottom, and drops a top number on opening pages', () => {
    const foot = toHtml(withHf({ pageNumbers: 'footer-outside' }))
    expect(foot).toMatch(/@page :left \{[^}]*?[^]*?@bottom-left \{ content: counter\(page\); \}/)
    expect(foot).toMatch(/@page :right \{[^]*?@bottom-right \{ content: counter\(page\); \}/)
    const top = toHtml(withHf({ pageNumbers: 'header-outside' }))
    expect(top).toMatch(/@page :left \{[^]*?@top-left \{ content: counter\(page\); \}[^]*?@bottom-center \{ content: none; \}/)
    expect(top).toMatch(/@page :right \{[^]*?@top-right \{ content: counter\(page\); \}/)
    expect(top).toMatch(/@page :first \{\n  @top-left \{ content: none; \}\n  @top-center \{ content: none; \}\n  @top-right \{ content: none; \}[^]*?@bottom-center \{ content: counter\(page\); \}/)
    const none = toHtml(withHf({ pageNumbers: 'none' }))
    expect(none).not.toContain('counter(page)')
  })

  it('numbers from the chosen first page and puts the footer line below a centred number', () => {
    const css = toHtml(withHf({ firstPageNumber: 5, footer: 'custom', footerCustom: 'Advance reader copy' }))
    expect(css).toContain('html { counter-reset: page 4; }')
    expect(css).toContain('@bottom-center { content: counter(page) "\\A " "Advance reader copy"; }')
    expect(css).toContain('white-space: pre;')
    expect(toHtml(novel)).not.toContain('counter-reset: page')
  })

  it('gives each physical side its folio side when the first page number is even', () => {
    // Physical page 1 is always :right in CSS, but folio 2 (or 4) is a left-hand page.
    for (const firstPageNumber of [2, 4]) {
      const css = toHtml(withHf({ firstPageNumber, versoHead: 'author', rectoHead: 'chapter', authorName: 'AUTH', pageNumbers: 'header-outside' }))
      const rule = (sel: string) => new RegExp(`@page ${sel} \\{[^]*?\\n\\}`).exec(css)?.[0] ?? ''
      // :right (folios N, N+2, ...) is a verso: outside margin at the left, author head, number top left.
      expect(rule(':right')).toMatch(/^@page :right \{\n  margin-left: 0\.65in;\n  margin-right: 0\.85in;/)
      expect(rule(':right')).toContain('@top-center { content: "AUTH"; }')
      expect(rule(':right')).toContain('@top-left { content: counter(page); }')
      // :left (folios N+1, ...) is a recto: gutter at the left, chapter head, number top right.
      expect(rule(':left')).toMatch(/^@page :left \{\n  margin-left: 0\.85in;\n  margin-right: 0\.65in;/)
      expect(rule(':left')).toContain('@top-right { content: counter(page); }')
      expect(rule(':left')).not.toContain('"AUTH"')
      expect(rule('tw-ch2:left')).toContain('@top-center { content: "Chapter Two"; }')
      expect(rule('tw-ch2:right')).toContain('@top-center { content: "AUTH"; }')
      // Right-hand chapter starts land on physical left pages.
      expect(css).toContain('h1, .tw-chapter { break-before: left; page-break-before: left; }')
      expect(css).toContain(`html { counter-reset: page ${firstPageNumber - 1}; }`)
    }
    const odd = toHtml(withHf({ firstPageNumber: 3, versoHead: 'author', authorName: 'AUTH' }))
    expect(odd).toMatch(/@page :left \{\n  margin-left: 0\.65in;[^]*?"AUTH"/)
    expect(odd).toContain('break-before: right;')
  })

  it('escapes running-head text so it cannot end the string, the rule or the style element', () => {
    expect(cssString('a"b\\c\nd</style>')).toBe('"a\\"b\\\\c\\A d\\3c /style>"')
    const html = toHtml(withHf({ versoHead: 'custom', versoCustom: '"; } </style><script>x()</script>' }))
    expect(html.match(/<\/style>/g)).toHaveLength(1)
    expect(html).not.toContain('<script>')
    expect(html).toContain('@top-center { content: "\\"; } \\3c /style>\\3c script>x()\\3c /script>"; }')
  })

  it('keeps one flow (no named pages) when chapters do not start new pages', () => {
    const html = toHtml(makeExportDoc([h(1, 'A'), p(t('x'))], { format: { presetId: 'trade-6x9', chapterStartsNewPage: false, headerFooter: { rectoHead: 'chapter' } } }))
    expect(html).not.toContain('<section')
    expect(html).not.toContain('tw-ch1')
    expect(html).toMatch(/@page :right \{[^]*?@top-center \{ content: "My Novel"; \}/)
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
