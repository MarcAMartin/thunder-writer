import { create } from 'zustand'
import { useDocuments } from '../../store/documents'
import { flushPendingEdits } from '../../store/pendingEdits'
import { buildExport, type ExportKind } from './formats'
import { describeSaveResult, saveToComputer, type SaveResult } from './saveToComputer'

export type ToastTone = 'ok' | 'info' | 'error'

export interface ExportToast {
  id: number
  text: string
  tone: ToastTone
  action?: { label: string; run: () => void }
}

interface ExportUiState {
  toast: ExportToast | null
  /** The "Export to your computer" dialog. */
  chooserOpen: boolean
  /** Why the dialog opened (shown as a note). */
  chooserNote: string | null
  /** The writer closed the dialog this session: plain Cmd/Ctrl+S stops opening it. */
  chooserDismissed: boolean
  showToast: (text: string, tone?: ToastTone, action?: ExportToast['action']) => number
  dismissToast: (id?: number) => void
  openChooser: (note?: string | null) => void
  closeChooser: () => void
}

let toastSeq = 0

export const useExportUi = create<ExportUiState>()((set, get) => ({
  toast: null,
  chooserOpen: false,
  chooserNote: null,
  chooserDismissed: false,
  showToast: (text, tone = 'ok', action) => {
    const id = ++toastSeq
    set({ toast: { id, text, tone, action } })
    return id
  },
  dismissToast: (id) => {
    if (id === undefined || get().toast?.id === id) set({ toast: null })
  },
  openChooser: (note = null) => set({ chooserOpen: true, chooserNote: note }),
  closeChooser: () => set({ chooserOpen: false, chooserNote: null, chooserDismissed: true }),
}))

/** "⌘" on Apple platforms, "Ctrl+" elsewhere. */
export function modKey(): string {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const platform =
    (nav as unknown as { userAgentData?: { platform?: string } } | undefined)?.userAgentData?.platform ?? nav?.platform ?? ''
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl+'
}

/**
 * One-off "Export to computer" for the current doc. Call from a click: the
 * native Save dialog opens before the file is built.
 */
export async function saveCurrentDocOnce(kind: ExportKind, docId?: string | null): Promise<SaveResult | null> {
  flushPendingEdits()
  const state = useDocuments.getState()
  const id = docId ?? state.currentId
  const doc = id ? state.docs[id] : undefined
  const ui = useExportUi.getState()
  if (!doc) {
    ui.showToast('Open a manuscript first.', 'error')
    return null
  }
  try {
    const result = await saveToComputer(() => buildExport(useDocuments.getState().docs[doc.id] ?? doc, kind), doc.title, kind)
    if (result.status !== 'cancelled') ui.showToast(describeSaveResult(result), result.status === 'saved' ? 'ok' : 'info')
    return result
  } catch (e) {
    ui.showToast(`Couldn’t save the file: ${e instanceof Error ? e.message : String(e)}`, 'error')
    return null
  }
}
