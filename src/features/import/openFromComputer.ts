import { useDocuments } from '../../store/documents'
import { flushPendingEdits } from '../../store/pendingEdits'
import type { ThunderDoc } from '../../types'
import { backUpOriginalFile, safetyBackup } from '../backups/backups'
import { countWords } from '../backups/store'
import {
  acceptFileVersion,
  CHANGED_SLACK_MS,
  changedSince,
  findDocForFile,
  getDesktopCopyHandle,
  getDesktopCopyStatus,
  holdForChoice,
  keepBrowserVersionInFile,
  linkDesktopCopy,
  restoreDesktopCopy,
} from '../export/desktopCopy'
import { DOCX_MIME, type CopyKind } from '../export/formats'
import { canSaveBackToOpenedFiles, getShowOpenFilePicker, isAbortError, requestWritePermission } from '../export/fsAccess'
import { parseEnvelope, withoutDriveLink } from '../storage/schema'
import {
  BUSY_NOTICE,
  createManuscriptFromImport,
  discardUntouchedCurrentDoc,
  importErrorText,
  IMPORT_INPUT_ACCEPT,
  openImportPicker,
  setImportNotice,
  useImportFlow,
  type OpenedFile,
} from './importFlow'
import { importManuscript } from './importManuscript'
import { MAX_IMPORT_BYTES, tooLargeMessage } from './limits'
import { ImportError, type ImportResult } from './types'

/**
 * File › Open from computer: opens a manuscript file (Word, Markdown, text,
 * HTML or a Thunder Writer file) and, in Chrome and Edge, offers to keep
 * saving into that same file as the writer works (it becomes the
 * manuscript's desktop copy; features/export/desktopCopy). Before Thunder
 * Writer first saves over a file, the file is kept byte for byte in
 * Backups. Other browsers open a copy, as an import does.
 */

/** Remembered folder for Open from computer. */
export const OPEN_PICKER_ID = 'thunder-writer-open'

const OPEN_TYPES = [
  {
    description: 'Manuscripts',
    accept: {
      [DOCX_MIME]: ['.docx'],
      'text/markdown': ['.md', '.markdown'],
      'text/plain': ['.txt', '.text'],
      'text/html': ['.html', '.htm'],
      'application/json': ['.json', '.bak'],
    },
  },
]

/** The plain file chooser's types, where the browser can't open files for saving back. */
export const OPEN_INPUT_ACCEPT = `${IMPORT_INPUT_ACCEPT},.json,.bak,application/json`

export { CHANGED_SLACK_MS }

/** A Thunder Writer save (.thunder.json), any .json, or the .bak Thunder Writer keeps of one. */
const isThunderName = (name: string) => /\.json(\.bak)?$/i.test(name.trim())

/**
 * The format Thunder Writer can save back into, or null: HTML is a print file
 * it doesn't write, and a .bak is a backup, never written over.
 */
export function saveBackKind(name: string): CopyKind | null {
  const n = name.trim().toLowerCase()
  if (n.endsWith('.bak')) return null
  if (n.endsWith('.docx')) return 'docx'
  if (n.endsWith('.md') || n.endsWith('.markdown')) return 'md'
  if (n.endsWith('.txt') || n.endsWith('.text')) return 'txt'
  if (n.endsWith('.json')) return 'thunder'
  return null
}

type Node = { type?: string; attrs?: { level?: number }; content?: Node[] }
const countChapters = (content: unknown) => {
  let n = 0
  const walk = (node: Node | null | undefined) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'heading' && node.attrs?.level === 1) n++
    node.content?.forEach(walk)
  }
  walk(content as Node)
  return n
}

const summary = (doc: Pick<ThunderDoc, 'title' | 'content'>): ImportResult => ({
  title: doc.title,
  content: doc.content,
  wordCount: countWords(doc.content),
  chapterCount: countChapters(doc.content),
  warnings: [],
})

async function readThunderFile(file: File): Promise<ThunderDoc> {
  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new ImportError('unsupported', `${file.name} is not a Thunder Writer file.`)
  }
  const parsed = parseEnvelope(data)
  if (!parsed.ok) throw new ImportError('corrupt', parsed.reason)
  return parsed.doc
}

