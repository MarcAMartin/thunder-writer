import type { ReactNode } from 'react'
import { openImportPicker, useImportFlow } from './importFlow'
import './import.css'

interface ImportButtonProps {
  /** "menuitem" matches the File menu's items (role="menuitem", class fm-item). */
  variant?: 'button' | 'menuitem'
  className?: string
  children?: ReactNode
  /** Runs before the file chooser opens, e.g. to close a menu. Must not await. */
  onBeforeOpen?: () => void
  /** Element to focus if the writer cancels the file chooser (e.g. the File menu button). */
  returnFocus?: () => HTMLElement | null | undefined
}

/**
 * "Import manuscript…": opens the file chooser for .docx, Google Docs HTML,
 * .txt, .md and .html files. Needs one <ImportHost/> mounted on the page to
 * show progress and the result.
 */
export function ImportButton({ variant = 'button', className, children, onBeforeOpen, returnFocus }: ImportButtonProps) {
  const busy = useImportFlow((s) => s.phase.kind === 'importing')
  const label = children ?? 'Import manuscript…'
  const onClick = () => {
    if (busy) return
    onBeforeOpen?.()
    openImportPicker({ returnFocus })
  }
  if (variant === 'menuitem') {
    return (
      <button
        type="button"
        role="menuitem"
        className={className ?? 'fm-item'}
        tabIndex={-1}
        aria-disabled={busy || undefined}
        onClick={onClick}
      >
        {label}
      </button>
    )
  }
  return (
    <button type="button" className={className ?? 'tw-btn im-button'} onClick={onClick} disabled={busy} aria-busy={busy || undefined}>
      {busy ? 'Importing…' : label}
    </button>
  )
}
