import { useEffect, useRef, useState } from 'react'
import type { ThunderDoc } from '../../types'
import { driveErrorMessage } from './drive'
import { keepBothVersions, openDownloadedDoc, saveDocToDrive } from './driveSession'
import { formatWhen } from './OpenLocalModal'

export type ConflictMode =
  /** Opening a Drive file while this browser has unsynced edits to it. */
  | 'open'
  /** Autosave found the Drive file changed elsewhere since the last sync. */
  | 'resolve'

interface Props {
  mode: ConflictMode
  local: ThunderDoc
  remote: ThunderDoc
  onDone: () => void
  onCancel: () => void
}

/**
 * Two versions of one manuscript: this browser's (with edits Drive doesn't
 * have) and Google Drive's. Nothing is replaced without the writer choosing;
 * "Keep both" loses nothing.
 */
export function ConflictChoices({ mode, local, remote, onDone, onCancel }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstRef = useRef<HTMLButtonElement>(null)
  useEffect(() => firstRef.current?.focus(), [])

  const run = async (fn: () => unknown) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onDone()
    } catch (e) {
      setError(driveErrorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="fm-callout fm-conflict" role="group" aria-labelledby="fm-conflict-title">
      <p id="fm-conflict-title">
        <strong>“{local.title}”</strong>{' '}
        {mode === 'open'
          ? 'has edits in this browser that aren’t in Google Drive yet.'
          : 'was changed in Google Drive (on another device or tab) since this browser last synced it.'}
      </p>
      <dl className="fm-conflict-versions">
        <div>
          <dt>This browser</dt>
          <dd>Edited {formatWhen(local.updatedAt)}</dd>
        </div>
        <div>
          <dt>Google Drive</dt>
          <dd>Edited {formatWhen(remote.updatedAt)}</dd>
        </div>
      </dl>
      {error && (
        <p className="fm-inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="fm-conflict-actions">
        <button
          ref={firstRef}
          type="button"
          className="tw-btn tw-btn-primary"
          disabled={busy}
          onClick={() => run(() => keepBothVersions(local.id, remote, mode === 'open' ? 'remote' : 'local'))}
        >
          Keep both
        </button>
        {mode === 'resolve' && (
          <button
            type="button"
            className="tw-btn"
            disabled={busy}
            onClick={() => run(() => saveDocToDrive(local.id, { force: true }))}
          >
            Keep this browser’s version
          </button>
        )}
        <button type="button" className="tw-btn" disabled={busy} onClick={() => run(() => openDownloadedDoc(remote))}>
          {mode === 'open' ? 'Replace with the Drive version' : 'Use the Drive version'}
        </button>
        <button type="button" className="tw-btn tw-btn-ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="fm-conflict-hint">
        {mode === 'open'
          ? `“Keep both” opens the Drive version as its own manuscript and keeps this browser’s copy as “${local.title} (this browser)”.`
          : `“Keep both” keeps you in this browser’s copy, renamed “${local.title} (this browser)” and saved to Drive as a new file, and adds the Drive version as its own manuscript.`}
      </p>
    </div>
  )
}