/**
 * Opens a Thunder Writer file as that manuscript. If this browser has another
 * version of it, asks first and keeps this browser's as a backup. Resolves
 * null if the writer says no.
 */
async function openThunderFile(file: File): Promise<ThunderDoc | null> {
  const doc = await readThunderFile(file)
  const store = useDocuments.getState()
  const existing = store.docs[doc.id]
  if (existing && existing.updatedAt === doc.updatedAt) {
    // The same version: just open it, keeping its Drive link.
    if (store.currentId !== existing.id) {
      discardUntouchedCurrentDoc()
      useDocuments.getState().openDoc(existing.id)
    }
    return existing
  }
  if (existing) {
    const question = existing.driveFileId
      ? `Replace the copy of “${existing.title}” in this browser with the version in ${file.name}? The Google Drive copy is left as it is; this version is saved to Drive as a separate file. This browser’s copy is kept in Backups.`
      : `Replace the copy of “${existing.title}” in this browser with the version in ${file.name}? This browser’s copy is kept in Backups.`
    if (!window.confirm(question)) return null
    if (
      !(await safetyBackup(existing, 'before-import')) &&
      !window.confirm(`This browser couldn’t keep a backup of “${existing.title}” first. Replace it anyway? This cannot be undone.`)
    )
      return null
  }
  discardUntouchedCurrentDoc()
  // A file never carries a Drive link: an old save must not autosave over the (newer) Drive file.
  useDocuments.getState().upsertDoc(withoutDriveLink(doc))
  useDocuments.getState().openDoc(doc.id)
  return useDocuments.getState().docs[doc.id]
}

/** Opens (converts) `file` as a manuscript and shows the result; `handle` when it may be saved back into. */
async function openFile(file: File, handle: FileSystemFileHandle | null, returnFocus?: () => HTMLElement | null | undefined): Promise<void> {
  useImportFlow.setState({ phase: { kind: 'importing', name: file.name }, prompt: false, notice: null })
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new ImportError('too_large', tooLargeMessage(file.name, file.size))
    let docId: string
    let result: ImportResult
    if (isThunderName(file.name)) {
      const doc = await openThunderFile(file)
      if (!doc) {
        useImportFlow.setState({ phase: { kind: 'idle' } })
        returnFocus?.()?.focus()
        return
      }
      docId = doc.id
      result = summary(doc)
    } else {
      result = await importManuscript({ name: file.name, mimeType: file.type || undefined, data: await file.arrayBuffer() })
      docId = createManuscriptFromImport(result).id
    }
    const kind = handle ? saveBackKind(file.name) : null
    useImportFlow.setState({
      phase: { kind: 'done', name: file.name, docId, result, opened: { file: handle && kind ? { handle, kind, file } : null } },
    })
  } catch (e) {
    useImportFlow.setState({ phase: { kind: 'error', name: file.name, message: importErrorText(e) } })
  }
}

/**
 * File › Open from computer…. Call straight from a click: the browser only
 * opens its file picker from one. Opening a file that already saves back to a
 * manuscript goes to that manuscript; if the file changed elsewhere since
 * (in Word, say), it is kept in Backups and the writer picks a version.
 */
