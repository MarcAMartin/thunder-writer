import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { currentDoc, useDocuments } from '../../store/documents'
import { describeSaveStatus } from './autosave'
import { driveErrorMessage } from './drive'
import {
  connectDrive,
  disconnectDrive,
  isDriveConfigured,
  isPickerConfigured,
  loadConfigFromDrive,
  pickDriveFile,
  saveConfigToDrive,
  saveDocToDrive,
  useStorageStatus,
} from './driveSession'
import { ImportButton } from '../import/ImportButton'
import { DriveImportFlow } from './DriveImportFlow'
import { DriveModal } from './DriveModal'
import { loadGis } from './googleAuth'
import { OpenLocalModal } from './OpenLocalModal'
import { loadPickerApi, type PickedFile } from './picker'
import { makeEnvelope, parseEnvelope, withoutDriveLink } from './schema'
import { ResolveConflictModal } from './ResolveConflictModal'
import './storage.css'

type ModalKind = 'open' | 'drive' | 'conflict' | null
type Note = { text: string; tone: 'ok' | 'error' } | null

/** File actions for the writer header: new/open/import/export, Google Drive, save status. */
export function FileMenu() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [modal, setModal] = useState<ModalKind>(null)
  const [note, setNote] = useState<Note>(null)
  /** Import from Google Drive in progress; `pick` null = show a prompt button first (?open=picker). */
  const [driveImport, setDriveImport] = useState<{ pick: Promise<PickedFile | null> | null; run: number } | null>(null)
  const importRun = useRef(0)
  const [searchParams, setSearchParams] = useSearchParams()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doc = useDocuments(currentDoc)
  const createDoc = useDocuments((s) => s.createDoc)
  const connected = useStorageStatus((s) => s.driveConnected)
  const configured = isDriveConfigured()
  const pickerReady = configured && isPickerConfigured()

  const flash = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    if (noteTimer.current) clearTimeout(noteTimer.current)
    setNote({ text, tone })
    noteTimer.current = setTimeout(() => setNote(null), tone === 'error' ? 7000 : 3500)
  }, [])
  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current)
  }, [])

  // Deep links: /write?open=drive (home page "Load File") and /write?open=picker (import from Drive).
  // The Picker needs a click to open, so ?open=picker shows a prompt button rather than the Picker itself.
  useEffect(() => {
    const open = searchParams.get('open')
    if (open === 'drive' || open === 'picker') {
      if (open === 'drive') setModal('drive')
      else setDriveImport({ pick: null, run: ++importRun.current })
      const next = new URLSearchParams(searchParams)
      next.delete('open')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Warm up Google's scripts so the consent popup and Picker open straight from the click.
  useEffect(() => {
    if (configured) loadGis().catch(() => undefined)
  }, [configured])
  useEffect(() => {
    if (pickerReady) loadPickerApi().catch(() => undefined)
  }, [pickerReady])

  /** Opens the Google Picker. Must run from a click (consent popup + Picker). */
  const startDriveImport = () => {
    const pick = pickDriveFile()
    pick.catch(() => undefined) // Reported by the import dialog.
    setDriveImport({ pick, run: ++importRun.current })
  }

  // Close the menu on outside click.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [menuOpen])

  const closeMenu = (restoreFocus = true) => {
    setMenuOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[(i + 1) % items.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      items[(i - 1 + items.length) % items.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      items[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      items[items.length - 1]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
    } else if (e.key === 'Tab') {
      closeMenu(false)
    }
  }

  /** Runs a menu action; Drive popups must start synchronously from the click, so no awaits before `fn`. */
  const act = (fn: () => unknown) => () => {
    closeMenu(false)
    void Promise.resolve()
      .then(fn)
      .catch((e: unknown) => flash(driveErrorMessage(e), 'error'))
  }

  const saveToDrive = async () => {
    if (!doc) return
    await saveDocToDrive(doc.id)
    flash(`“${doc.title}” saved to Drive. Changes will now autosave there.`)
  }

  const exportBackup = () => {
    if (!doc) return
    const blob = new Blob([JSON.stringify(makeEnvelope(doc), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(doc.title || 'Untitled Manuscript').replace(/[\\/:*?"<>|]+/g, ' ').trim()}.thunder.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const importFile = async (file: File) => {
    let data: unknown
    try {
      data = JSON.parse(await file.text())
    } catch {
      flash(`${file.name} is not a Thunder Writer file.`, 'error')
      return
    }
    const parsed = parseEnvelope(data)
    if (!parsed.ok) {
      flash(parsed.reason, 'error')
      return
    }
    const store = useDocuments.getState()
    const existing = store.docs[parsed.doc.id]
    const question = existing?.driveFileId
      ? `Replace the copy of “${existing.title}” in this browser with the imported file? The Google Drive copy is left as it is; the imported version is saved to Drive as a separate file.`
      : `Replace the copy of “${existing?.title ?? ''}” in this browser with the imported file?`
    if (existing && !window.confirm(question)) return
    // A file never carries a Drive link: an old backup must not autosave over the (newer) Drive file.
    store.upsertDoc(withoutDriveLink(parsed.doc))
    store.openDoc(parsed.doc.id)
    flash(`Opened “${parsed.doc.title}”.`)
  }

  return (
    <div className="fm-root">
      <div className="fm-menu-wrap">
        <button
          ref={triggerRef}
          type="button"
          className="tw-btn fm-trigger"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls="fm-file-menu"
          onClick={() => setMenuOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !menuOpen) {
              e.preventDefault()
              setMenuOpen(true)
            }
          }}
        >
          File <span aria-hidden="true">▾</span>
        </button>

        {menuOpen && (
          <div id="fm-file-menu" ref={menuRef} className="fm-menu" role="menu" aria-label="File" onKeyDown={onMenuKey}>
            <MenuItem onClick={act(() => createDoc())}>New manuscript</MenuItem>
            <MenuItem onClick={act(() => setModal('open'))}>Open manuscript…</MenuItem>
            <ImportButton variant="menuitem" onBeforeOpen={() => closeMenu(false)} />
            <MenuItem onClick={act(() => fileInput.current?.click())}>Import .thunder.json…</MenuItem>
            <MenuItem onClick={act(exportBackup)} disabled={!doc}>
              Download backup
            </MenuItem>

            <div className="fm-sep" role="separator" />
            <div className="fm-group-label" aria-hidden="true">
              Google Drive {connected && <span className="fm-dot" title="Connected" />}
            </div>

            {!configured ? (
              <>
                <p className="fm-menu-hint">Drive needs a Google OAuth client ID first.</p>
                <Link to="/settings#drive" role="menuitem" className="fm-item" onClick={() => setMenuOpen(false)}>
                  Set up in Settings →
                </Link>
              </>
            ) : (
              <>
                {!connected && (
                  <MenuItem
                    onClick={act(async () => {
                      await connectDrive()
                      flash('Google Drive connected.')
                    })}
                  >
                    Connect Google Drive
                  </MenuItem>
                )}
                <MenuItem onClick={act(saveToDrive)} disabled={!doc}>
                  {doc?.driveFileId ? 'Save to Drive now' : 'Save to Drive'}
                </MenuItem>
                <MenuItem onClick={act(() => setModal('drive'))}>Open from Drive…</MenuItem>
                {pickerReady ? (
                  <MenuItem onClick={act(startDriveImport)}>Import from Google Drive…</MenuItem>
                ) : (
                  <>
                    <Link
                      to="/settings#drive"
                      role="menuitem"
                      className="fm-item"
                      tabIndex={-1}
                      aria-describedby="fm-import-hint"
                      onClick={() => setMenuOpen(false)}
                    >
                      Import from Google Drive…
                    </Link>
                    <p id="fm-import-hint" className="fm-menu-hint">
                      Importing Google Docs and Word files needs a Google API key. Add it in Settings.
                    </p>
                  </>
                )}
                <MenuItem
                  onClick={act(async () => {
                    const cfg = await loadConfigFromDrive()
                    flash(cfg ? 'Settings loaded from Drive.' : 'No saved settings in Drive yet.', cfg ? 'ok' : 'error')
                  })}
                >
                  Load settings from Drive
                </MenuItem>
                <MenuItem
                  onClick={act(async () => {
                    await saveConfigToDrive()
                    flash('Settings saved to Drive (API keys are never uploaded).')
                  })}
                >
                  Save settings to Drive
                </MenuItem>
                {connected && (
                  <MenuItem
                    onClick={act(() => {
                      disconnectDrive()
                      flash('Disconnected from Google Drive.')
                    })}
                  >
                    Disconnect Drive
                  </MenuItem>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <SaveStatus onError={(m) => flash(m, 'error')} onResolve={() => setModal('conflict')} />

      <div className="fm-note-slot" aria-live="polite">
        {note && <span className={`fm-note fm-note-${note.tone}`}>{note.text}</span>}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void importFile(f)
        }}
      />

      {modal === 'open' && <OpenLocalModal onClose={() => setModal(null)} />}
      {modal === 'drive' && (
        <DriveModal
          onClose={() => setModal(null)}
          onImport={() => {
            setModal(null)
            startDriveImport()
          }}
        />
      )}
      {driveImport && <DriveImportFlow key={driveImport.run} pick={driveImport.pick} onClose={() => setDriveImport(null)} />}
      {modal === 'conflict' && doc && <ResolveConflictModal docId={doc.id} onClose={() => setModal(null)} />}
    </div>
  )
}

function MenuItem({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="fm-item"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </button>
  )
}

/** "Saved locally" / "Saving to Drive…" / "Saved to Drive 12:04" / "Drive error — retry". */
function SaveStatus({ onError, onResolve }: { onError: (msg: string) => void; onResolve: () => void }) {
  const doc = useDocuments(currentDoc)
  const dirty = useDocuments((s) => (s.currentId ? s.dirtyForDrive[s.currentId] === true : false))
  const st = useStorageStatus()
  const docConflict = !!doc && st.driveConflicts[doc.id] === true
  const view = describeSaveStatus({
    local: st.local,
    drive: st.drive,
    driveConnected: st.driveConnected,
    driveNeedsReconnect: st.driveNeedsReconnect,
    driveSavedAt: doc ? st.driveSavedAt[doc.id] : undefined,
    doc,
    docDirtyForDrive: dirty || (!!doc?.driveFileId && (doc.driveSyncedAt ?? 0) < doc.updatedAt),
    docConflict,
  })
  const detail = docConflict
    ? 'This manuscript changed in Google Drive since this browser last synced it. Autosave to Drive is paused for it until you choose which version to keep.'
    : st.drive === 'error'
      ? st.driveError
      : st.local === 'error'
        ? st.localError
        : null

  const run = () => {
    if (view.action === 'resolve') {
      onResolve()
      return
    }
    const p = view.action === 'retry' && doc ? saveDocToDrive(doc.id) : connectDrive()
    p.catch((e: unknown) => onError(driveErrorMessage(e)))
  }

  return (
    <span className={`fm-status fm-tone-${view.tone}`} role="status" title={detail ?? undefined}>
      <span className="fm-status-dot" aria-hidden="true" />
      {view.action ? (
        <button type="button" className="fm-status-btn" onClick={run} aria-label={`${view.label}${detail ? `: ${detail}` : ''}`}>
          {view.label}
        </button>
      ) : (
        <span>{view.label}</span>
      )}
    </span>
  )
}
