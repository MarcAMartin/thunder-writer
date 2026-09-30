import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { EditorContext } from '../../shell/EditorContext'
import { ThemeToggle } from '../../shell/ThemeToggle'
import { useDocuments } from '../../store/documents'
import { useSession } from '../../store/session'
import type { EditorContextValue } from '../../contracts'
import { SuggestionsPane } from '../suggestions/SuggestionsPane'
import { FileMenu } from '../storage/FileMenu'
import { ImportHost } from '../import/ImportHost'
import { useManuscriptDrop } from '../import/useManuscriptDrop'
import { DesktopCopyBadge, ExportHost, SaveToComputerMenu, useExportUi } from '../export'
import { createEditorBridge } from './bridge'
import { sanitizeContent } from './contentCheck'
import { PageView } from './PageView'
import { resolveFormat } from './presets'
import { StatusBar } from './StatusBar'
import { DocTitle, Toolbar } from './Toolbar'
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

/** Once storage has hydrated, make sure there is a document to write in. */
function useEnsureCurrentDoc() {
  const hydrated = useDocuments((s) => s.hydrated)
  const currentId = useDocuments((s) => s.currentId)
  useEffect(() => {
    if (!hydrated) return
    // Read live state (not the render closure) so StrictMode's double effect can't create two docs.
    const s = useDocuments.getState()
    if (s.currentId && s.docs[s.currentId]) return
    const latest = Object.values(s.docs).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (latest) s.openDoc(latest.id)
    else s.createDoc()
  }, [hydrated, currentId])
  return { hydrated, currentId }
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

  return (
    <EditorContext.Provider value={ctx}>
      <div className="ed-app">
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
            <div className="ed-filemenu">
              <FileMenu
                afterMenu={<SaveToComputerMenu />}
                afterStatus={<DesktopCopyBadge />}
                onSaveToComputer={openSaveToComputer}
              />
            </div>
            <div className="ed-topbar-spacer" />
            <ThemeToggle />
            <Link to="/settings" className="tw-btn tw-btn-ghost ed-settings-link">
              Settings
            </Link>
          </div>
          <Toolbar />
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
        <div className="ed-side">
          <SuggestionsPane />
        </div>
        <StatusBar />
        {/* Save to computer: desktop copy service, Cmd/Ctrl+S, the Save dialog and its toast. */}
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
