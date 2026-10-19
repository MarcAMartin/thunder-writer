import { fail, isConfigured, json, notConfigured, readJson, upstreamFailure } from '../_lib/http.js'
import { CHECKOUT_RETURN_PARAM, findPack, isKeyHash, requestsFor } from '../_lib/plans.js'
import { stripe, type CheckoutSession } from '../_lib/stripe.js'

/** The site the writer is on, for Stripe's return links. */
export function siteOrigin(request: Request): string {
  try {
    return new URL(request.url).origin
  } catch {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost'
    const proto = request.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
    return `${proto}://${host}`
  }
}

/**
 * POST /api/ai/checkout { pack, keyHash? } → { id, url }
 *
 * Starts a Stripe Checkout for a credit pack. `keyHash` is the writer's
 * current Thunder Writer AI key, so the credit tops it up instead of making a
 * new key. Nothing is credited here: api/ai/claim does that once Stripe says
 * the session is paid.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isConfigured()) return notConfigured()
  const body = await readJson(request)
  const pack = findPack(body?.pack)
  if (!pack) return fail(400, 'bad_request', 'Pick one of the credit packs.')
  const keyHash = isKeyHash(body?.keyHash) ? body.keyHash : undefined
  const origin = siteOrigin(request)

  try {
    const session = await stripe<CheckoutSession>('POST', '/checkout/sessions', {
      mode: 'payment',
      submit_type: 'pay',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: pack.usd * 100,
            product_data: {
              name: `Thunder Writer AI credit ($${pack.usd})`,
              description: `About ${requestsFor(pack.usd).toLocaleString('en-US')} AI suggestion requests in Thunder Writer. One-time purchase; no subscription.`,
            },
          },
        },
      ],
      success_url: `${origin}/settings?${CHECKOUT_RETURN_PARAM}={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/settings#thunder-ai`,
      metadata: { tw_pack: pack.id, tw_key_hash: keyHash },
      payment_intent_data: { description: 'Thunder Writer AI credit', metadata: { tw_pack: pack.id } },
    })
    if (!session.url) return upstreamFailure('checkout', new Error('Stripe returned no checkout URL'))
    return json(200, { id: session.id, url: session.url })
  } catch (e) {
    return upstreamFailure('checkout', e)
  }
}
