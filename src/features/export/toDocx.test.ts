import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { DOCX_MIME } from './formats'
import { br, h, hr, li, makeBigDoc, makeExportDoc, ol, p, pa, quote, t, ul } from './testFixtures'
import { toDocx, wordFontName } from './toDocx'
import type { ThunderDoc } from '../../types'

async function unzip(doc: ThunderDoc) {
  const blob = await toDocx(doc)
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const read = (name: string) => zip.file(name)?.async('string') ?? Promise.resolve('')
  return {
    blob,
    zip,
    document: await read('word/document.xml'),
    styles: await read('word/styles.xml'),
    numbering: await read('word/numbering.xml'),
    core: await read('docProps/core.xml'),
    footers: (await Promise.all(Object.keys(zip.files).filter((n) => /^word\/footer\d*\.xml$/.test(n)).map(read))).join(''),
  }
}

/** The <w:p> elements of document.xml, in order. */
const paragraphs = (xml: string) => xml.match(/<w:p>.*?<\/w:p>|<w:p\/>/g) ?? []
const textOf = (pXml: string) => [...pXml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map((m) => m[1]).join('')

const novel = makeExportDoc([
  h(1, 'Chapter One'),
  p(t('It was a '), t('dark', 'bold'), t(' and '), t('stormy', 'italic'), t(' night.')),
  p(t('She ran.'), br(), t('He waited.')),
  hr(),
  h(2, 'Later'),
  h(3, 'Scene'),
  p(t('under', 'underline'), t(' '), t('gone', 'strike'), t(' '), t('glow', 'highlight')),
  quote(p(t('A quoted line.'))),
  ul(li(p(t('apples'))), li(p(t('pears')), ul(li(p(t('green')))))),
  ol([li(p(t('first'))), li(p(t('second')))]),
  h(1, 'Chapter Two'),
  pa('center', t('The End')),
])

describe('toDocx', () => {
  it('produces a valid .docx zip with the Word MIME type', async () => {
    const { blob, zip, document } = await unzip(novel)
    expect(blob.type).toBe(DOCX_MIME)
    expect(zip.file('[Content_Types].xml')).not.toBeNull()
    expect(zip.file('word/document.xml')).not.toBeNull()
    expect(document.startsWith('<?xml')).toBe(true)
  })

  it('uses the book trim size and margins (inches → twips)', async () => {
    const { document } = await unzip(novel)
    // Trade 6 × 9: 6in = 8640, 9in = 12960; margins .75/.65/.8/.85in.
    expect(document).toContain('<w:pgSz w:w="8640" w:h="12960" w:orient="portrait"/>')
    expect(document).toMatch(/<w:pgMar w:top="1080" w:right="936" w:bottom="1152" w:left="1224"/)
    const ms = await unzip(makeExportDoc([p(t('x'))], { format: { presetId: 'manuscript-letter', chapterStartsNewPage: true } }))
    expect(ms.document).toContain('<w:pgSz w:w="12240" w:h="15840"')
    expect(ms.document).toMatch(/<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/)
  })

  it('sets font, size and line spacing from the resolved format', async () => {
    const { styles } = await unzip(novel)
    expect(styles).toContain('w:ascii="Palatino Linotype"')
    expect(styles).toContain('<w:sz w:val="23"/>') // 11.5pt
    expect(styles).toContain('w:line="336" w:lineRule="auto"') // 1.4 × 240
    const custom = await unzip(
      makeExportDoc([p(t('x'))], {
        format: { presetId: 'trade-5x8', chapterStartsNewPage: true, fontSizePt: 12, lineHeight: 2, fontFamily: "'Courier New', Courier, monospace" },
      }),
    )
    expect(custom.styles).toContain('w:ascii="Courier New"')
    expect(custom.styles).toContain('<w:sz w:val="24"/>')
    expect(custom.styles).toContain('w:line="480" w:lineRule="auto"')
  })

  it('writes chapters as Heading 1 with a page break before every chapter but the first', async () => {
    const { document, styles } = await unzip(novel)
    const ps = paragraphs(document)
    const chapters = ps.filter((x) => x.includes('<w:pStyle w:val="Heading1"/>'))
    expect(chapters.map(textOf)).toEqual(['Chapter One', 'Chapter Two'])
    expect(chapters[0]).not.toContain('pageBreakBefore')
    expect(chapters[1]).toContain('<w:pageBreakBefore/>')
    expect(ps.find((x) => textOf(x) === 'Later')).toContain('<w:pStyle w:val="Heading2"/>')
    expect(ps.find((x) => textOf(x) === 'Scene')).toContain('<w:pStyle w:val="Heading3"/>')
    expect(styles).toMatch(/w:styleId="Heading1"><w:name w:val="Heading 1"\/>/)
    expect(styles).toContain('<w:outlineLvl w:val="0"/>')
  })

  it('omits chapter page breaks when the format says so', async () => {
    const { document } = await unzip(makeExportDoc([h(1, 'A'), p(t('x')), h(1, 'B')], { format: { presetId: 'trade-6x9', chapterStartsNewPage: false } }))
    expect(document).not.toContain('pageBreakBefore')
  })

  it('maps marks, hard breaks, scene breaks, quotes and alignment', async () => {
    const { document, styles } = await unzip(novel)
    const ps = paragraphs(document)
    const first = ps.find((x) => textOf(x).startsWith('It was'))!
    expect(first).toContain('<w:pStyle w:val="FirstParagraph"/>')
    expect(first).toMatch(/<w:b\/>.*dark/)
    expect(first).toMatch(/<w:i\/>.*stormy/)
    const second = ps.find((x) => textOf(x).startsWith('She ran'))!
    expect(second).toContain('<w:pStyle w:val="BodyText"/>')
    expect(second).toContain('<w:br/>')
    const marks = ps.find((x) => textOf(x).startsWith('under'))!
    expect(marks).toContain('<w:u w:val="single"/>')
    expect(marks).toContain('<w:strike/>')
    expect(marks).toContain('<w:highlight w:val="yellow"/>')
    const scene = ps.find((x) => textOf(x) === '* * *')!
    expect(scene).toContain('<w:pStyle w:val="SceneBreak"/>')
    expect(styles).toMatch(/w:styleId="SceneBreak">.*?<w:jc w:val="center"\/>/)
    expect(ps.find((x) => textOf(x) === 'A quoted line.')).toContain('<w:pStyle w:val="Quote"/>')
    expect(ps.find((x) => textOf(x) === 'The End')).toContain('<w:jc w:val="center"/>')
  })

  it('writes bullet and numbered lists with Word numbering', async () => {
    const { document, numbering } = await unzip(novel)
    const ps = paragraphs(document)
    const lvl = (text: string) => /<w:ilvl w:val="(\d)"\/>/.exec(ps.find((x) => textOf(x) === text) ?? '')?.[1]
    expect(lvl('apples')).toBe('0')
    expect(lvl('green')).toBe('1')
    expect(lvl('first')).toBe('0')
    expect(numbering).toContain('w:val="bullet"')
    expect(numbering).toContain('w:val="decimal"')
  })

  it('puts page numbers in the footer and the title in the document properties', async () => {
    const { footers, core } = await unzip(novel)
    expect(footers).toMatch(/PAGE/)
    expect(core).toContain('<dc:title>My Novel</dc:title>')
  })

  it('escapes XML and drops characters Word cannot open', async () => {
    const { document, core } = await unzip(
      makeExportDoc([p(t('Tom & Jerry <3 "quotes" \u0007bell \uD800lone'))], { title: 'A & B <C>' }),
    )
    expect(document).toContain('Tom &amp; Jerry &lt;3 &quot;quotes&quot; bell lone')
    expect(core).toContain('<dc:title>A &amp; B &lt;C&gt;</dc:title>')
  })

  it('produces a valid document for an empty manuscript', async () => {
    const { document } = await unzip(makeExportDoc([], { title: '' }))
    expect(paragraphs(document).length).toBe(1)
    const nullContent = await unzip({ ...makeExportDoc([]), content: null })
    expect(nullContent.document).toContain('<w:body>')
  })

  it('converts a 120,000-word, 40-chapter novel in reasonable time', async () => {
    const t0 = performance.now()
    const { document } = await unzip(makeBigDoc())
    const ms = performance.now() - t0
    expect(document.match(/<w:pStyle w:val="Heading1"\/>/g)).toHaveLength(40)
    expect(document.match(/<w:pageBreakBefore\/>/g)).toHaveLength(39)
    // Typically well under a second; generous bound for slow CI machines.
    expect(ms).toBeLessThan(15_000)
  }, 30_000)
})

describe('wordFontName', () => {
  it('picks the first family desktop Word is likely to have', () => {
    expect(wordFontName("'EB Garamond', Garamond, 'Adobe Garamond Pro', 'Times New Roman', serif")).toBe('Garamond')
    expect(wordFontName("Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif")).toBe('Charter')
    expect(wordFontName('Georgia, Cambria, serif')).toBe('Georgia')
    expect(wordFontName('serif')).toBe('Times New Roman')
    expect(wordFontName('')).toBe('Times New Roman')
  })
})
