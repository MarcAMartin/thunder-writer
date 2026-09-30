import type { JSONContent } from '@tiptap/core'
import { blockText, countWords, shapeManuscript } from './structure'

const p = (text: string, attrs?: Record<string, unknown>): JSONContent => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  ...(text ? { content: [{ type: 'text', text }] } : {}),
})
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const summary = (d: JSONContent) =>
  (d.content ?? []).map((b) => (b.type === 'heading' ? `H${b.attrs?.level}:${blockText(b)}` : b.type === 'paragraph' ? blockText(b) || '∅' : b.type))

describe('shapeManuscript', () => {
  it('promotes standalone chapter lines and turns break lines into scene breaks', () => {
    const r = shapeManuscript(
      doc(
        p('Chapter 1'),
        p('Chapter one began badly, he thought.'),
        p('* * *', { textAlign: 'center' }),
        p('—'),
        p('Chapter Two: Rain'),
        p('Text.'),
      ),
    )
    expect(summary(r.doc)).toEqual(['H1:Chapter 1', 'Chapter one began badly, he thought.', 'horizontalRule', 'H1:Chapter Two: Rain', 'Text.'])
    expect(r.chapterCount).toBe(2)
    expect(r.promotedChapters).toBe(2)
    expect(r.sceneBreaks).toBe(2) // "—" merged into the preceding break
  })

  it('never promotes a chapter line that is part of a multi-line paragraph', () => {
    const para: JSONContent = { type: 'paragraph', content: [{ type: 'text', text: 'Chapter 3' }, { type: 'hardBreak' }, { type: 'text', text: 'and more' }] }
    expect(shapeManuscript(doc(para)).promotedChapters).toBe(0)
  })

  it('promotes bare Roman numerals only when there are several', () => {
    expect(shapeManuscript(doc(p('I'), p('Text'), p('II'), p('More'))).chapterCount).toBe(2)
    expect(shapeManuscript(doc(p('I'), p('Text'))).chapterCount).toBe(0)
  })

  it('raises "## Chapter 3" to a chapter heading', () => {
    const h2: JSONContent = { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Chapter 3' }] }
    expect(summary(shapeManuscript(doc(h2)).doc)).toEqual(['H1:Chapter 3'])
  })

  it('collapses empty paragraphs and trims trailing whitespace without touching the words', () => {
    const r = shapeManuscript(
      doc(p(''), p('One -- "two"   '), p(''), p('  '), p(''), p('Three'), p(''), p('Chapter 2'), p(''), p('Four'), p('')),
    )
    expect(summary(r.doc)).toEqual(['One -- "two"', '∅', 'Three', 'H1:Chapter 2', 'Four'])
  })

  it('does not count a leading title heading as a chapter', () => {
    const title: JSONContent = { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'My  Novel' }] }
    const r = shapeManuscript(doc(title, p('Chapter 1'), p('x')), { titleText: 'My Novel' })
    expect(r.chapterCount).toBe(1)
  })

  it('counts words, not punctuation', () => {
    expect(countWords(doc(p('Hello, world — twice.'), p('Again')))).toBe(4)
  })
})

describe('shapeManuscript — structure inside one block', () => {
  const brs = (...parts: Array<string | number>): JSONContent => ({
    type: 'paragraph',
    content: parts.flatMap((x) => (typeof x === 'number' ? Array.from({ length: x }, () => ({ type: 'hardBreak' })) : [{ type: 'text', text: x }])),
  })

  it('splits <br><br>-separated paragraphs, then finds chapters and scene breaks in them', () => {
    const r = shapeManuscript(doc(brs('Chapter 1', 2, 'She ran.', 2, '* * *', 2, 'He stayed.', 2, 'Chapter 2', 2, 'End.')))
    expect(summary(r.doc)).toEqual(['H1:Chapter 1', 'She ran.', 'horizontalRule', 'He stayed.', 'H1:Chapter 2', 'End.'])
    expect(r.chapterCount).toBe(2)
    expect(r.sceneBreaks).toBe(1)
  })

  it('keeps single line breaks and marks, and leaves extra space for a longer run of breaks', () => {
    const para: JSONContent = {
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [
        { type: 'text', text: 'Roses are red,' },
        { type: 'hardBreak' },
        { type: 'text', text: 'violets', marks: [{ type: 'italic' }] },
        { type: 'hardBreak' },
        { type: 'text', text: ' ' },
        { type: 'hardBreak' },
        { type: 'hardBreak' },
        { type: 'text', text: 'Next.' },
      ],
    }
    const out = shapeManuscript(doc(para)).doc.content ?? []
    expect(out.map((b) => blockText(b))).toEqual(['Roses are red,\nviolets', '', 'Next.'])
    expect(out[0].attrs).toEqual({ textAlign: 'center' })
    expect(out[0].content?.[2].marks).toEqual([{ type: 'italic' }])
  })

  it('promotes "Chapter 4" + line break + its title typed as one paragraph', () => {
    const r = shapeManuscript(doc(brs('Chapter 4', 1, 'The Calm'), p('Text.')))
    expect(summary(r.doc)).toEqual(['H1:Chapter 4\nThe Calm', 'Text.'])
    expect(r.chapterCount).toBe(1)
  })

  it('does not promote a chapter line followed by prose in the same paragraph', () => {
    const r = shapeManuscript(doc(brs('Chapter 4', 1, 'It was a dark and stormy night, and the rain fell in torrents.')))
    expect(r.chapterCount).toBe(0)
  })

  it('promotes bare numerals only when they count up, so "XXX" to-do markers stay text', () => {
    expect(shapeManuscript(doc(p('She walked into the room.'), p('XXX'), p('She left.'), p('XXX'), p('The end came soon.'))).chapterCount).toBe(0)
    expect(shapeManuscript(doc(p('MIX'), p('Text'), p('DIV'), p('More'))).chapterCount).toBe(0)
    const r = shapeManuscript(doc(p('I'), p('Text'), p('II'), p('C.'), p('III'), p('More')))
    expect(summary(r.doc)).toEqual(['H1:I', 'Text', 'H1:II', 'C.', 'H1:III', 'More'])
    expect(shapeManuscript(doc(p('12.'), p('Text'), p('13.'), p('More'))).chapterCount).toBe(2)
  })
})
