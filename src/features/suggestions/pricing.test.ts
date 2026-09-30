import { describe, expect, it } from 'vitest'
import {
  CLAUDE_WEB_SEARCH_USD,
  claudeCostUsd,
  formatUsd,
  isOpenAIReasoningModel,
  OPENAI_FIXED_SEARCH_BLOCK_TOKENS,
  OPENAI_WEB_SEARCH_USD,
  openaiCostUsd,
  priceFor,
  webSearchCostUsd,
} from './pricing'

describe('pricing', () => {
  it('prices Claude Haiku 4.5 at $1 / $5 per 1M', () => {
    expect(claudeCostUsd('claude-haiku-4-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(1)
    expect(claudeCostUsd('claude-haiku-4-5', { inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(5)
    expect(claudeCostUsd('claude-haiku-4-5', { inputTokens: 2_000, outputTokens: 300 })).toBeCloseTo(0.0035)
  })

  it('prices Claude cache reads at 0.1x and writes at 1.25x input', () => {
    const cost = claudeCostUsd('claude-sonnet-5-5', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(2 * 0.1 + 2 * 1.25)
  })

  it('uses an explicit cache-read price when the model has one (Opus 5.5: $0.20, not 0.1x)', () => {
    const cost = claudeCostUsd('claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })
    expect(cost).toBeCloseTo(0.2)
  })

  it('knows the other Claude tiers', () => {
    expect(priceFor('claude', 'claude-opus-5-5')).toMatchObject({ inputPerM: 4, outputPerM: 20 })
    expect(priceFor('claude', 'claude-sonnet-4-6')).toMatchObject({ inputPerM: 3, outputPerM: 15 })
  })

  it('returns null for unknown models', () => {
    expect(claudeCostUsd('claude-mystery-9', { inputTokens: 10, outputTokens: 10 })).toBeNull()
    expect(openaiCostUsd('gpt-unknown', { inputTokens: 10, outputTokens: 10 })).toBeNull()
  })

  it('prices OpenAI cached input separately (cached is a subset of input)', () => {
    // gpt-4.1-nano: $0.10 in, $0.025 cached, $0.40 out
    const cost = openaiCostUsd('gpt-4.1-nano', { inputTokens: 1_000_000, cachedTokens: 400_000, outputTokens: 1_000_000 })
    expect(cost).toBeCloseTo(0.6 * 0.1 + 0.4 * 0.025 + 0.4)
  })

  it('never lets cached exceed input', () => {
    expect(openaiCostUsd('gpt-6-luna', { inputTokens: 100, cachedTokens: 500, outputTokens: 0 })).toBeCloseTo((100 * 0.01) / 1e6)
  })

  it('formats costs', () => {
    expect(formatUsd(null)).toBe('—')
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.00123)).toBe('$0.0012')
    expect(formatUsd(1.236)).toBe('$1.24')
  })

  it('adds $0.01 per Claude web search on top of tokens ($10 / 1,000)', () => {
    expect(CLAUDE_WEB_SEARCH_USD).toBe(0.01)
    expect(webSearchCostUsd('claude', 'claude-haiku-4-5', 3)).toBeCloseTo(0.03)
    expect(webSearchCostUsd('claude', 'claude-haiku-4-5', -1)).toBe(0)
    expect(webSearchCostUsd('claude', 'claude-haiku-4-5', Number.NaN)).toBe(0)
    const tokens = claudeCostUsd('claude-haiku-4-5', { inputTokens: 2_000, outputTokens: 300 }) ?? 0
    const withSearch = claudeCostUsd('claude-haiku-4-5', { inputTokens: 2_000, outputTokens: 300, webSearches: 1 }) ?? 0
    expect(withSearch - tokens).toBeCloseTo(0.01)
    expect(claudeCostUsd('claude-unknown', { inputTokens: 1, outputTokens: 1, webSearches: 1 })).toBeNull()
  })

  it('prices the OpenAI web_search tool at $10 / 1k calls on every model', () => {
    expect(OPENAI_WEB_SEARCH_USD).toBe(0.01)
    expect(isOpenAIReasoningModel('gpt-6-luna')).toBe(true)
    expect(webSearchCostUsd('openai', 'gpt-6-luna', 1)).toBeCloseTo(0.01)
    // Non-reasoning models are NOT billed at the legacy web_search_preview rate ($25 / 1k).
    expect(webSearchCostUsd('openai', 'gpt-4.1-nano', 2)).toBeCloseTo(0.02)
    expect(webSearchCostUsd('openai', 'unknown-model', 1)).toBeCloseTo(0.01)
    const base = openaiCostUsd('gpt-6-luna', { inputTokens: 1000, outputTokens: 100 }) ?? 0
    expect((openaiCostUsd('gpt-6-luna', { inputTokens: 1000, outputTokens: 100, webSearches: 1 }) ?? 0) - base).toBeCloseTo(0.01)
  })

  it('adds the fixed 8,000-input-token search block for gpt-4o-mini and gpt-4.1-mini', () => {
    expect(OPENAI_FIXED_SEARCH_BLOCK_TOKENS).toBe(8_000)
    // gpt-4o-mini: $0.01 + 8,000 x $0.15/M = $0.0112 per call
    expect(webSearchCostUsd('openai', 'gpt-4o-mini', 1)).toBeCloseTo(0.0112, 6)
    // gpt-4.1-mini: $0.01 + 8,000 x $0.40/M = $0.0132 per call
    expect(webSearchCostUsd('openai', 'gpt-4.1-mini', 2)).toBeCloseTo(0.0264, 6)
    const base = openaiCostUsd('gpt-4o-mini', { inputTokens: 1000, outputTokens: 100 }) ?? 0
    expect((openaiCostUsd('gpt-4o-mini', { inputTokens: 1000, outputTokens: 100, webSearches: 1 }) ?? 0) - base).toBeCloseTo(0.0112, 6)
  })
})
