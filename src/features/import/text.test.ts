import type { JSONContent } from '@tiptap/core'
import { blockText } from './structure'
import { readPlainText, textToDoc, usesLinePerParagraph } from './text'

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

describe('textToDoc — paragraph boundaries judged across the whole file', () => {
  const dialogue = (from: number, to: number, first?: string) => {
    const out: string[] = []
    for (let i = from; i <= to; i++) out.push(`"Line number ${i} is a sentence of dialogue that is medium," he said.`)
    if (first) out[0] = first
    return out
  }

  it('keeps one-paragraph-per-line dialogue apart even with blank lines around a scene break', () => {
    const src = ['Chapter 1', ...dialogue(1, 15), '', '* * *', '', ...dialogue(16, 30)].join('\n')
    const r = readPlainText(src)
    const paras = texts(r.doc).filter((t) => t && t !== '<paragraph>')
    expect(paras).toHaveLength(1 + 15 + 1 + 15)
    expect(paras[1]).toBe(dialogue(1, 1)[0])
    expect(r.joinedLines).toBe(0)
    expect(r.wrapWidth).toBeUndefined()
  })

  it('does not fold a chapter into one hard-broken paragraph when some lines are short', () => {
    const src = ['Chapter 1', ...dialogue(1, 15, '"Line 1," he said.'), '', 'Chapter 2', ...dialogue(16, 30)].join('\n')
    const doc = textToDoc(src)
    expect(JSON.stringify(doc)).not.toContain('hardBreak')
    expect(texts(doc)).toContain('Chapter 2')
    expect(texts(doc)).toContain('"Line 1," he said.')
  })

  it('also keeps them apart when blank lines separate every paragraph', () => {
    const lines = dialogue(1, 6)
    const doc = textToDoc([lines.slice(0, 3).join('\n'), lines.slice(3).join('\n')].join('\n\n'))
    expect(texts(doc)).toEqual(lines)
  })

  it('joins genuinely hard-wrapped prose and reports the wrap width', () => {
    const src = [
      'It was a bright cold day in April, and the clocks were striking',
      'thirteen. Winston Smith, his chin nuzzled into his breast in an',
      'effort to escape the vile wind, slipped quickly through the glass',
      'doors of Victory Mansions.',
      '',
      'The hallway smelt of boiled cabbage and old rag mats. At one end of',
      'it a coloured poster, too large for indoor display, had been tacked',
      'to the wall.',
    ].join('\n')
    const r = readPlainText(src)
    expect(texts(r.doc)).toHaveLength(2)
    expect(texts(r.doc)[0]).toMatch(/^It was a bright .* Victory Mansions\.$/)
    expect(r.wrapWidth).toBe(67)
    expect(r.joinedLines).toBe(5)
  })

  it('splits hard-wrapped paragraphs that have no blank lines at short or indented lines', () => {
    const src = [
      '    It was a bright cold day in April, and the clocks were striking',
      'thirteen. Winston Smith, his chin nuzzled into his breast in an',
      'effort to escape the vile wind, slipped quickly.',
      '    The hallway smelt of boiled cabbage and old rag mats. At one end',
      'of it a coloured poster, too large for indoor display, had been',
      'tacked to the wall.',
    ].join('\n')
    expect(texts(textToDoc(src))).toHaveLength(2)
  })

  it('keeps a scene break shown only by an extra blank line', () => {
    const doc = textToDoc('First para here.\n\nSecond para here.\n\n\n\nNew scene starts.\n\nFourth.')
    expect(texts(doc)).toEqual(['First para here.', 'Second para here.', '', 'New scene starts.', 'Fourth.'])
  })

  it('treats a doubled blank line as the separator when the whole file uses it', () => {
    const doc = textToDoc('One here.\n\n\nTwo here.\n\n\nThree here.')
    expect(texts(doc)).toEqual(['One here.', 'Two here.', 'Three here.'])
  })
})
