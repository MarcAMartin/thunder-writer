import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { formatCount } from '../editor/format'
import { Modal } from '../storage/Modal'
import { dismissImport, openImportPicker, setImportPrompt, useImportFlow } from './importFlow'
import '../storage/storage.css'
import './import.css'

const SUPPORTED = 'Word (.docx), plain text (.txt), Markdown (.md) or HTML (for a Google Doc, choose File › Download › Microsoft Word in Google Docs first)'

/**
 * Mount once on the writer page. Shows import progress, the result (words,
 * chapters, anything left out) or the error, and the "Choose a file to
 * import" prompt for /write?import=local. Pass `dragging` from
 * useManuscriptDrop to show the drop hint.
 */
export function ImportHost({ dragging = false }: { dragging?: boolean }) {
  const phase = useImportFlow((s) => s.phase)
  const prompt = useImportFlow((s) => s.prompt)
  const [params, setParams] = useSearchParams()

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
        </div>
      )}

      {phase.kind === 'done' && (
        <Modal
          title="Manuscript imported"
          onClose={dismissImport}
          footer={
            <button type="button" className="tw-btn tw-btn-primary" data-autofocus onClick={dismissImport}>
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
          <button type="button" className="tw-btn tw-btn-primary im-choose" data-autofocus onClick={openImportPicker}>
            Choose a file to import
          </button>
          <p className="im-hint">{SUPPORTED}.</p>
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
