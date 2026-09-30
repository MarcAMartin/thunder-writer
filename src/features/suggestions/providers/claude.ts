import Anthropic from '@anthropic-ai/sdk'
import {
  MAX_OUTPUT_TOKENS,
  REQUEST_TIMEOUT_MS,
  TRIVIA_MAX_CONTINUATIONS,
  TRIVIA_MAX_OUTPUT_TOKENS,
  TRIVIA_MAX_SEARCHES,
} from '../constants'
import { claudeCostUsd, webSearchCostUsd } from '../pricing'
import { parseSuggestionBatch, SUGGESTION_BATCH_JSON_SCHEMA } from '../schema'
import { finishTrivia, type SearchEvidence } from '../trivia'
import {
  authMessage,
  CLAUDE_SEARCH_DISABLED_MESSAGE,
  isOrgDisabledMessage,
  isWebSearchUnavailableMessage,
  SuggestionError,
  type GenerateRequest,
  type GenerateResult,
  type SuggestionProvider,
  type TriviaRequest,
  type TriviaResult,
} from './types'

/**
 * System blocks with a cache breakpoint on the last stable block, so the
 * instructions + reference files are cached across requests. (Prefixes below
 * the model's minimum cacheable length simply are not cached; that is fine.)
 */
export function claudeSystemBlocks(system: string, contextBlock: string): Anthropic.TextBlockParam[] {
  if (!contextBlock) return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
  return [
    { type: 'text', text: system },
    { type: 'text', text: contextBlock, cache_control: { type: 'ephemeral' } },
  ]
}

/** Map SDK errors to writer-facing messages, most specific first. */
export function mapClaudeError(err: unknown): SuggestionError {
  if (err instanceof SuggestionError) return err
  if (err instanceof Anthropic.APIUserAbortError) return new SuggestionError('aborted', 'Request cancelled.', { cause: err })
  if (err instanceof Anthropic.AuthenticationError) return new SuggestionError('auth', authMessage('claude'), { cause: err })
  if (err instanceof Anthropic.PermissionDeniedError)
    return new SuggestionError('permission', 'Your Claude API key does not have access to this model. Pick another model in Settings.', { cause: err })
  if (err instanceof Anthropic.NotFoundError)
    return new SuggestionError('bad_request', 'Claude did not recognise that model id. Check the model in Settings.', { cause: err })
  if (err instanceof Anthropic.RateLimitError)
    return new SuggestionError('rate_limit', 'Claude is rate-limiting requests right now. Suggestions will pause and try again later.', { cause: err })
  if (err instanceof Anthropic.BadRequestError)
    return new SuggestionError('bad_request', `Claude rejected the request: ${err.message}`, { cause: err })
  if (err instanceof Anthropic.APIConnectionError)
    return new SuggestionError('network', 'Could not reach Claude. Check your internet connection.', { cause: err })
  if (err instanceof Anthropic.APIError)
    return new SuggestionError('server', `Claude had a problem (${err.status ?? 'unknown status'}). Try again in a moment.`, { cause: err })
  if (err instanceof Anthropic.AnthropicError || err instanceof SyntaxError)
    return new SuggestionError('bad_output', 'Claude returned something unreadable. Try again.', { cause: err })
  return new SuggestionError('server', err instanceof Error ? err.message : 'Unexpected error while asking Claude.', { cause: err })
}

/**
 * The web search tool for trivia requests. The basic `web_search_20250305`
 * version is used for every model: it is the only one the default
 * claude-haiku-4-5 supports, and the newer `_20260209`+ versions default to
 * dynamic filtering through code execution, which adds a code-execution step,
 * extra tokens and latency (and loses ZDR eligibility) for no gain when we
 * allow a single search per request.
 */
export const CLAUDE_WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: TRIVIA_MAX_SEARCHES,
} as const satisfies Anthropic.WebSearchTool20250305

