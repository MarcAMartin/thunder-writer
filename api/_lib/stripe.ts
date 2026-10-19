/**
 * The few Stripe calls Thunder Writer AI needs, over plain fetch (no SDK).
 * Uses STRIPE_SECRET_KEY: a restricted key with Checkout Sessions (write) and
 * PaymentIntents (write) is enough.
 */

const STRIPE_API = 'https://api.stripe.com/v1'

type Value = string | number | boolean | null | undefined
export interface Params {
  [key: string]: Value | Params | (Value | Params)[]
}

/** Stripe's form encoding: nested objects and arrays become `a[b][0][c]=value`. */
export function formEncode(params: Params, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(params)) {
    const key = prefix ? `${prefix}[${k}]` : k
    if (v === undefined) continue
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') formEncode(item, `${key}[${i}]`, out)
        else if (item !== undefined) out.append(`${key}[${i}]`, String(item ?? ''))
      })
    } else if (v !== null && typeof v === 'object') {
      formEncode(v, key, out)
    } else {
      // null clears a value (Stripe reads an empty string as "unset").
      out.append(key, v === null ? '' : String(v))
    }
  }
  return out
}

export class StripeError extends Error {
  readonly status: number
  readonly code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'StripeError'
    this.status = status
    this.code = code
  }
}

export interface CheckoutSession {
  id: string
  url: string | null
  status: 'open' | 'complete' | 'expired' | null
  payment_status: 'paid' | 'unpaid' | 'no_payment_required'
  amount_total: number | null
  currency: string | null
  metadata: Record<string, string> | null
  payment_intent: string | PaymentIntent | null
}

export interface PaymentIntent {
  id: string
  metadata: Record<string, string>
}

export async function stripe<T>(method: 'GET' | 'POST', path: string, params: Params = {}): Promise<T> {
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) throw new StripeError(503, 'STRIPE_SECRET_KEY is not set')
  const body = formEncode(params)
  const url = method === 'GET' && [...body].length ? `${STRIPE_API}${path}?${body}` : `${STRIPE_API}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method === 'POST' ? body.toString() : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null
  if (!res.ok) throw new StripeError(res.status, json?.error?.message ?? `Stripe answered ${res.status}`, json?.error?.code)
  return json as T
}
