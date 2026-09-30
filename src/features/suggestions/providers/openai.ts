import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { MAX_OUTPUT_TOKENS, REQUEST_TIMEOUT_MS, TRIVIA_MAX_OUTPUT_TOKENS, TRIVIA_MAX_SEARCHES } from '../constants'
import { isOpenAIReasoningModel, openaiCostUsd, webSearchCostUsd } from '../pricing'
import { SuggestionBatchSchema } from '../schema'
import { finishTrivia, type SearchEvidence } from '../trivia'
import {
  authMessage,
  isWebSearchUnavailableMessage,
  SuggestionError,
  type GenerateRequest,
  type GenerateResult,
  type SuggestionProvider,
  type TriviaRequest,
  type TriviaResult,
} from './types'

// Reasoning-capable families (GPT-5.x, GPT-6.x, o-series). For short margin
// notes we keep reasoning low: reasoning tokens bill as output tokens.
export { isOpenAIReasoningModel }

/** Instructions first (stable -> eligible for OpenAI's automatic prefix caching). */
export function openaiInstructions(system: string, contextBlock: string): string {
  return contextBlock ? `${system}\n\n${contextBlock}` : system
}

export function mapOpenAIError(err: unknown): SuggestionError {
  if (err instanceof SuggestionError) return err
  if (err instanceof OpenAI.APIUserAbortError) return new SuggestionError('aborted', 'Request cancelled.', { cause: err })
  if (err instanceof OpenAI.AuthenticationError) return new SuggestionError('auth', authMessage('openai'), { cause: err })
  if (err instanceof OpenAI.PermissionDeniedError)
    return new SuggestionError('permission', 'Your OpenAI API key does not have access to this model. Pick another model in Settings.', { cause: err })
  if (err instanceof OpenAI.NotFoundError)
    return new SuggestionError('bad_request', 'OpenAI did not recognise that model id. Check the model in Settings.', { cause: err })
  if (err instanceof OpenAI.RateLimitError)
    return new SuggestionError('rate_limit', 'OpenAI is rate-limiting requests (or your quota is used up). Suggestions will pause and try again later.', { cause: err })
  if (err instanceof OpenAI.BadRequestError)
    return new SuggestionError('bad_request', `OpenAI rejected the request: ${err.message}`, { cause: err })
  if (err instanceof OpenAI.APIConnectionError)
    return new SuggestionError('network', 'Could not reach OpenAI. Check your internet connection.', { cause: err })
  if (err instanceof OpenAI.APIError)
    return new SuggestionError('server', `OpenAI had a problem (${err.status ?? 'unknown status'}). Try again in a moment.`, { cause: err })
  if (err instanceof OpenAI.OpenAIError || err instanceof SyntaxError)
    return new SuggestionError('bad_output', 'OpenAI returned something unreadable. Try again.', { cause: err })
  return new SuggestionError('server', err instanceof Error ? err.message : 'Unexpected error while asking OpenAI.', { cause: err })
}

/**
 * Models whose OpenAI model page does not list the web_search tool
 * (developers.openai.com/api/docs/models, 2026-09). Anything else is tried, and
 * a "not supported" 400 at runtime switches search off for that model.
 */
const OPENAI_NO_WEB_SEARCH = [/^gpt-4\.1-nano\b/, /^gpt-3\.5/, /-search-(api|preview)\b/, /^o1-mini\b/]

export function openaiSupportsWebSearch(model: string): boolean {
  const m = model.trim()
  return m.length > 0 && !OPENAI_NO_WEB_SEARCH.some((re) => re.test(m))
}

export function mapOpenAITriviaError(err: unknown): SuggestionError {
  if (
    (err instanceof OpenAI.BadRequestError || err instanceof OpenAI.PermissionDeniedError) &&
    isWebSearchUnavailableMessage(err.message)
  ) {
    return new SuggestionError(
      'search_unavailable',
      "This OpenAI model can't use web search, so trivia will come from the model's own knowledge. Pick another model or turn off web-searched trivia in Settings.",
      { cause: err },
    )
  }
  return mapOpenAIError(err)
}

/** Search evidence, billed search calls and the answer text from a Responses API output. */
export function readOpenAISearchOutput(output: readonly OpenAI.Responses.ResponseOutputItem[]): {
  evidence: SearchEvidence
  searches: number
  failedSearches: number
  refused: boolean
  text: string
} {
  const evidence: SearchEvidence = { citations: [], results: [] }
  let searches = 0
  let failedSearches = 0
  let refused = false
  const texts: string[] = []
  for (const item of output) {
    if (item.type === 'web_search_call') {
      if (item.status === 'failed') failedSearches++
      else searches++
      if (item.action?.type === 'search') for (const src of item.action.sources ?? []) evidence.results.push({ url: src.url })
      continue
    }
    if (item.type !== 'message') continue
    for (const c of item.content) {
      if (c.type === 'refusal') refused = true
      if (c.type !== 'output_text') continue
      texts.push(c.text)
      for (const a of c.annotations ?? []) if (a.type === 'url_citation') evidence.citations.push({ url: a.url, title: a.title })
    }
  }
  return { evidence, searches, failedSearches, refused, text: texts.join('') }
}

/** Create body plus the /responses `max_tool_calls` cap (not yet in this SDK's stable create types). */
type CappedCreateParams = OpenAI.Responses.ResponseCreateParamsNonStreaming & { max_tool_calls?: number }

