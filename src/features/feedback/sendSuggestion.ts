/**
 * Suggestions go to the developer by email. The app has no server, so the
 * form is sent through FormSubmit (formsubmit.co), which forwards it to
 * SUGGESTION_EMAIL; the first one sent triggers an activation email there.
 * VITE_SUGGESTION_ENDPOINT points it elsewhere (any endpoint that accepts the
 * same JSON). Only what the writer types is sent, never their manuscript.
 */

export const SUGGESTION_EMAIL = 'marc@mickerstudios.com'

export const MAX_SUGGESTION_CHARS = 5000

/** A send that hasn't finished by then is given up, so the writer sees the fallback instead of "Sending…" forever. */
export const SEND_TIMEOUT_MS = 20_000

/** Mail apps on Windows refuse much longer mailto: links, so the fallback link's text is cut to fit. */
export const MAX_MAILTO_CHARS = 1900

export interface Suggestion {
  message: string
  /** Optional, so the developer can reply. */
  email?: string
}

const read = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export const suggestionEndpoint = () =>
  read(import.meta.env.VITE_SUGGESTION_ENDPOINT) || `https://formsubmit.co/ajax/${SUGGESTION_EMAIL}`

export class SuggestionError extends Error {}

/** Sends the suggestion. Rejects with a SuggestionError the form can show. */
export async function sendSuggestion(s: Suggestion, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<void> {
  const message = s.message.trim().slice(0, MAX_SUGGESTION_CHARS)
  if (!message) throw new SuggestionError('Write your suggestion first.')
  const email = s.email?.trim()
  let res: Response
  try {
    const timeout = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(SEND_TIMEOUT_MS) : undefined
    res = await fetchImpl(suggestionEndpoint(), {
      method: 'POST',
      signal: timeout,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject: 'Thunder Writer suggestion',
        _template: 'box',
        // FormSubmit sets Reply-To from a field named "email".
        ...(email ? { email } : {}),
        message,
      }),
    })
  } catch (e) {
    const slow = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')
    throw new SuggestionError(
      slow ? 'Sending is taking too long. Try again, or email it instead.' : 'Couldn’t reach the server. Check your connection, or email it instead.',
    )
  }
  let ok = res.ok
  try {
    const body = (await res.json()) as { success?: unknown }
    if (body && 'success' in body) ok = ok && (body.success === true || body.success === 'true')
  } catch {
    // Not JSON: the status decides.
  }
  if (!ok) throw new SuggestionError('Your suggestion couldn’t be sent just now. Try again, or email it instead.')
}

/**
 * A mailto: link with the suggestion filled in, for when sending fails. A long
 * suggestion is cut to fit (mail apps refuse longer links); Copy suggestion in
 * the form has the whole text.
 */
export function suggestionMailto(s: Suggestion): string {
  const base = `mailto:${SUGGESTION_EMAIL}?subject=${encodeURIComponent('Thunder Writer suggestion')}&body=`
  const tail = s.email?.trim() ? `\n\nReply to: ${s.email.trim()}` : ''
  let message = s.message.trim()
  const href = (m: string, cut: boolean) => base + encodeURIComponent(m + (cut ? '\n…(cut short; the full text is on your clipboard if you copied it)' : '') + tail)
  if (href(message, false).length <= MAX_MAILTO_CHARS) return href(message, false)
  while (message.length > 0 && href(message, true).length > MAX_MAILTO_CHARS) message = message.slice(0, Math.floor(message.length * 0.9))
  return href(message, true)
}
