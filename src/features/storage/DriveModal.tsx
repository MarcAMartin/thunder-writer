import { useCallback, useEffect, useState } from 'react'
import { useDocuments } from '../../store/documents'
import { flushPendingEdits } from '../../store/pendingEdits'
import type { ThunderDoc } from '../../types'
import { ConflictChoices } from './ConflictChoices'
import { titleFromFileName, driveErrorMessage, isDriveError, type DriveFileInfo } from './drive'
import {
  auth,
  connectDrive,
  DRIVE_UNAVAILABLE,
  downloadDriveDoc,
  isDriveConfigured,
  isPickerConfigured,
  listDriveDocs,
  openDownloadedDoc,
  useStorageStatus,
} from './driveSession'
import { Modal } from './Modal'
import { formatWhen } from './OpenLocalModal'

type View =
  | { kind: 'connect' }
  | { kind: 'loading' }
  | { kind: 'list'; files: DriveFileInfo[] }
  | { kind: 'error'; message: string; reconnect: boolean }
  | { kind: 'conflict'; files: DriveFileInfo[]; local: ThunderDoc; remote: ThunderDoc }

/**
 * "Load from Drive": lists manuscripts in the Thunder Writer Drive folder.
 * `onImport` starts "Import from Google Drive…" (any other Drive file, via the
 * Google Picker); it must be called straight from the click.
 */
export function DriveModal({ onClose, onImport }: { onClose: () => void; onImport?: () => void }) {
  const configured = isDriveConfigured()
  const pickerReady = configured && isPickerConfigured()
  const connected = useStorageStatus((s) => s.driveConnected)
  const [view, setView] = useState<View>(() => (connected || auth.hasValidToken ? { kind: 'loading' } : { kind: 'connect' }))
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setView({ kind: 'loading' })
    try {
      setView({ kind: 'list', files: await listDriveDocs() })
    } catch (e) {
      setView({ kind: 'error', message: driveErrorMessage(e), reconnect: isDriveError(e) && e.needsReconnect })
    }
  }, [])

  useEffect(() => {
    if (configured && (connected || auth.hasValidToken)) void refresh()
    // Only on open; later refreshes are explicit.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    try {
      await connectDrive()
      await refresh()
    } catch (e) {
      setView({ kind: 'error', message: driveErrorMessage(e), reconnect: true })
    }
  }

  const load = async (file: DriveFileInfo, files: DriveFileInfo[]) => {
    setBusyId(file.id)
    setRowError(null)
    try {
      const doc = await downloadDriveDoc(file.id)
      // The editor debounces typing; make sure the check below sees the latest words.
      flushPendingEdits()
      const state = useDocuments.getState()
      const existing = state.docs[doc.id]
      // Any local edits Drive doesn't have would be lost — whichever copy is newer.
      const unsynced =
        !!existing &&
        existing.updatedAt !== doc.updatedAt &&
        (state.dirtyForDrive[doc.id] === true || (existing.driveSyncedAt ?? 0) < existing.updatedAt)
      setBusyId(null)
      if (existing && unsynced) {
        setView({ kind: 'conflict', files, local: existing, remote: doc })
        return
      }
      await openDownloadedDoc(doc)
      onClose()
    } catch (e) {
      setRowError(`${titleFromFileName(file.name)}: ${driveErrorMessage(e)}`)
      setBusyId(null)
    }
  }

  let body
  if (!configured) {
    body = (
      <div className="fm-callout">
        <p>{DRIVE_UNAVAILABLE}</p>
        <button type="button" className="tw-btn tw-btn-primary" onClick={onClose} data-autofocus="">
          OK
        </button>
      </div>
    )
  } else if (view.kind === 'connect') {
    body = (
      <div className="fm-callout">
        <p>
          Connect Google Drive to see your manuscripts. This list shows the files Thunder Writer saved, kept in a
          “Thunder Writer” folder.
          {pickerReady && (
            <>
              {' '}
              To bring in an existing Google Doc or Word file, use <strong>Import from Google Drive…</strong> below.
            </>
          )}
        </p>
        <button type="button" className="tw-btn tw-btn-primary" onClick={connect} data-autofocus="">
          Connect Google Drive
        </button>
      </div>
    )
  } else if (view.kind === 'loading') {
    body = (
      <p className="fm-empty" role="status">
        Looking in your Drive…
      </p>
    )
  } else if (view.kind === 'conflict') {
    body = (
      <ConflictChoices
        mode="open"
        local={view.local}
        remote={view.remote}
        onDone={onClose}
        onCancel={() => setView({ kind: 'list', files: view.files })}
      />
    )
  } else if (view.kind === 'error') {
    body = (
      <div className="fm-callout" role="alert">
        <p>{view.message}</p>
        <button type="button" className="tw-btn tw-btn-primary" onClick={view.reconnect ? connect : refresh} data-autofocus="">
          {view.reconnect ? 'Reconnect Google Drive' : 'Try again'}
        </button>
      </div>
    )
  } else if (view.files.length === 0) {
    body = (
      <p className="fm-empty">
        No manuscripts in the “Thunder Writer” Drive folder yet. Use “Save to Drive” to add the one you’re writing
        {pickerReady ? (
          <>
            , or <strong>Import from Google Drive…</strong> below to open an existing Google Doc or Word file.
          </>
        ) : (
          '.'
        )}
      </p>
    )
  } else {
    body = (
      <>
        {rowError && (
          <p className="fm-inline-error" role="alert">
            {rowError}
          </p>
        )}
        <ul className="fm-list" aria-label="Manuscripts in Google Drive">
          {view.files.map((f, i) => (
            <li key={f.id} className="fm-row">
              <button
                type="button"
                className="fm-row-main"
                disabled={busyId !== null}
                data-autofocus={i === 0 ? '' : undefined}
                onClick={() => load(f, view.files)}
              >
                <span className="fm-row-title">{titleFromFileName(f.name)}</span>
                <span className="fm-row-meta">
                  {busyId === f.id
                    ? 'Opening…'
                    : f.modifiedTime
                      ? `Saved ${formatWhen(Date.parse(f.modifiedTime))}`
                      : 'In Drive'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </>
    )
  }

  const importAction =
    !pickerReady || !onImport || view.kind === 'conflict' ? null : (
      <button type="button" className="tw-btn" onClick={onImport}>
        Import from Google Drive…
      </button>
    )

  const footer =
    importAction || (configured && view.kind === 'list') ? (
      <>
        {importAction && (
          <span className="fm-foot-start">
            {importAction}
            <span className="fm-foot-hint">A Google Doc, Word or text draft from anywhere in your Drive</span>
          </span>
        )}
        {configured && view.kind === 'list' && (
          <button type="button" className="tw-btn tw-btn-ghost" onClick={refresh}>
            Refresh
          </button>
        )}
      </>
    ) : undefined

  return (
    <Modal title="Open from Google Drive" onClose={onClose} footer={footer}>
      {body}
    </Modal>
  )
}
