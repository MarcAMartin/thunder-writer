import { useId, useRef } from 'react'
import { useSession } from '../../store/session'
import { CONTEXT_PROMPT_TOTAL_CHARS } from './constants'
import { CONTEXT_FILE_ACCEPT } from './contextFiles'
import { planContextFiles } from './prompt'
import { useContextFileActions } from './useContextFiles'

const fmt = (n: number) => n.toLocaleString('en-US')

/**
 * Reference files (earlier work, a poem, research notes) the AI reads for
 * voice and world. Stored in this browser only. Shows exactly how much of each
 * file is sent, so nothing is truncated silently.
 */
export function ContextFilesControl() {
  const files = useSession((s) => s.contextFiles)
  const { add, remove, error, clearError, busy } = useContextFileActions()
  const inputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const plan = planContextFiles(files)

  return (
    <details className="sg-context">
      <summary className="sg-context-summary">
        Context files{files.length > 0 ? ` (${files.length})` : ''}
      </summary>
      <p id={hintId} className="sg-muted sg-small">
        Add earlier work, notes, or a poem so suggestions match your voice and world. Files stay in this browser; up to{' '}
        {fmt(CONTEXT_PROMPT_TOTAL_CHARS)} characters are sent with each request.
      </p>
      {files.length > 0 && (
        <ul className="sg-context-list">
          {files.map((f, i) => {
            const p = plan[i]
            return (
              <li key={f.id} className="sg-context-item">
                <div className="sg-context-meta">
                  <span className="sg-context-name" title={f.name}>
                    {f.name}
                  </span>
                  <span className="sg-muted sg-small">
                    {fmt(p.totalChars)} chars
                    {p.truncated &&
                      (p.includedChars === 0
                        ? ' · not sent (budget used by files above)'
                        : ` · first ${fmt(p.includedChars)} sent`)}
                  </span>
                </div>
                <button
                  type="button"
                  className="tw-btn tw-btn-ghost sg-small-btn"
                  aria-label={`Remove context file ${f.name}`}
                  onClick={() => void remove(f.id)}
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {error && (
        <p className="sg-error-text" role="alert">
          {error}{' '}
          <button type="button" className="sg-link-btn" onClick={clearError}>
            Dismiss
          </button>
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={CONTEXT_FILE_ACCEPT}
        multiple
        hidden
        data-testid="sg-context-input"
        onChange={(e) => {
          const list = e.currentTarget.files
          if (list && list.length > 0) void add(list)
          e.currentTarget.value = ''
        }}
      />
      <button
        type="button"
        className="tw-btn sg-small-btn"
        aria-describedby={hintId}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Adding…' : 'Add context'}
      </button>
    </details>
  )
}
