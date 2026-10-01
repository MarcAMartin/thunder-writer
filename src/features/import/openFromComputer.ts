import { useDocuments } from '../../store/documents'
import { flushPendingEdits } from '../../store/pendingEdits'
import type { ThunderDoc } from '../../types'
import { backUpOriginalFile, safetyBackup } from '../backups/backups'
import { countWords } from '../backups/store'
import { findDocForFile, grantDesktopCopy, linkDesktopCopy, noteDesktopCopyInSync, writeDesktopCopyNow } from '../export/desktopCopy'
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

/** A file opened this long after Thunder Writer last saved it was changed somewhere else (file times are coarse). */
export const CHANGED_SLACK_MS = 2000

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
  if (existing && existing.updatedAt !== doc.updatedAt) {
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
async function openFile(file: File, handle: FileSystemFileHandle | null): Promise<void> {
  useImportFlow.setState({ phase: { kind: 'importing', name: file.name }, prompt: false, notice: null })
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new ImportError('too_large', tooLargeMessage(file.name, file.size))
    let docId: string
    let result: ImportResult
    if (isThunderName(file.name)) {
      const doc = await openThunderFile(file)
      if (!doc) {
        useImportFlow.setState({ phase: { kind: 'idle' } })
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
    openImportPicker({ returnFocus: opts.returnFocus, accept: OPEN_INPUT_ACCEPT, onFile: (f) => void openFile(f, null) })
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
    if (file.lastModified > (linked.lastWrittenAt ?? 0) + CHANGED_SLACK_MS) {
      // Kept before anything else can write over it, whichever version the writer then picks.
      await backUpOriginalFile(doc, file)
      useImportFlow.setState({ phase: { kind: 'changed', docId: doc.id, file } })
    } else {
      setImportNotice(`“${file.name}” is already open, and your changes save to it.`)
    }
    return
  }
  await openFile(file, handle)
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
 * The linked file changed elsewhere: bring its version in, replacing this
 * browser's (kept in Backups first; the file's own was kept when it was found changed).
 */
export async function loadFileVersion(docId: string, file: File): Promise<void> {
  const doc = useDocuments.getState().docs[docId]
  if (!doc) return
  await safetyBackup(doc, 'before-import')
  let next: Pick<ThunderDoc, 'title' | 'content' | 'format'>
  if (isThunderName(file.name)) next = await readThunderFile(file)
  else {
    const r = await importManuscript({ name: file.name, mimeType: file.type || undefined, data: await file.arrayBuffer() })
    // The writer's title stays; the file's name may be a draft label.
    next = { title: doc.title, content: r.content, format: doc.format }
  }
  useDocuments.setState((s) => ({
    docs: { ...s.docs, [docId]: { ...doc, title: next.title, content: next.content, format: next.format, updatedAt: Date.now() } },
    dirtyForDrive: { ...s.dirtyForDrive, [docId]: true },
  }))
  noteDesktopCopyInSync(docId, file.lastModified)
}

/**
 * The linked file changed elsewhere: keep this browser's version and save it
 * into the file now (the file's version was kept in Backups when it was found
 * changed). Call from a click: the browser may need to allow writing again.
 */
export async function keepBrowserVersion(docId: string): Promise<boolean> {
  if (!(await grantDesktopCopy(docId))) return false
  flushPendingEdits()
  const outcome = await writeDesktopCopyNow(docId, { force: true })
  return outcome === 'written' || outcome === 'clean'
}
