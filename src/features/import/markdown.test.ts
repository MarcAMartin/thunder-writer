import type { JSONContent } from '@tiptap/core'
import { checkContent } from '../editor/contentCheck'
import { markdownToDoc, parseInline } from './markdown'

const marks = (nodes: JSONContent[]) => nodes.map((n) => [n.text ?? `<${n.type}>`, (n.marks ?? []).map((m) => m.type).join('+')])

describe('markdown inline', () => {
  const ctx = () => ({ images: 0 })
  it('reads emphasis, strong, both and strike', () => {
    expect(marks(parseInline('a *em* _em2_ **strong** __strong2__ ***both*** ~~gone~~ z', ctx()))).toEqual([
      ['a ', ''],
      ['em', 'italic'],
      [' ', ''],
      ['em2', 'italic'],
      [' ', ''],
      ['strong', 'bold'],
      [' ', ''],
      ['strong2', 'bold'],
      [' ', ''],
      ['both', 'bold+italic'],
      [' ', ''],
      ['gone', 'strike'],
      [' z', ''],
    ])
  })

  it('reads <u>underline</u> (and <ins>) and ==highlight==, which Thunder Writer’s own Markdown uses', () => {
    expect(marks(parseInline('a <u>under</u> <ins>too</ins> ==lit== **<u>both</u>** z', ctx()))).toEqual([
      ['a ', ''],
      ['under', 'underline'],
      [' ', ''],
      ['too', 'underline'],
      [' ', ''],
      ['lit', 'highlight'],
      [' ', ''],
      ['both', 'bold+underline'],
      [' z', ''],
    ])
  })

  it('leaves escaped or spaced-out markers as text', () => {
    expect(marks(parseInline('\\<u>not\\</u> a == b and \\=\\=no\\=\\=', ctx()))).toEqual([['<u>not</u> a == b and ==no==', '']])
  })

  it('nests emphasis inside strong and vice versa', () => {
    expect(marks(parseInline('**bold *and italic* text**', ctx()))).toEqual([
      ['bold ', 'bold'],
      ['and italic', 'bold+italic'],
      [' text', 'bold'],
    ])
    expect(marks(parseInline('*a **b** c*', ctx()))).toEqual([
      ['a ', 'italic'],
      ['b', 'bold+italic'],
      [' c', 'italic'],
    ])
  })

  it('leaves intraword underscores, lone asterisks and escapes as text', () => {
    expect(marks(parseInline('snake_case_name and 5 * 3 * 2 and \\*not em\\*', ctx()))).toEqual([
      ['snake_case_name and 5 * 3 * 2 and *not em*', ''],
    ])
  })

  it('keeps link text, drops images, keeps code as text', () => {
    const c = ctx()
    expect(marks(parseInline('see [the map](http://x.y) ![pic](a.png) `code`', c))).toEqual([['see the map  code', '']])
    expect(c.images).toBe(1)
  })
})

