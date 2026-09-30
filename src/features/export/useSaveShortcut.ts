import { useEffect } from 'react'
import { useDocuments } from '../../store/documents'
import { flushPendingEdits } from '../../store/pendingEdits'
import { getDesktopCopyStatus, resumeDesktopCopy, writeDesktopCopyNow } from './desktopCopy'
import { modKey, useExportUi } from './exportUi'

/** Cmd+S (Mac) / Ctrl+S (elsewhere); Shift adds "save as". */
export function isSaveShortcut(e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')
}

const BROWSER = 'Saved in your browser'

/**
 * What Cmd/Ctrl+S does:
 *  - with a desktop copy for this manuscript: write it now (asking for
 *    permission again first if a reload took it away) and confirm with a toast;
 *  - without one: open "Save to your computer" (Word first); once the writer
 *    has closed that dialog this session, just confirm the browser save and
 *    point at Shift+S;
 *  - with Shift: always open "Save to your computer".
 * Runs inside the key press, so permission prompts and Save dialogs may open.
 */
export async function handleSaveShortcut(opts: { saveAs?: boolean } = {}): Promise<void> {
  const ui = useExportUi.getState()
  const docId = useDocuments.getState().currentId
  if (!docId || !useDocuments.getState().docs[docId]) {
    ui.showToast('Open a manuscript first.', 'info')
    return
  }
  flushPendingEdits()
  const mod = modKey()
  if (opts.saveAs) {
    ui.openChooser()
    return
  }
  const status = getDesktopCopyStatus(docId)
  if (!status) {
    if (ui.chooserDismissed) {
      ui.showToast(`${BROWSER}. Press ${mod}⇧S to also save a copy to your computer.`, 'ok')
    } else {
      ui.openChooser()
    }
    return
  }
  const name = status.fileName
  if (status.phase === 'missing') {
    ui.openChooser(`${name} was moved or deleted. Choose where to keep your copy.`)
    return
  }

  let outcome
  if (status.phase === 'needs-permission') {
    // A key press counts as a user gesture, so the browser can ask right away.
    const ok = await resumeDesktopCopy(docId)
    outcome = ok ? 'written' : (getDesktopCopyStatus(docId)?.phase ?? 'needs-permission')
  } else {
    const toastId = status.phase === 'writing' ? ui.showToast(`${BROWSER} · writing ${name}…`, 'info') : null
    outcome = await writeDesktopCopyNow(docId)
    if (toastId !== null) useExportUi.getState().dismissToast(toastId)
  }

  const now = getDesktopCopyStatus(docId)
  const show = useExportUi.getState().showToast
  switch (outcome) {
    case 'written':
      show(`${BROWSER} · copy written to ${name}`, 'ok')
      return
    case 'clean':
      show(`${BROWSER} · ${name} is up to date`, 'ok')
      return
    case 'none':
      useExportUi.getState().openChooser()
      return
    case 'missing':
      useExportUi.getState().openChooser(`${name} was moved or deleted. Choose where to keep your copy.`)
      return
    case 'needs-permission':
    case 'paused':
      if (now?.phase === 'missing') {
        useExportUi.getState().openChooser(`${name} was moved or deleted. Choose where to keep your copy.`)
        return
      }
      show(`${BROWSER} · ${name} wasn’t updated: allow access when the browser asks (press ${mod}S again).`, 'error')
      return
    default:
      show(`${BROWSER} · couldn’t write ${name}${now?.error ? `: ${now.error}` : ''}`, 'error', {
        label: 'Retry',
        run: () => void handleSaveShortcut(),
      })
  }
}

/**
 * Intercepts Cmd/Ctrl+S (and Shift+Cmd/Ctrl+S) everywhere in the page so the
 * browser's "Save web page" dialog never appears. Mount once (ExportHost does).
 */
export function useSaveShortcut(enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (!isSaveShortcut(e)) return
      e.preventDefault()
      e.stopPropagation()
      // Holding the keys down repeats the event; one save is enough.
      if (e.repeat) return
      void handleSaveShortcut({ saveAs: e.shiftKey })
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [enabled])
}
