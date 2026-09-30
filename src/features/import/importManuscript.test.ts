import type { JSONContent } from '@tiptap/core'
import JSZip from 'jszip'
import { checkContent } from '../editor/contentCheck'
import { buildBombDocx, buildDocx, patchDeclaredSize } from './__fixtures__/buildDocx'
import { importManuscript } from './importManuscript'
import { formatMB, MAX_IMPORT_BYTES, tooLargeMessage } from './limits'
import { DOCX_MIME } from './sniff'
import { blockText } from './structure'
import { ImportError } from './types'
import { vetDocx } from './zip'

const blocks = (content: unknown) =>
  ((content as JSONContent).content ?? []).map((b) =>
    b.type === 'heading' ? `H${b.attrs?.level}:${blockText(b)}` : b.type === 'paragraph' ? blockText(b) : b.type,
  )

async function importError(p: Promise<unknown>): Promise<ImportError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError)
    return e as ImportError
  }
  throw new Error('expected an ImportError')
}

describe('importManuscript — Word', () => {
  it('converts a real .docx: styles, marks, typed chapters, scene breaks, footnotes, dropped images/comments', async () => {
    const data = await buildDocx(
      [
        { style: 'Title', runs: ['The Lighthouse'] },
        { runs: ['CHAPTER ONE'] },
        { runs: ['She ', { text: 'ran', b: true }, ' and ', { text: 'ran', i: true }, ', ', { text: 'fast', u: true }, { text: 'slow', strike: true }, '.', { footnote: 1 }] },
        { runs: ['* * *'] },
        { runs: [{ image: true }] },
        { runs: ['Chapter one began badly, he thought.', { comment: 1 }] },
        { style: 'Heading1', runs: ['Chapter 2'] },
        { style: 'Heading2', runs: ['A section'] },
        { runs: ['The end.'] },
      ],
      { footnotes: { 1: 'Check the tide tables.' }, comments: { 1: 'Too slow?' }, withImage: true },
    )
    const r = await importManuscript({ name: 'Lighthouse draft 3.docx', mimeType: DOCX_MIME, data })
    expect(checkContent(r.content).ok).toBe(true)
    expect(r.title).toBe('The Lighthouse')
    expect(r.chapterCount).toBe(2)
    expect(blocks(r.content)).toEqual([
      'H1:The Lighthouse',
      'H1:CHAPTER ONE',
      'She ran and ran, fastslow.[1]',
      'horizontalRule',
      'Chapter one began badly, he thought.',
      'H1:Chapter 2',
      'H2:A section',
      'The end.',
      'orderedList',
    ])
    const para = (r.content as JSONContent).content?.[2]
    expect(para?.content?.map((c) => (c.marks ?? []).map((m) => m.type).join())).toEqual(['', 'bold', '', 'italic', '', 'underline', 'strike', ''])
    const joined = r.warnings.join(' ')
    expect(joined).toMatch(/Detected 2 chapters/)
    expect(joined).toMatch(/1 image was left out/)
    expect(joined).toMatch(/1 comment was left out/)
    expect(joined).toMatch(/1 footnote was kept/)
    expect(joined).toMatch(/1 scene break/)
    expect(JSON.stringify(r.content)).toContain('Check the tide tables.')
    expect(JSON.stringify(r.content)).not.toContain('Too slow?')
  })

  it('keeps Word’s Quote paragraphs as one block quote and highlighter as highlight', async () => {
    const data = await buildDocx([
      { runs: ['She read the letter aloud.'] },
      { style: 'Quote', runs: ['“Keep the light burning,”'] },
      { style: 'Quote', runs: ['the old keeper wrote.'] },
      { runs: ['It was ', { text: 'important', highlight: 'yellow' }, '.'] },
    ])
    const r = await importManuscript({ name: 'q.docx', data })
    const blocks = (r.content as { content: JSONContent[] }).content
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blockquote', 'paragraph'])
    expect(blocks[1].content?.map((p) => p.content?.[0]?.text)).toEqual(['“Keep the light burning,”', 'the old keeper wrote.'])
    expect(blocks[2].content?.[1]).toEqual({ type: 'text', text: 'important', marks: [{ type: 'highlight' }] })
  })

  it('prefers the document’s metadata title, and ignores junk metadata titles', async () => {
    const paras = [{ runs: ['Some text here.'] }]
    expect((await importManuscript({ name: 'a.docx', data: await buildDocx(paras, { coreTitle: 'Real Title' }) })).title).toBe('Real Title')
    expect((await importManuscript({ name: 'Draft 3.docx', data: await buildDocx(paras, { coreTitle: 'Microsoft Word - Doc1' }) })).title).toBe('Draft 3')
  })

  it('refuses a zip bomb that declares its size', async () => {
    const data = patchDeclaredSize(await buildDocx([{ runs: ['Hi'] }]), 'word/document.xml', 0xfffffff0)
    expect((await importError(importManuscript({ name: 'bomb.docx', data }))).code).toBe('too_large')
  })

  it('measures the real inflated size, so a zip bomb that lies about its size is stopped too', async () => {
    const bomb = await buildBombDocx(3 * 1024 * 1024)
    const lying = patchDeclaredSize(bomb, 'word/document.xml', 10)
    expect(bomb.byteLength).toBeLessThan(20 * 1024)
    expect((await importError(vetDocx(new Uint8Array(lying), 1024 * 1024))).code).toBe('too_large')
    await expect(vetDocx(new Uint8Array(lying), 4 * 1024 * 1024)).resolves.toBeTruthy()
  })

  it('reports a corrupt .docx', async () => {
    const e = await importError(importManuscript({ name: 'bad.docx', data: new TextEncoder().encode('not a zip at all').buffer }))
    expect(e.code).toBe('corrupt')
    const truncated = (await buildDocx([{ runs: ['Hello'] }])).slice(0, 200)
    expect((await importError(importManuscript({ name: 'cut.docx', data: truncated }))).code).toBe('corrupt')
  })

  it('explains password-protected or old .doc files', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]).buffer
    const e = await importError(importManuscript({ name: 'locked.docx', data: ole }))
    expect(e.code).toBe('unsupported')
    expect(e.message).toMatch(/password/)
    expect((await importError(importManuscript({ name: 'old.doc', data: ole }))).message).toMatch(/\.docx/)
  })
})

