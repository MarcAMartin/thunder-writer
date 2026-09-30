import JSZip from 'jszip'

/** Builds a small but real .docx (a zip of WordprocessingML parts) for tests. */

export interface Run {
  /** '\n' writes a soft line break (Shift+Enter, <w:br/>) and '\t' a tab (<w:tab/>). */
  text?: string
  b?: boolean
  i?: boolean
  u?: boolean
  strike?: boolean
  /** Word's highlighter (w:highlight), e.g. 'yellow'. */
  highlight?: string
  footnote?: number
  comment?: number
  image?: boolean
}
export interface Para {
  style?: 'Title' | 'Heading1' | 'Heading2' | 'Heading3' | 'Heading4' | 'Quote'
  runs: Array<Run | string>
  /** Direct list numbering on the paragraph (w:numPr with numId 1, level 0). */
  numbered?: boolean
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'

function runXml(r: Run | string): string {
  const run: Run = typeof r === 'string' ? { text: r } : r
  if (run.footnote) return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${run.footnote}"/></w:r>`
  if (run.comment) return `<w:r><w:commentReference w:id="${run.comment}"/></w:r>`
  if (run.image) {
    return `<w:r><w:drawing><wp:inline><wp:extent cx="100" cy="100"/><wp:docPr id="1" name="Picture 1" descr="alt"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg1"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  }
  if (run.text === '\n') return '<w:r><w:br/></w:r>'
  if (run.text === '\t') return '<w:r><w:tab/></w:r>'
  const props = [run.b && '<w:b/>', run.i && '<w:i/>', run.u && '<w:u w:val="single"/>', run.strike && '<w:strike/>', run.highlight && `<w:highlight w:val="${run.highlight}"/>`].filter(Boolean).join('')
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(run.text ?? "")}</w:t></w:r>`
}

const paraXml = (p: Para) => {
  const pPr = [p.style && `<w:pStyle w:val="${p.style}"/>`, p.numbered && '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>']
    .filter(Boolean)
    .join('')
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${p.runs.map(runXml).join('')}</w:p>`
}

/** numbering.xml with one list (numId 1) whose level 0 reads `lvlText`, optionally linked to Heading 1. */
const numberingXml = (n: HeadingNumbering) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/><w:lvl w:ilvl="0"><w:start w:val="${n.start ?? 1}"/><w:numFmt w:val="${n.numFmt ?? 'decimal'}"/>${n.linkStyle ? '<w:pStyle w:val="Heading1"/>' : ''}<w:lvlText w:val="${esc(n.lvlText)}"/><w:lvlJc w:val="left"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/></w:style>
</w:styles>`

export interface HeadingNumbering {
  lvlText: string
  numFmt?: string
  start?: number
  /** Word's "link level to style": the level names Heading 1 and the style carries the numbering. */
  linkStyle?: boolean
}

export interface DocxOptions {
  /** Word's automatic heading numbering, e.g. { lvlText: 'Chapter %1', linkStyle: true }. */
  headingNumbering?: HeadingNumbering
  footnotes?: Record<number, string>
  comments?: Record<number, string>
  coreTitle?: string
  withImage?: boolean
}

export async function buildDocx(paras: Para[], opts: DocxOptions = {}): Promise<ArrayBuffer> {
  const zip = new JSZip()
  const rels: string[] = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
  ]
  const overrides: string[] = [
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
  ]
  if (opts.footnotes) {
    rels.push('<Relationship Id="rIdFn" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>')
    overrides.push('<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>')
    zip.file(
      'word/footnotes.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${W}>${Object.entries(opts.footnotes)
        .map(([id, t]) => `<w:footnote w:id="${id}"><w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p></w:footnote>`)
        .join('')}</w:footnotes>`,
    )
  }
  if (opts.comments) {
    rels.push('<Relationship Id="rIdCm" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>')
    overrides.push('<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>')
    zip.file(
      'word/comments.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${W}>${Object.entries(opts.comments)
        .map(([id, t]) => `<w:comment w:id="${id}" w:author="Ed"><w:p><w:r><w:t>${esc(t)}</w:t></w:r></w:p></w:comment>`)
        .join('')}</w:comments>`,
    )
  }
  if (opts.withImage) {
    rels.push('<Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>')
    zip.file('word/media/image1.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (opts.coreTitle !== undefined) {
    overrides.push('<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>')
    zip.file(
      'docProps/core.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(opts.coreTitle)}</dc:title></cp:coreProperties>`,
    )
  }
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides.join('')}</Types>`,
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
  )
  if (opts.headingNumbering) {
    rels.push('<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>')
    overrides.push('<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>')
    zip.file('word/numbering.xml', numberingXml(opts.headingNumbering))
  }
  const styles = opts.headingNumbering?.linkStyle
    ? STYLES.replace(
        '<w:name w:val="heading 1"/></w:style>',
        '<w:name w:val="heading 1"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>',
      )
    : STYLES
  zip.file('word/styles.xml', styles)
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${paras.map(paraXml).join('')}</w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}

/** A zip whose one XML part inflates to `size` bytes of spaces (a miniature zip bomb). */
export async function buildBombDocx(size: number): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('word/document.xml', ' '.repeat(size))
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } })
}

/**
 * Rewrites the uncompressed size recorded for `name` in the zip's central
 * directory, e.g. to claim a part is 3 GB, or to hide how large it really is.
 */
export function patchDeclaredSize(zip: ArrayBuffer, name: string, size: number): ArrayBuffer {
  const b = new Uint8Array(zip.slice(0))
  const view = new DataView(b.buffer)
  const want = new TextEncoder().encode(name)
  for (let p = 0; p + 46 < b.length; p++) {
    if (view.getUint32(p, true) !== 0x02014b50) continue
    const len = view.getUint16(p + 28, true)
    const got = b.subarray(p + 46, p + 46 + len)
    if (len === want.length && got.every((v, i) => v === want[i])) {
      view.setUint32(p + 24, size >>> 0, true)
      return b.buffer
    }
  }
  throw new Error(`no entry ${name}`)
}
