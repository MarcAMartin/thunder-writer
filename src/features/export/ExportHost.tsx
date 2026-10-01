import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDocuments } from '../../store/documents'
import { flushPendingEdits } from '../../store/pendingEdits'
import { DesktopCopyControl } from './DesktopCopyControl'
import { PDF_EXPORT, requestPdfExport } from '../preview/pdfRequest'
import { flushPendingDesktopCopy, restoreDesktopCopy, startDesktopCopyService } from './desktopCopy'
import { saveCurrentDocOnce, useExportUi } from './exportUi'
import { EXPORT_FORMATS, MENU_ORDER, type ExportKind } from './formats'
import { useSaveShortcut } from './useSaveShortcut'
import './export.css'

/**
 * Mount once on the writing page. Runs the desktop-copy service (restores the
 * current manuscript's copy, rewrites it as it changes), intercepts Cmd/Ctrl+S,
 * and renders the "Export to your computer" dialog and the save toast.
 */
export function ExportHost() {
  useDesktopCopyService()
  useSaveShortcut()
  const chooserOpen = useExportUi((s) => s.chooserOpen)
  return (
    <>
      <ExportToast />
      {chooserOpen && <SaveChooserDialog />}
    </>
  )
}

/**
 * Starts the desktop-copy service and follows the open manuscript: switching
 * writes the previous manuscript's pending changes to its file, then restores
 * the new one's copy (the badge, panel and Cmd/Ctrl+S all act on the open one).
 */
export function useDesktopCopyService(): void {
  const currentId = useDocuments((s) => s.currentId)
  useEffect(() => startDesktopCopyService(), [])
  useEffect(() => {
    if (!currentId) return
    void restoreDesktopCopy(currentId)
    return () => {
      // The editor flushes its keystrokes on switch; the old copy then catches up now.
      flushPendingEdits()
      flushPendingDesktopCopy(currentId)
    }
  }, [currentId])
}

export function ExportToast() {
  const toast = useExportUi((s) => s.toast)
  const dismiss = useExportUi((s) => s.dismissToast)
  useEffect(() => {
    if (!toast) return
    const ms = toast.tone === 'error' ? 9000 : toast.action ? 7000 : 3500
    const t = setTimeout(() => dismiss(toast.id), ms)
    return () => clearTimeout(t)
  }, [toast, dismiss])
  return (
    <div className="ex-toast-slot" aria-live="polite" aria-atomic="true">
      {toast && (
        <div className={`ex-toast ex-toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          <span className="ex-dot" aria-hidden="true" />
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className="ex-toast-btn"
              onClick={() => {
                dismiss(toast.id)
                toast.action!.run()
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** "Export to your computer": keep a desktop copy, or export a one-off copy in any format (PDF via Book Preview). */
export function SaveChooserDialog() {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const note = useExportUi((s) => s.chooserNote)
  const close = useExportUi((s) => s.closeChooser)
  const closeRef = useRef(close)
  closeRef.current = close
  const [saving, setSaving] = useState<ExportKind | null>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        if (items.length === 0) return
        const firstEl = items[0]
        const lastEl = items[items.length - 1]
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault()
          lastEl.focus()
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault()
          firstEl.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [])

  // Straight from the click: the native Save dialog must open before any await.
  const saveOnce = (kind: ExportKind) => {
    if (saving) return
    setSaving(kind)
    void saveCurrentDocOnce(kind).then((r) => {
      setSaving(null)
      if (r && r.status !== 'cancelled') closeRef.current()
    })
  }

  return createPortal(
    <div
      className="ex-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="ex-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel} tabIndex={-1}>
        <header className="ex-dialog-head">
          <h2 id={titleId}>Export to your computer</h2>
          <button type="button" className="tw-btn tw-btn-ghost ex-close" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="ex-dialog-body">
          {note && (
            <p className="ex-dialog-note" role="status">
              {note}
            </p>
          )}
          <DesktopCopyControl />
          <section className="ex-once" aria-labelledby={`${titleId}-once`}>
            <h3 id={`${titleId}-once`}>Export a copy once</h3>
            <ul className="ex-choices">
              {MENU_ORDER.map((kind) => {
                const f = EXPORT_FORMATS[kind]
                return (
                  <Fragment key={kind}>
                    <li>
                      <button
                        type="button"
                        className={`ex-choice${kind === 'docx' ? ' ex-choice-primary' : ''}`}
                        aria-disabled={saving !== null || undefined}
                        aria-describedby={`${titleId}-${kind}`}
                        onClick={() => saveOnce(kind)}
                      >
                        <span className="ex-item-label">
                          {saving === kind ? `Saving ${f.label}…` : f.label}
                          {kind === 'docx' && <span className="ex-badge">Recommended</span>}
                        </span>
                        <span id={`${titleId}-${kind}`} className="ex-item-hint">
                          {f.hint}
                        </span>
                      </button>
                    </li>
                    {kind === 'docx' && (
                      <li>
                        <button
                          type="button"
                          className="ex-choice"
                          aria-disabled={saving !== null || undefined}
                          aria-describedby={`${titleId}-pdf`}
                          onClick={() => {
                            if (saving) return
                            closeRef.current()
                            requestPdfExport()
                          }}
                        >
                          <span className="ex-item-label">{PDF_EXPORT.label}</span>
                          <span id={`${titleId}-pdf`} className="ex-item-hint">
                            {PDF_EXPORT.hint}
                          </span>
                        </button>
                      </li>
                    )}
                  </Fragment>
                )
              })}
            </ul>
          </section>
        </div>
        <footer className="ex-dialog-foot">Your manuscript is also saved in this browser as you type.</footer>
      </div>
    </div>,
    document.body,
  )
}
