import type { AIProvider } from '../../types'

/** USD per 1M tokens. */
export interface ModelPrice {
  inputPerM: number
  outputPerM: number
  /** OpenAI: explicit cached-input price. Claude uses multipliers of the input price instead. */
  cachedInputPerM?: number
  /**
   * Claude: explicit cache-read price, for models whose cache reads are not the
   * usual 0.1x of input (e.g. Claude Opus 5.5 reads at $0.20 = 0.05x).
   */
  cacheReadPerM?: number
}

/** Anthropic first-party API rates (cached 2026-09). */
export const CLAUDE_PRICING: Record<string, ModelPrice> = {
  'claude-haiku-4-5': { inputPerM: 1, outputPerM: 5 },
  'claude-sonnet-5-5': { inputPerM: 2, outputPerM: 10 },
  'claude-sonnet-5': { inputPerM: 2, outputPerM: 10 },
  'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 },
  'claude-opus-5-5': { inputPerM: 4, outputPerM: 20, cacheReadPerM: 0.2 },
  'claude-opus-5': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-8': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-7': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-6': { inputPerM: 5, outputPerM: 25 },
}

/** Claude prompt-cache multipliers relative to the base input price (unless a model sets cacheReadPerM). */
export const CLAUDE_CACHE_READ_MULTIPLIER = 0.1
export const CLAUDE_CACHE_WRITE_MULTIPLIER = 1.25

/** OpenAI standard-tier rates (developers.openai.com/api/docs/pricing, 2026-09). */
export const OPENAI_PRICING: Record<string, ModelPrice> = {
  'gpt-6-luna': { inputPerM: 0.1, cachedInputPerM: 0.01, outputPerM: 0.5 },
  'gpt-6-sol': { inputPerM: 2, cachedInputPerM: 0.2, outputPerM: 10 },
  'gpt-6.1-sol': { inputPerM: 2, cachedInputPerM: 0.1, outputPerM: 10 },
  'gpt-5.6-luna': { inputPerM: 0.2, cachedInputPerM: 0.02, outputPerM: 1.2 },
  'gpt-5.6-terra': { inputPerM: 2, cachedInputPerM: 0.2, outputPerM: 12 },
  'gpt-5.4-nano': { inputPerM: 0.2, cachedInputPerM: 0.02, outputPerM: 1.25 },
  'gpt-5.4-mini': { inputPerM: 0.75, cachedInputPerM: 0.075, outputPerM: 4.5 },
  'gpt-5-nano': { inputPerM: 0.05, cachedInputPerM: 0.005, outputPerM: 0.4 },
  'gpt-5-mini': { inputPerM: 0.25, cachedInputPerM: 0.025, outputPerM: 2 },
  'gpt-4.1-nano': { inputPerM: 0.1, cachedInputPerM: 0.025, outputPerM: 0.4 },
  'gpt-4.1-mini': { inputPerM: 0.4, cachedInputPerM: 0.1, outputPerM: 1.6 },
  'gpt-4o-mini': { inputPerM: 0.15, cachedInputPerM: 0.075, outputPerM: 0.6 },
}

/**
 * Anthropic web search tool: $10 per 1,000 searches, on top of token costs
 * (search results count as input tokens). Failed searches are not billed.
 * platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool (2026-09).
 */
export const CLAUDE_WEB_SEARCH_USD = 10 / 1000

/**
 * OpenAI `web_search` tool (the non-preview tool this app sends), all models:
 * $10 / 1k calls, plus search content tokens billed at the model's rates
 * (developers.openai.com/api/docs/pricing, 2026-09). The $25 / 1k "content
 * tokens free" rate belongs only to the legacy `web_search_preview` tool.
 */
export const OPENAI_WEB_SEARCH_USD = 10 / 1000

/**
 * For these models the non-preview web search tool bills search content as a
 * fixed block of 8,000 input tokens per call (pricing page footnote). The block
 * is not assumed to be part of usage.input_tokens, so it is added on top: at
 * worst this over-estimates by the block's price (about $0.001-$0.003).
 */
export const OPENAI_FIXED_SEARCH_BLOCK_MODELS: readonly string[] = ['gpt-4o-mini', 'gpt-4.1-mini']
export const OPENAI_FIXED_SEARCH_BLOCK_TOKENS = 8_000

/**
 * Reasoning-capable OpenAI families (GPT-5.x, GPT-6.x, o-series). Reasoning
 * tokens bill as output tokens, so these requests keep reasoning effort low.
 */
export function isOpenAIReasoningModel(model: string): boolean {
  return /^(gpt-5|gpt-6|o\d)/.test(model.trim())
}

/** USD for `count` provider-run web searches (per-call fee plus any fixed content-token block). */
export function webSearchCostUsd(provider: AIProvider, model: string, count: number): number {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  if (provider === 'claude') return n * CLAUDE_WEB_SEARCH_USD
  const m = model.trim()
  const price = OPENAI_PRICING[m]
  const block =
    price && OPENAI_FIXED_SEARCH_BLOCK_MODELS.includes(m) ? (OPENAI_FIXED_SEARCH_BLOCK_TOKENS * price.inputPerM) / 1_000_000 : 0
  return n * (OPENAI_WEB_SEARCH_USD + block)
}

export function priceFor(provider: AIProvider, model: string): ModelPrice | null {
  const table = provider === 'claude' ? CLAUDE_PRICING : OPENAI_PRICING
  return table[model.trim()] ?? null
}

export interface ClaudeTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** usage.server_tool_use.web_search_requests */
  webSearches?: number
}

/** Cost of one Claude response (tokens + web searches), or null when the model's price is unknown. */
export function claudeCostUsd(model: string, u: ClaudeTokenUsage): number | null {
  const p = priceFor('claude', model)
  if (!p) return null
  const read = u.cacheReadTokens ?? 0
  const write = u.cacheWriteTokens ?? 0
  const micro =
    u.inputTokens * p.inputPerM +
    read * (p.cacheReadPerM ?? p.inputPerM * CLAUDE_CACHE_READ_MULTIPLIER) +
    write * p.inputPerM * CLAUDE_CACHE_WRITE_MULTIPLIER +
    u.outputTokens * p.outputPerM
  return micro / 1_000_000 + webSearchCostUsd('claude', model, u.webSearches ?? 0)
}

export interface OpenAITokenUsage {
  /** Total input tokens, INCLUDING cached ones (OpenAI's convention). */
  inputTokens: number
  cachedTokens?: number
  /** Output tokens including any reasoning tokens. */
  outputTokens: number
  /** web_search_call items in the response output. */
  webSearches?: number
}

/** Cost of one OpenAI response, or null when the model's price is unknown. */
export function openaiCostUsd(model: string, u: OpenAITokenUsage): number | null {
  const p = priceFor('openai', model)
  if (!p) return null
  const cached = Math.min(u.cachedTokens ?? 0, u.inputTokens)
  const cachedPrice = p.cachedInputPerM ?? p.inputPerM
  const micro = (u.inputTokens - cached) * p.inputPerM + cached * cachedPrice + u.outputTokens * p.outputPerM
  return micro / 1_000_000 + webSearchCostUsd('openai', model, u.webSearches ?? 0)
}

/** "$0.0012", "$1.24", or "—" when unknown. */
export function formatUsd(cost: number | null): string {
  if (cost === null || !Number.isFinite(cost)) return '—'
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}
