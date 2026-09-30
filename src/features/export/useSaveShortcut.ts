import { useEffect } from 'react'
import { useDocuments } from '../../store/documents'
import { saveInBrowserNow } from '../../store/pendingEdits'
import { getDesktopCopyStatus, resumeDesktopCopy, writeDesktopCopyNow } from './desktopCopy'
import { modKey, useExportUi } from './exportUi'

/**
 * Cmd+S (Mac) / Ctrl+S (elsewhere). Shift is left alone: Cmd/Ctrl+Shift+S is
 * the editor's strikethrough shortcut (TipTap), shown in the toolbar.
 * Latin layouts match on the typed letter (so Dvorak's Cmd+O isn't taken for
 * Cmd+S); other scripts (Cyrillic, Greek…) match on the physical S key.
 */
export function isSaveShortcut(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey'> & { shiftKey?: boolean },
): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase() === 's'
  return e.code === 'KeyS'
}

const BROWSER = 'Saved in your browser'

/**
 * The full-screen Book preview is open (it sets `html.bp-open`). It sits above
 * every other overlay and keeps focus inside itself, so the Save dialog must
 * not open behind it: Cmd/Ctrl+S then saves quietly and says how to save a file.
 */
export function isPreviewCovering(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('bp-open')
}

/**
 * What Cmd/Ctrl+S does:
 *  - always: push the editor's pending keystrokes into the store and write
 *    the browser copy (IndexedDB) now, so "Saved in your browser" is true;
 *  - with a desktop copy for this manuscript: write it now (asking for
 *    permission again first if a reload took it away) and confirm with a toast;
 *  - without one: open "Save to your computer" (Word first); once the writer
 *    has closed that dialog this session, just confirm the browser save and
 *    offer the dialog from the toast.
 *  - while the Book preview is open: never open the dialog (it would be hidden
 *    and unreachable behind the preview); confirm the browser save instead and
 *    say to close the preview to save to the computer.
 * Runs inside the key press, so permission prompts and Save dialogs may open:
 * nothing is awaited before them.
 */
export async function handleSaveShortcut(opts: { saveAs?: boolean } = {}): Promise<void> {
  const ui = useExportUi.getState()
  const docId = useDocuments.getState().currentId
  if (!docId || !useDocuments.getState().docs[docId]) {
    ui.showToast('Open a manuscript first.', 'info')
    return
  }
  const covered = isPreviewCovering()
  const mod = modKey()
  // Starts the IndexedDB write synchronously; awaited only after any permission prompt.
  const browserSave = saveInBrowserNow()
  const offerChooser = (label: string) => (covered ? undefined : { label, run: () => useExportUi.getState().openChooser() })
  const browserFailed = (err: string, extra = '') =>
    useExportUi.getState().showToast(`Not saved in your browser: ${err}${extra}`, 'error', offerChooser('Save to computer…'))
  /** Opens "Save to your computer", or while the preview covers the page, says how to get to it. */
  const chooser = (note?: string) => {
    if (!covered) {
      useExportUi.getState().openChooser(note)
      return
    }
    const why = note ? `${note.replace(/ Choose where to keep your copy\.$/, '')} ` : ''
    useExportUi.getState().showToast(`${BROWSER}. ${why}To save to your computer, close the preview and press ${mod}S.`, 'info')
  }
  const openChooser = (note?: string) => {
    if (covered) {
      void browserSave.then((err) => (err ? browserFailed(err) : chooser(note)))
      return
    }
    chooser(note)
    void browserSave.then((err) => {
      if (err) browserFailed(err)
    })
  }
  if (opts.saveAs) {
    openChooser()
    return
  }
  const status = getDesktopCopyStatus(docId)
  if (!status) {
    if (ui.chooserDismissed || covered) {
      const err = await browserSave
      if (err) browserFailed(err)
      else if (covered) chooser()
      else
        useExportUi.getState().showToast(`${BROWSER}.`, 'ok', {
          label: 'Also save to computer…',
          run: () => useExportUi.getState().openChooser(),
        })
    } else {
      openChooser()
    }
    return
  }
  const name = status.fileName
  const movedNote = `${name} was moved or deleted. Choose where to keep your copy.`
  if (status.phase === 'missing') {
    openChooser(movedNote)
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

  const browserErr = await browserSave
  if (browserErr) {
    browserFailed(browserErr, outcome === 'written' || outcome === 'clean' ? ` · ${name} on your computer is up to date` : '')
    return
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
      chooser()
      return
    case 'missing':
      chooser(movedNote)
      return
    case 'needs-permission':
    case 'paused':
      if (now?.phase === 'missing') {
        chooser(movedNote)
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
 * Intercepts Cmd/Ctrl+S everywhere in the page (capture phase, before the
 * editor sees it) so the browser's "Save web page" dialog never appears.
 * Mount once (ExportHost does).
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
      void handleSaveShortcut()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [enabled])
}
