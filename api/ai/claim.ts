import { fail, isConfigured, json, notConfigured, readJson, upstreamFailure } from '../_lib/http.js'
import { createKey, deleteKey, getKey, updateKey, type OpenRouterKeyInfo } from '../_lib/openrouterKeys.js'
import {
  findPack,
  isCheckoutSessionId,
  isKeyHash,
  openRouterLimitFor,
  THUNDER_AI_KEY_NAME_PREFIX,
  type ClaimResponse,
} from '../_lib/plans.js'
import { stripe, StripeError, type CheckoutSession, type PaymentIntent } from '../_lib/stripe.js'

/** How long one claim holds a purchase before another may try again (a crashed claim frees it after this). */
export const CLAIM_LOCK_MS = 60_000

/**
 * Bookkeeping lives on the purchase's PaymentIntent metadata, so there is no
 * database: `tw_credited_key` (the key the credit went to), `tw_created` (this
 * purchase made that key) and `tw_claiming` (a claim is in progress, since when).
 */
const setMeta = (pi: PaymentIntent, metadata: Record<string, string | null>) =>
  stripe('POST', `/payment_intents/${pi.id}`, { metadata })

/** A key the credit may go to: it exists and is one of ours (named by this service). */
async function ourKey(hash: unknown): Promise<OpenRouterKeyInfo | null> {
  if (!isKeyHash(hash)) return null
  const key = await getKey(hash)
  return key && key.name.startsWith(THUNDER_AI_KEY_NAME_PREFIX) ? key : null
}

const notOurs = () => fail(400, 'bad_request', 'That isn’t a Thunder Writer AI purchase.')

/**
 * POST /api/ai/claim { sessionId, keyHash? } → ClaimResponse
 *
 * Credits a paid Checkout Session exactly once. The credit tops up the key the
 * checkout was started for, else the key the writer holds (`keyHash`), else a
 * new key, which is returned (OpenRouter shows a key only when it is made).
 * Claiming again is safe: it answers `alreadyCredited`, and if this purchase
 * made the key and the writer doesn't have it (the first answer never
 * arrived), the key is replaced by a new one holding its remaining credit.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isConfigured()) return notConfigured()
  const body = await readJson(request)
  const sessionId = body?.sessionId
  if (!isCheckoutSessionId(sessionId)) return notOurs()
  const heldHash = isKeyHash(body?.keyHash) ? body.keyHash : undefined

  let session: CheckoutSession
  try {
    session = await stripe<CheckoutSession>('GET', `/checkout/sessions/${sessionId}`, { expand: ['payment_intent'] })
  } catch (e) {
    if (e instanceof StripeError && e.status === 404) return fail(404, 'not_found', 'Stripe has no record of that purchase.')
    return upstreamFailure('claim: retrieve session', e)
  }

  const pack = findPack(session.metadata?.tw_pack)
  if (!pack || session.currency !== 'usd' || session.amount_total !== pack.usd * 100) return notOurs()
  if (session.status === 'expired') return fail(410, 'expired', 'That checkout ended without a payment, so nothing was charged.')
  const pi = session.payment_intent !== null && typeof session.payment_intent === 'object' ? session.payment_intent : null
  if (session.payment_status !== 'paid' || !pi) {
    return fail(402, 'not_paid', 'Stripe hasn’t confirmed this payment yet. Your credit is added as soon as it does.')
  }

  const meta = pi.metadata ?? {}
  let locked = false
  try {
    if (meta.tw_credited_key) {
      if (meta.tw_created === '1' && heldHash !== meta.tw_credited_key) return await reissue(pi, meta.tw_credited_key)
      return json(200, { credited: 0, hash: meta.tw_credited_key, alreadyCredited: true } satisfies ClaimResponse)
    }
    if (meta.tw_claiming && Date.now() - Number(meta.tw_claiming) < CLAIM_LOCK_MS) {
      return fail(409, 'busy', 'Still adding this credit. Try again in a moment.')
    }
    await setMeta(pi, { tw_claiming: String(Date.now()) })
    locked = true

    const add = openRouterLimitFor(pack.usd)
    const existing = (await ourKey(session.metadata?.tw_key_hash)) ?? (await ourKey(heldHash))
    if (existing) {
      const before = existing.limit ?? 0
      await updateKey(existing.hash, { limit: before + add })
      try {
        await setMeta(pi, { tw_credited_key: existing.hash, tw_claiming: null })
      } catch (e) {
        // Unrecorded credit would be added again by the next claim: take it back.
        await updateKey(existing.hash, { limit: before }).catch((undo) => console.error('[thunder-ai] claim: undo top-up', undo))
        throw e
      }
      locked = false
      return json(200, { credited: pack.usd, hash: existing.hash } satisfies ClaimResponse)
    }

    const created = await createKey(`${THUNDER_AI_KEY_NAME_PREFIX} ${sessionId.slice(-12)}`, add)
    try {
      await setMeta(pi, { tw_credited_key: created.info.hash, tw_created: '1', tw_claiming: null })
    } catch (e) {
      await deleteKey(created.info.hash).catch((undo) => console.error('[thunder-ai] claim: undo new key', undo))
      throw e
    }
    locked = false
    return json(200, { credited: pack.usd, hash: created.info.hash, key: created.key } satisfies ClaimResponse)
  } catch (e) {
    if (locked) await setMeta(pi, { tw_claiming: null }).catch(() => {})
    return upstreamFailure('claim', e)
  }
}

/** Replaces the key a purchase made with a new one holding what's left on it, for a writer whose first answer was lost. */
async function reissue(pi: PaymentIntent, hash: string): Promise<Response> {
  const old = await getKey(hash)
  if (!old || old.disabled) {
    return fail(410, 'replaced', 'The key from this purchase has been replaced. Use your newest Thunder Writer AI key.')
  }
  const remaining = (old.limit ?? 0) - old.usage
  if (remaining <= 0) return fail(410, 'replaced', 'The credit from this purchase has been used up.')
  const fresh = await createKey(old.name, remaining)
  try {
    await setMeta(pi, { tw_credited_key: fresh.info.hash })
  } catch (e) {
    await deleteKey(fresh.info.hash).catch((undo) => console.error('[thunder-ai] reissue: undo new key', undo))
    throw e
  }
  // The old key must stop working, or its credit could be spent twice.
  await deleteKey(old.hash).catch(async (e) => {
    console.error('[thunder-ai] reissue: delete old key', e)
    await updateKey(old.hash, { disabled: true })
  })
  return json(200, { credited: 0, hash: fresh.info.hash, key: fresh.key, alreadyCredited: true } satisfies ClaimResponse)
}
