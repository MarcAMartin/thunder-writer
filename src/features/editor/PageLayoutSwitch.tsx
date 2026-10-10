import { useMemo, type ReactNode } from 'react'
import { useSettings } from '../../store/settings'
import { effectiveLayout, supportsSpread, type PageLayout } from './pageLayouts'

const LAYOUT_ICON: Record<PageLayout, ReactNode> = {
  scroll: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4.5" y="1.5" width="7" height="6" rx="0.8" />
      <rect x="4.5" y="9" width="7" height="6" rx="0.8" />
    </svg>
  ),
  spread: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5.8" height="5.8" rx="0.8" />
      <rect x="8.7" y="1.5" width="5.8" height="5.8" rx="0.8" />
      <rect x="1.5" y="8.7" width="5.8" height="5.8" rx="0.8" />
      <rect x="8.7" y="8.7" width="5.8" height="5.8" rx="0.8" />
    </svg>
  ),
  flip: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.5C6.4 2.6 4 2.3 1.5 2.6v10c2.5-.3 4.9 0 6.5.9 1.6-.9 4-1.2 6.5-.9v-10c-2.5-.3-4.9 0-6.5.9Z" />
      <path d="M8 3.5v10" />
    </svg>
  ),
}

const LAYOUTS: { id: PageLayout; label: string; title: string }[] = [
  { id: 'scroll', label: 'Scroll', title: 'Scroll: one page after another' },
  { id: 'spread', label: 'Side by side', title: 'Side by side: two pages across, scrolling down' },
  { id: 'flip', label: 'Flip', title: 'Flip: two pages at a time, turned like a book' },
]

/**
 * Page view: one column, two across, or flipping spreads. Floats in the lower
 * right of the page area (over the pages' backdrop), where the writer looks.
 */
export function PageLayoutSwitch() {
  const wanted = useSettings((s) => s.pageLayout)
  const set = useSettings((s) => s.set)
  const spreadSupported = useMemo(supportsSpread, [])
  const current = effectiveLayout(wanted, { spreadSupported, narrow: false })
  return (
    <div className="ed-layoutctl" role="group" aria-label="Page view">
      {LAYOUTS.map((l) => {
        const unavailable = l.id === 'spread' && !spreadSupported
        return (
          <button
            key={l.id}
            type="button"
            className="ed-layoutctl-btn"
            aria-label={l.label}
            aria-pressed={current === l.id}
            disabled={unavailable}
            title={unavailable ? 'Side by side needs Chrome or Edge (this browser can’t lay pages out in rows yet)' : l.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => set({ pageLayout: l.id })}
          >
            {LAYOUT_ICON[l.id]}
            <span className="ed-layoutctl-label">{l.label}</span>
          </button>
        )
      })}
    </div>
  )
}
