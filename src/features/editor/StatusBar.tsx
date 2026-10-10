import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { useEditorContext } from '../../shell/EditorContext'
import { useSession } from '../../store/session'
import { clampSetting, SETTING_BOUNDS, useSettings } from '../../store/settings'
import { describeElapsed, formatCost, formatCount, formatElapsed } from './format'
import { effectiveLayout, supportsSpread, type PageLayout } from './pageLayouts'

/** Word count, recomputed shortly after edits (not on every keystroke). */
function useWordCount() {
  const { editor } = useEditorContext()
  const [words, setWords] = useState(0)
  useEffect(() => {
    if (!editor) return
    let t: ReturnType<typeof setTimeout> | undefined
    const count = () => {
      if (!editor.isDestroyed) setWords(editor.storage.characterCount.words())
    }
    const onUpdate = () => {
      if (t) clearTimeout(t)
      t = setTimeout(count, 250)
    }
    count()
    editor.on('update', onUpdate)
    editor.on('create', count)
    return () => {
      if (t) clearTimeout(t)
      editor.off('update', onUpdate)
      editor.off('create', count)
    }
  }, [editor])
  return words
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function Stat({ label, value, title, sr }: { label: string; value: string; title?: string; sr?: string }) {
  return (
    <div className="ed-stat" title={title}>
      <dt>{label}</dt>
      <dd>
        <span aria-hidden={sr ? true : undefined}>{value}</span>
        {sr && <span className="ed-sr">{sr}</span>}
      </dd>
    </div>
  )
}

/** Page zoom, 100–250%: 100% fits the page to the window, more makes it bigger. */
function ZoomSlider() {
  const zoom = useSettings((s) => clampSetting('pageZoom', s.pageZoom))
  const set = useSettings((s) => s.set)
  const id = useId()
  return (
    <div className="ed-zoomctl">
      <label htmlFor={id}>Zoom</label>
      <input
        id={id}
        type="range"
        {...SETTING_BOUNDS.pageZoom}
        step={10}
        value={zoom}
        aria-valuetext={`${zoom}%`}
        onChange={(e) => set({ pageZoom: clampSetting('pageZoom', Number(e.target.value)) })}
      />
      <span className="ed-zoomctl-value" aria-hidden="true">
        {zoom}%
      </span>
    </div>
  )
}

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

/** Page view, lower right: one column, two across, or flipping spreads. */
function PageLayoutSwitch() {
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

export function StatusBar() {
  const words = useWordCount()
  const startedAt = useSession((s) => s.startedAt)
  const available = useSession((s) => s.suggestions.filter((x) => x.status === 'open').length)
  const accepted = useSession((s) => s.suggestionsAccepted)
  const usage = useSession((s) => s.usage)
  const now = useNow(1000)
  const elapsed = now - startedAt

  const searches = usage.webSearches ?? 0
  const tokens =
    `${formatCount(usage.inputTokens)} input · ${formatCount(usage.outputTokens)} output tokens` +
    (searches > 0 ? ` · ${formatCount(searches)} web search${searches === 1 ? '' : 'es'}` : '')

  return (
    <footer className="ed-status" aria-label="Writing session">
      <ZoomSlider />
      <dl className="ed-stats">
        <Stat label="Words" value={formatCount(words)} />
        <Stat label="Time" value={formatElapsed(elapsed)} title="Time elapsed this session" sr={describeElapsed(elapsed)} />
        <Stat label="Suggestions" value={formatCount(available)} title="Suggestions available" />
        <Stat label="Accepted" value={formatCount(accepted)} title="Suggestions accepted" />
        <Stat label="AI cost" value={formatCost(usage.costUsd)} title={`Estimated AI cost this session — ${tokens}`} />
      </dl>
      <PageLayoutSwitch />
    </footer>
  )
}