export async function openFromComputer(opts: { returnFocus?: () => HTMLElement | null | undefined } = {}): Promise<void> {
  if (useImportFlow.getState().phase.kind === 'importing') {
    setImportNotice(BUSY_NOTICE)
    return
  }
  const show = getShowOpenFilePicker()
  if (!show || !canSaveBackToOpenedFiles()) {
    openImportPicker({
      returnFocus: opts.returnFocus,
      accept: OPEN_INPUT_ACCEPT,
      onFile: (f) => {
        useImportFlow.setState({ prompt: false })
        void openFile(f, null, opts.returnFocus)
      },
    })
    return
  }
  let handle: FileSystemFileHandle | undefined
  try {
    // The first await, so the picker still counts as part of the click.
    ;[handle] = await show({ id: OPEN_PICKER_ID, types: OPEN_TYPES, multiple: false })
  } catch (e) {
    if (!isAbortError(e)) {
      useImportFlow.setState({
        phase: { kind: 'error', name: 'Open from computer', message: 'The browser couldn’t open its file picker. Try again.' },
      })
    }
    opts.returnFocus?.()?.focus()
    return
  }
  if (!handle) return
  // A file was chosen: the "Open a manuscript" prompt (from the Home page) has done its job.
  useImportFlow.setState({ prompt: false })
  let file: File
  try {
    file = await handle.getFile()
  } catch {
    useImportFlow.setState({ phase: { kind: 'error', name: handle.name, message: 'That file couldn’t be read. It may have been moved or deleted.' } })
    return
  }

  const linked = await findDocForFile(handle)
  const doc = linked ? useDocuments.getState().docs[linked.docId] : undefined
  if (linked && doc) {
    flushPendingEdits()
    const s = useDocuments.getState()
    if (s.currentId !== doc.id) {
      discardUntouchedCurrentDoc()
      s.openDoc(doc.id)
    }
    await restoreDesktopCopy(doc.id)
    if (changedSince(linked, file.lastModified)) {
      // Kept in Backups and saving paused, until the writer picks a version (ChangedFileDialog).
      await holdForChoice(doc.id, file)
    } else {
      setImportNotice(`“${file.name}” is already open, and your changes save to it.`)
      opts.returnFocus?.()?.focus()
    }
    return
  }
  await openFile(file, handle, opts.returnFocus)
}

export type KeepSavingOutcome = 'linked' | 'denied' | 'cancelled'

/**
 * "Keep saving to <file>": asks the browser for permission to write the file
 * (first, while it's still the click), keeps the file as it is now in Backups,
 * then saves the manuscript into it from the next change on.
 */
export async function keepSavingToFile(docId: string, opened: OpenedFile): Promise<KeepSavingOutcome> {
  let perm: PermissionState
  try {
    perm = await requestWritePermission(opened.handle)
  } catch {
    perm = 'denied'
  }
  if (perm !== 'granted') return 'denied'
  const doc = useDocuments.getState().docs[docId]
  if (!doc) return 'cancelled'
  const kept = await backUpOriginalFile(doc, opened.file)
  if (
    !kept &&
    !window.confirm(
      `This browser couldn’t keep a backup of “${opened.file.name}” as it is now. Save your changes into it anyway? Its current contents couldn’t be brought back.`,
    )
  )
    return 'cancelled'
  await linkDesktopCopy(docId, opened.handle, opened.kind, opened.file.lastModified)
  return 'linked'
}

/**
 * "Use the file's version" for a linked file that changed elsewhere: read it
 * again (it may have changed since), keep this browser's version in Backups
 * (asking if that fails), and load the file's words into the manuscript. The
 * file and manuscript then match, so nothing is rewritten until the next edit.
 */
export async function loadFileVersion(docId: string): Promise<'loaded' | 'cancelled'> {
  const doc = useDocuments.getState().docs[docId]
  if (!doc) return 'cancelled'
  const handle = getDesktopCopyHandle(docId)
  const file = (handle ? await handle.getFile().catch(() => null) : null) ?? getDesktopCopyStatus(docId)?.changed?.file
  if (!file) throw new Error('The file couldn’t be read. It may have been moved or deleted.')
  if (
    !(await safetyBackup(doc, 'before-import')) &&
    !window.confirm(`This browser couldn’t keep a backup of “${doc.title}” first. Use the file’s version anyway? This browser’s version couldn’t be brought back.`)
  )
    return 'cancelled'
  let next: Pick<ThunderDoc, 'title' | 'content' | 'format'>
  if (isThunderName(file.name)) next = await readThunderFile(file)
  else {
    const r = await importManuscript({ name: file.name, mimeType: file.type || undefined, data: await file.arrayBuffer() })
    // The writer's title stays; the file's name may be a draft label.
    next = { title: doc.title, content: r.content, format: doc.format }
  }
  const updatedAt = Date.now()
  useDocuments.setState((s) => ({
    docs: { ...s.docs, [docId]: { ...doc, title: next.title, content: next.content, format: next.format, updatedAt } },
    dirtyForDrive: { ...s.dirtyForDrive, [docId]: true },
  }))
  acceptFileVersion(docId, file.lastModified, updatedAt)
  return 'loaded'
}

/** "Keep this browser's version": write it over the changed file now. Call from a click. */
export const keepBrowserVersion = (docId: string) => keepBrowserVersionInFile(docId)
