import type { ErrorResponse } from './plans.js'
import { OpenRouterKeysError } from './openrouterKeys.js'
import { StripeError } from './stripe.js'

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

export const fail = (status: number, error: ErrorResponse['error'], message: string) =>
  json(status, { error, message } satisfies ErrorResponse)

/** The request's JSON object body, or null when it isn't one (or is unreasonably large). */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text().catch(() => '')
  if (!text || text.length > 4_096) return null
  try {
    const v: unknown = JSON.parse(text)
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const isConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.OPENROUTER_MANAGEMENT_KEY)

export const notConfigured = () =>
  fail(503, 'not_configured', 'Thunder Writer AI isn’t available right now. Try again later, or use your own AI key.')

/** Logs the details for the developer and answers with a message for the writer. */
export function upstreamFailure(where: string, err: unknown): Response {
  const detail = err instanceof StripeError || err instanceof OpenRouterKeysError ? `${err.name} ${err.status}: ${err.message}` : err
  console.error(`[thunder-ai] ${where}:`, detail)
  return fail(502, 'upstream', 'Thunder Writer AI couldn’t finish that just now. Try again in a moment.')
}
