/**
 * OpenRouter's key management API: one key per Thunder Writer AI buyer, with a
 * spending limit. Uses OPENROUTER_MANAGEMENT_KEY, a management key (OpenRouter
 * → Settings → Management keys); an ordinary key can't create keys.
 */

const KEYS_API = 'https://openrouter.ai/api/v1/keys'

export interface OpenRouterKeyInfo {
  hash: string
  name: string
  /** Spending limit in USD (null = none, which this service never sets). */
  limit: number | null
  /** USD spent so far. */
  usage: number
  disabled: boolean
}

export class OpenRouterKeysError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'OpenRouterKeysError'
    this.status = status
  }
}

async function call<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const secret = process.env.OPENROUTER_MANAGEMENT_KEY
  if (!secret) throw new OpenRouterKeysError(503, 'OPENROUTER_MANAGEMENT_KEY is not set')
  const res = await fetch(`${KEYS_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secret}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  if (!res.ok) throw new OpenRouterKeysError(res.status, json?.error?.message ?? `OpenRouter answered ${res.status}`)
  return json as T
}

function info(data: Partial<OpenRouterKeyInfo> & { hash: string }): OpenRouterKeyInfo {
  return {
    hash: data.hash,
    name: data.name ?? '',
    limit: typeof data.limit === 'number' ? data.limit : null,
    usage: typeof data.usage === 'number' ? data.usage : 0,
    disabled: data.disabled === true,
  }
}

/** Limits are dollars; keep them to whole micro-dollars so repeated top-ups don't drift. */
export const roundUsd = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000

export async function createKey(name: string, limit: number): Promise<{ key: string; info: OpenRouterKeyInfo }> {
  const res = await call<{ key: string; data: OpenRouterKeyInfo }>('POST', '', {
    name,
    limit: roundUsd(limit),
    limit_reset: null,
    include_byok_in_limit: true,
  })
  return { key: res.key, info: info(res.data) }
}

/** The key, or null when it doesn't exist (deleted, or never did). */
export async function getKey(hash: string): Promise<OpenRouterKeyInfo | null> {
  try {
    return info((await call<{ data: OpenRouterKeyInfo }>('GET', `/${hash}`)).data)
  } catch (e) {
    if (e instanceof OpenRouterKeysError && e.status === 404) return null
    throw e
  }
}

export async function updateKey(hash: string, patch: { limit?: number; disabled?: boolean }): Promise<OpenRouterKeyInfo> {
  const body = { ...patch, ...(patch.limit !== undefined ? { limit: roundUsd(patch.limit) } : {}) }
  return info((await call<{ data: OpenRouterKeyInfo }>('PATCH', `/${hash}`, body)).data)
}

export async function deleteKey(hash: string): Promise<void> {
  await call('DELETE', `/${hash}`)
}