describe('importManuscript — text formats', () => {
  it('imports a Google Docs HTML export (format gdoc-html) with style-span formatting', async () => {
    const html = `<html><head><style>.c1{font-weight:700}.c2{font-style:italic}</style><title>Storm</title></head><body>
      <p class="title"><span>Storm</span></p><p><span>Chapter 1</span></p>
      <p><span>It was </span><span class="c1">loud</span><span> and </span><span class="c2">wet</span><span>.</span></p></body></html>`
    const r = await importManuscript({ name: 'Storm', mimeType: 'application/vnd.google-apps.document', data: html, format: 'gdoc-html' })
    expect(r.title).toBe('Storm')
    expect(r.chapterCount).toBe(1)
    expect(blocks(r.content)).toEqual(['H1:Storm', 'H1:Chapter 1', 'It was loud and wet.'])
  })

  it('imports plain text with one line per paragraph and typed chapters', async () => {
    const line = (s: string) => `${s} ${'and then the rain kept falling over the long grey harbour wall, '.repeat(2)}`.trim()
    const txt = ['Chapter 1', line('One'), line('Two'), '', '#', '', line('Three'), 'Chapter 2', line('Four')].join('\r\n')
    const r = await importManuscript({ name: 'book.txt', mimeType: 'text/plain', data: new TextEncoder().encode(txt).buffer })
    expect(r.title).toBe('book')
    expect(r.chapterCount).toBe(2)
    expect(blocks(r.content)).toEqual(['H1:Chapter 1', line('One'), line('Two'), 'horizontalRule', line('Three'), 'H1:Chapter 2', line('Four')])
  })

  it('imports Markdown', async () => {
    const r = await importManuscript({ name: 'novel.md', data: '# Chapter 1\n\nIt was *very* dark.\n\n* * *\n\n# Chapter 2\n\nLight.' })
    expect(r.chapterCount).toBe(2)
    expect(blocks(r.content)).toEqual(['H1:Chapter 1', 'It was very dark.', 'horizontalRule', 'H1:Chapter 2', 'Light.'])
    expect(r.wordCount).toBe(9)
  })

  it('reads a Windows-1252 text file and says so', async () => {
    const bytes = new Uint8Array([0x93, 0x48, 0x69, 0x94, 0x20, 0x73, 0x68, 0x65, 0x20, 0x73, 0x61, 0x69, 0x64, 0x2e])
    const r = await importManuscript({ name: 'old.txt', data: bytes.buffer })
    expect(blocks(r.content)).toEqual(['“Hi” she said.'])
    expect(r.warnings.join(' ')).toMatch(/Windows-1252/)
  })

  it('strips scripts from imported HTML', async () => {
    const r = await importManuscript({ name: 'page.html', data: '<p>Hi<script>alert(1)</script> <a href="javascript:alert(2)">there</a></p>' })
    expect(JSON.stringify(r.content)).not.toMatch(/alert|javascript/)
    expect(blocks(r.content)).toEqual(['Hi there'])
  })
})

