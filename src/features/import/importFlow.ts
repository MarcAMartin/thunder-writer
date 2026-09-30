import { create } from 'zustand'
import { DEFAULT_FORMAT, useDocuments } from '../../store/documents'
import type { ThunderDoc } from '../../types'
import { IMPORT_ACCEPT, IMPORT_MIME_TYPES, importManuscript } from './importManuscript'
import { formatMB, MAX_IMPORT_BYTES } from './limits'
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
}

export const useImportFlow = create<ImportFlowState>()(() => ({ phase: { kind: 'idle' }, prompt: false }))

export const setImportPrompt = (prompt: boolean) => useImportFlow.setState({ prompt })
export const dismissImport = () => useImportFlow.setState({ phase: { kind: 'idle' } })

/** accept="" value for a file input. */
export const IMPORT_INPUT_ACCEPT = [...IMPORT_ACCEPT, '.text', ...IMPORT_MIME_TYPES].join(',')

/**
 * New manuscript from an import result, opened in the editor. Marked as
 * changed for Drive so it is saved there like a newly written one.
 */
export function createManuscriptFromImport(result: ImportResult): ThunderDoc {
  const docs = useDocuments.getState()
  const doc = docs.createDoc({ title: result.title, content: result.content, format: DEFAULT_FORMAT })
  useDocuments.setState((s) => ({ dirtyForDrive: { ...s.dirtyForDrive, [doc.id]: true } }))
  return doc
}

export function importErrorText(e: unknown): string {
  if (e instanceof ImportError) return e.message
  return 'Something went wrong while reading this file. It may be damaged; try saving it again from the app you wrote it in.'
}

/** Converts a local file and opens it as a new manuscript, reporting through useImportFlow. */
export async function importLocalFile(file: File): Promise<ThunderDoc | null> {
  const { phase } = useImportFlow.getState()
  if (phase.kind === 'importing') return null
  useImportFlow.setState({ phase: { kind: 'importing', name: file.name }, prompt: false })
  try {
    if (file.size > MAX_IMPORT_BYTES) {
      throw new ImportError(
        'too_large',
        `“${file.name}” is ${formatMB(file.size)}; the largest file Thunder Writer can import is ${formatMB(MAX_IMPORT_BYTES)}. If it contains pictures, save a copy without them and try again.`,
      )
    }
    const data = await file.arrayBuffer()
    const result = await importManuscript({ name: file.name, mimeType: file.type || undefined, data })
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
 * may unmount, as File menu items do.
 */
export function openImportPicker(): void {
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
  input.addEventListener('cancel', done)
  document.body.appendChild(input)
  pendingInput = input
  input.click()
}
