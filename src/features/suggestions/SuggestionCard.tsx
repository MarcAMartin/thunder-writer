import { useId, useState, type FocusEvent } from 'react'
import type { Suggestion } from '../../types'
import { diffWords } from './diff'
import { KIND_LABEL } from './labels'
import { sanitizeSources, sourceHost } from './sanitize'
import type { ActionResult, SuggestionActions } from './useSuggestionActions'

export interface SuggestionCardProps {
  suggestion: Suggestion
  active: boolean
  actions: SuggestionActions
}

/**
 * One suggestion. Collapsed it shows a kind chip and headline; hovering or
 * focusing expands it to the full explanation and a before/after preview.
 * Clicking the headline marks the referenced passage in the manuscript.
 * All AI text is rendered as plain text (React-escaped).
 */
export function SuggestionCard({ suggestion: s, active, actions }: SuggestionCardProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const detailId = useId()
  const expanded = hovered || focused || active

  const handle = (r: ActionResult) => setNote(r.ok ? null : r.message)

  const onBlur = (e: FocusEvent<HTMLLIElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
  }

  const hasEdit = s.quote !== undefined && s.replacement !== undefined
  // Re-checked at render: sources also arrive via state that bypassed the engine (tests, future storage).
  const sources = sanitizeSources(s.sources)

  return (
    <li
      className="sg-card"
      data-kind={s.kind}
      data-expanded={expanded || undefined}
      data-active={active || undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
    >
      <button
        type="button"
        className="sg-card-head"
        aria-pressed={active}
        aria-describedby={detailId}
        title={s.quote ? (active ? 'Unmark the passage' : 'Show this passage in the manuscript') : undefined}
        onClick={() => handle(actions.select(s))}
      >
        <span className={`sg-chip sg-chip-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
        <span className="sg-card-title">{s.title}</span>
      </button>

      <div className="sg-card-body">
        <p id={detailId} className="sg-card-detail">
          {s.detail}
        </p>
        {expanded && s.quote !== undefined && (
          <div className="sg-diff" aria-label={hasEdit ? 'Proposed change' : 'Referenced passage'}>
            {hasEdit ? (
              diffWords(s.quote, s.replacement ?? '').map((seg, i) =>
                seg.type === 'del' ? (
                  <del key={i} className="sg-del">
                    {seg.text}
                  </del>
                ) : seg.type === 'ins' ? (
                  <ins key={i} className="sg-ins">
                    {seg.text}
                  </ins>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )
            ) : (
              <q className="sg-quote">{s.quote}</q>
            )}
          </div>
        )}
        {sources.length > 0 && (
          <div className="sg-sources">
            <span className="sg-sources-label">{sources.length === 1 ? 'Source' : 'Sources'}:</span>
            <ul className="sg-sources-list" aria-label={`Sources for “${s.title}”`}>
              {sources.map((src) => {
                // The page title is third-party text: the real domain always leads, so a
                // misleading title ("Re-verify your API key") can't pass as something else.
                const host = sourceHost(src.url)
                const showTitle = src.title !== '' && src.title.toLowerCase().replace(/^www\./, '') !== host
                return (
                  <li key={src.url}>
                    <a href={src.url} target="_blank" rel="noopener noreferrer" title={src.url}>
                      <span className="sg-source-host">{host}</span>
                      {showTitle && ' — '}
                      {showTitle && <span className="sg-source-title">{src.title}</span>}{' '}
                      <span className="sg-visually-hidden">(opens in a new tab)</span>
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

      {note && (
        <p className="sg-card-note" role="status">
          {note}
        </p>
      )}

      <div className="sg-card-actions" role="group" aria-label={`Actions for “${s.title}”`}>
        <button
          type="button"
          className="tw-btn tw-btn-primary sg-act"
          onClick={() => handle(actions.accept(s))}
          title={hasEdit ? 'Apply this change to your manuscript' : 'Mark as accepted'}
        >
          Accept
        </button>
        <button type="button" className="tw-btn sg-act" onClick={() => handle(actions.decline(s))} title="Not for me">
          Decline
        </button>
        <button type="button" className="tw-btn sg-act" onClick={() => handle(actions.done(s))} title="I handled this myself">
          Mark Done
        </button>
        <button type="button" className="tw-btn tw-btn-ghost sg-act" onClick={() => handle(actions.hide(s))} title="Hide without deciding">
          Hide
        </button>
      </div>
    </li>
  )
}
