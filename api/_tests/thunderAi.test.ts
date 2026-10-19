// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THUNDER_AI_MARKUP, type ClaimResponse } from '../_lib/plans'
import { POST as checkout, siteOrigin } from '../ai/checkout'
import { POST as claim } from '../ai/claim'

/**
 * A tiny in-memory Stripe (one Checkout Session and its PaymentIntent) and
 * OpenRouter key store, behind a fake fetch.
 */
interface FakeKey {
  hash: string
  name: string
  limit: number
  usage: number
  disabled: boolean
}

const SESSION = 'cs_test_session0000000001'
let session: Record<string, unknown>
let pi: { id: string; metadata: Record<string, string> }
let keys: Map<string, FakeKey>
let created: number
let calls: { method: string; url: string; body?: string }[]

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input)
  const method = init.method ?? 'GET'
  const body = typeof init.body === 'string' ? init.body : undefined
  calls.push({ method, url, body })
  if (url.startsWith('https://api.stripe.com/v1/checkout/sessions/')) {
    if (!url.includes(SESSION)) return Promise.resolve(res(404, { error: { message: 'No such checkout.session' } }))
    return Promise.resolve(res(200, { ...session, payment_intent: session.payment_status === 'paid' ? structuredClone(pi) : null }))
  }
  if (url === 'https://api.stripe.com/v1/checkout/sessions') {
    return Promise.resolve(res(200, { id: SESSION, url: 'https://checkout.stripe.com/c/pay/x' }))
  }
  if (url.startsWith('https://api.stripe.com/v1/payment_intents/')) {
    for (const [k, v] of new URLSearchParams(body)) {
      const name = /^metadata\[(.+)\]$/.exec(k)?.[1]
      if (!name) continue
      if (v === '') delete pi.metadata[name]
      else pi.metadata[name] = v
    }
    return Promise.resolve(res(200, pi))
  }
  if (url.startsWith('https://openrouter.ai/api/v1/keys')) {
    const hash = url.split('/keys/')[1]
    if (method === 'POST') {
      const b = JSON.parse(body ?? '{}')
      const k: FakeKey = { hash: String(++created).padStart(64, '0'), name: b.name, limit: b.limit, usage: 0, disabled: false }
      keys.set(k.hash, k)
      return Promise.resolve(res(201, { data: k, key: `sk-or-v1-key${created}` }))
    }
    const k = hash ? keys.get(hash) : undefined
    if (!k) return Promise.resolve(res(404, { error: { message: 'Not found' } }))
    if (method === 'GET') return Promise.resolve(res(200, { data: k }))
    if (method === 'PATCH') {
      Object.assign(k, JSON.parse(body ?? '{}'))
      return Promise.resolve(res(200, { data: k }))
    }
    if (method === 'DELETE') {
      keys.delete(k.hash)
      return Promise.resolve(res(200, { deleted: true }))
    }
  }
  return Promise.resolve(res(500, { error: { message: `unexpected ${method} ${url}` } }))
}

const post = (handler: (r: Request) => Promise<Response>, body: unknown, url = 'https://thunder-writer.vercel.app/api/ai/x') =>
  handler(new Request(url, { method: 'POST', body: JSON.stringify(body) }))

const claimJson = async (body: unknown) => {
  const r = await post(claim, body)
  return { status: r.status, body: (await r.json()) as ClaimResponse & { error?: string } }
}

