import { useId, useState } from 'react'
import { Modal } from '../storage/Modal'
import { MAX_SUGGESTION_CHARS, sendSuggestion, SuggestionError, suggestionMailto } from './sendSuggestion'
import './feedback.css'

type State = { kind: 'editing' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'failed'; message: string }

/** "Suggestion" beside Settings: a short form that emails the developer. */
export function SuggestionButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="tw-btn tw-btn-ghost" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Suggestion
      </button>
      {open && <SuggestionDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function SuggestionDialog({ onClose }: { onClose: () => void }) {
  const formId = useId()
  const messageId = useId()
  const emailId = useId()
  const noteId = useId()
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [honey, setHoney] = useState('')
  const [state, setState] = useState<State>({ kind: 'editing' })
  const [copied, setCopied] = useState(false)
  const sending = state.kind === 'sending'

  /** The whole text, for pasting into any mail app (the mailto link may have to cut it short). */
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const submit = async () => {
    if (sending) return
    // A bot filled the hidden field: pretend it went.
    if (honey) {
      setState({ kind: 'sent' })
      return
    }
    setState({ kind: 'sending' })
    try {
      await sendSuggestion({ message, email })
      setState({ kind: 'sent' })
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof SuggestionError ? e.message : 'Your suggestion couldn’t be sent.' })
    }
  }

  if (state.kind === 'sent') {
    return (
      <Modal
        // A new dialog, not the form's: so it takes focus (Done) when it appears.
        key="sent"
        title="Thank you"
        onClose={onClose}
        footer={
          <button type="button" className="tw-btn tw-btn-primary" data-autofocus onClick={onClose}>
            Done
          </button>
        }
      >
        <p className="fb-lead" role="status">
          Your suggestion is on its way to the developer.{email.trim() ? ' You may hear back at the email you gave.' : ''}
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      key="form"
      title="Send a suggestion"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tw-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="tw-btn tw-btn-primary" aria-busy={sending || undefined} disabled={!message.trim()}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="fb-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <p className="fb-lead">An idea, something that got in your way, a feature you’d like? It goes straight to the developer.</p>
        <label className="fb-label" htmlFor={messageId}>
          Your suggestion
        </label>
        <textarea
          id={messageId}
          className="fb-input fb-textarea"
          value={message}
          required
          rows={6}
          maxLength={MAX_SUGGESTION_CHARS}
          data-autofocus
          aria-describedby={noteId}
          onChange={(e) => setMessage(e.target.value)}
        />
        <label className="fb-label" htmlFor={emailId}>
          Your email <span className="fb-optional">(optional, for a reply)</span>
        </label>
        <input
          id={emailId}
          className="fb-input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {/* Hidden from people; bots tend to fill it in. */}
        <input
          className="fb-honey"
          type="text"
          name="_honey"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={honey}
          onChange={(e) => setHoney(e.target.value)}
        />
        <p id={noteId} className="fb-note">
          Only what you type here is sent, by email through FormSubmit. Your manuscript never is.
        </p>
        {state.kind === 'failed' && (
          <div className="fb-error" role="alert">
            <p>{state.message}</p>
            <p className="fb-fallback">
              <a href={suggestionMailto({ message, email })}>Email it instead</a>
              <button type="button" className="tw-btn tw-btn-ghost" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy suggestion'}
              </button>
            </p>
          </div>
        )}
      </form>
    </Modal>
  )
}
