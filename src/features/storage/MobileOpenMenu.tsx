import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { isDriveConfigured, isPickerConfigured } from './driveSession'
import './storage.css'

/**
 * Phones: the toolbar (and its File menu) is hidden, so this is how a writer
 * opens another manuscript. The Drive items hand off to the hidden File menu
 * through its deep links (?open=drive lists the manuscripts in the writer's
 * "Thunder Writer" Drive folder, with Connect if needed; ?open=picker imports
 * a Google Doc or Word file); ?new=1 starts a fresh manuscript.
 */
export function MobileOpenMenu() {
  const [open, setOpen] = useState(false)
  const [, setSearchParams] = useSearchParams()
  const menuId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const drive = isDriveConfigured()
  const picker = drive && isPickerConfigured()

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onDown = (e: Event) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const go = (param: 'open' | 'new', value: string) => {
    setOpen(false)
    setSearchParams({ [param]: value })
  }

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[(i + 1) % items.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      items[(i - 1 + items.length) % items.length]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  return (
    <div className="fm-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className="tw-btn ed-open-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
        Open
      </button>
      {open && (
        <div id={menuId} ref={menuRef} className="fm-menu fm-menu-right" role="menu" aria-label="Open a manuscript" onKeyDown={onKey}>
          {drive && (
            <button type="button" role="menuitem" className="fm-item" tabIndex={-1} onClick={() => go('open', 'drive')}>
              Your manuscripts in Google Drive
            </button>
          )}
          {picker && (
            <button type="button" role="menuitem" className="fm-item" tabIndex={-1} onClick={() => go('open', 'picker')}>
              Import a Google Doc or Word file from Drive
            </button>
          )}
          <button type="button" role="menuitem" className="fm-item" tabIndex={-1} onClick={() => go('new', '1')}>
            New manuscript
          </button>
        </div>
      )}
    </div>
  )
}
