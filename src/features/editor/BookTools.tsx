import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useDocuments } from '../../store/documents'
import { flushPendingEdits } from '../../store/pendingEdits'
import type { BookLayoutOptions, DocFormat, HeaderFooterSettings } from '../../types'

// The preview (typesetting engine, page turns) and the settings dialog load on first use.
const BookPreview = lazy(() => import('../preview/BookPreview').then((m) => ({ default: m.BookPreview })))
const HeaderFooterDialog = lazy(() => import('./HeaderFooterDialog').then((m) => ({ default: m.HeaderFooterDialog })))

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** The Book preview shortcut as the toolbar shows it. */
export const PREVIEW_SHORTCUT = isMac ? '⌘⌥P' : 'Ctrl+Alt+P'

/**
 * Cmd+Option+P (Mac) / Ctrl+Alt+P (elsewhere) opens the Book preview.
 * Free in TipTap (its Mod-Alt keys are 0-6 for headings, C for code) and in
 * the major browsers (Cmd/Ctrl+Shift+P opens a private window in Firefox).
 * On a Mac, Option changes the typed letter (π), so the physical key is used;
 * elsewhere a typed character other than p (AltGr = Ctrl+Alt on some layouts)
 * is left alone so no one loses a character.
 */
export function isPreviewShortcut(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  mac = isMac,
): boolean {
  if (!e.altKey || e.shiftKey) return false
  if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return false
  if (mac) return e.code === 'KeyP'
  if (/^.$/u.test(e.key)) return e.key.toLowerCase() === 'p'
  return e.code === 'KeyP'
}

/** Index of the top-level block holding the writer's cursor (where the preview opens). */
export function cursorBlock(editor: Editor | null): number | undefined {
  if (!editor || editor.isDestroyed) return undefined
  try {
    const { doc, selection } = editor.state
    if (doc.childCount === 0) return undefined
    return Math.min(doc.childCount - 1, doc.resolve(selection.from).index(0))
  } catch {
    return undefined
  }
}

function BookIcon() {
  return (
    <svg className="ed-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5zM12 6v13" />
    </svg>
  )
}

function HeadFootIcon() {
  return (
    <svg className="ed-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M8 6.5h8M8 17.5h8" />
      <path d="M8 10h8M8 13h5" strokeWidth="1.2" opacity="0.55" />
    </svg>
  )
}

/** Header/footer and book-layout settings of the current doc, saved through updateFormat (and so to Drive). */
function useBookSettings() {
  const currentId = useDocuments((s) => s.currentId)
  const format = useDocuments((s) => (s.currentId ? s.docs[s.currentId]?.format : undefined))
  const updateFormat = useDocuments((s) => s.updateFormat)
  const patch = (p: Partial<DocFormat>) => {
    if (currentId) updateFormat(currentId, p)
  }
  return {
    currentId,
    format,
    onHeaderFooterChange: (hf: HeaderFooterSettings) => patch({ headerFooter: hf }),
    onBookLayoutChange: (o: BookLayoutOptions) => patch({ bookLayout: o }),
  }
}

/** A modal dialog is open somewhere on the page. */
export const otherDialogOpen = () => document.querySelector('[role="dialog"][aria-modal="true"]') !== null

/**
 * Toolbar › Preview: the manuscript typeset as a printed book, opened at the
 * writer's place. Also opened with Cmd/Ctrl+Alt+P. Header/footer and book
 * layout changes made in the preview are saved to the manuscript.
 */
export function PreviewButton({ editor }: { editor: Editor | null }) {
  const { currentId, format, onHeaderFooterChange, onBookLayoutChange } = useBookSettings()
  const [open, setOpen] = useState<{ block: number | undefined } | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  const editorRef = useRef(editor)
  editorRef.current = editor

  const show = () => {
    if (!useDocuments.getState().currentId) return
    // The editor debounces typing into the store; the preview typesets the stored words.
    flushPendingEdits()
    setOpen({ block: cursorBlock(editorRef.current) })
  }
  const showRef = useRef(show)
  showRef.current = show

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || !isPreviewShortcut(e)) return
      e.preventDefault()
      // Not over another open dialog (Headers & footers, Save to computer, a Drive conflict…):
      // the full-screen preview would cover it and take its focus.
      if (!openRef.current && !otherDialogOpen()) showRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        type="button"
        className="ed-tool ed-tool-text ed-preview-btn"
        disabled={!currentId}
        title={`Book preview — see the pages as a printed book, turn them, and set headers & footers (${PREVIEW_SHORTCUT})`}
        aria-keyshortcuts={isMac ? 'Meta+Alt+P' : 'Control+Alt+P'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={show}
      >
        <BookIcon />
        <span>Preview</span>
      </button>
      {open && currentId && (
        <Suspense fallback={null}>
        <BookPreview
          docId={currentId}
          initialBlock={open.block}
          headerFooter={format?.headerFooter}
          onHeaderFooterChange={onHeaderFooterChange}
          layoutOptions={format?.bookLayout}
          onLayoutOptionsChange={onBookLayoutChange}
          onClose={() => {
            setOpen(null)
            editorRef.current?.commands.focus()
          }}
        />
        </Suspense>
      )}
    </>
  )
}

/** Toolbar › Headers & footers…: running heads, footer line, page numbers and book layout, without opening the preview. */
export function HeaderFooterButton() {
  const { currentId, format } = useBookSettings()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="ed-tool ed-tool-text ed-hf-btn"
        disabled={!currentId || !format}
        title="Headers & footers — running heads, author name, footer line and page numbers for the printed book and exports"
        aria-haspopup="dialog"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(true)}
      >
        <HeadFootIcon />
        <span>Headers &amp; footers…</span>
      </button>
      {open && currentId && (
        <Suspense fallback={null}>
          <HeaderFooterDialog onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
