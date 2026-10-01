import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendSuggestion, SUGGESTION_EMAIL, suggestionEndpoint, suggestionMailto } from './sendSuggestion'
import { SuggestionButton } from './SuggestionButton'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const ok = () => new Response(JSON.stringify({ success: 'true' }), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('sendSuggestion', () => {
  it('posts the suggestion (and a reply-to email) to the developer’s address through FormSubmit', async () => {
    const fetchImpl = vi.fn(async () => ok())
    await sendSuggestion({ message: '  Add a word goal.  ', email: ' reader@example.com ' }, fetchImpl)
    expect(SUGGESTION_EMAIL).toBe('marc@mickerstudios.com')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://formsubmit.co/ajax/marc@mickerstudios.com')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      _subject: 'Thunder Writer suggestion',
      _template: 'box',
      email: 'reader@example.com',
      message: 'Add a word goal.',
    })
  })

  it('leaves out the email when none is given, and can be pointed at another endpoint', async () => {
    vi.stubEnv('VITE_SUGGESTION_ENDPOINT', 'https://forms.example/abc')
    const fetchImpl = vi.fn(async () => ok())
    await sendSuggestion({ message: 'Hi' }, fetchImpl)
    expect(suggestionEndpoint()).toBe('https://forms.example/abc')
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body))).not.toHaveProperty('email')
  })

  it('fails clearly when offline, when the service refuses, or with nothing written', async () => {
    await expect(sendSuggestion({ message: 'x' }, vi.fn(async () => Promise.reject(new TypeError('offline'))))).rejects.toThrow(/Couldn’t reach/)
    await expect(sendSuggestion({ message: 'x' }, vi.fn(async () => new Response('{"success":"false"}', { status: 200 })))).rejects.toThrow(/couldn’t be sent/)
    await expect(sendSuggestion({ message: 'x' }, vi.fn(async () => new Response('nope', { status: 500 })))).rejects.toThrow(/couldn’t be sent/)
    await expect(sendSuggestion({ message: '   ' }, vi.fn())).rejects.toThrow(/Write your suggestion/)
  })

  it('gives up on a send that takes too long, and says so', async () => {
    const timeout = vi.fn(async (_u: unknown, init?: RequestInit): Promise<Response> => {
      expect(init?.signal).toBeDefined()
      throw new DOMException('The operation timed out.', 'TimeoutError')
    })
    await expect(sendSuggestion({ message: 'x' }, timeout)).rejects.toThrow(/taking too long/)
  })

  it('keeps the mailto: fallback short enough for mail apps, cutting long text', () => {
    const href = suggestionMailto({ message: 'word '.repeat(2000), email: 'me@x.org' })
    expect(href.length).toBeLessThanOrEqual(1900)
    expect(decodeURIComponent(href.split('body=')[1])).toMatch(/cut short[\s\S]*Reply to: me@x\.org$/)
  })

  it('offers a mailto: fallback with everything filled in', () => {
    const href = suggestionMailto({ message: 'Dark mode & more', email: 'me@x.org' })
    expect(href.startsWith('mailto:marc@mickerstudios.com?subject=Thunder%20Writer%20suggestion&body=')).toBe(true)
    expect(decodeURIComponent(href.split('body=')[1])).toBe('Dark mode & more\n\nReply to: me@x.org')
  })
})

describe('SuggestionButton', () => {
  it('opens a form, sends the suggestion and thanks the writer', async () => {
    const fetchMock = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<SuggestionButton />)
    await user.click(screen.getByRole('button', { name: 'Suggestion' }))
    const dialog = screen.getByRole('dialog', { name: 'Send a suggestion' })
    const send = within(dialog).getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()
    const box = within(dialog).getByLabelText('Your suggestion')
    expect(box).toHaveFocus()
    expect(box).toHaveAccessibleDescription(/Your manuscript never is/)
    await user.type(box, 'Please add a word-count goal.')
    await user.type(within(dialog).getByLabelText(/Your email/), 'me@example.com')
    await user.click(send)
    const thanks = await screen.findByRole('dialog', { name: 'Thank you' })
    expect(thanks).toHaveTextContent(/on its way to the developer/)
    expect(within(thanks).getByRole('button', { name: 'Done' })).toHaveFocus()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('when sending fails, says so and offers to email it instead', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })))
    const user = userEvent.setup()
    render(<SuggestionButton />)
    await user.click(screen.getByRole('button', { name: 'Suggestion' }))
    const dialog = screen.getByRole('dialog', { name: 'Send a suggestion' })
    await user.type(within(dialog).getByLabelText('Your suggestion'), 'Idea')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(/couldn’t be sent/)
    expect(within(alert).getByRole('link', { name: 'Email it instead' }).getAttribute('href')).toMatch(/^mailto:marc@mickerstudios\.com\?/)
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await user.click(within(alert).getByRole('button', { name: 'Copy suggestion' }))
    expect(writeText).toHaveBeenCalledWith('Idea')
    expect(within(alert).getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    // What was written is kept, to try again.
    expect(within(dialog).getByLabelText('Your suggestion')).toHaveValue('Idea')
  })

  it('drops what a spam bot fills in the hidden field, without sending', async () => {
    const fetchMock = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<SuggestionButton />)
    await user.click(screen.getByRole('button', { name: 'Suggestion' }))
    const dialog = screen.getByRole('dialog', { name: 'Send a suggestion' })
    await user.type(within(dialog).getByLabelText('Your suggestion'), 'Buy now')
    await user.type(dialog.querySelector<HTMLInputElement>('input[name="_honey"]')!, 'spam')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    await screen.findByRole('dialog', { name: 'Thank you' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
