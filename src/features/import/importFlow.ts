import { create } from 'zustand'
import type { JSONContent } from '@tiptap/core'
import { DEFAULT_FORMAT, useDocuments } from '../../store/documents'
import type { ThunderDoc } from '../../types'
import { IMPORT_ACCEPT, IMPORT_MIME_TYPES, importManuscript } from './importManuscript'
import { MAX_IMPORT_BYTES, tooLargeMessage } from './limits'
import { ImportError, type ImportResult } from './types'

/**
 * Local-file import: the writer picks (or drops) a file, it is converted, and
 * a new manuscript is created and opened. The file itself is only read.
 * State lives in a tiny store so the file picker can be opened from anywhere
 * (a File menu item that unmounts on click, a Home page link) while one
 * <ImportHost/> shows progress and the result.
 */

export type ImportPhase =
  | { kind: 'idle' }
  | { kind: 'importing'; name: string }
  | { kind: 'done'; name: string; docId: string; result: ImportResult }
  | { kind: 'error'; name: string; message: string }

interface ImportFlowState {
  phase: ImportPhase
  /** The "Choose a file to import" prompt (from /write?import=local). */
  prompt: boolean
  /** A short passing message, e.g. a file dropped while another import is still running. */
  notice: string | null
}

export const useImportFlow = create<ImportFlowState>()(() => ({ phase: { kind: 'idle' }, prompt: false, notice: null }))

export const BUSY_NOTICE = 'An import is already in progress. Drop the file again once it has finished.'
export const setImportNotice = (notice: string | null) => useImportFlow.setState({ notice })

export const setImportPrompt = (prompt: boolean) => useImportFlow.setState({ prompt })
export const dismissImport = () => useImportFlow.setState({ phase: { kind: 'idle' } })

/** Title of a manuscript created without one (store/documents createDoc). */
const UNTITLED = 'Untitled Manuscript'

/** accept="" value for a file input. */
export const IMPORT_INPUT_ACCEPT = [...IMPORT_ACCEPT, '.text', ...IMPORT_MIME_TYPES].join(',')

/**
 * New manuscript from an import result, opened in the editor. Marked as
 * changed for Drive so it is saved there like a newly written one.
 */
export function createManuscriptFromImport(result: ImportResult): ThunderDoc {
  discardUntouchedCurrentDoc()
  const docs = useDocuments.getState()
  const doc = docs.createDoc({ title: result.title, content: result.content, format: DEFAULT_FORMAT })
  useDocuments.setState((s) => ({ dirtyForDrive: { ...s.dirtyForDrive, [doc.id]: true } }))
  return doc
}

const isEmptyContent = (content: unknown): boolean => {
  if (content == null) return true
  const walk = (n: JSONContent): boolean => (n.type === 'text' ? !(n.text ?? '').trim() : (n.content ?? []).every(walk))
  return typeof content === 'object' && walk(content as JSONContent)
}

/**
 * The blank "Untitled Manuscript" the writer page creates on a first visit
 * (e.g. arriving from Home › Import a manuscript) would otherwise linger next
 * to the imported book. The current manuscript is removed only when nothing
 * was ever written in it: default title, no text, never saved to Drive.
 */
export function discardUntouchedCurrentDoc(): void {
  const s = useDocuments.getState()
  const d = s.currentId ? s.docs[s.currentId] : undefined
  if (!d || d.driveFileId || d.title !== UNTITLED || !isEmptyContent(d.content)) return
  s.deleteDoc(d.id)
}

export function importErrorText(e: unknown): string {
  if (e instanceof ImportError) return e.message
  return 'Something went wrong while reading this file. It may be damaged; try saving it again from the app you wrote it in.'
}

/**
 * Converts a local file and opens it as a new manuscript, reporting through
 * useImportFlow. `alsoDropped` lists other files dropped at the same time,
 * which aren't imported (the result says so).
 */
export async function importLocalFile(file: File, opts: { alsoDropped?: string[] } = {}): Promise<ThunderDoc | null> {
  const { phase } = useImportFlow.getState()
  if (phase.kind === 'importing') {
    setImportNotice(BUSY_NOTICE)
    return null
  }
  useImportFlow.setState({ phase: { kind: 'importing', name: file.name }, prompt: false, notice: null })
  try {
    if (file.size > MAX_IMPORT_BYTES) {
      throw new ImportError('too_large', tooLargeMessage(file.name, file.size))
    }
    const data = await file.arrayBuffer()
    const converted = await importManuscript({ name: file.name, mimeType: file.type || undefined, data })
    const others = opts.alsoDropped ?? []
    const result: ImportResult = others.length
      ? {
          ...converted,
          warnings: [
            ...converted.warnings,
            `Only “${file.name}” was imported; ${others.length === 1 ? `“${others[0]}” was` : `${others.length} other files were`} left out. Import one file at a time.`,
          ],
        }
      : converted
    const doc = createManuscriptFromImport(result)
    useImportFlow.setState({ phase: { kind: 'done', name: file.name, docId: doc.id, result } })
    return doc
  } catch (e) {
    useImportFlow.setState({ phase: { kind: 'error', name: file.name, message: importErrorText(e) } })
    return null
  }
}

let pendingInput: HTMLInputElement | null = null

/**
 * Opens the browser's file chooser. Call it straight from a click handler:
 * browsers only open file choosers in response to a user gesture. The input is
 * created on the fly (and removed afterwards), so the button that called this
 * may unmount, as File menu items do; `returnFocus` gives the element to
 * focus if the writer cancels the chooser.
 */
export function openImportPicker(opts: { returnFocus?: () => HTMLElement | null | undefined } = {}): void {
  pendingInput?.remove()
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = IMPORT_INPUT_ACCEPT
  input.hidden = true
  input.setAttribute('aria-hidden', 'true')
  input.tabIndex = -1
  const done = () => {
    input.remove()
    if (pendingInput === input) pendingInput = null
  }
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    done()
    if (file) void importLocalFile(file)
  })
  input.addEventListener('cancel', () => {
    done()
    // The menu item that opened the chooser is gone; put focus back where the writer was.
    opts.returnFocus?.()?.focus()
  })
  document.body.appendChild(input)
  pendingInput = input
  input.click()
}
