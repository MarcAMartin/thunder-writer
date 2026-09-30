import { describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { ENCODING_WARNING } from '../import/decode'
import { importManuscript } from '../import/importManuscript'
import { MAX_IMPORT_BYTES, tooLargeMessage } from '../import/limits'
import { blockText } from '../import/structure'
import { ImportError, type ImportResult, type ImportSource } from '../import/types'
import { DRIVE_API, DriveClient, DriveError } from './drive'
import {
  CANT_OPEN_MESSAGE,
  downloadKind,
  downloadPickedFile,
  EXPORT_TOO_LARGE_MESSAGE,
  importPickedFile,
} from './driveImport'
import { DOCX_MIME, GDOC_MIME, type PickedFile } from './picker'
import { makeEnvelope } from './schema'
import { makeDoc } from './testDocs'

type Call = { url: string; init: RequestInit }

const googleError = (status: number, reason: string) =>
  new Response(JSON.stringify({ error: { message: reason, errors: [{ reason }] } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

function setup(respond: (c: Call) => Response) {
  const calls: Call[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const c = { url, init }
    calls.push(c)
    return respond(c)
  })
  const getToken = vi.fn(async ({ forceRefresh }: { forceRefresh: boolean }) => (forceRefresh ? 'fresh' : 'stale'))
  return { client: new DriveClient({ fetch, getToken }), calls, getToken }
}

const gdoc: PickedFile = { id: 'G/1', name: 'My Novel', mimeType: GDOC_MIME }
const docx: PickedFile = { id: 'D1', name: 'Draft 3.docx', mimeType: DOCX_MIME }
const md: PickedFile = { id: 'M1', name: 'notes.md', mimeType: 'text/markdown' }

const RESULT: ImportResult = { title: 'My Novel', content: { type: 'doc' }, wordCount: 3, chapterCount: 1, warnings: [] }

describe('downloadKind', () => {
  it('classifies picked files', () => {
    expect(downloadKind(gdoc)).toBe('gdoc')
    expect(downloadKind(docx)).toBe('binary')
    expect(downloadKind({ name: 'x.docx', mimeType: 'application/octet-stream' })).toBe('binary')
    expect(downloadKind(md)).toBe('text')
    expect(downloadKind({ name: 'a.md', mimeType: 'application/octet-stream' })).toBe('text')
    expect(downloadKind({ name: 'a.txt', mimeType: 'text/plain' })).toBe('text')
    expect(downloadKind({ name: 'a.html', mimeType: 'text/html' })).toBe('text')
    expect(downloadKind({ name: 'Book.thunder.json', mimeType: 'application/json' })).toBe('thunder')
    expect(downloadKind({ name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet' })).toBeNull()
    expect(downloadKind({ name: 'photo.png', mimeType: 'image/png' })).toBeNull()
  })
})

describe('downloadPickedFile', () => {
  it('exports a Google Doc as HTML (read-only GET) and marks the format', async () => {
    const d = setup(() => new Response('<p>Hello</p>', { status: 200 }))
    const src = await downloadPickedFile(d.client, gdoc)
    expect(d.calls).toHaveLength(1)
    expect(d.calls[0].url).toBe(`${DRIVE_API}/G%2F1/export?mimeType=text%2Fhtml`)
    expect(d.calls[0].init.method ?? 'GET').toBe('GET')
    expect(new Headers(d.calls[0].init.headers).get('Authorization')).toBe('Bearer stale')
    expect(src).toEqual({ name: 'My Novel', mimeType: 'text/html', data: '<p>Hello</p>', format: 'gdoc-html' })
  })

  it('downloads a .docx with alt=media as an ArrayBuffer', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4])
    const d = setup(() => new Response(bytes, { status: 200 }))
    const src = await downloadPickedFile(d.client, docx)
    expect(d.calls[0].url).toBe(`${DRIVE_API}/D1?alt=media&supportsAllDrives=true`)
    expect(src.data).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(src.data as ArrayBuffer)).toEqual(bytes)
    expect(src).toMatchObject({ name: 'Draft 3.docx', mimeType: DOCX_MIME })
    expect(src.format).toBeUndefined()
  })

  it('downloads text types with alt=media as bytes, for the importer to decode', async () => {
    const d = setup(() => new Response('# Chapter One', { status: 200 }))
    const src = await downloadPickedFile(d.client, md)
    expect(d.calls[0].url).toBe(`${DRIVE_API}/M1?alt=media&supportsAllDrives=true`)
    expect(src).toMatchObject({ name: 'notes.md', mimeType: 'text/markdown' })
    expect(src.data).toBeInstanceOf(ArrayBuffer)
    expect(new TextDecoder().decode(src.data as ArrayBuffer)).toBe('# Chapter One')
  })

  it('keeps legacy encodings intact: a Windows-1252 .txt from Drive imports with its curly quotes and a note', async () => {
    // “hi” café, saved by an old Word "Save as Plain Text" (Windows-1252).
    const cp1252 = new Uint8Array([0x93, 0x68, 0x69, 0x94, 0x20, 0x63, 0x61, 0x66, 0xe9])
    const d = setup(() => new Response(cp1252, { status: 200, headers: { 'Content-Type': 'text/plain; charset=windows-1252' } }))
    const src = await downloadPickedFile(d.client, { id: 'T', name: 'Old draft.txt', mimeType: 'text/plain' })
    const r = await importManuscript(src)
    expect(blockText((r.content as JSONContent).content![0])).toBe('“hi” café')
    expect(r.warnings).toContain(ENCODING_WARNING)
  })

  it('reads a UTF-16 (Notepad "Unicode") Markdown file from Drive without stray characters', async () => {
    const text = '# Chapter 1\n\nHi there.'
    const utf16 = new Uint8Array(2 + text.length * 2)
    utf16.set([0xff, 0xfe])
    for (let i = 0; i < text.length; i++) utf16[2 + i * 2] = text.charCodeAt(i)
    const d = setup(() => new Response(utf16, { status: 200 }))
    const src = await downloadPickedFile(d.client, md)
    const r = await importManuscript(src)
    const blocks = (r.content as JSONContent).content!
    expect(blocks.map((b) => blockText(b))).toEqual(['Chapter 1', 'Hi there.'])
    expect(JSON.stringify(r.content)).not.toContain('hardBreak')
  })

  it('stops a download that turns out larger than the import limit, even without a size from the Picker', async () => {
    const big = new Uint8Array(MAX_IMPORT_BYTES + 10)
    const d = setup(() => new Response(big, { status: 200 }))
    const err = await downloadPickedFile(d.client, docx).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ImportError)
    expect((err as ImportError).code).toBe('too_large')
    expect((err as ImportError).message).toMatch(/largest file Thunder Writer can import is 25 MB/)
  })

  it('refuses a download whose Content-Length is over the limit before reading it', async () => {
    const d = setup(() => new Response('x', { status: 200, headers: { 'Content-Length': String(40 * 1024 * 1024) } }))
    const err = (await downloadPickedFile(d.client, md).catch((e: unknown) => e)) as ImportError
    expect(err.code).toBe('too_large')
    expect(err.message).toBe(tooLargeMessage('notes.md', 40 * 1024 * 1024))
  })

  it('refuses unsupported and oversized files without downloading', async () => {
    const d = setup(() => new Response('x'))
    const sheet = await downloadPickedFile(d.client, { id: 'S', name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet' }).catch(
      (e: unknown) => e,
    )
    expect(sheet).toBeInstanceOf(ImportError)
    expect((sheet as ImportError).code).toBe('unsupported')
    const big = await downloadPickedFile(d.client, { ...docx, sizeBytes: 200 * 1024 * 1024 }).catch((e: unknown) => e)
    expect((big as ImportError).code).toBe('too_large')
    expect(d.calls).toHaveLength(0)
  })

  it('maps a too-large Google Doc export to advice to download it as .docx', async () => {
    const d = setup(() => googleError(403, 'exportSizeLimitExceeded'))
    const err = (await downloadPickedFile(d.client, gdoc).catch((e: unknown) => e)) as DriveError
    expect(err).toBeInstanceOf(DriveError)
    expect(err.message).toBe(EXPORT_TOO_LARGE_MESSAGE)
    expect(err.message).toMatch(/File › Download › Microsoft Word \(\.docx\)/)
  })

  it('maps 403 and 404 to "pick it again"', async () => {
    for (const [status, reason] of [
      [403, 'insufficientFilePermissions'],
      [404, 'notFound'],
    ] as const) {
      const d = setup(() => googleError(status, reason))
      const err = (await downloadPickedFile(d.client, docx).catch((e: unknown) => e)) as DriveError
      expect(err.message).toBe(CANT_OPEN_MESSAGE)
      expect(err.needsReconnect).toBe(false)
    }
  })

  it('retries a 401 with a fresh token, then asks to reconnect', async () => {
    const d = setup(() => googleError(401, 'authError'))
    const err = (await downloadPickedFile(d.client, docx).catch((e: unknown) => e)) as DriveError
    expect(d.getToken.mock.calls.map((c) => c[0].forceRefresh)).toEqual([false, true])
    expect(err.code).toBe('auth')
    expect(err.needsReconnect).toBe(true)
    expect(err.message).toMatch(/Reconnect Google Drive/)
  })

  it('keeps rate limiting as a retryable error rather than "pick it again"', async () => {
    const d = setup(() => googleError(403, 'userRateLimitExceeded'))
    const err = (await downloadPickedFile(d.client, docx).catch((e: unknown) => e)) as DriveError
    expect(err.code).toBe('rate_limited')
  })
})

describe('importPickedFile', () => {
  it('hands the downloaded bytes to importManuscript and never writes to Drive', async () => {
    const d = setup(() => new Response('<h1>One</h1>', { status: 200 }))
    const importManuscript = vi.fn(async (_s: ImportSource) => RESULT)
    const out = await importPickedFile(gdoc, { client: d.client, importManuscript })
    expect(importManuscript).toHaveBeenCalledWith({ name: 'My Novel', mimeType: 'text/html', data: '<h1>One</h1>', format: 'gdoc-html' })
    expect(out).toEqual({ kind: 'manuscript', file: gdoc, result: RESULT })
    expect(d.calls.every((c) => (c.init.method ?? 'GET') === 'GET')).toBe(true)
  })

  it('passes importer errors through', async () => {
    const d = setup(() => new Response('', { status: 200 }))
    const importManuscript = vi.fn(async () => {
      throw new ImportError('empty', 'That file has no text in it.')
    })
    const err = await importPickedFile(md, { client: d.client, importManuscript }).catch((e: unknown) => e)
    expect((err as ImportError).message).toBe('That file has no text in it.')
  })

  it('opens a .thunder.json file as a Thunder Writer manuscript without the importer', async () => {
    const doc = makeDoc({ id: 'x', title: 'Backup' })
    const d = setup(() => new Response(JSON.stringify(makeEnvelope(doc, 1)), { status: 200 }))
    const importManuscript = vi.fn()
    const file = { id: 'T1', name: 'Backup.thunder.json', mimeType: 'application/json' }
    const out = await importPickedFile(file, { client: d.client, importManuscript })
    expect(d.calls[0].url).toBe(`${DRIVE_API}/T1?alt=media&supportsAllDrives=true`)
    expect(out).toEqual({ kind: 'thunder', file, doc })
    expect(importManuscript).not.toHaveBeenCalled()

    const bad = setup(() => new Response(JSON.stringify({ hello: 1 }), { status: 200 }))
    const err = await importPickedFile(file, { client: bad.client, importManuscript }).catch((e: unknown) => e)
    expect((err as DriveError).code).toBe('invalid_file')
  })
})
