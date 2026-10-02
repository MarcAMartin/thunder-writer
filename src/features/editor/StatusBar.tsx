import { useEffect, useId, useState } from 'react'
import { useEditorContext } from '../../shell/EditorContext'
import { useSession } from '../../store/session'
import { clampSetting, SETTING_BOUNDS, useSettings } from '../../store/settings'
import { describeElapsed, formatCost, formatCount, formatElapsed } from './format'

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
    </footer>
  )
}
