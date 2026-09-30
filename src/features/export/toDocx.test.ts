import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { DOCX_MIME } from './formats'
import { br, h, hr, li, makeBigDoc, makeExportDoc, ol, p, pa, quote, t, ul } from './testFixtures'
import { toDocx, wordFontName } from './toDocx'
import type { DocFormat, HeaderFooterSettings, ThunderDoc } from '../../types'

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
// <w:t> or <w:t xml:space=…>, not <w:titlePg/> or <w:tabs> (a section break's properties can sit in the paragraph).
const textOf = (pXml: string) => [...pXml.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/g)].map((m) => m[1]).join('')

/** The document's <w:sectPr> elements, in order (one per Word section). */
const sectPrs = (xml: string) => xml.match(/<w:sectPr>.*?<\/w:sectPr>/g) ?? []

const withFormat = (blocks: Parameters<typeof makeExportDoc>[0], headerFooter: Partial<HeaderFooterSettings> = {}, bookLayout: DocFormat['bookLayout'] = {}, over: Partial<DocFormat> = {}) =>
  makeExportDoc(blocks, { format: { presetId: 'trade-6x9', chapterStartsNewPage: true, headerFooter, bookLayout, ...over } })

type Band = { xml: string; text: string }
interface Section {
  xml: string
  titlePage: boolean
  headers: Partial<Record<'default' | 'even' | 'first', Band>>
  footers: Partial<Record<'default' | 'even' | 'first', Band>>
}

/** Each section with the header and footer parts it references (text with fields shown as {PAGE}). */
async function sections(doc: ThunderDoc): Promise<{ sections: Section[]; settings: string; files: string[]; document: string }> {
  const blob = await toDocx(doc)
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const read = (name: string) => zip.file(name)?.async('string') ?? Promise.resolve('')
  const document = await read('word/document.xml')
  const rels = await read('word/_rels/document.xml.rels')
  const target = new Map([...rels.matchAll(/<Relationship [^>]*?Id="(rId\d+)"[^>]*?Target="([^"]+)"/g)].map((m) => [m[1], m[2]]))
  for (const m of rels.matchAll(/<Relationship [^>]*?Target="([^"]+)"[^>]*?Id="(rId\d+)"/g)) target.set(m[2], m[1])
  const band = async (id: string): Promise<Band> => {
    const xml = await read(`word/${target.get(id)}`)
    const text = xml
      .replace(/<w:instrText[^>]*>(.*?)<\/w:instrText>/g, '{$1}')
      .replace(/<w:fldSimple w:instr="([^"]*)"[^>]*>/g, '{$1}')
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/^\n+|\n+$/g, '')
    return { xml, text }
  }
  const out: Section[] = []
  for (const xml of sectPrs(document)) {
    const sec: Section = { xml, titlePage: xml.includes('<w:titlePg/>'), headers: {}, footers: {} }
    for (const m of xml.matchAll(/<w:(header|footer)Reference w:type="(\w+)" r:id="(rId\d+)"\/>/g)) {
      const group = m[1] === 'header' ? sec.headers : sec.footers
      group[m[2] as 'default'] = await band(m[3])
    }
    out.push(sec)
  }
  return { sections: out, settings: await read('word/settings.xml'), files: Object.keys(zip.files), document }
}

