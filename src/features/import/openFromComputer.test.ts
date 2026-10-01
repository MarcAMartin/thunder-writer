import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FORMAT, useDocuments } from '../../store/documents'
import type { ThunderDoc } from '../../types'
import { makeDoc } from '../storage/testDocs'

const copy = vi.hoisted(() => ({
  linkedTo: null as null | { docId: string; lastWrittenAt: number | null },
  links: [] as { docId: string; kind: string; fileModifiedAt: number }[],
  synced: [] as [string, number][],
  granted: true,
}))
vi.mock('../export/desktopCopy', () => ({
  findDocForFile: vi.fn(async () => copy.linkedTo),
  linkDesktopCopy: vi.fn(async (docId: string, _h: unknown, kind: string, fileModifiedAt: number) => void copy.links.push({ docId, kind, fileModifiedAt })),
  noteDesktopCopyInSync: vi.fn((docId: string, at: number) => void copy.synced.push([docId, at])),
  grantDesktopCopy: vi.fn(async () => copy.granted),
  writeDesktopCopyNow: vi.fn(async () => 'written'),
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
  copy.synced.length = 0
  copy.granted = true
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
    copy.linkedTo = { docId: 'a', lastWrittenAt: 10_000 }
    withPickers(fakeHandle(new File(['x'], 'Storm.docx', { lastModified: 10_500 })))
    await openFromComputer()
    expect(useDocuments.getState().currentId).toBe('a')
    expect(Object.keys(useDocuments.getState().docs)).toHaveLength(2)
    expect(phase().kind).toBe('idle')
    expect(useImportFlow.getState().notice).toMatch(/already open, and your changes save to it/)
  })

  it('a linked file changed elsewhere since the last save is kept in Backups at once, then the writer picks a version', async () => {
    useDocuments.getState().hydrate([makeDoc({ id: 'a', title: 'Storm', content: para('Browser words.') })], 'a')
    copy.linkedTo = { docId: 'a', lastWrittenAt: 10_000 }
    const file = new File(['New words from Word.'], 'Storm.txt', { type: 'text/plain', lastModified: 60_000 })
    withPickers(fakeHandle(file))
    await openFromComputer()
    expect(kept.files).toEqual(['Storm.txt'])
    expect(phase()).toMatchObject({ kind: 'changed', docId: 'a', file })

    await loadFileVersion('a', file)
    const d = useDocuments.getState().docs.a
    expect(JSON.stringify(d.content)).toContain('New words from Word.')
    expect(d.title).toBe('Storm')
    expect(kept.docs).toEqual([['a', 'before-import']])
    expect(copy.synced).toEqual([['a', 60_000]])
    expect(useDocuments.getState().dirtyForDrive.a).toBe(true)

    await expect(keepBrowserVersion('a')).resolves.toBe(true)
    copy.granted = false
    await expect(keepBrowserVersion('a')).resolves.toBe(false)
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
