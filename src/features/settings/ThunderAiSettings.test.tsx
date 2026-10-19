import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettings } from '../../store/settings'
import { formatThunderAiKey } from '../thunderAi/key'
import { THUNDER_AI_MARKUP } from '../thunderAi/plans'
import { SettingsPage } from './SettingsPage'

const HASH = 'b'.repeat(64)
const SESSION = 'cs_test_a1b2c3d4e5f6g7h8'

const renderPage = (entry = '/settings') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <SettingsPage />
    </MemoryRouter>,
  )

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

/** Answers the app's calls: our two functions, and OpenRouter's key-info call for the balance. */
function stubFetch(routes: { checkout?: unknown; claim?: [unknown, number?]; balance?: unknown }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/ai/checkout') return jsonResponse(routes.checkout ?? { id: SESSION, url: 'https://checkout.stripe.com/c/pay/x' })
    if (url === '/api/ai/claim') return jsonResponse(...(routes.claim ?? [{ error: 'not_found', message: 'No.' }, 404]))
    if (url.endsWith('/api/v1/key')) return jsonResponse(routes.balance ?? { data: { limit_remaining: 2, usage: 0.5 } })
    return jsonResponse({ data: [] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const region = () => screen.getByRole('region', { name: 'Thunder Writer AI' })

describe('SettingsPage: Thunder Writer AI', () => {
  beforeEach(() => {
    useSettings.setState(useSettings.getInitialState())
    localStorage.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('is the first provider choice, with credit packs and no key yet', () => {
    stubFetch({})
    renderPage()
    const radios = screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent ?? '')
    expect(radios[0]).toMatch(/^Thunder Writer AI/)
    const packs = within(region()).getByRole('group', { name: 'Buy credit' })
    expect(within(packs).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Buy $5 of credit, about 10,000 suggestion requests',
      'Buy $10 of credit, about 20,000 suggestion requests',
      'Buy $25 of credit, about 50,000 suggestion requests',
    ])
    expect(within(region()).getByLabelText('Your Thunder Writer AI key')).toHaveAttribute('type', 'password')
  })

  it('a pack opens Stripe Checkout and remembers the purchase until it is credited', async () => {
    const fetchMock = stubFetch({})
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    const user = userEvent.setup()
    renderPage()
    await user.click(within(region()).getByRole('button', { name: /^Buy \$10/ }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/x'))
    const [, init] = fetchMock.mock.calls.find(([u]) => u === '/api/ai/checkout') as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ pack: 'credit-10' })
    expect(localStorage.getItem('thunder-writer:ai-pending')).toContain(SESSION)
  })

  it('coming back from Stripe stores the new key, switches to Thunder Writer AI and shows the balance', async () => {
    stubFetch({ claim: [{ credited: 5, hash: HASH, key: 'sk-or-v1-newkey123' }] })
    renderPage(`/settings?ai_checkout=${SESSION}`)
    expect(await within(region()).findByText(/Added \$5\.00 of Thunder Writer AI credit/)).toBeInTheDocument()
    const s = useSettings.getState()
    expect(s.provider).toBe('thunder')
    expect(s.thunderAiKey).toBe(formatThunderAiKey({ hash: HASH, key: 'sk-or-v1-newkey123' }))
    // $2 of OpenRouter limit left is $4 of the writer's credit.
    expect(await within(region()).findByText(`$${(2 * THUNDER_AI_MARKUP).toFixed(2)}`)).toBeInTheDocument()
    expect(localStorage.getItem('thunder-writer:ai-pending')).toBeNull()
  })

  it('tops up the key the writer already has', async () => {
    useSettings.setState({ thunderAiKey: formatThunderAiKey({ hash: HASH, key: 'sk-or-v1-mine12345' }) })
    const fetchMock = stubFetch({})
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() })
    const user = userEvent.setup()
    renderPage()
    await user.click(within(region()).getByRole('button', { name: /^Add \$5/ }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/ai/checkout')).toBe(true))
    const [, init] = fetchMock.mock.calls.find(([u]) => u === '/api/ai/checkout') as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ pack: 'credit-5', keyHash: HASH })
  })

  it('keeps an unconfirmed payment to try again later', async () => {
    stubFetch({ claim: [{ error: 'not_paid', message: 'Stripe hasn’t confirmed this payment yet.' }, 402] })
    renderPage(`/settings?ai_checkout=${SESSION}`)
    expect(await within(region()).findByText(/hasn’t confirmed this payment yet/)).toBeInTheDocument()
    expect(localStorage.getItem('thunder-writer:ai-pending')).toContain(SESSION)
    expect(useSettings.getState().thunderAiKey).toBe('')
  })

  it('says when a pasted value isn’t a Thunder Writer AI key', async () => {
    stubFetch({})
    const user = userEvent.setup()
    renderPage()
    await user.type(within(region()).getByLabelText('Your Thunder Writer AI key'), 'sk-or-v1-something')
    expect(within(region()).getByText(/That isn’t a Thunder Writer AI key/)).toBeInTheDocument()
  })
})