const threeChapters = [
  p(t('A prologue before any chapter.')),
  h(1, 'Chapter One: The Very Long Beginning of Everything'),
  p(t('One.')),
  h(1, 'Chapter Two'),
  p(t('Two.')),
]

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

  it('writes chapters as Heading 1, each chapter a section starting on a right-hand page', async () => {
    const { document, styles } = await unzip(novel)
    const ps = paragraphs(document)
    const chapters = ps.filter((x) => x.includes('<w:pStyle w:val="Heading1"/>'))
    expect(chapters.map(textOf)).toEqual(['Chapter One', 'Chapter Two'])
    // The section break starts the page, so the heading itself carries no page break.
    expect(document).not.toContain('pageBreakBefore')
    const secs = sectPrs(document)
    expect(secs).toHaveLength(2)
    expect(secs[0]).not.toContain('<w:type ')
    expect(secs[1]).toContain('<w:type w:val="oddPage"/>')
    // The second section's break sits right before Chapter Two.
    const iBreak = ps.findIndex((x) => x.includes('<w:sectPr>'))
    expect(textOf(ps[iBreak + 1])).toBe('Chapter Two')
    expect(ps.find((x) => textOf(x) === 'Later')).toContain('<w:pStyle w:val="Heading2"/>')
    expect(ps.find((x) => textOf(x) === 'Scene')).toContain('<w:pStyle w:val="Heading3"/>')
    expect(styles).toMatch(/w:styleId="Heading1"><w:name w:val="Heading 1"\/>/)
    expect(styles).toContain('<w:outlineLvl w:val="0"/>')
  })

  it('puts each section break on the chapter’s last paragraph, with no extra empty paragraph', async () => {
    const { document } = await unzip(withFormat([h(1, 'One'), p(t('a')), h(1, 'Two'), p(t('b')), h(1, ''), p(t('c'))]))
    const ps = paragraphs(document)
    // One paragraph per block: no empty paragraph holding a section break (a stray line, maybe a blank page, in Word).
    expect(ps.map(textOf)).toEqual(['One', 'a', 'Two', 'b', '', 'c'])
    expect(ps.map((x) => x.includes('<w:sectPr>'))).toEqual([false, true, false, true, false, false])
    expect(sectPrs(document)).toHaveLength(3)
    expect(ps[1]).toMatch(/^<w:p><w:pPr><w:pStyle w:val="FirstParagraph"\/>.*<w:sectPr>.*<\/w:sectPr><\/w:pPr><w:r>/)
    // The last section's properties stay at the end of the body.
    expect(document).toMatch(/<\/w:p><w:sectPr>.*<\/w:sectPr><\/w:body>/)
  })

  it('omits chapter page breaks when the format says so', async () => {
    const { document } = await unzip(makeExportDoc([h(1, 'A'), p(t('x')), h(1, 'B')], { format: { presetId: 'trade-6x9', chapterStartsNewPage: false } }))
    expect(document).not.toContain('pageBreakBefore')
    expect(sectPrs(document)).toHaveLength(1)
    expect(document).not.toContain('oddPage')
  })

  it('starts chapters on the next page (not a right-hand one) when the book layout says so', async () => {
    const { document } = await unzip(withFormat([h(1, 'A'), p(t('x')), h(1, 'B'), p(t('y'))], {}, { chaptersStartRecto: false }))
    const secs = sectPrs(document)
    expect(secs).toHaveLength(2)
    expect(secs[1]).toContain('<w:type w:val="nextPage"/>')
    expect(document).not.toContain('oddPage')
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
    expect(document.match(/<w:type w:val="oddPage"\/>/g)).toHaveLength(39)
    expect(document).not.toContain('pageBreakBefore')
    // Typically well under a second; generous bound for slow CI machines.
    expect(ms).toBeLessThan(15_000)
  }, 30_000)
})

