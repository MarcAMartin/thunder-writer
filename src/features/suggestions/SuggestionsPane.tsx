import { useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useEditorContext } from '../../shell/EditorContext'
import { useSession } from '../../store/session'
import { hasApiKey, useSettings } from '../../store/settings'
import { ContextFilesControl } from './ContextFilesControl'
import { BoltIcon, ChevronIcon } from './icons'
import { STATUS_LABEL, KIND_LABEL } from './labels'
import { providerLabel, type SuggestionErrorKind } from './providers/types'
import { blockReasonMessage, requestCount } from './scheduler'
import { SuggestionCard } from './SuggestionCard'
import { useLoadContextFiles } from './useContextFiles'
import { useSuggestionActions } from './useSuggestionActions'
import { useSuggestionEngine } from './useSuggestionEngine'
import './suggestions.css'

const NOTICE_MS = 4_000
const SETTINGS_FIXABLE = new Set<SuggestionErrorKind>(['auth', 'permission', 'bad_request', 'search_unavailable'])

/**
 * Right-hand "Suggestion Previews" pane. Mounts the suggestion engine, lists
 * open suggestions as cards, and can collapse to a slim rail while the writer
 * is locked in and cruising.
 */
export function SuggestionsPane() {
  const { bridge, editor } = useEditorContext()
  const engine = useSuggestionEngine(bridge, editor)
  useLoadContextFiles()
  const actions = useSuggestionActions(bridge)

  const collapsed = useSettings((s) => s.suggestionsCollapsed)
  const setSettings = useSettings((s) => s.set)
  const keyReady = useSettings(hasApiKey)
  const provider = useSettings((s) => s.provider)
  const autoEnabled = useSettings((s) => s.suggestionsEnabled)
  const maxOpen = useSettings((s) => s.maxOpenSuggestions)

  const suggestions = useSession((s) => s.suggestions)
  const activeId = useSession((s) => s.activeSuggestionId)
  const generating = useSession((s) => s.generating)
  const aiError = useSession((s) => s.aiError)
  const setAiError = useSession((s) => s.setAiError)

  const open = useMemo(() => suggestions.filter((s) => s.status === 'open'), [suggestions])
  const history = useMemo(
    () => suggestions.filter((s) => s.status === 'accepted' || s.status === 'declined' || s.status === 'done').reverse(),
    [suggestions],
  )

  const [notice, setNotice] = useState<string | null>(null)
  const hintId = useId()
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(t)
  }, [notice])

  const full = requestCount(maxOpen, open.length) === 0
  const generateDisabled = !keyReady || generating || full
  const generateHint = !keyReady
    ? blockReasonMessage('no_key')
    : full
      ? blockReasonMessage('full')
      : generating
        ? blockReasonMessage('in_flight')
        : notice

  const onGenerate = () => {
    const d = engine.generate()
    setNotice(d.fire ? null : blockReasonMessage(d.reason, d.retryInMs))
  }

  if (collapsed) {
    return (
      <aside className="sg-pane sg-rail" aria-label="Suggestions (collapsed)">
        <button
          type="button"
          className="sg-rail-btn"
          aria-expanded={false}
          aria-label={`Show suggestions${open.length ? ` (${open.length} open)` : ''}`}
          title="Show suggestions"
          onClick={() => setSettings({ suggestionsCollapsed: false })}
        >
          <ChevronIcon direction="left" />
          <BoltIcon size={18} />
          {open.length > 0 && (
            <span className="sg-badge" aria-hidden="true">
              {open.length}
            </span>
          )}
          {generating && <span className="sg-spinner sg-rail-spinner" aria-hidden="true" />}
        </button>
      </aside>
    )
  }

  return (
    <aside className="sg-pane" aria-label="Suggestions">
      <header className="sg-header">
        <div className="sg-heading">
          <BoltIcon />
          <h2 className="sg-title">Suggestions</h2>
          {open.length > 0 && (
            <span className="sg-count" aria-label={`${open.length} open`}>
              {open.length}
            </span>
          )}
        </div>
        <button
          type="button"
          className="tw-btn tw-btn-ghost sg-hide-btn"
          aria-expanded={true}
          onClick={() => setSettings({ suggestionsCollapsed: true })}
          title="Collapse the pane while you're locked in and cruising"
        >
          Hide Suggestions
          <ChevronIcon direction="right" />
        </button>
      </header>

      <div className="sg-body">
        {!keyReady ? (
          <div className="sg-empty">
            <BoltIcon size={28} />
            <p className="sg-empty-title">Bring your own AI key</p>
            <p className="sg-muted">
              Suggestions come from Claude, OpenAI or any model on OpenRouter, called straight from your browser with your
              own key. Nothing goes through a Thunder Writer server — there isn't one.
            </p>
            <Link to="/settings#ai" className="tw-btn tw-btn-primary sg-settings-link">
              Add your AI key
            </Link>
          </div>
        ) : (
          <>
            {aiError && (
              <div className="sg-error" role="alert">
                <p>{aiError}</p>
                <div className="sg-error-actions">
                  {engine.errorKind !== null && SETTINGS_FIXABLE.has(engine.errorKind) && (
                    <Link to={engine.errorKind === 'search_unavailable' ? '/settings#suggestions' : '/settings'} className="sg-link-btn">
                      Open Settings
                    </Link>
                  )}
                  <button type="button" className="sg-link-btn" onClick={() => setAiError(null)}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {generating && (
              <p className="sg-generating" role="status">
                <span className="sg-spinner" aria-hidden="true" />
                Reading your pages…
              </p>
            )}

            {open.length > 0 ? (
              <ul className="sg-list" aria-label="Open suggestions">
                {open.map((s) => (
                  <SuggestionCard key={s.id} suggestion={s} active={s.id === activeId} actions={actions} />
                ))}
              </ul>
            ) : (
              !generating && (
                <div className="sg-empty sg-empty-quiet">
                  <p className="sg-muted">
                    {autoEnabled
                      ? 'Nothing to flag right now. Keep writing — when you pause, a suggestion or two may appear here.'
                      : 'Automatic suggestions are off. Use Generate Suggestions when you want a second opinion.'}
                  </p>
                </div>
              )
            )}

            {history.length > 0 && (
              <details className="sg-history">
                <summary>History ({history.length})</summary>
                <ul className="sg-history-list">
                  {history.map((s) => (
                    <li key={s.id} className="sg-history-item" data-status={s.status}>
                      <span className={`sg-status sg-status-${s.status}`}>{STATUS_LABEL[s.status]}</span>
                      <span className="sg-history-title">
                        <span className="sg-visually-hidden">{KIND_LABEL[s.kind]}: </span>
                        {s.title}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      <footer className="sg-footer">
        <button
          type="button"
          className="tw-btn tw-btn-primary sg-generate"
          onClick={onGenerate}
          disabled={generateDisabled}
          aria-describedby={generateHint ? hintId : undefined}
        >
          <BoltIcon />
          {generating ? 'Generating…' : 'Generate Suggestions'}
        </button>
        {generateHint && (
          <p id={hintId} className="sg-muted sg-small" aria-live="polite">
            {generateHint}
          </p>
        )}
        {keyReady && (
          <p className="sg-muted sg-small sg-provider-line">
            Using {providerLabel(provider)} · one or two at a time
            {engine.unpricedModel && ` · cost unknown for “${engine.unpricedModel}”`}
          </p>
        )}
        <ContextFilesControl />
      </footer>
    </aside>
  )
}
