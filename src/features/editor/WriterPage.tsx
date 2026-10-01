import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { EditorContext } from '../../shell/EditorContext'
import { ThemeToggle } from '../../shell/ThemeToggle'
import { useDocuments } from '../../store/documents'
import { useSession } from '../../store/session'
import type { EditorContextValue } from '../../contracts'
import { SuggestionsPane } from '../suggestions/SuggestionsPane'
import { BackupsMenu } from '../backups/BackupsMenu'
import { SuggestionButton } from '../feedback/SuggestionButton'
import { FileMenu } from '../storage/FileMenu'
import { ImportHost } from '../import/ImportHost'
import { discardUntouchedCurrentDoc } from '../import/importFlow'
import { useManuscriptDrop } from '../import/useManuscriptDrop'
import { DesktopCopyBadge, ExportHost, SaveToComputerMenu, useExportUi } from '../export'
import { createEditorBridge } from './bridge'
import { sanitizeContent } from './contentCheck'
import { PageView } from './PageView'
import { resolveFormat } from './presets'
import { StatusBar } from './StatusBar'
import { DocTitle, Toolbar } from './Toolbar'
import { ExitFocusButton, otherDialogOpen } from './BookTools'
import { setFocusMode, useFocusMode } from './focusMode'
import { useTypewriterSounds } from './useTypewriterSounds'
import { useManuscriptEditor } from './useManuscriptEditor'
import './editor.css'

const openSaveToComputer = () => useExportUi.getState().openChooser()

function Bolt() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M13.5 2 4 13.5h6.5L9.5 22 20 9.5h-6.8L13.5 2Z" fill="var(--tw-bolt)" stroke="var(--tw-text)" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Once storage has hydrated, make sure there is a document to write in: the
 * last one open, or a fresh one for /write?new=1 (Home › Start Writing).
 */
function useEnsureCurrentDoc() {
  const hydrated = useDocuments((s) => s.hydrated)
  const currentId = useDocuments((s) => s.currentId)
  const [params, setParams] = useSearchParams()
  const { key } = useLocation()
  const wantsNew = params.has('new')
  /** The navigation whose ?new=1 was handled: StrictMode replays effects before the param is gone. */
  const startedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!hydrated) return
    if (wantsNew) {
      if (startedFor.current === key) return
      startedFor.current = key
      // A blank manuscript left from an earlier Start Writing is replaced, not piled up.
      discardUntouchedCurrentDoc()
      useDocuments.getState().createDoc()
      const next = new URLSearchParams(params)
      next.delete('new')
      setParams(next, { replace: true })
      return
    }
    // Read live state (not the render closure) so StrictMode's double effect can't create two docs.
    const s = useDocuments.getState()
    if (s.currentId && s.docs[s.currentId]) return
    const latest = Object.values(s.docs).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (latest) s.openDoc(latest.id)
    else s.createDoc()
  }, [hydrated, currentId, wantsNew, key, params, setParams])
  // Until the new manuscript exists, don't load the previous one into the editor.
  return { hydrated: hydrated && !wantsNew, currentId }
}

