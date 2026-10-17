import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { currentDoc, useDocuments } from '../../store/documents'
import { flushPendingEdits } from '../../store/pendingEdits'
import { SaveToFilesDialog } from '../export/SaveToFilesDialog'
import { useExportUi } from '../export/exportUi'
import { openFromComputer } from '../import/openFromComputer'
import { driveErrorMessage } from './drive'
import { isDriveConfigured, isPickerConfigured, saveDocToDrive } from './driveSession'
import './storage.css'

/**
 * Phones: the toolbar (and its File menu) is hidden, so this File menu is how
 * a writer opens and saves manuscripts there:
 *  - Open from Files / Save to Files: the phone's own files (on iPhone, the
 *    Files app). Opening uses the file picker; saving builds a copy and hands
 *    it to the share sheet (SaveToFilesDialog). Phones can't keep saving into
 *    the same file, so a saved file is a copy.
 *  - Google Drive: Save to Google Drive (connects if needed, then autosaves
 *    there), the manuscripts in Drive, and import of a Google Doc or Word
 *    file, through the hidden File menu's ?open=drive / ?open=picker links.
 *  - New manuscript (?new=1).
 */
export function MobileOpenMenu() {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [, setSearchParams] = useSearchParams()
  const doc = useDocuments(currentDoc)
  const menuId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const drive = isDriveConfigured()
  const picker = drive && isPickerConfigured()

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onDown = (e: Event) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const go = (param: 'open' | 'new', value: string) => {
    setOpen(false)
    setSearchParams({ [param]: value })
  }

  // The file picker and Google's sign-in only open straight from a tap: no awaits before them.
  const openFiles = () => {
    setOpen(false)
    void openFromComputer({ returnFocus: () => triggerRef.current })
  }
  const saveToDrive = () => {
    setOpen(false)
    if (!doc) return
    flushPendingEdits()
    const toast = useExportUi.getState().showToast
    saveDocToDrive(doc.id).then(
      () => toast(`“${doc.title}” saved to Google Drive. Changes now save there automatically.`),
      (e: unknown) => toast(driveErrorMessage(e), 'error'),
    )
  }

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[(i + 1) % items.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      items[(i - 1 + items.length) % items.length]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  const item = (label: string, onClick: () => void, disabled = false) => (
    <button type="button" role="menuitem" className="fm-item" tabIndex={-1} aria-disabled={disabled || undefined} onClick={disabled ? undefined : onClick}>
      {label}
    </button>
  )

  return (
    <div className="fm-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className="tw-btn ed-open-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
        File
      </button>
      {open && (
        <div id={menuId} ref={menuRef} className="fm-menu fm-menu-right" role="menu" aria-label="File" onKeyDown={onKey}>
          <p className="fm-menu-heading" role="presentation">
            This phone
          </p>
          {item('Open from Files…', openFiles)}
          {item('Save to Files…', () => {
            setOpen(false)
            setSaving(true)
          }, !doc)}
          {drive && (
            <>
              <p className="fm-menu-heading" role="presentation">
                Google Drive
              </p>
              {item('Save to Google Drive', saveToDrive, !doc)}
              {item('Your manuscripts in Google Drive', () => go('open', 'drive'))}
              {picker && item('Import a Google Doc or Word file from Drive', () => go('open', 'picker'))}
            </>
          )}
          <div className="fm-sep" role="separator" />
          {item('New manuscript', () => go('new', '1'))}
        </div>
      )}
      {saving && (
        <SaveToFilesDialog
          onClose={() => {
            setSaving(false)
            triggerRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}