/** Errors from a trivia request: a disabled/unsupported web search tool gets its own kind. */
export function mapClaudeTriviaError(err: unknown): SuggestionError {
  if (
    (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.PermissionDeniedError) &&
    isWebSearchUnavailableMessage(err.message)
  ) {
    const msg = isOrgDisabledMessage(err.message)
      ? CLAUDE_SEARCH_DISABLED_MESSAGE
      : "This Claude model can't use web search, so trivia will come from the model's own knowledge. Pick another model or turn off web-searched trivia in Settings."
    return new SuggestionError('search_unavailable', msg, { cause: err })
  }
  return mapClaudeError(err)
}

interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  searches: number
}

function billClaude(model: string, t: UsageTotals) {
  const tokenCost = claudeCostUsd(model, {
    inputTokens: t.input,
    outputTokens: t.output,
    cacheReadTokens: t.cacheRead,
    cacheWriteTokens: t.cacheWrite,
    webSearches: t.searches,
  })
  const usage = {
    inputTokens: t.input + t.cacheRead + t.cacheWrite,
    outputTokens: t.output,
    // Unknown token price: still count the (known) search charge.
    costUsd: tokenCost ?? webSearchCostUsd('claude', model, t.searches),
    ...(t.searches > 0 ? { webSearches: t.searches } : {}),
  }
  return { usage, costKnown: tokenCost !== null }
}

/**
 * Pull search evidence, the web search error code (if any) and the final
 * answer text out of an assistant turn. The answer is the text after the last
 * search result; text before it is the model narrating its search.
 */
export function readClaudeSearchTurn(content: readonly Anthropic.ContentBlock[]): {
  evidence: SearchEvidence
  searchErrorCode?: string
  text: string
} {
  const evidence: SearchEvidence = { citations: [], results: [] }
  let searchErrorCode: string | undefined
  let lastResult = -1
  content.forEach((b, i) => {
    if (b.type !== 'web_search_tool_result') return
    lastResult = i
    // On error, content is a single error OBJECT rather than a list of results (HTTP is still 200).
    if (Array.isArray(b.content)) {
      for (const r of b.content) if (r.type === 'web_search_result') evidence.results.push({ url: r.url, title: r.title })
    } else if (b.content && b.content.type === 'web_search_tool_result_error') {
      searchErrorCode = b.content.error_code
    }
  })
  const texts: string[] = []
  content.forEach((b, i) => {
    if (b.type !== 'text') return
    for (const c of b.citations ?? []) {
      if (c.type === 'web_search_result_location') evidence.citations.push({ url: c.url, title: c.title })
    }
    if (i > lastResult) texts.push(b.text)
  })
  return { evidence, searchErrorCode, text: texts.join('') }
}

