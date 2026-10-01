import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FORMAT, useDocuments } from '../../store/documents'
import type { ThunderDoc } from '../../types'
import { makeDoc } from '../storage/testDocs'

const copy = vi.hoisted(() => ({
  linkedTo: null as null | { docId: string; fileModifiedAt: number | null; lastWrittenAt?: number | null },
  links: [] as { docId: string; kind: string; fileModifiedAt: number }[],
  accepted: [] as [string, number, number][],
  held: [] as [string, string][],
  handle: null as FileSystemFileHandle | null,
  keep: 'written' as 'written' | 'denied' | 'failed',
}))
vi.mock('../export/desktopCopy', async (importActual) => ({
  CHANGED_SLACK_MS: 2000,
  // The real rule for "changed elsewhere".
  changedSince: (await importActual<typeof import('../export/desktopCopy')>()).changedSince,
  findDocForFile: vi.fn(async () => copy.linkedTo),
  linkDesktopCopy: vi.fn(async (docId: string, _h: unknown, kind: string, fileModifiedAt: number) => void copy.links.push({ docId, kind, fileModifiedAt })),
  restoreDesktopCopy: vi.fn(async () => undefined),
  holdForChoice: vi.fn(async (docId: string, f: File) => void copy.held.push([docId, f.name])),
  acceptFileVersion: vi.fn((docId: string, mtime: number, updatedAt: number) => void copy.accepted.push([docId, mtime, updatedAt])),
  keepBrowserVersionInFile: vi.fn(async () => copy.keep),
  getDesktopCopyHandle: vi.fn(() => copy.handle),
  getDesktopCopyStatus: vi.fn(() => undefined),
}))
const kept = vi.hoisted(() => ({ files: [] as string[], docs: [] as [string, string][], fileOk: true }))
vi.mock('../backups/backups', () => ({
  backUpOriginalFile: vi.fn(async (_d: ThunderDoc, f: File) => {
    if (kept.fileOk) kept.files.push(f.name)
    return kept.fileOk
  }),
  safetyBackup: vi.fn(async (d: ThunderDoc | undefined, reason: string) => {
    if (d) kept.docs.push([d.id, reason])
    return true
  }),
}))

const { openFromComputer, keepSavingToFile, loadFileVersion, keepBrowserVersion, saveBackKind } = await import('./openFromComputer')
const { useImportFlow } = await import('./importFlow')

const para = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

/** A file on the computer, as Chrome's File System Access API hands it over. */
function fakeHandle(file: File, permission: PermissionState = 'granted') {
  return {
    kind: 'file',
    name: file.name,
    getFile: vi.fn(async () => file),
    requestPermission: vi.fn(async () => permission),
    queryPermission: vi.fn(async () => permission),
    isSameEntry: vi.fn(async () => false),
  } as unknown as FileSystemFileHandle
}

function withPickers(handle: FileSystemFileHandle | Error) {
  const open = vi.fn(async () => {
    if (handle instanceof Error) throw handle
    return [handle]
  })
  vi.stubGlobal('showOpenFilePicker', open)
  vi.stubGlobal('showSaveFilePicker', vi.fn())
  return open
}

const phase = () => useImportFlow.getState().phase