describe('markdownToDoc', () => {
  it('reads headings, paragraphs, quotes, lists and breaks into valid editor content', () => {
    const { doc } = markdownToDoc(
      [
        '# Chapter One',
        '',
        'It was *late*.',
        'Still late.',
        '',
        '## A section',
        '#### Deep',
        '',
        '> Quoted line',
        '> continues',
        '',
        '- one',
        '- two',
        '  - nested',
        '',
        '3. three',
        '4. four',
        '',
        '***',
        '',
        '#',
        '',
        'Setext Title',
        '============',
      ].join('\n'),
    )
    expect(checkContent(doc).ok).toBe(true)
    expect(doc.content?.map((b) => (b.type === 'heading' ? `h${b.attrs?.level}` : b.type))).toEqual([
      'h1',
      'paragraph',
      'h2',
      'h3',
      'blockquote',
      'bulletList',
      'orderedList',
      'horizontalRule',
      'horizontalRule',
      'h1',
    ])
    expect(doc.content?.[1].content?.map((c) => c.text)).toEqual(['It was ', 'late', '. Still late.'])
    const bullet = doc.content?.[5]
    expect(bullet?.content?.[1].content?.[1].type).toBe('bulletList')
    expect(doc.content?.[6].attrs?.start).toBe(3)
  })

  it('treats "---" under a sentence as a scene break, not a setext heading', () => {
    const { doc } = markdownToDoc('She left the room.\n---\nNext scene.')
    expect(doc.content?.map((b) => b.type)).toEqual(['paragraph', 'horizontalRule', 'paragraph'])
  })

  it('reads a front-matter title and hard line breaks', () => {
    const r = markdownToDoc('---\ntitle: "The Long Road"\nauthor: Me\n---\nLine one  \nline two')
    expect(r.title).toBe('The Long Road')
    expect(r.doc.content?.[0].content?.map((c) => c.type)).toEqual(['text', 'hardBreak', 'text'])
  })

  it('splits one-long-line-per-paragraph Markdown into paragraphs', () => {
    const para = 'word '.repeat(30).trim()
    const { doc } = markdownToDoc(`${para}\n${para}\n${para}`)
    expect(doc.content?.length).toBe(3)
  })
})

const summary = (d: JSONContent) =>
  (d.content ?? []).map((b) =>
    b.type === 'heading'
      ? `H${b.attrs?.level}:${(b.content ?? []).map((c) => c.text ?? '').join('')}`
      : b.type === 'paragraph'
        ? (b.content ?? []).map((c) => (c.type === 'hardBreak' ? '\n' : c.text ?? '')).join('')
        : b.type,
  )

describe('markdownToDoc — never mistakes prose for metadata or headings', () => {
  it('keeps a manuscript that opens with a --- scene break (not front matter)', () => {
    const r = markdownToDoc('---\n\nNote: this draft is rough.\n\nShe walked into the room and sat down.\n\n---\n\nChapter 1\n\nText.')
    expect(r.frontMatter).toBe(false)
    expect(summary(r.doc)).toEqual([
      'horizontalRule',
      'Note: this draft is rough.',
      'She walked into the room and sat down.',
      'horizontalRule',
      'Chapter 1',
      'Text.',
    ])
  })

  it('keeps text between --- lines when any line of it is prose', () => {
    const r = markdownToDoc('---\nMonday: rain again.\nShe walked into the room and sat down.\n---\nMore.')
    expect(r.frontMatter).toBe(false)
    expect(summary(r.doc).join(' ')).toContain('She walked into the room')
  })

  it('still reads real YAML front matter', () => {
    const r = markdownToDoc('---\ntitle: "The Orchard"\nauthor: Jane Doe\ntags:\n  - novel\n  - draft\n---\n\n# Chapter 1\n\nText.')
    expect(r.title).toBe('The Orchard')
    expect(r.frontMatter).toBe(true)
    expect(summary(r.doc)).toEqual(['H1:Chapter 1', 'Text.'])
  })

  it('reads "---" under the last line of a scene as a scene break, not a heading', () => {
    for (const line of [
      'The door creaked open. She held her breath and whispered, *not again*',
      'He was about to say something when—',
      'And then the lights went out…',
      'She never came back...',
    ]) {
      const r = markdownToDoc(`${line}\n---\nMorning came.`)
      expect(r.doc.content?.map((b) => b.type)).toEqual(['paragraph', 'horizontalRule', 'paragraph'])
    }
  })

  it('keeps short title-like setext headings', () => {
    expect(summary(markdownToDoc('Morning\n---\nText.').doc)).toEqual(['H2:Morning', 'Text.'])
    expect(summary(markdownToDoc('Chapter 3: The Storm\n---\nText.').doc)).toEqual(['H2:Chapter 3: The Storm', 'Text.'])
    expect(summary(markdownToDoc('The Long Night\n===\nText.').doc)).toEqual(['H1:The Long Night', 'Text.'])
  })
})
