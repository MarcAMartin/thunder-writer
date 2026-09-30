import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** Small accessible dialog: Escape closes, focus is trapped and restored. */
export function Modal({ title, onClose, children, footer }: ModalProps) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

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

  return createPortal(
    <div
      className="fm-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="fm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel} tabIndex={-1}>
        <header className="fm-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="tw-btn tw-btn-ghost fm-icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="fm-dialog-body">{children}</div>
        {footer && <footer className="fm-dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
