import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportFileName, sanitizeBaseName } from './filename'
import { describeSaveResult, saveToComputer, withExtension } from './saveToComputer'

type Win = { showSaveFilePicker?: unknown }

function fakeHandle(name = 'My Novel.docx') {
  const writable = {
    write: vi.fn(async (_b: Blob) => undefined),
    close: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
  }
  const handle = { kind: 'file', name, createWritable: vi.fn(async () => writable) } as unknown as FileSystemFileHandle
  return { handle, writable }
}

const abort = () => new DOMException('The user aborted a request.', 'AbortError')

afterEach(() => {
  delete (window as Win).showSaveFilePicker
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('file names', () => {
  it('sanitizes titles for Windows and macOS', () => {
    expect(sanitizeBaseName('My Novel')).toBe('My Novel')
    expect(sanitizeBaseName('What? Now: "A/B" <draft>*|\\')).toBe('What Now A B draft')
    expect(sanitizeBaseName('  ..hidden. ')).toBe('hidden')
    expect(sanitizeBaseName('tab\tnew\nline')).toBe('tab new line')
    expect(sanitizeBaseName('CON')).toBe('CON manuscript')
    expect(sanitizeBaseName('')).toBe('Untitled Manuscript')
    expect(sanitizeBaseName('???')).toBe('Untitled Manuscript')
    expect(sanitizeBaseName('x'.repeat(300))).toHaveLength(120)
    expect(sanitizeBaseName('Café — “Rêve”')).toBe('Café — “Rêve”')
  })

  it('adds the right extension once', () => {
    expect(exportFileName('My Novel', 'docx')).toBe('My Novel.docx')
    expect(exportFileName('My Novel', 'thunder')).toBe('My Novel.thunder.json')
    expect(withExtension('My Novel.docx', 'docx')).toBe('My Novel.docx')
    expect(withExtension('My Novel.thunder.json', 'thunder')).toBe('My Novel.thunder.json')
    expect(withExtension('Draft: 2', 'md')).toBe('Draft 2.md')
  })
})

describe('saveToComputer — native Save dialog (Chrome/Edge)', () => {
  it('opens on the Desktop with the suggested name and type, then writes the file', async () => {
    const { handle, writable } = fakeHandle()
    const picker = vi.fn(async (_opts: unknown) => handle)
    ;(window as Win).showSaveFilePicker = picker
    const build = vi.fn(async () => new Blob(['hello'], { type: 'text/plain' }))

    const r = await saveToComputer(build, 'My: Novel', 'docx')

    expect(picker).toHaveBeenCalledTimes(1)
    const opts = picker.mock.calls[0][0] as Record<string, unknown>
    expect(opts.startIn).toBe('desktop')
    expect(opts.suggestedName).toBe('My Novel.docx')
    expect(opts.types).toEqual([
      {
        description: 'Word document (.docx)',
        accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] },
      },
    ])
    // The dialog opens before the file is built (the click's permission is not wasted on a slow export).
    expect(picker.mock.invocationCallOrder[0]).toBeLessThan(build.mock.invocationCallOrder[0])
    expect(writable.write).toHaveBeenCalledWith(await build.mock.results[0].value)
    expect(writable.close).toHaveBeenCalled()
    expect(r).toEqual({ status: 'saved', fileName: 'My Novel.docx', handle })
    expect(describeSaveResult(r)).toBe('Saved “My Novel.docx” to your computer.')
  })

  it('calls the picker synchronously, inside the click', () => {
    const picker = vi.fn(() => new Promise<never>(() => undefined))
    ;(window as Win).showSaveFilePicker = picker
    void saveToComputer(new Blob(['x']), 'A', 'txt')
    expect(picker).toHaveBeenCalledTimes(1)
  })

  it('treats a cancelled dialog as a silent no-op', async () => {
    ;(window as Win).showSaveFilePicker = vi.fn(async () => {
      throw abort()
    })
    const build = vi.fn(async () => new Blob(['x']))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    expect(await saveToComputer(build, 'A', 'md')).toEqual({ status: 'cancelled' })
    expect(build).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
  })

  it('aborts the write stream when writing fails', async () => {
    const { handle, writable } = fakeHandle()
    writable.write.mockRejectedValueOnce(new DOMException('disk full', 'QuotaExceededError'))
    ;(window as Win).showSaveFilePicker = vi.fn(async () => handle)
    await expect(saveToComputer(new Blob(['x']), 'A', 'txt')).rejects.toThrow('disk full')
    expect(writable.abort).toHaveBeenCalled()
  })

  it('falls back to a download when the dialog is blocked', async () => {
    ;(window as Win).showSaveFilePicker = vi.fn(async () => {
      throw new DOMException('Must be handling a user gesture', 'SecurityError')
    })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    expect(await saveToComputer(new Blob(['x']), 'A', 'txt')).toEqual({ status: 'downloaded', fileName: 'A.txt' })
    expect(click).toHaveBeenCalledTimes(1)
  })
})

describe('saveToComputer — download fallback (Firefox, Safari)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:thunder')
    URL.revokeObjectURL = vi.fn()
  })

  it('downloads through a temporary link and revokes the URL afterwards', async () => {
    vi.useFakeTimers()
    let seen: HTMLAnchorElement | null = null
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      seen = this
      expect(document.body.contains(this)).toBe(true)
    })
    const blob = new Blob(['# hi'], { type: 'text/markdown' })
    const r = await saveToComputer(blob, 'The Long Storm', 'md')

    expect(click).toHaveBeenCalledTimes(1)
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(seen!.download).toBe('The Long Storm.md')
    expect(seen!.getAttribute('href')).toBe('blob:thunder')
    expect(document.body.contains(seen!)).toBe(false)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thunder')

    expect(r).toEqual({ status: 'downloaded', fileName: 'The Long Storm.md' })
    expect(describeSaveResult(r)).toContain('Downloads folder')
    expect(describeSaveResult(r)).toContain('Ask where to save')
  })

  it('builds lazy blobs before downloading', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const build = vi.fn(async () => new Blob(['x']))
    await saveToComputer(build, 'A', 'thunder')
    expect(build).toHaveBeenCalledTimes(1)
  })
})
