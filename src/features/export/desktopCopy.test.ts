import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory idb-keyval. Real IndexedDB structured-clones FileSystemFileHandles natively; the fakes here hold functions, so no clone.
const mem = vi.hoisted(() => new Map<string, Map<IDBValidKey, unknown>>())
vi.mock('idb-keyval', () => {
  const bucket = (s: unknown) => {
    const name = s as string
    if (!mem.has(name)) mem.set(name, new Map())
    return mem.get(name)!
  }
  return {
    createStore: (db: string, store: string) => `${db}/${store}`,
    get: async (k: IDBValidKey, s: unknown) => bucket(s).get(k),
    set: async (k: IDBValidKey, v: unknown, s: unknown) => void bucket(s).set(k, v),
    del: async (k: IDBValidKey, s: unknown) => void bucket(s).delete(k),
  }
})

const backup = vi.hoisted(() => ({ ok: true, files: [] as string[] }))
vi.mock('../backups/backups', () => ({
  backUpOriginalFile: vi.fn(async (_doc: unknown, file: File) => {
    if (backup.ok) backup.files.push(file.name)
    return backup.ok
  }),
}))

import { useDocuments } from '../../store/documents'
import { describeCopyStatus } from './copyStatus'
import {
  __resetDesktopCopyForTests,
  acceptFileVersion,
  COPY_PICKER_ID,
  getDesktopCopyStatus,
  keepBrowserVersionInFile,
  linkDesktopCopy,
  useDesktopCopy,
  isDesktopCopySupported,
  restoreDesktopCopy,
  resumeDesktopCopy,
  setUpDesktopCopy,
  startDesktopCopyService,
  stopDesktopCopy,
  writeDesktopCopyNow,
} from './desktopCopy'
import { makeExportDoc, p, t } from './testFixtures'

type Win = { showSaveFilePicker?: unknown }
const STORE = 'thunder-writer-export/handles'

function fakeFile(name = 'My Novel.txt') {
  const written: string[] = []
  let permission: PermissionState = 'granted'
  let failNext: DOMException | null = null
  const handle = {
    kind: 'file',
    name,
    queryPermission: vi.fn(async (): Promise<PermissionState> => permission),
    requestPermission: vi.fn(async (): Promise<PermissionState> => {
      permission = 'granted'
      return permission
    }),
    createWritable: vi.fn(async () => {
      if (failNext) {
        const e = failNext
        failNext = null
        throw e
      }
      let buf = ''
      return {
        write: async (b: Blob) => void (buf = await b.text()),
        close: async () => void written.push(buf),
        abort: async () => undefined,
      }
    }),
  }
  return {
    handle: handle as unknown as FileSystemFileHandle,
    raw: handle,
    written,
    setPermission: (p: PermissionState) => (permission = p),
    failNextWith: (e: DOMException) => (failNext = e),
  }
}

/**
 * A file with a modification time, like a real one: Thunder Writer's writes
 * set it, and `editElsewhere` stands in for saving it in Word.
 */
function fileOnDisk(name = 'My Novel.txt', text = 'It began.\n') {
  const f = fakeFile(name)
  let content = text
  let modified = Date.now() - 60_000
  const raw = f.raw as unknown as Record<string, unknown>
  raw.getFile = vi.fn(async () => new File([content], name, { lastModified: modified }))
  const create = f.raw.createWritable
  raw.createWritable = vi.fn(async () => {
    const w = await create()
    return {
      ...w,
      close: async () => {
        await w.close()
        content = f.written.at(-1)!
        modified = Date.now()
      },
    }
  })
  return {
    ...f,
    modifiedAt: () => modified,
    editElsewhere: (next: string) => {
      content = next
      modified = Date.now() + 5_000
    },
    content: () => content,
  }
}

let stopService: () => void

function openDoc(text = 'It began.') {
  const doc = makeExportDoc([p(t(text))], { id: 'd1', title: 'My Novel' })
  useDocuments.getState().hydrate([doc], doc.id)
  return doc
}

