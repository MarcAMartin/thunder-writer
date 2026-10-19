import { OPENROUTER_API } from '../suggestions/providers/openrouterModels'
import { isCheckoutSessionId, writerUsd, type ClaimResponse, type ErrorResponse } from './plans'

/**
 * Buying Thunder Writer AI credit from the app: start a Stripe Checkout
 * (api/ai/checkout), then claim the paid purchase (api/ai/claim), which tops
 * up the writer's key or returns a new one. Purchases are remembered in this
 * browser until claimed, so the credit still arrives if the writer pays and
 * closes the tab before Stripe sends them back.
 */

const PENDING_KEY = 'thunder-writer:ai-pending'
/** Checkout sessions expire after a day; a payment that is still settling gets a week. */
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface Pending {
  id: string
  at: number
}

function readPending(): Pending[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((p): p is Pending => isCheckoutSessionId(p?.id) && typeof p?.at === 'number') : []
  } catch {
    return []
  }
}

function writePending(list: Pending[]): void {
  try {
    if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list))
    else localStorage.removeItem(PENDING_KEY)
  } catch {
    // Storage blocked: the purchase is still claimed from Stripe's return link.
  }
}

export function rememberPending(id: string, now = Date.now()): void {
  if (!isCheckoutSessionId(id)) return
  writePending([...readPending().filter((p) => p.id !== id), { id, at: now }])
}

export function forgetPending(id: string): void {
  writePending(readPending().filter((p) => p.id !== id))
}

/** Purchases still waiting to be credited, oldest first (stale ones are dropped). */
export function pendingPurchases(now = Date.now()): string[] {
  const all = readPending()
  const live = all.filter((p) => now - p.at < PENDING_MAX_AGE_MS)
  if (live.length !== all.length) writePending(live)
  return live.map((p) => p.id)
}

export class ThunderAiError extends Error {
  readonly code: ErrorResponse['error'] | 'network'
  constructor(code: ThunderAiError['code'], message: string) {
    super(message)
    this.name = 'ThunderAiError'
    this.code = code
  }
}

async function post<T>(path: string, body: unknown, fetchImpl: typeof fetch): Promise<T> {
  let res: Response
  try {
    res = await fetchImpl(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new ThunderAiError('network', 'Couldn’t reach Thunder Writer. Check your internet connection.')
  }
  const json = (await res.json().catch(() => null)) as (Partial<ErrorResponse> & T) | null
  if (!res.ok || !json) {
    throw new ThunderAiError(json?.error ?? 'upstream', json?.message ?? `Thunder Writer AI isn’t available right now (${res.status}).`)
  }
  return json
}

/** Opens Stripe Checkout for a credit pack, topping up `keyHash`'s key when the writer has one. */
export async function startCheckout(
  pack: string,
  keyHash: string | undefined,
  go: (url: string) => void = (url) => window.location.assign(url),
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { id, url } = await post<{ id: string; url: string }>('/api/ai/checkout', { pack, keyHash }, fetchImpl)
  rememberPending(id)
  go(url)
}

export function claimPurchase(sessionId: string, keyHash: string | undefined, fetchImpl: typeof fetch = fetch): Promise<ClaimResponse> {
  return post<ClaimResponse>('/api/ai/claim', { sessionId, keyHash }, fetchImpl)
}

/** Claim errors worth retrying later: the purchase stays remembered. */
export const RETRY_LATER = new Set<ThunderAiError['code']>(['not_paid', 'busy', 'network', 'upstream', 'not_configured'])

export interface Balance {
  /** Writer dollars left. */
  remainingUsd: number
  spentUsd: number
}

/** What's left on a Thunder Writer AI key, from OpenRouter's free key-info call; null when the key isn't accepted. */
export async function fetchBalance(openRouterKey: string, fetchImpl: typeof fetch = fetch): Promise<Balance | null> {
  const res = await fetchImpl(`${OPENROUTER_API}/key`, {
    headers: { Authorization: `Bearer ${openRouterKey}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401 || res.status === 403) return null
  if (!res.ok) throw new Error(`OpenRouter answered ${res.status}`)
  const data = ((await res.json()) as { data?: { limit_remaining?: unknown; usage?: unknown } }).data
  const remaining = typeof data?.limit_remaining === 'number' ? Math.max(0, data.limit_remaining) : 0
  const spent = typeof data?.usage === 'number' ? data.usage : 0
  return { remainingUsd: writerUsd(remaining), spentUsd: writerUsd(spent) }
}