describe('importManuscript — limits and errors', () => {
  it('rejects files over the size limit', async () => {
    const big = new ArrayBuffer(MAX_IMPORT_BYTES + 1)
    expect((await importError(importManuscript({ name: 'huge.txt', data: big }))).code).toBe('too_large')
    expect((await importError(importManuscript({ name: 'huge.md', data: 'x'.repeat(MAX_IMPORT_BYTES + 1) }))).code).toBe('too_large')
  })

  it('rejects empty files and files with no words', async () => {
    expect((await importError(importManuscript({ name: 'e.txt', data: new ArrayBuffer(0) }))).code).toBe('empty')
    expect((await importError(importManuscript({ name: 'blank.txt', data: '\n\n   \n' }))).code).toBe('empty')
    expect((await importError(importManuscript({ name: 'breaks.md', data: '***\n\n---\n' }))).code).toBe('empty')
    expect((await importError(importManuscript({ name: 'empty.docx', data: await buildDocx([{ runs: [''] }]) }))).code).toBe('empty')
  })

  it('names unsupported formats', async () => {
    const e = await importError(importManuscript({ name: 'book.pdf', data: new TextEncoder().encode('%PDF-1.7').buffer }))
    expect(e.code).toBe('unsupported')
    expect((await importError(importManuscript({ name: 'noext', data: new Uint8Array([0, 1, 2, 0]).buffer }))).code).toBe('unsupported')
  })

  it('sniffs HTML and docx without an extension', async () => {
    expect(blocks((await importManuscript({ name: 'download', data: '<!doctype html><p>Hello</p>' })).content)).toEqual(['Hello'])
    const docx = await buildDocx([{ runs: ['From Drive'] }])
    expect(blocks((await importManuscript({ name: 'download', data: docx })).content)).toEqual(['From Drive'])
  })
})

