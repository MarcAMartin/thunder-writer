import type { JSONContent } from '@tiptap/core'
import { blockText } from './structure'
import { textToDoc, usesLinePerParagraph } from './text'

const texts = (doc: JSONContent) => (doc.content ?? []).map((b) => (b.type === 'paragraph' ? blockText(b) : `<${b.type}>`))

const long = (s: string) => `${s} ${'and the words went on and on across the page without a single break, '.repeat(2)}`.trim()

describe('textToDoc', () => {
  it('splits blank-line separated paragraphs and joins hard-wrapped lines', () => {
    const src = [
      'It was a bright cold day in April, and the clocks were striking',
      'thirteen. Winston Smith, his chin nuzzled into his breast in an',
      'effort to escape the vile wind, slipped quickly.',
      '',
      'The hallway smelt of boiled cabbage and old rag mats.',
    ].join('\n')
    expect(texts(textToDoc(src))).toEqual([
      'It was a bright cold day in April, and the clocks were striking thirteen. Winston Smith, his chin nuzzled into his breast in an effort to escape the vile wind, slipped quickly.',
      'The hallway smelt of boiled cabbage and old rag mats.',
    ])
  })

  it('treats each line as a paragraph when the file has one line per paragraph', () => {
    const lines = [long('First paragraph'), '“Short reply,” she said.', long('Third paragraph'), 'Fine.', long('Fifth')]
    expect(usesLinePerParagraph(lines)).toBe(true)
    expect(texts(textToDoc(lines.join('\n')))).toEqual(lines)
  })

  it('detects line-per-paragraph even with an occasional blank line', () => {
    const lines: string[] = []
    for (let i = 0; i < 30; i++) lines.push(long(`Paragraph ${i}`))
    lines.splice(15, 0, '')
    const doc = textToDoc(lines.join('\n'))
    expect(doc.content?.filter((b) => blockText(b).trim()).length).toBe(30)
  })

  it('keeps line breaks in short-line blocks such as a poem', () => {
    const doc = textToDoc('Roses are red,\nViolets are blue.\n\nNext paragraph here.')
    expect(doc.content?.[0].content?.map((c) => c.type)).toEqual(['text', 'hardBreak', 'text'])
  })

  it('normalizes CRLF, strips a BOM-free leading indent and trailing spaces, keeps the words verbatim', () => {
    const doc = textToDoc('\tShe said -- "no".  \r\n\r\n  Then  two  spaces.\r\n')
    expect(texts(doc)).toEqual(['She said -- "no".', 'Then  two  spaces.'])
  })

  it('splits a chapter title sitting directly above its text, and scene-break lines', () => {
    const src = 'Chapter 1\nIt was a dark night and the rain fell in torrents on the town.\n* * *\nMorning came.'
    expect(texts(textToDoc(src))).toEqual([
      'Chapter 1',
      'It was a dark night and the rain fell in torrents on the town.',
      '* * *',
      'Morning came.',
    ])
  })
})
