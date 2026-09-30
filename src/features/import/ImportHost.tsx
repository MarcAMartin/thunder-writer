import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { useEditorContext } from '../../shell/EditorContext'
import { formatCount } from '../editor/format'
import { Modal } from '../storage/Modal'
import { dismissImport, openImportPicker, setImportNotice, setImportPrompt, useImportFlow } from './importFlow'
import '../storage/storage.css'
import './import.css'

const SUPPORTED = 'Word (.docx), plain text (.txt), Markdown (.md) or HTML files from your computer.'
const NOTICE_MS = 5000

/**
 * Mount once on the writer page. Shows import progress, the result (words,
 * chapters, anything left out) or the error, and the "Choose a file to
 * import" prompt for /write?import=local. Pass `dragging` from
 * useManuscriptDrop to show the drop hint.
 */
export function ImportHost({ dragging = false }: { dragging?: boolean }) {
  const phase = useImportFlow((s) => s.phase)
  const prompt = useImportFlow((s) => s.prompt)
  const notice = useImportFlow((s) => s.notice)
  const [params, setParams] = useSearchParams()
  const { editor } = useEditorContext()

  /** Closes the result and puts the cursor at the start of the new manuscript. */
  const startWriting = () => {
    dismissImport()
    // After the dialog has closed and handed focus back (to <body>, when the File menu opened the chooser).
    setTimeout(() => editor?.commands.focus('start'), 0)
  }

  /** The File menu reads ?open=picker and offers the Google Drive Picker. */
  const importFromDrive = () => {
    setImportPrompt(false)
    const next = new URLSearchParams(params)
    next.set('open', 'picker')
    setParams(next, { replace: true })
  }

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setImportNotice(null), NOTICE_MS)
    return () => clearTimeout(t)
  }, [notice])

  // /write?import=local: a file chooser can't open without a click, so show a prompt with a button.
  useEffect(() => {
    if (params.get('import') !== 'local') return
    setImportPrompt(true)
    const next = new URLSearchParams(params)
    next.delete('import')
    setParams(next, { replace: true })
  }, [params, setParams])

  return (
    <>
      {phase.kind === 'importing' && (
        <div className="im-toast" role="status">
          <span className="im-spinner" aria-hidden="true" />
          Importing “{phase.name}”…
          {notice && <span className="im-toast-note">{notice}</span>}
        </div>
      )}
      {phase.kind !== 'importing' && notice && (
        <div className="im-toast" role="status">
          {notice}
        </div>
      )}

      {phase.kind === 'done' && (
        <Modal
          title="Manuscript imported"
          onClose={dismissImport}
          footer={
            <button type="button" className="tw-btn tw-btn-primary" data-autofocus onClick={startWriting}>
              Start writing
            </button>
          }
        >
          <p className="im-lead">
            “{phase.result.title}” is open as a new manuscript and saves like any other. Your original file wasn’t changed.
          </p>
          <dl className="im-stats">
            <div>
              <dt>Words</dt>
              <dd>{formatCount(phase.result.wordCount)}</dd>
            </div>
            <div>
              <dt>Chapters</dt>
              <dd>{formatCount(phase.result.chapterCount)}</dd>
            </div>
          </dl>
          {phase.result.warnings.length > 0 && (
            <ul className="im-notes" aria-label="Import notes">
              {phase.result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {phase.kind === 'error' && (
        <Modal
          title="Couldn’t import that file"
          onClose={dismissImport}
          footer={
            <>
              <button type="button" className="tw-btn" onClick={dismissImport}>
                Close
              </button>
              <button
                type="button"
                className="tw-btn tw-btn-primary"
                data-autofocus
                onClick={() => {
                  dismissImport()
                  openImportPicker()
                }}
              >
                Choose another file
              </button>
            </>
          }
        >
          <p className="im-file">{phase.name}</p>
          <p className="im-error" role="alert">
            {phase.message}
          </p>
        </Modal>
      )}

      {prompt && phase.kind === 'idle' && (
        <Modal title="Import a manuscript" onClose={() => setImportPrompt(false)}>
          <p className="im-lead">
            Bring in a draft you’ve already started. It opens as a new manuscript, with chapter headings and scene
            breaks recognised; the original file isn’t changed.
          </p>
          <div className="im-choices">
            <button type="button" className="tw-btn tw-btn-primary im-choose" data-autofocus onClick={() => openImportPicker()}>
              Choose a file to import
            </button>
            <button type="button" className="tw-btn im-choose" onClick={importFromDrive}>
              Import from Google Drive…
            </button>
          </div>
          <p className="im-hint">
            {SUPPORTED} Draft in Google Docs? Import it straight from Google Drive; there’s no need to download it first.
          </p>
        </Modal>
      )}

      {dragging &&
        createPortal(
          <div className="im-drop" aria-hidden="true">
            <div className="im-drop-card">Drop to import as a new manuscript</div>
          </div>,
          document.body,
        )}
    </>
  )
}
