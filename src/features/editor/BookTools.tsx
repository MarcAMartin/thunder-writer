import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useDocuments } from '../../store/documents'
import { flushPendingEdits } from '../../store/pendingEdits'
import { usePdfRequest } from '../preview/pdfRequest'
import { setFocusMode, toggleFocusMode, useFocusMode } from './focusMode'
import type { BookLayoutOptions, DocFormat, HeaderFooterSettings, PrintSettings } from '../../types'

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
    onPrintChange: (p: PrintSettings) => patch({ print: p }),
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
  const { currentId, format, onHeaderFooterChange, onBookLayoutChange, onPrintChange } = useBookSettings()
  /** `print`: opened by Export › PDF, so it prints straight away and closes. */
  const [open, setOpen] = useState<{ block: number | undefined; print?: boolean } | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  const editorRef = useRef(editor)
  editorRef.current = editor

  const show = (print = false) => {
    if (!useDocuments.getState().currentId) return
    // The editor debounces typing into the store; the preview typesets the stored words.
    flushPendingEdits()
    setOpen({ block: cursorBlock(editorRef.current), print })
  }
  const showRef = useRef(show)
  showRef.current = show

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || !isPreviewShortcut(e)) return
      e.preventDefault()
      // Not over another open dialog (Headers & footers, Export, a Drive conflict…):
      // the full-screen preview would cover it and take its focus.
      if (!openRef.current && !otherDialogOpen()) showRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Export › PDF.
  const pdfSeq = usePdfRequest((s) => s.seq)
  const seenPdf = useRef(pdfSeq)
  useEffect(() => {
    if (pdfSeq === seenPdf.current) return
    seenPdf.current = pdfSeq
    if (!openRef.current) showRef.current(true)
  }, [pdfSeq])

  return (
    <>
      <button
        type="button"
        className="ed-tool ed-tool-text ed-preview-btn"
        disabled={!currentId}
        title={`Book preview — see the pages as a printed book, turn them, and set headers & footers (${PREVIEW_SHORTCUT})`}
        aria-keyshortcuts={isMac ? 'Meta+Alt+P' : 'Control+Alt+P'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => show()}
      >
        <BookIcon />
        <span>Preview Book</span>
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
          print={format?.print}
          onPrintChange={onPrintChange}
          printOnOpen={open.print}
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

/** The bolt from the app icon, in its yellow, for the Focus Mode buttons. */
function FocusBolt() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M13.5 2 4 13.5h6.5L9.5 22 20 9.5h-6.8L13.5 2Z" fill="#ffc83d" />
    </svg>
  )
}

/** Toolbar › Focus Mode: only the manuscript on screen (focusMode.ts). */
export function FocusModeButton() {
  const on = useFocusMode((s) => s.on)
  return (
    <button type="button" className="tw-btn ed-focus-btn" aria-pressed={on} onClick={() => void toggleFocusMode()}>
      <FocusBolt />
      Focus Mode
    </button>
  )
}

/** Floating at the top while in Focus Mode: the way back (Escape works too). */
export function ExitFocusButton() {
  return (
    <button type="button" className="ed-focus-btn ed-exit-focus" onClick={() => void setFocusMode(false)} title="Exit Focus Mode (Esc)">
      <FocusBolt />
      Exit Focus Mode
    </button>
  )
}

/** Toolbar › Headers & footers…: running heads, footer line, page numbers and book layout, without opening the preview. */
/** "Headers & footers…" beside File, Export and Backups, in the same button style (it opens a dialog, hence the "…"). */
export function HeaderFooterButton() {
  const { currentId, format } = useBookSettings()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="tw-btn ed-hf-btn"
        disabled={!currentId || !format}
        title="Headers & footers — running heads, author name, footer line and page numbers for the printed book and exports"
        aria-haspopup="dialog"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(true)}
      >
        Headers &amp; footers…
      </button>
      {open && currentId && (
        <Suspense fallback={null}>
          <HeaderFooterDialog onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