function addKey(name = 'Thunder Writer AI old', limit = 1, usage = 0.25): FakeKey {
  const k = { hash: 'c'.repeat(64), name, limit, usage, disabled: false }
  keys.set(k.hash, k)
  return k
}

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'rk_test_x')
  vi.stubEnv('OPENROUTER_MANAGEMENT_KEY', 'sk-or-mgmt')
  session = { id: SESSION, status: 'complete', payment_status: 'paid', amount_total: 500, currency: 'usd', metadata: { tw_pack: 'credit-5' } }
  pi = { id: 'pi_1', metadata: { tw_pack: 'credit-5' } }
  keys = new Map()
  created = 0
  calls = []
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('POST /api/ai/claim', () => {
  it('a first purchase makes a key whose limit is the price divided by the markup', async () => {
    const { status, body } = await claimJson({ sessionId: SESSION })
    expect(status).toBe(200)
    expect(body).toMatchObject({ credited: 5, key: 'sk-or-v1-key1' })
    const key = keys.get(body.hash)!
    expect(key.limit).toBeCloseTo(5 / THUNDER_AI_MARKUP)
    expect(key.name).toMatch(/^Thunder Writer AI /)
    expect(pi.metadata).toMatchObject({ tw_credited_key: body.hash, tw_created: '1' })
    expect(pi.metadata.tw_claiming).toBeUndefined()
  })

  it('credits a purchase only once', async () => {
    const first = await claimJson({ sessionId: SESSION })
    const again = await claimJson({ sessionId: SESSION, keyHash: first.body.hash })
    expect(again.body).toMatchObject({ credited: 0, alreadyCredited: true, hash: first.body.hash })
    expect(again.body.key).toBeUndefined()
    expect(keys.size).toBe(1)
    expect(keys.get(first.body.hash)!.limit).toBeCloseTo(2.5)
  })

  it('tops up the key the checkout was started for', async () => {
    const mine = addKey()
    session.metadata = { tw_pack: 'credit-5', tw_key_hash: mine.hash }
    const { body } = await claimJson({ sessionId: SESSION, keyHash: mine.hash })
    expect(body).toEqual({ credited: 5, hash: mine.hash })
    expect(mine.limit).toBeCloseTo(1 + 2.5)
    expect(keys.size).toBe(1)
  })

  it('tops up the key the writer holds when the checkout named none', async () => {
    const mine = addKey()
    const { body } = await claimJson({ sessionId: SESSION, keyHash: mine.hash })
    expect(body).toEqual({ credited: 5, hash: mine.hash })
    expect(mine.limit).toBeCloseTo(3.5)
  })

  it('never tops up a key it didn’t make (such as the account’s own key)', async () => {
    const other = addKey('Production server key')
    session.metadata = { tw_pack: 'credit-5', tw_key_hash: other.hash }
    const { body } = await claimJson({ sessionId: SESSION })
    expect(other.limit).toBe(1)
    expect(body.key).toBe('sk-or-v1-key1')
  })

  it('re-issues the key when the writer never received it, carrying what is left and retiring the old one', async () => {
    const first = await claimJson({ sessionId: SESSION })
    keys.get(first.body.hash)!.usage = 1
    const again = await claimJson({ sessionId: SESSION })
    expect(again.body).toMatchObject({ credited: 0, alreadyCredited: true, key: 'sk-or-v1-key2' })
    expect(keys.has(first.body.hash)).toBe(false)
    expect(keys.get(again.body.hash)!.limit).toBeCloseTo(1.5)
    expect(pi.metadata.tw_credited_key).toBe(again.body.hash)
  })

  it('waits for Stripe to confirm the payment', async () => {
    session.payment_status = 'unpaid'
    session.status = 'open'
    const { status, body } = await claimJson({ sessionId: SESSION })
    expect(status).toBe(402)
    expect(body.error).toBe('not_paid')
    expect(keys.size).toBe(0)
  })

  it('backs off while another claim is in progress', async () => {
    pi.metadata.tw_claiming = String(Date.now())
    const { status, body } = await claimJson({ sessionId: SESSION })
    expect(status).toBe(409)
    expect(body.error).toBe('busy')
    expect(keys.size).toBe(0)
  })

  it('refuses sessions that aren’t Thunder Writer AI purchases', async () => {
    session.metadata = { something: 'else' }
    expect((await claimJson({ sessionId: SESSION })).status).toBe(400)
    session.metadata = { tw_pack: 'credit-5' }
    session.amount_total = 100
    expect((await claimJson({ sessionId: SESSION })).status).toBe(400)
    expect((await claimJson({ sessionId: 'not-a-session' })).status).toBe(400)
    expect((await claimJson({ sessionId: 'cs_test_unknown00000000' })).status).toBe(404)
    expect(keys.size).toBe(0)
  })

  it('takes a new key back if the purchase can’t be marked as credited', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const isCreditMark = String(input).includes('/payment_intents/') && String(init?.body).includes('tw_credited_key')
      return isCreditMark ? Promise.resolve(res(500, { error: { message: 'boom' } })) : fakeFetch(input, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { status } = await claimJson({ sessionId: SESSION })
    expect(status).toBe(502)
    expect(keys.size).toBe(0)
    expect(pi.metadata.tw_claiming).toBeUndefined()
  })

  it('says so when the deployment has no keys configured', async () => {
    vi.stubEnv('OPENROUTER_MANAGEMENT_KEY', '')
    const { status, body } = await claimJson({ sessionId: SESSION })
    expect(status).toBe(503)
    expect(body.error).toBe('not_configured')
  })
})

describe('POST /api/ai/checkout', () => {
  it('creates a one-time USD payment for the pack that returns to Settings', async () => {
    const r = await post(checkout, { pack: 'credit-10', keyHash: 'd'.repeat(64) }, 'https://thunder-writer.vercel.app/api/ai/checkout')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ id: SESSION, url: 'https://checkout.stripe.com/c/pay/x' })
    const form = new URLSearchParams(calls.find((c) => c.url.endsWith('/checkout/sessions'))!.body)
    expect(form.get('mode')).toBe('payment')
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('1000')
    expect(form.get('line_items[0][price_data][currency]')).toBe('usd')
    expect(form.get('success_url')).toBe('https://thunder-writer.vercel.app/settings?ai_checkout={CHECKOUT_SESSION_ID}')
    expect(form.get('metadata[tw_pack]')).toBe('credit-10')
    expect(form.get('metadata[tw_key_hash]')).toBe('d'.repeat(64))
  })

  it('refuses unknown packs and ignores malformed key ids', async () => {
    expect((await post(checkout, { pack: 'credit-1' })).status).toBe(400)
    await post(checkout, { pack: 'credit-5', keyHash: 'nope' })
    const form = new URLSearchParams(calls.find((c) => c.url.endsWith('/checkout/sessions'))!.body)
    expect(form.has('metadata[tw_key_hash]')).toBe(false)
  })

  it('uses the forwarded host when the request URL is relative', () => {
    const fake = { url: '/api/ai/checkout', headers: new Headers({ host: 'localhost:3000' }) } as unknown as Request
    expect(siteOrigin(fake)).toBe('http://localhost:3000')
  })
})