export function WriterPage() {
  const { hydrated, currentId } = useEnsureCurrentDoc()
  const format = useDocuments((s) => (s.currentId ? s.docs[s.currentId]?.format : undefined))
  const title = useDocuments((s) => (s.currentId ? (s.docs[s.currentId]?.title ?? '') : ''))
  const resolved = useMemo(() => resolveFormat(format), [format])
  const { editor, contentError } = useManuscriptEditor(hydrated ? currentId : null)
  const startWritingSession = useSession((s) => s.startWritingSession)
  // Dropping a .docx/.txt/.md/.html file anywhere on the page imports it as a new manuscript.
  const dragging = useManuscriptDrop()

  // The session clock starts the first time the writer opens the editor. Coming
  // back from Settings (a remount) must not zero the time, cost or open cards.
  useEffect(() => {
    startWritingSession()
  }, [startWritingSession])

  // Suggestions quote the manuscript they were made for; when the writer switches
  // manuscripts, tuck the old doc's open cards away (they keep counting in stats).
  const prevDocId = useRef<string | null>(null)
  useEffect(() => {
    if (!currentId) return
    const prev = prevDocId.current
    prevDocId.current = currentId
    if (prev === null || prev === currentId) return
    const s = useSession.getState()
    for (const sg of s.suggestions) if (sg.status === 'open') s.setSuggestionStatus(sg.id, 'hidden')
    s.setActiveSuggestion(null)
  }, [currentId])

  const ctx = useMemo<EditorContextValue>(
    () => ({ editor, bridge: editor ? createEditorBridge(editor) : null }),
    [editor],
  )

  const ready = hydrated && Boolean(currentId) && Boolean(format)
  /** Beside the title: where the File menu (now in the toolbar) puts the save status. */
  const [statusSlot, setStatusSlot] = useState<HTMLDivElement | null>(null)
  const focus = useFocusMode((s) => s.on)
  useTypewriterSounds()

  // Focus Mode: Escape leaves it (not while a dialog is open, which Escape closes instead),
  // and the cursor stays in the manuscript either way.
  const firstFocusRun = useRef(true)
  useEffect(() => {
    if (firstFocusRun.current) {
      firstFocusRun.current = false
      return
    }
    editor?.commands.focus()
    // Only on switching, not when the editor instance changes.
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focus) return
    // Capture phase: the editor handles Escape itself before it would reach a normal listener.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || otherDialogOpen()) return
      e.preventDefault()
      void setFocusMode(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [focus])
  // Leaving the writer page leaves Focus Mode, so the next visit shows everything.
  useEffect(() => () => useFocusMode.setState({ on: false }), [])

  return (
    <EditorContext.Provider value={ctx}>
      <div className={focus ? 'ed-app ed-focus' : 'ed-app'}>
        <a
          className="ed-skip"
          href="#manuscript"
          onClick={(e) => {
            e.preventDefault()
            editor?.commands.focus()
          }}
        >
          Skip to manuscript
        </a>
        <header className="ed-header">
          <div className="ed-topbar">
            <Link to="/" className="ed-brand" aria-label="Thunder Writer home">
              <Bolt />
              <span className="ed-brand-name">Thunder Writer</span>
            </Link>
            <DocTitle />
            <div ref={setStatusSlot} className="ed-docstatus" />
            <div className="ed-topbar-spacer" />
            <ThemeToggle />
            <SuggestionButton />
            <Link to="/settings" className="tw-btn tw-btn-ghost ed-settings-link">
              Settings
            </Link>
          </div>
          {/* File, Export to computer and Backups lead the first row of controls, as in word processors. */}
          <Toolbar
            leading={
              <FileMenu
                afterMenu={
                  <>
                    <SaveToComputerMenu />
                    <BackupsMenu />
                  </>
                }
                afterStatus={<DesktopCopyBadge />}
                onSaveToComputer={openSaveToComputer}
                statusContainer={statusSlot}
              />
            }
          />
        </header>
        <main className="ed-main" id="manuscript" aria-label="Manuscript pages" aria-busy={!ready}>
          {ready && contentError ? (
            <UnreadableManuscript message={contentError} />
          ) : ready ? (
            <PageView editor={editor} format={resolved} headerFooter={format?.headerFooter} title={title} />
          ) : (
            <div className="ed-loading" role="status">
              <Bolt />
              <span>Opening your manuscript…</span>
            </div>
          )}
        </main>
        {/* Out of Focus Mode entirely, so suggestions pause rather than pile up unseen. */}
        {!focus && (
          <div className="ed-side">
            <SuggestionsPane />
          </div>
        )}
        {focus && <ExitFocusButton />}
        <StatusBar />
        {/* Export to computer: desktop copy service, Cmd/Ctrl+S, the Export dialog and its toast. */}
        <ExportHost />
        <ImportHost dragging={dragging} />
      </div>
    </EditorContext.Provider>
  )
}

/**
 * Shown instead of the pages when the stored content can't be loaded
 * faithfully. The original is never modified; the writer can open a repaired
 * copy (unsupported formatting removed, text kept) as a separate manuscript.
 */
function UnreadableManuscript({ message }: { message: string }) {
  const doc = useDocuments((s) => (s.currentId ? s.docs[s.currentId] : undefined))
  if (!doc) return null
  const openRepaired = () => {
    useDocuments.getState().createDoc({
      title: `${doc.title} (repaired)`,
      content: sanitizeContent(doc.content),
      format: doc.format,
    })
  }
  return (
    <div className="ed-unreadable" role="alert">
      <h2>“{doc.title}” can’t be opened safely</h2>
      <p>{message}</p>
      <p>
        Your original is untouched — nothing will be saved over it. You can keep a copy with File → Download backup,
        or open a repaired copy with the unsupported formatting removed and all the text kept.
      </p>
      <button type="button" className="tw-btn tw-btn-primary" onClick={openRepaired}>
        Open a repaired copy
      </button>
    </div>
  )
}