describe('importManuscript — Word fidelity', () => {
  const chapters = [
    { runs: ['It began.'] },
    { style: 'Heading1' as const, runs: [] },
    { runs: ['First chapter text.'] },
    { style: 'Heading1' as const, runs: ['The Storm'] },
    { runs: ['Second chapter text.'] },
  ]

  it('keeps automatic "Chapter %1" heading numbers, including on an untitled numbered heading', async () => {
    for (const linkStyle of [true, false]) {
      const paras = linkStyle ? chapters : chapters.map((p) => (p.style ? { ...p, numbered: true } : p))
      const data = await buildDocx(paras, { headingNumbering: { lvlText: 'Chapter %1', linkStyle } })
      const r = await importManuscript({ name: 'Book.docx', data })
      expect(blocks(r.content)).toEqual(['It began.', 'H1:Chapter 1', 'First chapter text.', 'H1:Chapter 2 The Storm', 'Second chapter text.'])
      expect(r.chapterCount).toBe(2)
      expect(r.warnings.join(' ')).toMatch(/2 headings used Word’s automatic numbering/)
    }
  })

  it('formats heading numbers as Word shows them (Roman, words, start value)', async () => {
    const data = await buildDocx(chapters, { headingNumbering: { lvlText: 'Part %1', numFmt: 'upperRoman', start: 3, linkStyle: true } })
    expect(blocks((await importManuscript({ name: 'Book.docx', data })).content)).toContain('H1:Part IV The Storm')
    const words = await buildDocx(chapters, { headingNumbering: { lvlText: 'Chapter %1', numFmt: 'cardinalText', linkStyle: true } })
    expect(blocks((await importManuscript({ name: 'Book.docx', data: words })).content)).toContain('H1:Chapter One')
  })

  it('leaves numbered body lists alone', async () => {
    const data = await buildDocx([{ runs: ['Buy milk'], numbered: true }, { runs: ['Text.'] }], { headingNumbering: { lvlText: '%1.' } })
    const r = await importManuscript({ name: 'List.docx', data })
    expect(blocks(r.content)).toEqual(['orderedList', 'Text.'])
    expect(r.warnings.join(' ')).not.toMatch(/automatic numbering/)
  })

  it('recognises "Chapter 4" + Shift-Enter + title in one paragraph', async () => {
    const data = await buildDocx([{ runs: ['Chapter 4', '\n', 'The Calm'] }, { runs: ['Quiet.'] }, { runs: ['Chapter Two: The Storm'] }, { runs: ['Loud.'] }])
    const r = await importManuscript({ name: 'Book.docx', data })
    expect(blocks(r.content)).toEqual(['H1:Chapter 4\nThe Calm', 'Quiet.', 'H1:Chapter Two: The Storm', 'Loud.'])
    expect(r.chapterCount).toBe(2)
  })

  it('keeps typed double spaces and tabs inside paragraphs', async () => {
    const data = await buildDocx([{ runs: ['\t', 'She said <hi> & left.  Two spaces.', '\t', 'after tab'] }])
    expect(blocks((await importManuscript({ name: 'Letter.docx', data })).content)).toEqual(['She said <hi> & left.  Two spaces.\tafter tab'])
  })

  it('names the manuscript from its visible Title, not a stale document property', async () => {
    const data = await buildDocx([{ style: 'Title', runs: ['My New Book'] }, { runs: ['Chapter 1'] }, { runs: ['Text.'] }], {
      coreTitle: 'Old Book From Last Year',
    })
    const r = await importManuscript({ name: 'Copy of old.docx', data })
    expect(r.title).toBe('My New Book')
    expect(r.chapterCount).toBe(1)
  })

  it('measures a main document hidden under a non-.xml name (zip-bomb guard)', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file(
      '_rels/.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.bin"/></Relationships>',
    )
    zip.file('word/dummy.xml', '<x/>')
    zip.file('word/document.bin', ' '.repeat(3 * 1024 * 1024))
    const bytes = new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }))
    expect((await importError(vetDocx(bytes, 1024 * 1024))).code).toBe('too_large')
    // Even disguised as a picture, the part the relationships name as the document is measured.
    const img = new JSZip()
    img.file('[Content_Types].xml', '<Types/>')
    img.file('_rels/.rels', (await zip.file('_rels/.rels')!.async('string')).replace('word/document.bin', 'word/media/image1.png'))
    img.file('word/dummy.xml', '<x/>')
    img.file('word/media/image1.png', ' '.repeat(3 * 1024 * 1024))
    const imgBytes = new Uint8Array(await img.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }))
    expect((await importError(vetDocx(imgBytes, 1024 * 1024))).code).toBe('too_large')
  })

  it('resolves the parts mammoth reads from the relationships', async () => {
    const pkg = await vetDocx(new Uint8Array(await buildDocx([{ runs: ['Hi'] }], { footnotes: { 1: 'x' }, headingNumbering: { lvlText: '%1' } })))
    expect(pkg.parts).toEqual({
      document: 'word/document.xml',
      related: { styles: 'word/styles.xml', numbering: 'word/numbering.xml', footnotes: 'word/footnotes.xml' },
    })
  })
})