describe('toDocx headers and footers', () => {
  it('turns on different odd/even headers and mirrored margins in word/settings.xml', async () => {
    const { settings, files } = await sections(novel)
    expect(settings).toContain('<w:evenAndOddHeaders/>')
    expect(settings).toContain('<w:mirrorMargins/>')
    // Schema order: mirrorMargins comes after displayBackgroundShape and before evenAndOddHeaders.
    expect(settings.indexOf('<w:displayBackgroundShape/>')).toBeLessThan(settings.indexOf('<w:mirrorMargins/>'))
    expect(settings.indexOf('<w:mirrorMargins/>')).toBeLessThan(settings.indexOf('<w:evenAndOddHeaders/>'))
    expect(files.filter((f) => /^word\/header\d+\.xml$/.test(f)).length).toBeGreaterThanOrEqual(3)
    expect(files.filter((f) => /^word\/footer\d+\.xml$/.test(f)).length).toBeGreaterThanOrEqual(3)
  })

  it('defaults: author (or the title) on left pages, title on right, number centred, nothing on chapter openings', async () => {
    const { sections: secs } = await sections(withFormat(threeChapters))
    const first = secs[0]
    // Word: "default" = odd (right-hand) pages, "even" = left-hand pages.
    expect(first.headers.default?.text).toBe('My Novel')
    expect(first.headers.even?.text).toBe('My Novel') // no author name: falls back to the title
    expect(first.headers.default?.xml).toContain('<w:smallCaps/>')
    expect(first.footers.default?.text).toBe('{PAGE}')
    expect(first.footers.default?.xml).toContain('<w:jc w:val="center"/>')
    expect(first.footers.even?.text).toBe('{PAGE}')
    // Chapter openings (and the book's first page): different first page, empty head, drop folio.
    expect(first.titlePage).toBe(true)
    expect(first.headers.first?.text).toBe('')
    expect(first.footers.first?.text).toBe('{PAGE}')
    expect(first.xml).toContain('<w:pgNumType w:start="1"/>')
    // Later sections link to the first one's (same) headers, keep the first-page rule and continue numbering.
    for (const s of secs.slice(1)) {
      expect(s.titlePage).toBe(true)
      expect(s.headers).toEqual({})
      expect(s.xml).not.toContain('w:start=')
    }
    const withAuthor = await sections(withFormat(threeChapters, { authorName: 'Ada Lovelace' }))
    expect(withAuthor.sections[0].headers.even?.text).toBe('Ada Lovelace')
  })

  it("uses each chapter's title (or its short head) for chapter running heads", async () => {
    const { sections: secs } = await sections(
      withFormat(threeChapters, {
        versoHead: 'title',
        rectoHead: 'chapter',
        shortHeads: { 'Chapter One: The Very Long Beginning of Everything': 'The Beginning' },
      }),
    )
    expect(secs).toHaveLength(3)
    expect(secs[0].headers.default?.text).toBe('My Novel') // before the first chapter: the title
    expect(secs[1].headers.default?.text).toBe('The Beginning')
    expect(secs[2].headers.default?.text).toBe('Chapter Two')
    expect(secs[1].headers.even?.text).toBe('My Novel')
    expect(secs[2].headers.first?.text).toBe('')
  })

  it('puts the page number in the outside corner of the footer, or of the header', async () => {
    const outside = await sections(withFormat(threeChapters, { pageNumbers: 'footer-outside' }))
    const s = outside.sections[0]
    expect(s.footers.default?.xml).toContain('<w:jc w:val="right"/>')
    expect(s.footers.even?.xml).toContain('<w:jc w:val="left"/>')
    expect(s.footers.default?.text).toBe('{PAGE}')

    const top = await sections(withFormat(threeChapters, { pageNumbers: 'header-outside', authorName: 'Ada' }))
    const h0 = top.sections[0]
    // Left page: number, then the head at a centre tab. Right page: head at a centre tab, number at a right tab.
    expect(h0.headers.even?.text).toBe('{PAGE}\tAda\t')
    expect(h0.headers.default?.text).toBe('\tMy Novel\t{PAGE}')
    expect(h0.headers.default?.xml).toMatch(/<w:tab w:val="center" w:pos="3240"\/><w:tab w:val="right" w:pos="6480"\/>/)
    expect(h0.footers.default?.text).toBe('')
    // Opening pages: the number drops to the foot of the page.
    expect(h0.headers.first?.text).toBe('')
    expect(h0.footers.first?.text).toBe('{PAGE}')

    const none = await sections(withFormat(threeChapters, { pageNumbers: 'none' }))
    expect(JSON.stringify(none.sections)).not.toContain('{PAGE}')
  })

  it('starts numbering at the chosen first page number, on the first section only', async () => {
    const { sections: secs } = await sections(withFormat(threeChapters, { firstPageNumber: 7 }))
    expect(secs[0].xml).toContain('<w:pgNumType w:start="7"/>')
    expect(secs.slice(1).every((s) => !s.xml.includes('w:start='))).toBe(true)
  })

  it('keeps heads on chapter openings when asked, and can hide the opening page number', async () => {
    const keep = await sections(withFormat(threeChapters, { suppressOnChapterOpeners: false }))
    expect(keep.sections.every((s) => !s.titlePage)).toBe(true)
    expect(keep.sections[0].headers.first).toBeUndefined()
    const hide = await sections(withFormat(threeChapters, { openerFolio: 'none' }))
    expect(hide.sections[0].footers.first?.text).toBe('')
    expect(hide.sections[0].footers.default?.text).toBe('{PAGE}')
  })

  it('prints the footer line on its own row below a centred number, and beside an outside one', async () => {
    const centred = await sections(withFormat(threeChapters, { footer: 'custom', footerCustom: 'Advance reader copy' }))
    expect(centred.sections[0].footers.default?.text).toBe('{PAGE}\nAdvance reader copy')
    expect(centred.sections[0].footers.first?.text).toBe('{PAGE}\nAdvance reader copy')
    const outside = await sections(withFormat(threeChapters, { footer: 'custom', footerCustom: 'ARC', pageNumbers: 'footer-outside' }))
    expect(outside.sections[0].footers.default?.text).toBe('\tARC\t{PAGE}')
    expect(outside.sections[0].footers.even?.text).toBe('{PAGE}\tARC\t')
  })

  it('sizes running heads from the font scale and can turn small caps off', async () => {
    const { sections: secs } = await sections(withFormat(threeChapters, { fontScale: 1, smallCapsRunningHeads: false }))
    expect(secs[0].headers.default?.xml).toContain('<w:sz w:val="23"/>') // 11.5pt body
    expect(secs[0].headers.default?.xml).not.toContain('smallCaps')
  })

  it("uses Word's STYLEREF field for chapter heads when chapters don't start new pages (one section)", async () => {
    const { sections: secs } = await sections(withFormat(threeChapters, { rectoHead: 'chapter' }, {}, { chapterStartsNewPage: false }))
    expect(secs).toHaveLength(1)
    expect(secs[0].headers.default?.xml).toMatch(/STYLEREF &quot;Heading 1&quot;|STYLEREF "Heading 1"/)
  })

  it('escapes header text and drops characters Word cannot open', async () => {
    const { sections: secs } = await sections(withFormat(threeChapters, { versoHead: 'custom', versoCustom: 'Tom & <Jerry> \u0007' }))
    expect(secs[0].headers.even?.xml).toContain('Tom &amp; &lt;Jerry&gt; ')
  })

  it('reads old documents without settings as the defaults', async () => {
    const plain = await sections(makeExportDoc(threeChapters))
    const defaults = await sections(withFormat(threeChapters))
    expect(plain.sections.map((s) => [s.titlePage, s.headers.default?.text, s.footers.first?.text])).toEqual(
      defaults.sections.map((s) => [s.titlePage, s.headers.default?.text, s.footers.first?.text]),
    )
  })
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
