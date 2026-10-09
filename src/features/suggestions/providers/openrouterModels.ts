/**
 * OpenRouter's public model catalog (no key needed): ids, names, per-token
 * prices and which output formats each model supports. Fetched once per page
 * load, and only when OpenRouter is actually in use (Settings or a request),
 * so writers who never pick it make no request to openrouter.ai.
 */

export const OPENROUTER_API = 'https://openrouter.ai/api/v1'

export interface OpenRouterModel {
  id: string
  name: string
  /** USD per input token, or null when the catalog gives no price. */
  promptUsd: number | null
  /** USD per output token, or null when the catalog gives no price. */
  completionUsd: number | null
  contextLength: number | null
  /** Accepts a strict JSON schema (`response_format: json_schema`). */
  structuredOutputs: boolean
  /** Accepts `response_format` at all (JSON mode). */
  responseFormat: boolean
}

interface CatalogEntry {
  id?: unknown
  name?: unknown
  context_length?: unknown
  pricing?: { prompt?: unknown; completion?: unknown }
  supported_parameters?: unknown
}

const price = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** The catalog's `data` array, reduced to what the app uses; odd entries are skipped. */
export function parseOpenRouterCatalog(json: unknown): OpenRouterModel[] {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const out: OpenRouterModel[] = []
  for (const raw of data as CatalogEntry[]) {
    if (typeof raw?.id !== 'string' || !raw.id) continue
    const params = Array.isArray(raw.supported_parameters) ? (raw.supported_parameters as unknown[]) : []
    out.push({
      id: raw.id,
      name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
      promptUsd: price(raw.pricing?.prompt),
      completionUsd: price(raw.pricing?.completion),
      contextLength: typeof raw.context_length === 'number' ? raw.context_length : null,
      structuredOutputs: params.includes('structured_outputs'),
      responseFormat: params.includes('response_format'),
    })
  }
  return out
}

let catalog: Promise<OpenRouterModel[]> | null = null

/** The catalog, fetched once; a failed fetch is retried next time it is asked for. */
export function loadOpenRouterModels(fetchImpl: typeof fetch = fetch): Promise<OpenRouterModel[]> {
  if (!catalog) {
    catalog = fetchImpl(`${OPENROUTER_API}/models`, { signal: AbortSignal.timeout(15_000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`OpenRouter models: HTTP ${r.status}`))))
      .then(parseOpenRouterCatalog)
      .catch((e) => {
        catalog = null
        throw e
      })
  }
  return catalog
}

/** One model's catalog entry, or null when unknown or the catalog can't be reached. */
export async function findOpenRouterModel(id: string, fetchImpl?: typeof fetch): Promise<OpenRouterModel | null> {
  try {
    const all = await loadOpenRouterModels(fetchImpl)
    return all.find((m) => m.id === id.trim()) ?? null
  } catch {
    return null
  }
}

/** Forget the cached catalog (tests). */
export function resetOpenRouterModels(): void {
  catalog = null
}

/** "$0.10 in / $0.50 out per million tokens", or null without a price. */
export function describeOpenRouterPrice(m: Pick<OpenRouterModel, 'promptUsd' | 'completionUsd'>): string | null {
  if (m.promptUsd === null || m.completionUsd === null) return null
  if (m.promptUsd === 0 && m.completionUsd === 0) return 'Free'
  const perM = (usd: number) => {
    const v = usd * 1_000_000
    return `$${v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(2).replace(/\.00$/, '') : v.toFixed(2)}`
  }
  return `${perM(m.promptUsd)} in / ${perM(m.completionUsd)} out per million tokens`
}
