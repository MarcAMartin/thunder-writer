import type { AIProvider } from '../../types'
import { findOpenRouterModel, OPENROUTER_API } from '../suggestions/providers/openrouterModels'

export interface KeyTestResult {
  ok: boolean
  message: string
}

/**
 * Verifies a key with a free metadata call (retrieve the chosen model). No
 * tokens are generated, so testing costs nothing. SDKs load on demand.
 */
export async function testApiKey(provider: AIProvider, apiKey: string, model: string): Promise<KeyTestResult> {
  const key = apiKey.trim()
  if (!key) return { ok: false, message: 'Enter a key first.' }
  if (provider === 'claude') return testClaude(key, model)
  if (provider === 'openrouter') return testOpenRouter(key, model)
  return testOpenAI(key, model)
}

async function testClaude(apiKey: string, model: string): Promise<KeyTestResult> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 15_000 })
  try {
    const m = await client.models.retrieve(model)
    return { ok: true, message: `Key works. ${m.display_name || m.id} is available.` }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, message: 'Claude rejected this key. Check it in the Anthropic Console.' }
    if (e instanceof Anthropic.PermissionDeniedError) return { ok: false, message: 'This key does not have permission to use the API.' }
    if (e instanceof Anthropic.NotFoundError) return { ok: false, message: `The key works, but model “${model}” was not found.` }
    if (e instanceof Anthropic.RateLimitError) return { ok: true, message: 'Key accepted (rate limited right now — try again shortly).' }
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, message: 'Could not reach Anthropic. Check your connection.' }
    return { ok: false, message: e instanceof Error ? e.message : 'Key test failed.' }
  }
}

async function testOpenAI(apiKey: string, model: string): Promise<KeyTestResult> {
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 15_000 })
  try {
    const m = await client.models.retrieve(model)
    return { ok: true, message: `Key works. ${m.id} is available.` }
  } catch (e) {
    if (e instanceof OpenAI.AuthenticationError) return { ok: false, message: 'OpenAI rejected this key. Check it at platform.openai.com.' }
    if (e instanceof OpenAI.PermissionDeniedError) return { ok: false, message: 'This key does not have permission to use the API.' }
    if (e instanceof OpenAI.NotFoundError) return { ok: false, message: `The key works, but model “${model}” was not found.` }
    if (e instanceof OpenAI.RateLimitError) return { ok: true, message: 'Key accepted (rate limited right now — try again shortly).' }
    if (e instanceof OpenAI.APIConnectionError) return { ok: false, message: 'Could not reach OpenAI. Check your connection.' }
    return { ok: false, message: e instanceof Error ? e.message : 'Key test failed.' }
  }
}

/**
 * OpenRouter: the key's own info endpoint (free) proves the key, and the public
 * catalog says whether the model id exists. Reports remaining credit when the
 * key has a limit.
 */
async function testOpenRouter(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): Promise<KeyTestResult> {
  let res: Response
  try {
    res = await fetchImpl(`${OPENROUTER_API}/key`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return { ok: false, message: 'Could not reach OpenRouter. Check your connection.' }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, message: 'OpenRouter rejected this key. Check it at openrouter.ai/settings/keys.' }
  if (res.status === 429) return { ok: true, message: 'Key accepted (rate limited right now — try again shortly).' }
  if (!res.ok) return { ok: false, message: `OpenRouter had a problem (${res.status}). Try again in a moment.` }
  const info = ((await res.json().catch(() => null)) as { data?: { limit?: unknown; limit_remaining?: unknown } } | null)?.data
  const remaining = typeof info?.limit_remaining === 'number' ? info.limit_remaining : null
  const credit = remaining !== null ? ` $${remaining.toFixed(2)} of this key’s limit left.` : ''
  const found = await findOpenRouterModel(model, fetchImpl)
  if (!found) return { ok: true, message: `Key works.${credit} Couldn’t find model “${model}” in OpenRouter’s catalog; check the id.` }
  return { ok: true, message: `Key works. ${found.name} is available.${credit}` }
}

export { testOpenRouter }