beforeEach(() => {
  backup.ok = true
  backup.files.length = 0
  useDesktopCopy.setState({ choiceFor: null })
  mem.clear()
  vi.useFakeTimers()
  __resetDesktopCopyForTests()
  stopService = startDesktopCopyService()
})
afterEach(() => {
  stopService()
  __resetDesktopCopyForTests()
  delete (window as Win).showSaveFilePicker
  vi.useRealTimers()
})

describe('desktop copy', () => {
  it('is only offered where the browser has the native Save dialog', () => {
    expect(isDesktopCopySupported()).toBe(false)
    ;(window as Win).showSaveFilePicker = vi.fn()
    expect(isDesktopCopySupported()).toBe(true)
  })

  it('asks for a file on the Desktop once, writes it, and remembers the handle', async () => {
    openDoc()
    const f = fakeFile()
    const picker = vi.fn(async (_o: unknown) => f.handle)
    ;(window as Win).showSaveFilePicker = picker

    await expect(setUpDesktopCopy('d1', 'txt')).resolves.toBe('ok')

    expect(picker.mock.calls[0][0]).toMatchObject({ suggestedName: 'My Novel.txt', startIn: 'desktop', id: COPY_PICKER_ID })
    expect(f.written).toEqual(['It began.\n'])
    const rec = mem.get(STORE)!.get('d1') as { kind: string; fileName: string; handle: unknown; lastWrittenAt: number }
    expect(rec).toMatchObject({ kind: 'txt', fileName: 'My Novel.txt', handle: f.handle })
    expect(rec.lastWrittenAt).toBeGreaterThan(0)
    const status = getDesktopCopyStatus('d1')!
    expect(status).toMatchObject({ phase: 'ready', fileName: 'My Novel.txt', pending: false })
    expect(describeCopyStatus(status, () => '12:04').text).toBe('Copy on your computer: My Novel.txt — saved 12:04')
  })

  it('does nothing when the writer cancels the Save dialog', async () => {
    openDoc()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => {
      throw new DOMException('cancel', 'AbortError')
    })
    await expect(setUpDesktopCopy('d1', 'docx')).resolves.toBe('cancelled')
    expect(getDesktopCopyStatus('d1')).toBeUndefined()
    expect(mem.get(STORE)?.get('d1')).toBeUndefined()
  })

  it('rewrites the file ~15 s after the manuscript changes', async () => {
    openDoc()
    const f = fakeFile()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    await setUpDesktopCopy('d1', 'txt')
    await vi.advanceTimersByTimeAsync(30_000) // clear the rate limit after the first write

    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('A new line.'))] })
    expect(getDesktopCopyStatus('d1')?.pending).toBe(true)
    await vi.advanceTimersByTimeAsync(14_000)
    expect(f.written).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(f.written).toEqual(['It began.\n', 'A new line.\n'])
    expect(getDesktopCopyStatus('d1')?.pending).toBe(false)

    // Drive bookkeeping alone doesn't rewrite the file.
    useDocuments.getState().markDriveSynced('d1', 'F', Date.now())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.written).toHaveLength(2)
  })

  it('writes immediately on demand (Cmd/Ctrl+S) and reports when it is already up to date', async () => {
    openDoc()
    const f = fakeFile()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    await setUpDesktopCopy('d1', 'txt')
    await expect(writeDesktopCopyNow('d1')).resolves.toBe('clean')
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('Now.'))] })
    await expect(writeDesktopCopyNow('d1')).resolves.toBe('written')
    expect(f.written.at(-1)).toBe('Now.\n')
    await expect(writeDesktopCopyNow('other')).resolves.toBe('none')
  })

  it('survives a reload: asks for permission again, then resumes', async () => {
    openDoc()
    const f = fakeFile()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    await setUpDesktopCopy('d1', 'txt')

    // Reload: memory is gone, the handle is still in IndexedDB, permission is back to "prompt".
    __resetDesktopCopyForTests()
    f.setPermission('prompt')
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('Written before the reload.'))] })
    await restoreDesktopCopy('d1')
    const status = getDesktopCopyStatus('d1')!
    expect(status.phase).toBe('needs-permission')
    expect(describeCopyStatus(status)).toMatchObject({ action: 'resume', actionLabel: 'Resume desktop copy' })
    await expect(writeDesktopCopyNow('d1')).resolves.toBe('needs-permission')

    await expect(resumeDesktopCopy('d1')).resolves.toBe(true)
    expect(f.raw.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(f.written.at(-1)).toBe('Written before the reload.\n')
    expect(getDesktopCopyStatus('d1')?.phase).toBe('ready')
  })

  it('catches up after a reload when permission was kept', async () => {
    openDoc()
    const f = fakeFile()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    await setUpDesktopCopy('d1', 'txt')
    __resetDesktopCopyForTests()
    vi.setSystemTime(Date.now() + 5_000)
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('Newer.'))] })
    await restoreDesktopCopy('d1')
    expect(getDesktopCopyStatus('d1')?.phase).toBe('ready')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(f.written.at(-1)).toBe('Newer.\n')
  })

  it('stays paused when the browser refuses permission', async () => {
    openDoc()
    const f = fakeFile()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    await setUpDesktopCopy('d1', 'txt')
    __resetDesktopCopyForTests()
    f.setPermission('prompt')
    f.raw.requestPermission.mockResolvedValueOnce('denied')
    await restoreDesktopCopy('d1')
    await expect(resumeDesktopCopy('d1')).resolves.toBe(false)
    expect(getDesktopCopyStatus('d1')?.phase).toBe('needs-permission')
  })

  it('asks to choose again when the file was moved or deleted', async () => {
    openDoc()
    const f = fakeFile()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    await setUpDesktopCopy('d1', 'txt')
    f.failNextWith(new DOMException('gone', 'NotFoundError'))
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('x'))] })
    await expect(writeDesktopCopyNow('d1')).resolves.toBe('paused')
    const status = getDesktopCopyStatus('d1')!
    expect(status.phase).toBe('missing')
    expect(describeCopyStatus(status)).toMatchObject({ action: 'choose', tone: 'error' })

    // Choosing again starts a fresh copy.
    const g = fakeFile('Elsewhere.txt')
    ;(window as Win).showSaveFilePicker = vi.fn(async () => g.handle)
    await expect(setUpDesktopCopy('d1', 'txt')).resolves.toBe('ok')
    expect(g.written).toEqual(['x\n'])
    expect(getDesktopCopyStatus('d1')).toMatchObject({ phase: 'ready', fileName: 'Elsewhere.txt' })
  })

  it('shows a retryable error for other write failures', async () => {
    openDoc()
    const f = fakeFile()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    await setUpDesktopCopy('d1', 'txt')
    f.failNextWith(new DOMException('locked', 'NoModificationAllowedError'))
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('y'))] })
    await expect(writeDesktopCopyNow('d1')).resolves.toBe('failed')
    expect(getDesktopCopyStatus('d1')).toMatchObject({ phase: 'error' })
    expect(describeCopyStatus(getDesktopCopyStatus('d1')!)).toMatchObject({ action: 'retry', text: 'Copy on your computer: My Novel.txt — write failed' })
    await expect(writeDesktopCopyNow('d1')).resolves.toBe('written')
    expect(getDesktopCopyStatus('d1')?.phase).toBe('ready')
  })

  it('stop forgets the file but leaves it on disk', async () => {
    openDoc()
    const f = fakeFile()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    await setUpDesktopCopy('d1', 'txt')
    await stopDesktopCopy('d1')
    expect(getDesktopCopyStatus('d1')).toBeUndefined()
    expect(mem.get(STORE)!.has('d1')).toBe(false)
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('z'))] })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(f.written).toHaveLength(1)
  })

  it('stops when the manuscript is deleted from this browser', async () => {
    openDoc()
    const f = fakeFile()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    await setUpDesktopCopy('d1', 'txt')
    useDocuments.getState().deleteDoc('d1')
    await vi.advanceTimersByTimeAsync(0)
    expect(getDesktopCopyStatus('d1')).toBeUndefined()
  })

  it('forgets the saved file handle when the deleted manuscript’s copy was never loaded this session', async () => {
    openDoc()
    const f = fakeFile()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    await setUpDesktopCopy('d1', 'txt')
    __resetDesktopCopyForTests() // a reload: the handle is only in IndexedDB
    expect(mem.get(STORE)?.has('d1')).toBe(true)
    useDocuments.getState().deleteDoc('d1')
    await vi.advanceTimersByTimeAsync(0)
    expect(mem.get(STORE)?.has('d1')).toBe(false)
    await restoreDesktopCopy('d1')
    expect(getDesktopCopyStatus('d1')).toBeUndefined()
  })

  it('does not bring back the copy of a manuscript deleted while its handle was loading', async () => {
    openDoc()
    const f = fakeFile()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    await setUpDesktopCopy('d1', 'txt')
    __resetDesktopCopyForTests()
    const restoring = restoreDesktopCopy('d1')
    useDocuments.setState({ docs: {}, currentId: null }) // deleted before get() resolved (no service diff)
    await restoring
    expect(getDesktopCopyStatus('d1')).toBeUndefined()
  })

  it('keeps one copy per manuscript and writes the one that changed', async () => {
    const a = makeExportDoc([p(t('Book A.'))], { id: 'a', title: 'A' })
    const b = makeExportDoc([p(t('Book B.'))], { id: 'b', title: 'B' })
    useDocuments.getState().hydrate([a, b], 'a')
    const fa = fakeFile('A.txt')
    const fb = fakeFile('B.txt')
    ;(window as Win).showSaveFilePicker = vi.fn(async () => fa.handle)
    await setUpDesktopCopy('a', 'txt')
    ;(window as Win).showSaveFilePicker = vi.fn(async () => fb.handle)
    useDocuments.getState().openDoc('b')
    await setUpDesktopCopy('b', 'txt')
    useDocuments.getState().updateContent('b', { type: 'doc', content: [p(t('Book B, revised.'))] })
    expect(await writeDesktopCopyNow('b')).toBe('written')
    expect(await writeDesktopCopyNow('a')).toBe('clean')
    expect(fb.written.at(-1)).toBe('Book B, revised.\n')
    expect(fa.written).toEqual(['Book A.\n'])
  })

  it('writes a real Word file for the default format', async () => {
    openDoc()
    const f = fakeFile('My Novel.docx')
    const bytes: Blob[] = []
    f.raw.createWritable.mockImplementation(async () => ({
      write: async (b: Blob) => void bytes.push(b),
      close: async () => undefined,
      abort: async () => undefined,
    }))
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    vi.useRealTimers()
    await expect(setUpDesktopCopy('d1', 'docx')).resolves.toBe('ok')
    expect(bytes[0].type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    const head = new Uint8Array(await bytes[0].arrayBuffer()).slice(0, 2)
    expect(String.fromCharCode(...head)).toBe('PK') // a zip
  })
})