export const claudeProvider: SuggestionProvider = {
  id: 'claude',
  // Web search is available on every current Claude model on the Claude API.
  supportsWebSearch: () => true,

  async generateTrivia(req: TriviaRequest): Promise<TriviaResult> {
    const client = new Anthropic({
      apiKey: req.apiKey,
      dangerouslyAllowBrowser: true,
      // No SDK retries: a timed-out request may already have run (and billed) its search,
      // and a failed trivia attempt just falls back to a regular request until the next cooldown.
      maxRetries: 0,
      timeout: REQUEST_TIMEOUT_MS,
    })
    const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0 }
    const content: Anthropic.ContentBlock[] = []
    try {
      const user: Anthropic.MessageParam = { role: 'user', content: req.user }
      let messages: Anthropic.MessageParam[] = [user]
      let stop: Anthropic.StopReason | null = null
      for (let turn = 0; ; turn++) {
        // No output_config here: web search citations and JSON-schema output are not documented as compatible.
        const response = await client.messages.create(
          {
            model: req.model,
            max_tokens: TRIVIA_MAX_OUTPUT_TOKENS,
            system: [{ type: 'text', text: req.system }, ...(req.contextBlock ? [{ type: 'text' as const, text: req.contextBlock }] : [])],
            messages,
            tools: [CLAUDE_WEB_SEARCH_TOOL],
          },
          { signal: req.signal },
        )
        const u = response.usage
        totals.input += u.input_tokens
        totals.output += u.output_tokens
        totals.cacheRead += u.cache_read_input_tokens ?? 0
        totals.cacheWrite += u.cache_creation_input_tokens ?? 0
        totals.searches += u.server_tool_use?.web_search_requests ?? 0
        content.push(...response.content)
        stop = response.stop_reason
        // The server-side tool loop paused: re-send with the assistant turn appended (same tools) to resume.
        // max_uses is per HTTP request, so a resumed turn may search once more: worst case 2 searches
        // per trivia attempt (TRIVIA_MAX_CONTINUATIONS = 1). Both are counted and billed below.
        if (stop === 'pause_turn' && turn < TRIVIA_MAX_CONTINUATIONS) {
          messages = [user, { role: 'assistant', content: response.content }]
          continue
        }
        break
      }
      const billed = billClaude(req.model, totals)
      if (stop === 'refusal') throw new SuggestionError('refusal', 'Claude declined to look up trivia for this passage.', billed)
      if (stop === 'max_tokens') throw new SuggestionError('truncated', 'Claude ran out of room before finishing the trivia. Try again.', billed)
      if (stop === 'pause_turn') throw new SuggestionError('truncated', "Claude's web search took too long; skipped this time.", billed)

      const turn = readClaudeSearchTurn(content)
      const failed = turn.searchErrorCode !== undefined && turn.searchErrorCode !== 'max_uses_exceeded'
      if (failed && turn.evidence.results.length === 0) {
        // The search itself failed: whatever the model wrote is unsourced, so don't show it.
        return { item: null, outcome: 'search_error', searchErrorCode: turn.searchErrorCode, ...billed }
      }
      const done = finishTrivia(turn.text, turn.evidence)
      return { ...done, ...(turn.searchErrorCode ? { searchErrorCode: turn.searchErrorCode } : {}), ...billed }
    } catch (err) {
      if (err instanceof SuggestionError) throw err
      const mapped = mapClaudeTriviaError(err)
      // Earlier turns (before a failed continuation) were still billed.
      if (totals.input + totals.output > 0) {
        throw new SuggestionError(mapped.kind, mapped.message, { cause: err, ...billClaude(req.model, totals) })
      }
      throw mapped
    }
  },

  async generateSuggestions(req: GenerateRequest): Promise<GenerateResult> {
    // The writer supplies their own key; there is no backend to proxy through.
    const client = new Anthropic({
      apiKey: req.apiKey,
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
      timeout: REQUEST_TIMEOUT_MS,
    })
    try {
      const response = await client.messages.create(
        {
          model: req.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: claudeSystemBlocks(req.system, req.contextBlock),
          messages: [{ role: 'user', content: req.user }],
          output_config: { format: { type: 'json_schema', schema: SUGGESTION_BATCH_JSON_SCHEMA } },
        },
        { signal: req.signal },
      )

      const u = response.usage
      const cacheRead = u.cache_read_input_tokens ?? 0
      const cacheWrite = u.cache_creation_input_tokens ?? 0
      const cost = claudeCostUsd(req.model, {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
      })
      const usage = {
        inputTokens: u.input_tokens + cacheRead + cacheWrite,
        outputTokens: u.output_tokens,
        costUsd: cost ?? 0,
      }
      const billed = { usage, costKnown: cost !== null }

      if (response.stop_reason === 'refusal') {
        throw new SuggestionError('refusal', 'Claude declined to comment on this passage.', billed)
      }
      if (response.stop_reason === 'max_tokens') {
        throw new SuggestionError('truncated', 'Claude ran out of room before finishing. Try again.', billed)
      }
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
      const items = parseSuggestionBatch(json)
      if (!items) throw new SuggestionError('bad_output', 'Claude returned something unreadable. Try again.', billed)
      return { items, usage, costKnown: cost !== null }
    } catch (err) {
      throw mapClaudeError(err)
    }
  },
}
