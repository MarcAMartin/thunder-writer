import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { useEditorContext } from '../../shell/EditorContext'
import { formatCount } from '../editor/format'
import { hasGooglePicker } from '../storage/googleConfig'
import { Modal } from '../storage/Modal'
import { canSaveBackToOpenedFiles } from '../export/fsAccess'
import { modKey } from '../export/exportUi'
import { dismissImport, setImportNotice, setImportPrompt, useImportFlow, type OpenedFile } from './importFlow'
import { postponeChoice, useDesktopCopy } from '../export/desktopCopy'
import { keepBrowserVersion, keepSavingToFile, loadFileVersion, openFromComputer } from './openFromComputer'
import '../storage/storage.css'
import './import.css'

const SUPPORTED = 'Word (.docx), plain text (.txt), Markdown (.md), HTML or Thunder Writer (.thunder.json) files from your computer.'
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
        <DoneDialog
          docId={phase.docId}
          title={phase.result.title}
          words={phase.result.wordCount}
          chapters={phase.result.chapterCount}
          warnings={phase.result.warnings}
          opened={phase.opened}
          onStart={startWriting}
        />
      )}

      <ChangedFileDialog onDone={startWriting} />

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
                  void openFromComputer()
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
        <Modal title="Open a manuscript" onClose={() => setImportPrompt(false)}>
          <p className="im-lead">
            Open a draft you’ve already started, with its chapter headings and scene breaks recognised.
            {canSaveBackToOpenedFiles()
              ? ' Thunder Writer can then keep saving into that file on your computer, or leave it as it is.'
              : ' It opens as a new manuscript; the file itself isn’t changed.'}
          </p>
          <div className="im-choices">
            <button type="button" className="tw-btn tw-btn-primary im-choose" data-autofocus onClick={() => void openFromComputer()}>
              Choose a file…
            </button>
            {hasGooglePicker() && (
              <button type="button" className="tw-btn im-choose" onClick={importFromDrive}>
                Import from Google Drive…
              </button>
            )}
          </div>
          <p className="im-hint">
            {SUPPORTED}{' '}
            {hasGooglePicker()
              ? 'Draft in Google Docs? Import it straight from Google Drive; there’s no need to download it first.'
              : 'Draft in Google Docs? Choose File › Download › Microsoft Word (.docx) there, then import that.'}
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