describe('a file changed outside Thunder Writer', () => {
  async function linked(text = 'Mine.') {
    const doc = openDoc(text)
    const f = fileOnDisk('My Novel.txt', 'Mine.\n')
    ;(window as Win).showSaveFilePicker = vi.fn()
    await linkDesktopCopy(doc.id, f.handle, 'txt', f.modifiedAt())
    return { doc, f }
  }

  it('is never written over: it is kept in Backups, saving pauses, and the writer is asked', async () => {
    const { f } = await linked()
    f.editElsewhere('Edited in Word.\n')
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('Typed here.'))] })
    await vi.advanceTimersByTimeAsync(31_000)
    expect(f.written).toEqual([])
    expect(f.content()).toBe('Edited in Word.\n')
    expect(backup.files).toEqual(['My Novel.txt'])
    expect(getDesktopCopyStatus('d1')).toMatchObject({ phase: 'changed', changed: { kept: true } })
    expect(describeCopyStatus(getDesktopCopyStatus('d1')!)).toMatchObject({ action: 'resolve', actionLabel: 'Choose which version to keep' })
    expect(useDesktopCopy.getState().choiceFor).toBe('d1')

    // Cmd/Ctrl+S, Resume, and more typing all wait for the choice.
    useDesktopCopy.setState({ choiceFor: null })
    await expect(writeDesktopCopyNow('d1')).resolves.toBe('paused')
    await expect(resumeDesktopCopy('d1')).resolves.toBe(false)
    expect(useDesktopCopy.getState().choiceFor).toBe('d1')
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('More typing.'))] })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.written).toEqual([])
  })

  it('"Keep this browser’s version" writes it over the file, then saving carries on', async () => {
    const { f } = await linked()
    f.editElsewhere('Edited in Word.\n')
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('Typed here.'))] })
    await vi.advanceTimersByTimeAsync(31_000)
    await expect(keepBrowserVersionInFile('d1')).resolves.toBe('written')
    expect(f.content()).toBe('Typed here.\n')
    expect(getDesktopCopyStatus('d1')).toMatchObject({ phase: 'ready', changed: null })
    expect(useDesktopCopy.getState().choiceFor).toBeNull()
    await vi.advanceTimersByTimeAsync(31_000)
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('Later.'))] })
    await vi.advanceTimersByTimeAsync(31_000)
    expect(f.content()).toBe('Later.\n')
  })

  it('"Use the file’s version" leaves the file alone until the next edit', async () => {
    const { f } = await linked()
    f.editElsewhere('Edited in Word.\n')
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('Typed here.'))] })
    await vi.advanceTimersByTimeAsync(31_000)
    // What loadFileVersion does: the file's words come in, then the file counts as matching.
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('Edited in Word.'))] })
    acceptFileVersion('d1', f.modifiedAt(), useDocuments.getState().docs.d1.updatedAt)
    expect(getDesktopCopyStatus('d1')?.phase).not.toBe('changed')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.written).toEqual([])
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('Edited in Word, and here.'))] })
    await vi.advanceTimersByTimeAsync(31_000)
    expect(f.content()).toBe('Edited in Word, and here.\n')
  })

  it('says so when even the backup failed', async () => {
    backup.ok = false
    const { f } = await linked()
    f.editElsewhere('Edited in Word.\n')
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('Typed here.'))] })
    await vi.advanceTimersByTimeAsync(31_000)
    expect(getDesktopCopyStatus('d1')).toMatchObject({ phase: 'changed', changed: { kept: false } })
    expect(f.written).toEqual([])
  })

  it('a reload doesn’t rewrite a file when nothing changed in either place', async () => {
    const { f } = await linked()
    __resetDesktopCopyForTests()
    vi.setSystemTime(Date.now() + 60_000)
    await restoreDesktopCopy('d1')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.written).toEqual([])
  })
})

