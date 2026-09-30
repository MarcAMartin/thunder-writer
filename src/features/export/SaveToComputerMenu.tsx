import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { currentDoc, useDocuments } from '../../store/documents'
import { isDesktopCopySupported, useDesktopCopy } from './desktopCopy'
import { saveCurrentDocOnce, useExportUi } from './exportUi'
import { EXPORT_FORMATS, MENU_ORDER, type ExportKind } from './formats'
import './export.css'

/**
 * "Save to computer ▾": one-off saves in every format (Word first), plus the
 * entry point for "Keep a copy on my computer". Keyboard: Enter/Space/↓ opens,
 * ↑/↓/Home/End move, Escape closes.
 */
export function SaveToComputerMenu({ align = 'start' }: { align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const doc = useDocuments(currentDoc)
  const copy = useDesktopCopy((s) => (doc ? s.byDoc[doc.id] : undefined))
  const openChooser = useExportUi((s) => s.openChooser)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
  }, [open])

  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (n: number) => {
      e.preventDefault()
      items[(n + items.length) % items.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') close(false)
  }

  // No awaits before saveCurrentDocOnce: the native Save dialog needs the click.
  const save = (kind: ExportKind) => {
    close()
    void saveCurrentDocOnce(kind)
  }

  const copyLabel = copy ? `Desktop copy: ${copy.fileName}…` : 'Keep a copy on my computer…'

  return (
    <div className="ex-menu-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="tw-btn ex-trigger"
        aria-label="Save to computer"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={!doc}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {/* Narrow screens show just "Save ▾"; the accessible name stays "Save to computer". */}
        Save<span className="ex-trigger-long"> to computer</span> <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div
          id={menuId}
          ref={menuRef}
          className={`ex-menu${align === 'end' ? ' ex-menu-end' : ''}`}
          role="menu"
          aria-label="Save to computer"
          onKeyDown={onMenuKey}
        >
          <div className="ex-group-label" aria-hidden="true">
            Save a copy now
          </div>
          {MENU_ORDER.map((kind) => (
            <FormatItem key={kind} kind={kind} onSelect={() => save(kind)} />
          ))}
          <div className="ex-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="ex-item"
            onClick={() => {
              close()
              openChooser()
            }}
          >
            <span className="ex-item-label">{copyLabel}</span>
            <span className="ex-item-hint">
              {isDesktopCopySupported()
                ? 'Updates a file on your computer automatically while you write.'
                : 'Needs Chrome or Edge. You can still save a copy any time.'}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

function FormatItem({ kind, onSelect }: { kind: ExportKind; onSelect: () => void }) {
  const hintId = useId()
  const f = EXPORT_FORMATS[kind]
  return (
    <button type="button" role="menuitem" tabIndex={-1} className="ex-item" aria-describedby={hintId} onClick={onSelect}>
      <span className="ex-item-label">
        {f.label}
        {kind === 'docx' && <span className="ex-badge">Recommended</span>}
      </span>
      <span id={hintId} className="ex-item-hint">
        {f.hint}
      </span>
    </button>
  )
}