describe('importManuscript — Markdown and text titles', () => {
  it('takes a Markdown book title from a leading H1 and does not count it as a chapter', async () => {
    const r = await importManuscript({
      name: 'draft3-final.md',
      data: '# The Lighthouse Keeper\n\n# Chapter 1\n\nOne.\n\n# Chapter 2\n\nTwo.\n\n# Chapter 3\n\nThree.',
    })
    expect(r.title).toBe('The Lighthouse Keeper')
    expect(r.chapterCount).toBe(3)
  })

  it('prefers Markdown front matter for the title and notes that the metadata was left out', async () => {
    const r = await importManuscript({ name: 'x.md', data: '---\ntitle: Orchard\n---\n# The Orchard\n\n# Chapter 1\n\nText.' })
    expect(r.title).toBe('Orchard')
    expect(r.chapterCount).toBe(1)
    expect(r.warnings.join(' ')).toMatch(/metadata block/)
  })

  it('takes a plain-text title from a short first line above the chapters', async () => {
    const r = await importManuscript({ name: 'draft3.txt', data: 'THE ORCHARD\nby Jane Doe\n\nChapter 1\nOne.\n\nChapter 2\nTwo.\n\nChapter 3\nThree.' })
    expect(r.title).toBe('THE ORCHARD')
    expect(r.chapterCount).toBe(3)
  })

  it('keeps the file name when the first line is prose', async () => {
    const r = await importManuscript({ name: 'notes.md', data: '# Chapter 1\n\nText.' })
    expect(r.title).toBe('notes')
    const t = await importManuscript({ name: 'story.txt', data: 'It was late.\n\nChapter 1\nText.' })
    expect(t.title).toBe('story')
  })

  it('notes when hard-wrapped lines were joined into paragraphs', async () => {
    const src = [
      'It was a bright cold day in April, and the clocks were striking',
      'thirteen. Winston Smith, his chin nuzzled into his breast in an',
      'effort to escape the vile wind, slipped quickly.',
    ].join('\n')
    const r = await importManuscript({ name: 'wrapped.txt', data: src })
    expect(blocks(r.content)).toHaveLength(1)
    expect(r.warnings.join(' ')).toMatch(/wrapped at about 63 characters/)
  })
})

describe('importManuscript — odd inputs', () => {
  it('imports <br><br>-separated HTML as paragraphs with chapters and scene breaks', async () => {
    const r = await importManuscript({
      name: 'old.html',
      data: '<body>Chapter 1<br><br>She ran.<br><br>* * *<br><br>He stayed.<br><br>Chapter 2<br><br>End.</body>',
    })
    expect(blocks(r.content)).toEqual(['H1:Chapter 1', 'She ran.', 'horizontalRule', 'He stayed.', 'H1:Chapter 2', 'End.'])
    expect(r.chapterCount).toBe(2)
  })

  it('refuses a Google Drive for desktop ".gdoc" shortcut and points to the Drive import', async () => {
    const shortcut = '{"doc_id":"1AbC","email":"a@b.com","resource_key":""}'
    for (const src of [
      { name: 'My Novel.gdoc', data: shortcut },
      { name: 'My Novel', mimeType: 'application/vnd.google-apps.document', data: new TextEncoder().encode(shortcut).buffer },
    ]) {
      const e = await importError(importManuscript(src))
      expect(e.code).toBe('unsupported')
      expect(e.message).toMatch(/shortcut to a Google Doc.*Import from Google Drive/)
    }
  })

  it('never says a file over the limit is the size of the limit', () => {
    expect(formatMB(25.3 * 1024 * 1024)).toBe('25.3 MB')
    expect(formatMB(MAX_IMPORT_BYTES)).toBe('25 MB')
    expect(formatMB(MAX_IMPORT_BYTES + 1)).toBe('25.1 MB')
    expect(tooLargeMessage('Novel.docx', 25.3 * 1024 * 1024)).toMatch(/is 25\.3 MB; the largest file Thunder Writer can import is 25 MB/)
  })
})