describe('a file changed outside Thunder Writer: the edge cases', () => {
  async function linkedFile() {
    const doc = openDoc('Mine.')
    const f = fileOnDisk('My Novel.txt', 'Mine.\n')
    ;(window as Win).showSaveFilePicker = vi.fn()
    await linkDesktopCopy(doc.id, f.handle, 'txt', f.modifiedAt())
    return f
  }
  const typeSomething = async (text = 'Typed here.') => {
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t(text))] })
    await vi.advanceTimersByTimeAsync(31_000)
  }

  it('changed again while the question waits: that version is kept too, and the writer is asked again', async () => {
    const f = await linkedFile()
    f.editElsewhere('v2\n')
    await typeSomething()
    useDesktopCopy.setState({ choiceFor: null }) // closed without choosing
    vi.setSystemTime(Date.now() + 60_000)
    f.editElsewhere('v3, with a new chapter\n')
    await expect(keepBrowserVersionInFile('d1')).resolves.toBe('changed-again')
    expect(backup.files).toEqual(['My Novel.txt', 'My Novel.txt'])
    expect(f.content()).toBe('v3, with a new chapter\n')
    expect(getDesktopCopyStatus('d1')).toMatchObject({ phase: 'changed' })
    expect(useDesktopCopy.getState().choiceFor).toBe('d1')
    // Asked again, the writer can still keep theirs.
    await expect(keepBrowserVersionInFile('d1')).resolves.toBe('written')
    expect(f.content()).toBe('Typed here.\n')
  })

  it('protects copies saved before the file’s own time was recorded', async () => {
    const doc = openDoc('Mine.')
    const f = fileOnDisk('My Novel.txt', 'Mine.\n')
    ;(window as Win).showSaveFilePicker = vi.fn()
    const written = Date.now()
    mem.set(STORE, new Map([[doc.id, { docId: doc.id, kind: 'txt', fileName: 'My Novel.txt', handle: f.handle, setUpAt: 1, lastWrittenAt: written }]]))
    vi.setSystemTime(written + 60_000)
    f.editElsewhere('Edited in Word.\n')
    await restoreDesktopCopy(doc.id)
    await typeSomething()
    expect(f.content()).toBe('Edited in Word.\n')
    expect(getDesktopCopyStatus('d1')?.phase).toBe('changed')
  })

  it('a file replaced by an older-dated version (a sync or a restore) counts as changed too', async () => {
    const f = await linkedFile()
    const raw = f.raw as unknown as { getFile: () => Promise<File> }
    raw.getFile = vi.fn(async () => new File(['Restored from last week.\n'], 'My Novel.txt', { lastModified: Date.now() - 7 * 86_400_000 }))
    await typeSomething()
    expect(f.written).toEqual([])
    expect(getDesktopCopyStatus('d1')?.phase).toBe('changed')
  })

  it('another tab writing the same file doesn’t look like an outside change', async () => {
    const f = await linkedFile()
    // The other tab wrote the file and recorded it.
    f.editElsewhere('Written by the other tab.\n')
    const stored = mem.get(STORE)!.get('d1') as Record<string, unknown>
    mem.get(STORE)!.set('d1', { ...stored, fileModifiedAt: f.modifiedAt(), lastWrittenAt: Date.now() })
    await typeSomething('From this tab.')
    expect(f.content()).toBe('From this tab.\n')
    expect(getDesktopCopyStatus('d1')?.phase).toBe('ready')
  })

  it('Cmd/Ctrl+S with nothing pending still notices a file changed elsewhere', async () => {
    const f = await linkedFile()
    f.editElsewhere('Edited in Word.\n')
    await expect(writeDesktopCopyNow('d1')).resolves.toBe('paused')
    expect(getDesktopCopyStatus('d1')?.phase).toBe('changed')
    expect(backup.files).toEqual(['My Novel.txt'])
  })

  it('if writing this browser’s version fails, the question stays open', async () => {
    const f = await linkedFile()
    f.editElsewhere('Edited in Word.\n')
    await typeSomething()
    f.failNextWith(new DOMException('busy', 'NoModificationAllowedError'))
    await expect(keepBrowserVersionInFile('d1')).resolves.toBe('failed')
    expect(getDesktopCopyStatus('d1')?.phase).toBe('changed')
    expect(useDesktopCopy.getState().choiceFor).toBe('d1')
    expect(f.content()).toBe('Edited in Word.\n')
  })

  it('after "Use the file’s version" the status is plain ready, with no leftover error', async () => {
    const f = await linkedFile()
    f.editElsewhere('Edited in Word.\n')
    await typeSomething()
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('Edited in Word.'))] })
    acceptFileVersion('d1', f.modifiedAt(), useDocuments.getState().docs.d1.updatedAt)
    expect(getDesktopCopyStatus('d1')).toMatchObject({ phase: 'ready', error: null, changed: null })
  })
})
