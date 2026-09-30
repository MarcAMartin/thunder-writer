import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  createStore: vi.fn(() => ({})),
  get: vi.fn(async (k: string) => store.get(k)),
  set: vi.fn(async (k: string, v: unknown) => {
    store.set(k, v)
  }),
}))

import { CONTEXT_FILES_IDB_KEY, CONTEXT_FILES_MAX_TOTAL_CHARS } from './constants'
import { addContextFile, extractText, isSupportedContextFile, loadContextFiles, rtfToText, saveContextFiles } from './contextFiles'

beforeEach(() => store.clear())

describe('context file parsing', () => {
  it('accepts only formats we can read in the browser', () => {
    expect(isSupportedContextFile('poem.TXT')).toBe(true)
    expect(isSupportedContextFile('notes.markdown')).toBe(true)
    expect(isSupportedContextFile('novel.docx')).toBe(false)
    expect(isSupportedContextFile('README')).toBe(false)
  })

  it('extracts text from HTML without scripts', () => {
    const text = extractText('a.html', '<html><body><p>Hello</p><script>alert(1)</script><p>World</p></body></html>')
    expect(text).toContain('Hello')
    expect(text).toContain('World')
    expect(text).not.toContain('alert')
  })

  it('strips RTF control words', () => {
    const text = rtfToText('{\\rtf1\\ansi{\\fonttbl{\\f0 Times;}}\\f0\\fs24 Hello \\b bold \\b0 world.\\par Next\\u8217?s line}')
    expect(text).toContain('Hello bold world.')
    expect(text).toContain('Next’s line')
    expect(text).not.toContain('Times')
  })
})

describe('addContextFile', () => {
  it('adds a supported file', async () => {
    const r = await addContextFile([], new File(['Once upon a time.'], 'story.md'), 7)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.files[0]).toMatchObject({ name: 'story.md', text: 'Once upon a time.', addedAt: 7 })
  })

  it('rejects unsupported formats with a helpful message', async () => {
    const r = await addContextFile([], new File(['x'], 'book.docx'))
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.error).toMatch(/save a copy as \.txt/)
  })

  it('rejects empty files', async () => {
    const r = await addContextFile([], new File(['   '], 'blank.txt'))
    expect(r.ok).toBe(false)
  })

  it('enforces the total size cap with a clear message', async () => {
    const existing = [{ id: '1', name: 'big.txt', text: 'a'.repeat(CONTEXT_FILES_MAX_TOTAL_CHARS - 5), addedAt: 0 }]
    const r = await addContextFile(existing, new File(['more than five chars'], 'more.txt'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/limited to/)
  })
})

describe('persistence', () => {
  it('round-trips through IndexedDB and ignores corrupt data', async () => {
    const files = [{ id: '1', name: 'a.txt', text: 'hi', addedAt: 1 }]
    await saveContextFiles(files)
    expect(await loadContextFiles()).toEqual(files)
    store.set(CONTEXT_FILES_IDB_KEY, [{ nope: true }])
    expect(await loadContextFiles()).toEqual([])
  })
})