/** The result of an import or of File › Open from computer, with the offer to keep saving into the opened file. */
function DoneDialog(props: {
  docId: string
  title: string
  words: number
  chapters: number
  warnings: string[]
  opened?: { file: OpenedFile | null }
  onStart: () => void
}) {
  const { opened, onStart } = props
  const target = opened?.file ?? null
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const keepSaving = async () => {
    if (!target || busy) return
    setBusy(true)
    setProblem(null)
    const outcome = await keepSavingToFile(props.docId, target)
    setBusy(false)
    if (outcome === 'linked') {
      setImportNotice(`Saving to “${target.file.name}” on your computer as you write.`)
      onStart()
    } else if (outcome === 'denied') {
      setProblem(`The browser didn’t allow Thunder Writer to save into “${target.file.name}”. Try again, or use Export to computer for a copy.`)
    }
  }

  const footer = target ? (
    <>
      <button type="button" className="tw-btn" onClick={onStart}>
        Not now
      </button>
      <button type="button" className="tw-btn tw-btn-primary" data-autofocus aria-busy={busy || undefined} onClick={() => void keepSaving()}>
        Keep saving to “{target.file.name}”
      </button>
    </>
  ) : (
    <button type="button" className="tw-btn tw-btn-primary" data-autofocus onClick={onStart}>
      Start writing
    </button>
  )

  return (
    <Modal title={opened ? 'Manuscript opened' : 'Manuscript imported'} onClose={onStart} footer={footer}>
      <p className="im-lead">
        {opened
          ? `“${props.title}” is open.`
          : `“${props.title}” is open as a new manuscript and saves like any other. Your original file wasn’t changed.`}
      </p>
      <dl className="im-stats">
        <div>
          <dt>Words</dt>
          <dd>{formatCount(props.words)}</dd>
        </div>
        <div>
          <dt>Chapters</dt>
          <dd>{formatCount(props.chapters)}</dd>
        </div>
      </dl>
      {props.warnings.length > 0 && (
        <ul className="im-notes" aria-label="Import notes">
          {props.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {target && (
        <div className="im-saveback">
          <p>
            <strong>Keep saving to “{target.file.name}”?</strong> Your changes go into this file on your computer as you
            write, and {modKey()}S saves it at once. It’s also saved in this browser, as always.
          </p>
          <p className="im-hint">
            {target.kind === 'docx'
              ? 'Thunder Writer rewrites the whole file from your manuscript, so anything only Word keeps (comments, tracked changes, images) is left out. '
              : ''}
            The file as it is now is kept first, in Backups › All backups, so you can always get it back.
          </p>
          {problem && (
            <p className="im-error" role="alert">
              {problem}
            </p>
          )}
        </div>
      )}
      {opened && !target && (
        <p className="im-hint">
          {canSaveBackToOpenedFiles()
            ? 'Thunder Writer can’t save back into this kind of file, so it wasn’t changed. Export to computer saves a copy in any format.'
            : 'The file itself wasn’t changed. Saving back into a file works in Chrome and Edge; here, Export to computer saves a copy whenever you like.'}
        </p>
      )}
    </Modal>
  )
}

/**
 * A file Thunder Writer saves into changed elsewhere (in Word, say). Saving to
 * it is paused until the writer picks a version; closing this leaves it
 * paused, and the header badge or Cmd/Ctrl+S brings it back.
 */
function ChangedFileDialog({ onDone }: { onDone: () => void }) {
  const docId = useDesktopCopy((s) => s.choiceFor)
  const changed = useDesktopCopy((s) => (s.choiceFor ? s.byDoc[s.choiceFor]?.changed : null))
  /** The file changed yet again while this was open: say so when the question comes back. */
  const [againAt, setAgainAt] = useState<number | null>(null)
  if (!docId || !changed) return null
  return (
    <ChangedFileQuestion
      // A new version of the file starts the question afresh (no stale error or busy state).
      key={`${docId}:${changed.file.lastModified}:${changed.file.size}`}
      docId={docId}
      changed={changed}
      changedAgain={againAt === changed.file.lastModified}
      onChangedAgain={setAgainAt}
      onDone={onDone}
    />
  )
}

function ChangedFileQuestion({
  docId,
  changed,
  changedAgain,
  onChangedAgain,
  onDone,
}: {
  docId: string
  changed: { file: File; kept: boolean }
  changedAgain: boolean
  onChangedAgain: (lastModified: number) => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const name = changed.file.name

  const attempt = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setProblem(null)
    try {
      await fn()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That didn’t work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const keepMine = () => {
    // Without a backup of the file, overwriting it can't be undone: ask once more.
    if (
      !changed.kept &&
      !window.confirm(`This browser couldn’t keep a backup of “${name}” as it is now. Write this browser’s version over it anyway? Its current contents couldn’t be brought back.`)
    )
      return
    void attempt(async () => {
      const r = await keepBrowserVersion(docId)
      if (r === 'written') {
        setImportNotice(`Saved this browser’s version into “${name}”.`)
        onDone()
      } else if (r === 'changed-again') {
        const latest = useDesktopCopy.getState().byDoc[docId]?.changed?.file
        if (latest) onChangedAgain(latest.lastModified)
      } else if (r === 'denied') setProblem(`The browser didn’t allow Thunder Writer to save into “${name}”. Try again.`)
      else setProblem(`“${name}” couldn’t be written. Try again.`)
    })
  }

  const useFile = () =>
    void attempt(async () => {
      if ((await loadFileVersion(docId)) === 'loaded') {
        setImportNotice(`Opened the version in “${name}”.`)
        onDone()
      }
    })

  return (
    <Modal
      title={`“${name}” changed on your computer`}
      onClose={postponeChoice}
      footer={
        <>
          <button type="button" className="tw-btn" aria-busy={busy || undefined} onClick={keepMine}>
            Keep this browser’s version
          </button>
          <button
            type="button"
            className="tw-btn tw-btn-primary"
            data-autofocus
            aria-busy={busy || undefined}
            onClick={useFile}
          >
            Use the file’s version
          </button>
        </>
      }
    >
      <p className="im-lead">
        {changedAgain
          ? 'It changed again while you were deciding, so that newer version has been kept in Backups too. Which version do you want to keep writing?'
          : 'It was changed outside Thunder Writer (in Word, say) since Thunder Writer last saved it, so saving into it is paused. Which version do you want to keep writing?'}
      </p>
      <p className="im-hint">
        {changed.kept
          ? 'Nothing is lost either way: the file as it is now has been kept in Backups › All backups, and this browser’s version is kept there too if you use the file’s.'
          : 'This browser couldn’t keep a backup of the file as it is now, so keeping this browser’s version would replace it for good.'}
      </p>
      {problem && (
        <p className="im-error" role="alert">
          {problem}
        </p>
      )}
    </Modal>
  )
}