/** Did OpenAI reject the request because it does not know `max_tool_calls`? */
export function isMaxToolCallsRejected(err: unknown): boolean {
  return err instanceof OpenAI.BadRequestError && /max_tool_calls/i.test(err.message)
}

/**
 * Create a trivia response with at most TRIVIA_MAX_SEARCHES built-in tool
 * calls, so one trivia attempt is one billed search. If the endpoint rejects
 * the cap as an unknown parameter, retry once without it (every
 * web_search_call in the output is still counted and billed).
 */
async function createCapped(
  client: OpenAI,
  body: OpenAI.Responses.ResponseCreateParamsNonStreaming,
  signal: AbortSignal | undefined,
): Promise<OpenAI.Responses.Response> {
  const capped: CappedCreateParams = { ...body, max_tool_calls: TRIVIA_MAX_SEARCHES }
  try {
    return await client.responses.create(capped, { signal })
  } catch (err) {
    if (!isMaxToolCallsRejected(err)) throw err
    return client.responses.create(body, { signal })
  }
}

export const openaiProvider: SuggestionProvider = {
  id: 'openai',
  supportsWebSearch: openaiSupportsWebSearch,

  async generateTrivia(req: TriviaRequest): Promise<TriviaResult> {
    const client = new OpenAI({
      apiKey: req.apiKey,
      dangerouslyAllowBrowser: true,
      // No SDK retries: a timed-out request may already have run (and billed) its searches,
      // and a failed trivia attempt just falls back to a regular request until the next cooldown.
      maxRetries: 0,
      timeout: REQUEST_TIMEOUT_MS,
    })
    try {
      // Plain text reply (no text.format): the model returns one JSON object or NONE, parsed leniently.
      const body: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
        model: req.model,
        instructions: openaiInstructions(req.system, req.contextBlock),
        input: req.user,
        tools: [{ type: 'web_search' }],
        include: ['web_search_call.action.sources'],
        max_output_tokens: Math.max(TRIVIA_MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
        store: false,
        ...(isOpenAIReasoningModel(req.model) ? { reasoning: { effort: 'low' as const } } : {}),
      }
      const response = await createCapped(client, body, req.signal)
      const out = readOpenAISearchOutput(response.output ?? [])
      const u = response.usage
      const inputTokens = u?.input_tokens ?? 0
      const outputTokens = u?.output_tokens ?? 0
      const tokenCost = openaiCostUsd(req.model, {
        inputTokens,
        cachedTokens: u?.input_tokens_details?.cached_tokens ?? 0,
        outputTokens,
        webSearches: out.searches,
      })
      const usage = {
        inputTokens,
        outputTokens,
        costUsd: tokenCost ?? webSearchCostUsd('openai', req.model, out.searches),
        ...(out.searches > 0 ? { webSearches: out.searches } : {}),
      }
      const billed = { usage, costKnown: tokenCost !== null }
      if (out.refused || response.incomplete_details?.reason === 'content_filter') {
        throw new SuggestionError('refusal', 'OpenAI declined to look up trivia for this passage.', billed)
      }
      if (response.status === 'incomplete') {
        throw new SuggestionError('truncated', 'OpenAI ran out of room before finishing the trivia. Try again.', billed)
      }
      if (out.failedSearches > 0 && out.searches === 0) {
        return { item: null, outcome: 'search_error', searchErrorCode: 'failed', ...billed }
      }
      return { ...finishTrivia(out.text, out.evidence), ...billed }
    } catch (err) {
      throw mapOpenAITriviaError(err)
    }
  },

  async generateSuggestions(req: GenerateRequest): Promise<GenerateResult> {
    const client = new OpenAI({
      apiKey: req.apiKey,
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
      timeout: REQUEST_TIMEOUT_MS,
    })
    try {
      const response = await client.responses.parse(
        {
          model: req.model,
          instructions: openaiInstructions(req.system, req.contextBlock),
          input: req.user,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          store: false,
          text: { format: zodTextFormat(SuggestionBatchSchema, 'thunder_writer_suggestions') },
          ...(isOpenAIReasoningModel(req.model) ? { reasoning: { effort: 'low' as const } } : {}),
        },
        { signal: req.signal },
      )

      const u = response.usage
      const inputTokens = u?.input_tokens ?? 0
      const outputTokens = u?.output_tokens ?? 0
      const cost = openaiCostUsd(req.model, {
        inputTokens,
        cachedTokens: u?.input_tokens_details?.cached_tokens ?? 0,
        outputTokens,
      })
      const usage = { inputTokens, outputTokens, costUsd: cost ?? 0 }
      const billed = { usage, costKnown: cost !== null }

      const refused = response.output.some(
        (o) => o.type === 'message' && o.content.some((c) => c.type === 'refusal'),
      )
      if (refused || response.incomplete_details?.reason === 'content_filter') {
        throw new SuggestionError('refusal', 'OpenAI declined to comment on this passage.', billed)
      }
      if (response.status === 'incomplete') {
        throw new SuggestionError('truncated', 'OpenAI ran out of room before finishing. Try again.', billed)
      }
      const parsed = response.output_parsed
      if (!parsed) throw new SuggestionError('bad_output', 'OpenAI returned something unreadable. Try again.', billed)
      return { items: parsed.suggestions, usage, costKnown: cost !== null }
    } catch (err) {
      throw mapOpenAIError(err)
    }
  },
}
