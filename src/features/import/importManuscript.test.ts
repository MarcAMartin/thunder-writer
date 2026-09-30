import type { JSONContent } from '@tiptap/core'
import { checkContent } from '../editor/contentCheck'
import { buildBombDocx, buildDocx, patchDeclaredSize } from './__fixtures__/buildDocx'
import { importManuscript } from './importManuscript'
import { MAX_IMPORT_BYTES } from './limits'
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
