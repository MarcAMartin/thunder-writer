/**
 * Thunder Writer AI: prepaid credit for suggestions, paid for with Stripe
 * Checkout and spent on OpenRouter. Each buyer gets their own OpenRouter key
 * whose spending limit is what they paid divided by THUNDER_AI_MARKUP, so the
 * browser still talks straight to OpenRouter and no buyer can spend more than
 * they bought.
 *
 * Shared by the serverless functions (api/ai/*) and the app, so prices and
 * balances agree. Keep this file free of imports: the functions run it as-is.
 */

/**
 * The model Thunder Writer AI uses: the cheapest one in OpenRouter's catalog
 * that can be held to the suggestion JSON schema (checked 2026-10: $0.018/M
 * input, $0.09/M output). Changing it needs no migration.
 */
export const THUNDER_AI_MODEL = 'openai/gpt-oss-20b'

/**
 * Writers pay this many dollars per dollar of OpenRouter usage. It covers
 * Stripe's fee (2.9% + 30¢ a payment) and OpenRouter's fee on credit (5.5%),
 * and leaves a margin. Changing it changes the balance shown for keys bought
 * before the change, so raise prices with new packs instead.
 */
export const THUNDER_AI_MARKUP = 2

/** What a writer can buy. $5 is the smallest pack because Stripe's 30¢ fee would eat smaller ones. */
export const THUNDER_AI_PACKS = [
  { id: 'credit-5', usd: 5 },
  { id: 'credit-10', usd: 10 },
  { id: 'credit-25', usd: 25 },
] as const

export type ThunderAiPack = (typeof THUNDER_AI_PACKS)[number]

export const findPack = (id: unknown): ThunderAiPack | null => THUNDER_AI_PACKS.find((p) => p.id === id) ?? null

/** OpenRouter spending limit (USD) bought with `usd` dollars. */
export const openRouterLimitFor = (usd: number) => usd / THUNDER_AI_MARKUP

/** What an amount of OpenRouter usage costs the writer, in USD. */
export const writerUsd = (openRouterUsd: number) => openRouterUsd * THUNDER_AI_MARKUP

/**
 * OpenRouter's cost for a typical suggestion request on THUNDER_AI_MODEL
 * (about 6,000 tokens in and 800 out, reasoning included), for "about N
 * suggestions" estimates. Long reference files make requests cost more.
 */
export const TYPICAL_REQUEST_OPENROUTER_USD = 0.00025

/** About how many suggestion requests `usd` dollars of credit pays for. */
export const requestsFor = (usd: number) => Math.max(0, Math.floor(usd / writerUsd(TYPICAL_REQUEST_OPENROUTER_USD)))

/** Names of the OpenRouter keys the service creates. Only keys named this way can be topped up. */
export const THUNDER_AI_KEY_NAME_PREFIX = 'Thunder Writer AI'

/** An OpenRouter key's id (its hash): 64 hex digits. */
export const isKeyHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)

/** A Stripe Checkout Session id. */
export const isCheckoutSessionId = (v: unknown): v is string => typeof v === 'string' && /^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(v)

/** Where Stripe sends the writer after paying ({CHECKOUT_SESSION_ID} is filled in by Stripe). */
export const CHECKOUT_RETURN_PARAM = 'ai_checkout'

/** What the claim function answers once a purchase is credited. */
export interface ClaimResponse {
  /** Writer dollars this call added (0 when the purchase was already credited). */
  credited: number
  /** The OpenRouter key's hash: the id the next top-up goes to. */
  hash: string
  /** The OpenRouter key, only when this call created (or re-issued) it. */
  key?: string
  alreadyCredited?: boolean
}

/** Error answers from the functions: a code for the app, and a message written for the writer. */
export interface ErrorResponse {
  error: 'bad_request' | 'not_found' | 'not_paid' | 'expired' | 'busy' | 'replaced' | 'not_configured' | 'upstream'
  message: string
}
