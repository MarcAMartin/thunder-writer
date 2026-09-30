import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEditorContext } from '../../shell/EditorContext'
import type { DriveImportOutcome } from './driveImport'
import { importErrorMessage } from './driveImport'
import {
  createImportedManuscript,
  importPickedDriveFile,
  isDriveConfigured,
  isDriveError,
  isPickerConfigured,
  pickDriveFile,
  useStorageStatus,
} from './driveSession'
import { Modal } from './Modal'
import type { PickedFile } from './picker'

type Phase =
  | { kind: 'setup' }
  | { kind: 'prompt' }
  | { kind: 'picking' }
  | { kind: 'importing'; file: PickedFile }
  | { kind: 'done'; title: string; outcome: DriveImportOutcome }
  | { kind: 'error'; message: string; reconnect: boolean }

const n = (v: number) => v.toLocaleString()
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`

/**
 * "Import from Google Drive…": the Picker, then download + convert, then a
 * small result dialog. `pick` is the Picker already opened from the writer's
 * click (pickDriveFile()); null shows a prompt button first, because a Picker
 * or consent popup opened without a click is blocked by the browser.
 */
export function DriveImportFlow({ pick, onClose }: { pick: Promise<PickedFile | null> | null; onClose: () => void }) {
  const [current, setCurrent] = useState<Promise<PickedFile | null> | null>(pick)
  const [phase, setPhase] = useState<Phase>(() =>
    pick ? { kind: 'picking' } : isDriveConfigured() && isPickerConfigured() ? { kind: 'prompt' } : { kind: 'setup' },
  )
  const connected = useStorageStatus((s) => s.driveConnected)
  // Refs survive StrictMode's effect replay, so each Picker session is handled exactly once.
  const handled = useRef<Promise<PickedFile | null> | null>(null)
  const closed = useRef(false)

  const close = () => {
    closed.current = true
    onClose()
  }
  const { editor } = useEditorContext()
  /** Closes the result and puts the cursor at the start of the new manuscript. */
  const startWriting = () => {
    close()
    setTimeout(() => editor?.commands.focus('start'), 0)
  }

  useEffect(() => {
    if (!current || handled.current === current) return
    handled.current = current
    const run = async () => {
      setPhase({ kind: 'picking' })
      let file: PickedFile | null
      try {
        file = await current
      } catch (e) {
        if (handled.current !== current || closed.current) return
        setPhase({ kind: 'error', message: importErrorMessage(e), reconnect: isDriveError(e) && e.needsReconnect })
        return
      }
      if (handled.current !== current || closed.current) return
      if (!file) {
        close()
        return
      }
      setPhase({ kind: 'importing', file })
      try {
        const outcome = await importPickedDriveFile(file)
        if (handled.current !== current || closed.current) return
        const doc = createImportedManuscript(outcome)
        setPhase({ kind: 'done', title: doc.title, outcome })
      } catch (e) {
        if (handled.current !== current || closed.current) return
        setPhase({ kind: 'error', message: importErrorMessage(e), reconnect: isDriveError(e) && e.needsReconnect })
      }
    }
    void run()
    // `close` only reads refs and the latest onClose.
  }, [current]) // eslint-disable-line react-hooks/exhaustive-deps

  /** From a click: opens the Picker (and consent popup if needed) right away. */
  const pickAgain = () => {
    const p = pickDriveFile()
    // Avoid an unhandled rejection before the effect picks it up.
    p.catch(() => undefined)
    setCurrent(p)
    setPhase({ kind: 'picking' })
  }

  // The Google Picker draws its own dialog; ours would sit on top of it.
  if (phase.kind === 'picking') return null

  let body
  let footer
  if (phase.kind === 'setup') {
    body = (
      <div className="fm-callout">
        <p>
          {isDriveConfigured()
            ? 'Importing Google Docs and Word files from your Drive needs a Google API key for the Google Picker, in addition to the OAuth client ID. Add it in Settings → Google Drive.'
            : 'Google Drive needs a one-time setup: add your Google OAuth client ID and a Google API key in Settings.'}
        </p>
        <Link to="/settings#drive" className="tw-btn tw-btn-primary" onClick={close} data-autofocus="">
          Open Settings
        </Link>
      </div>
    )
  } else if (phase.kind === 'prompt') {
    body = (
      <div className="fm-callout">
        <p>
          Pick a Google Doc, Word (.docx), text, Markdown or HTML file in your Drive. Thunder Writer makes a new
          manuscript from it; the original file is never changed.
        </p>
        <button type="button" className="tw-btn tw-btn-primary" onClick={pickAgain} data-autofocus="">
          Choose a file from Google Drive…
        </button>
      </div>
    )
  } else if (phase.kind === 'importing') {
    body = (
      <p className="fm-empty" role="status">
        Importing “{phase.file.name}”…
      </p>
    )
  } else if (phase.kind === 'error') {
    body = (
      <div className="fm-callout" role="alert">
        <p>{phase.message}</p>
        <button type="button" className="tw-btn tw-btn-primary" onClick={pickAgain} data-autofocus="">
          {phase.reconnect ? 'Reconnect and pick a file' : 'Pick a file again'}
        </button>
      </div>
    )
  } else {
    const o = phase.outcome
    body = (
      <div className="fm-callout fm-import-done" role="status">
        <p>
          <strong>“{phase.title}”</strong> is ready
          {o.kind === 'manuscript' ? (
            <>
              : {plural(o.result.wordCount, 'word')}, {plural(o.result.chapterCount, 'chapter')}.
            </>
          ) : (
            '.'
          )}
        </p>
        {o.kind === 'manuscript' && o.result.warnings.length > 0 && (
          <ul className="fm-import-warnings" aria-label="Import notes">
            {o.result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        <p className="fm-import-hint">
          “{o.file.name}” in Google Drive was not changed.{' '}
          {connected
            ? 'This new manuscript autosaves to the Thunder Writer folder in your Drive.'
            : 'This new manuscript is saved in this browser; connect Google Drive to back it up there.'}
        </p>
      </div>
    )
    footer = (
      <button type="button" className="tw-btn tw-btn-primary" onClick={startWriting} data-autofocus="">
        Start writing
      </button>
    )
  }

  return (
    <Modal title="Import from Google Drive" onClose={close} footer={footer}>
      {body}
    </Modal>
  )
}