beforeEach(() => {
  copy.linkedTo = null
  copy.links.length = 0
  copy.accepted.length = 0
  copy.held.length = 0
  copy.handle = null
  copy.keep = 'written'
  kept.files.length = 0
  kept.docs.length = 0
  kept.fileOk = true
  useImportFlow.setState({ phase: { kind: 'idle' }, prompt: false, notice: null })
  useDocuments.setState({ docs: {}, currentId: null, hydrated: true, dirtyForDrive: {} })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('saveBackKind', () => {
  it('saves back into Word, Markdown, text and Thunder Writer files, never into HTML or a .bak', () => {
    expect(saveBackKind('Novel.docx')).toBe('docx')
    expect(saveBackKind('Novel.md')).toBe('md')
    expect(saveBackKind('notes.markdown')).toBe('md')
    expect(saveBackKind('Novel.TXT')).toBe('txt')
    expect(saveBackKind('Novel.thunder.json')).toBe('thunder')
    expect(saveBackKind('Novel.html')).toBeNull()
    expect(saveBackKind('Novel.thunder.json.bak')).toBeNull()
  })
})

describe('Open from computer (Chrome and Edge)', () => {
  it('opens a Markdown file from the native picker and offers to keep saving into it', async () => {
    const file = new File(['# Chapter One\n\nIt began to rain.'], 'Storm.md', { type: 'text/markdown', lastModified: 1_000 })
    const handle = fakeHandle(file)
    const open = withPickers(handle)
    await openFromComputer()
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'thunder-writer-open', multiple: false }))
    const p = phase()
    expect(p.kind).toBe('done')
    if (p.kind !== 'done') return
    expect(p.result.wordCount).toBeGreaterThan(0)
    expect(p.opened?.file).toMatchObject({ kind: 'md', file })
    expect(useDocuments.getState().currentId).toBe(p.docId)
    // Nothing is written until the writer says so.
    expect(copy.links).toEqual([])
  })

  it('"Keep saving": asks the browser first, keeps the file as it is in Backups, then links it', async () => {
    const file = new File(['Hello.'], 'Storm.txt', { type: 'text/plain', lastModified: 5_000 })
    const handle = fakeHandle(file)
    withPickers(handle)
    await openFromComputer()
    const p = phase()
    if (p.kind !== 'done' || !p.opened?.file) throw new Error('expected an offer to save back')
    await expect(keepSavingToFile(p.docId, p.opened.file)).resolves.toBe('linked')
    expect((handle as unknown as { requestPermission: ReturnType<typeof vi.fn> }).requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(kept.files).toEqual(['Storm.txt'])
    expect(copy.links).toEqual([{ docId: p.docId, kind: 'txt', fileModifiedAt: 5_000 }])
  })

  it('doesn’t link when the browser says no, or when the original couldn’t be kept and the writer stops', async () => {
    const file = new File(['Hello.'], 'Storm.txt', { type: 'text/plain' })
    withPickers(fakeHandle(file, 'denied'))
    await openFromComputer()
    let p = phase()
    if (p.kind !== 'done' || !p.opened?.file) throw new Error('expected an offer')
    await expect(keepSavingToFile(p.docId, p.opened.file)).resolves.toBe('denied')
    expect(kept.files).toEqual([])

    withPickers(fakeHandle(file))
    await openFromComputer()
    p = phase()
    if (p.kind !== 'done' || !p.opened?.file) throw new Error('expected an offer')
    kept.fileOk = false
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await expect(keepSavingToFile(p.docId, p.opened.file)).resolves.toBe('cancelled')
    expect(copy.links).toEqual([])
  })

  it('opens HTML and .bak files without offering to save into them', async () => {
    withPickers(fakeHandle(new File(['<p>Hi there.</p>'], 'Page.html', { type: 'text/html' })))
    await openFromComputer()
    expect(phase()).toMatchObject({ kind: 'done', opened: { file: null } })
  })

  it('a Thunder Writer file replaces this browser’s other version only after asking, keeping it in Backups', async () => {
    const mine = makeDoc({ id: 'a', title: 'Storm', content: para('Browser words.'), updatedAt: 10 })
    useDocuments.getState().hydrate([mine], 'a')
    const saved = { app: 'thunder-writer', version: 1, savedAt: 1, doc: { ...mine, content: para('File words.'), updatedAt: 20, driveFileId: 'F' } }
    const file = new File([JSON.stringify(saved)], 'Storm.thunder.json', { type: 'application/json' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)

    withPickers(fakeHandle(file))
    await openFromComputer()
    expect(phase().kind).toBe('idle')
    expect(useDocuments.getState().docs.a.content).toEqual(para('Browser words.'))

    await openFromComputer()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(kept.docs).toEqual([['a', 'before-import']])
    expect(useDocuments.getState().docs.a.content).toEqual(para('File words.'))
    expect(useDocuments.getState().docs.a.driveFileId).toBeUndefined()
    expect(phase()).toMatchObject({ kind: 'done', docId: 'a', opened: { file: { kind: 'thunder' } } })
  })

  it('opening a file already linked goes back to its manuscript instead of making another', async () => {
    const doc = makeDoc({ id: 'a', title: 'Storm', format: DEFAULT_FORMAT })
    useDocuments.getState().hydrate([doc, makeDoc({ id: 'b', title: 'Other' })], 'b')
    copy.linkedTo = { docId: 'a', fileModifiedAt: 10_000 }
    withPickers(fakeHandle(new File(['x'], 'Storm.docx', { lastModified: 10_500 })))
    await openFromComputer()
    expect(useDocuments.getState().currentId).toBe('a')
    expect(Object.keys(useDocuments.getState().docs)).toHaveLength(2)
    expect(phase().kind).toBe('idle')
    expect(useImportFlow.getState().notice).toMatch(/already open, and your changes save to it/)
  })

  it('a linked file changed elsewhere since the last save is held for the writer to choose (kept in Backups, saving paused)', async () => {
    useDocuments.getState().hydrate([makeDoc({ id: 'a', title: 'Storm', content: para('Browser words.') })], 'a')
    copy.linkedTo = { docId: 'a', fileModifiedAt: 10_000 }
    const file = new File(['New words from Word.'], 'Storm.txt', { type: 'text/plain', lastModified: 60_000 })
    withPickers(fakeHandle(file))
    await openFromComputer()
    expect(copy.held).toEqual([['a', 'Storm.txt']])
    expect(phase().kind).toBe('idle')
  })

  it('"Use the file’s version" reads the file again, keeps this browser’s version first, and marks them in sync', async () => {
    useDocuments.getState().hydrate([makeDoc({ id: 'a', title: 'Storm', content: para('Browser words.') })], 'a')
    const file = new File(['Newest words, saved again in Word.'], 'Storm.txt', { type: 'text/plain', lastModified: 90_000 })
    copy.handle = fakeHandle(file)
    await expect(loadFileVersion('a')).resolves.toBe('loaded')
    const d = useDocuments.getState().docs.a
    expect(JSON.stringify(d.content)).toContain('Newest words, saved again in Word.')
    expect(d.title).toBe('Storm')
    expect(kept.docs).toEqual([['a', 'before-import']])
    expect(copy.accepted).toEqual([['a', 90_000, d.updatedAt]])
    expect(useDocuments.getState().dirtyForDrive.a).toBe(true)
  })

  it('"Use the file’s version" asks again when this browser’s version couldn’t be kept, and can be called off', async () => {
    const backups = await import('../backups/backups')
    vi.mocked(backups.safetyBackup).mockResolvedValueOnce(false)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    useDocuments.getState().hydrate([makeDoc({ id: 'a', content: para('Browser words.') })], 'a')
    copy.handle = fakeHandle(new File(['File words.'], 'Storm.txt', { type: 'text/plain', lastModified: 90_000 }))
    await expect(loadFileVersion('a')).resolves.toBe('cancelled')
    expect(useDocuments.getState().docs.a.content).toEqual(para('Browser words.'))
    expect(copy.accepted).toEqual([])
  })

  it('"Keep this browser’s version" is the desktop copy writing it over the file', async () => {
    await expect(keepBrowserVersion('a')).resolves.toBe('written')
    copy.keep = 'denied'
    await expect(keepBrowserVersion('a')).resolves.toBe('denied')
  })

  it('opening an unchanged Thunder Writer file of a Drive-linked manuscript keeps its Drive link', async () => {
    const mine = makeDoc({ id: 'a', title: 'Storm', updatedAt: 20, driveFileId: 'F', driveSyncedAt: 20 })
    useDocuments.getState().hydrate([mine, makeDoc({ id: 'b' })], 'b')
    const saved = { app: 'thunder-writer', version: 1, savedAt: 1, doc: { ...mine, driveFileId: undefined } }
    withPickers(fakeHandle(new File([JSON.stringify(saved)], 'Storm.thunder.json', { type: 'application/json' })))
    await openFromComputer()
    expect(useDocuments.getState().currentId).toBe('a')
    expect(useDocuments.getState().docs.a).toBe(mine)
    expect(useDocuments.getState().docs.a.driveFileId).toBe('F')
  })

  it('cancelling the picker does nothing and puts focus back', async () => {
    withPickers(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }))
    const button = document.createElement('button')
    document.body.appendChild(button)
    await openFromComputer({ returnFocus: () => button })
    expect(phase().kind).toBe('idle')
    expect(button).toHaveFocus()
    button.remove()
  })
})
