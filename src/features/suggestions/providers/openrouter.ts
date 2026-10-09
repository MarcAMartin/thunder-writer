import OpenAI from 'openai'
import { MAX_OUTPUT_TOKENS, REQUEST_TIMEOUT_MS } from '../constants'
import { parseSuggestionBatch, SUGGESTION_BATCH_JSON_SCHEMA } from '../schema'
import { findOpenRouterModel, OPENROUTER_API, type OpenRouterModel } from './openrouterModels'
import { authMessage, SuggestionError, type GenerateRequest, type GenerateResult, type SuggestionProvider } from './types'

/**
 * OpenRouter: one key for hundreds of models (Anthropic, OpenAI, Google, Meta,
 * Mistral, DeepSeek, …) behind an OpenAI-compatible Chat Completions API, so
 * the OpenAI SDK talks to it with a different base URL. Requests go straight
 * from the browser to openrouter.ai, like the other providers.
 *
 * Not every model can be held to a JSON schema, so the reply format is also
 * spelled out in the instructions and the reply is parsed leniently (code
 * fences and stray prose around the object are tolerated). There is no
 * web-searched trivia here: trivia comes from the model's own knowledge.
 */

/** Shown on openrouter.ai as the app making the requests (its app attribution headers). */
export const OPENROUTER_APP_HEADERS = { 'HTTP-Referer': 'https://www.thunderwriter.app', 'X-Title': 'Thunder Writer' } as const

/** The reply shape, for models that can't be held to the JSON schema. */
export const OPENROUTER_FORMAT_INSTRUCTIONS =
  'Reply with only a JSON object and no other text, in this shape: {"suggestions":[{"kind":"style","title":"…","detail":"…","quote":null,"replacement":null}]}. ' +
  '"kind" is one of grammar, spelling, style, context, general or trivia. Every item has all five keys, with null where a value does not apply. ' +
  'Reply {"suggestions":[]} when nothing is worth saying.'

export function openrouterSystem(system: string, contextBlock: string): string {
  return [system, contextBlock, OPENROUTER_FORMAT_INSTRUCTIONS].filter(Boolean).join('\n\n')
}

type ResponseFormat = OpenAI.Chat.Completions.ChatCompletionCreateParams['response_format']

/** The strictest output format the model accepts (unknown models get the schema, which OpenRouter drops if unsupported). */
export function openrouterResponseFormat(model: Pick<OpenRouterModel, 'structuredOutputs' | 'responseFormat'> | null): ResponseFormat | undefined {
  if (!model || model.structuredOutputs) {
    return { type: 'json_schema', json_schema: { name: 'thunder_writer_suggestions', strict: true, schema: { ...SUGGESTION_BATCH_JSON_SCHEMA } } }
  }
  return model.responseFormat ? { type: 'json_object' } : undefined
}

/** The JSON object in a model's reply, tolerating code fences and prose around it; null if there is none. */
export function extractJsonObject(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(t)
  } catch {
    const start = t.indexOf('{')
    const end = t.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(t.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

export function mapOpenRouterError(err: unknown): SuggestionError {
  if (err instanceof SuggestionError) return err
  if (err instanceof OpenAI.APIUserAbortError) return new SuggestionError('aborted', 'Request cancelled.', { cause: err })
  if (err instanceof OpenAI.AuthenticationError) return new SuggestionError('auth', authMessage('openrouter'), { cause: err })
  if (err instanceof OpenAI.APIError && err.status === 402)
    return new SuggestionError('permission', 'Your OpenRouter account is out of credits. Add credits at openrouter.ai, or pick a free model in Settings.', { cause: err })
  if (err instanceof OpenAI.PermissionDeniedError)
    return new SuggestionError('permission', 'OpenRouter refused this request for that model (it may be moderated or limited to some accounts). Pick another model in Settings.', { cause: err })
  if (err instanceof OpenAI.NotFoundError)
    return new SuggestionError('bad_request', 'OpenRouter could not find that model, or no provider can serve it right now. Check the model in Settings.', { cause: err })
  if (err instanceof OpenAI.RateLimitError)
    return new SuggestionError('rate_limit', 'OpenRouter is rate-limiting requests right now. Suggestions will pause and try again later.', { cause: err })
  if (err instanceof OpenAI.BadRequestError)
    return new SuggestionError('bad_request', `OpenRouter rejected the request: ${err.message}`, { cause: err })
  if (err instanceof OpenAI.APIConnectionError)
    return new SuggestionError('network', 'Could not reach OpenRouter. Check your internet connection.', { cause: err })
  if (err instanceof OpenAI.APIError)
    return new SuggestionError('server', `OpenRouter had a problem (${err.status ?? 'unknown status'}). Try again in a moment.`, { cause: err })
  if (err instanceof OpenAI.OpenAIError || err instanceof SyntaxError)
    return new SuggestionError('bad_output', 'OpenRouter returned something unreadable. Try again.', { cause: err })
  return new SuggestionError('server', err instanceof Error ? err.message : 'Unexpected error while asking OpenRouter.', { cause: err })
}

/** Did the request fail only because this model (or its provider) won't take the output format? */
const isFormatRejected = (err: unknown) =>
  err instanceof OpenAI.BadRequestError && /response_format|json_schema|structured|json mode/i.test(err.message)

/** Chat Completions body plus OpenRouter's own options (not in the OpenAI SDK's types). */
type OpenRouterBody = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
  usage?: { include: boolean }
  reasoning?: { effort: 'low' | 'medium' | 'high'; exclude?: boolean }
}

interface OpenRouterUsage {
  prompt_tokens?: number
  completion_tokens?: number
  /** What the request cost, in USD (OpenRouter credits), when usage accounting is on. */
  cost?: number
}

/** Tokens and cost: OpenRouter's own figure when it sends one, else the catalog price. */
export function billOpenRouter(usage: OpenRouterUsage | undefined, model: OpenRouterModel | null) {
  const inputTokens = usage?.prompt_tokens ?? 0
  const outputTokens = usage?.completion_tokens ?? 0
  let cost: number | null = typeof usage?.cost === 'number' && Number.isFinite(usage.cost) ? usage.cost : null
  if (cost === null && model?.promptUsd != null && model.completionUsd != null) {
    cost = inputTokens * model.promptUsd + outputTokens * model.completionUsd
  }
  return { usage: { inputTokens, outputTokens, costUsd: cost ?? 0 }, costKnown: cost !== null }
}

export const openrouterProvider: SuggestionProvider = {
  id: 'openrouter',

  async generateSuggestions(req: GenerateRequest): Promise<GenerateResult> {
    const client = new OpenAI({
      apiKey: req.apiKey,
      baseURL: OPENROUTER_API,
      defaultHeaders: { ...OPENROUTER_APP_HEADERS },
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
      timeout: REQUEST_TIMEOUT_MS,
    })
    const info = await findOpenRouterModel(req.model)
    const format = openrouterResponseFormat(info)
    const body: OpenRouterBody = {
      model: req.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: openrouterSystem(req.system, req.contextBlock) },
        { role: 'user', content: req.user },
      ],
      ...(format ? { response_format: format } : {}),
      // Report the real cost of each request, and keep any reasoning short (it bills as output).
      usage: { include: true },
      reasoning: { effort: 'low', exclude: true },
    }
    try {
      let response: OpenAI.Chat.Completions.ChatCompletion
      try {
        response = await client.chat.completions.create(body, { signal: req.signal })
      } catch (err) {
        if (!format || !isFormatRejected(err)) throw err
        const { response_format: _dropped, ...plain } = body
        response = await client.chat.completions.create(plain, { signal: req.signal })
      }

      // OpenRouter can answer 200 with an error from the upstream provider instead of choices.
      const upstream = (response as { error?: { message?: string } }).error
      const choice = response.choices?.[0]
      if (!choice) throw new SuggestionError('server', `OpenRouter had a problem: ${upstream?.message ?? 'no reply from the model'}. Try again in a moment.`)

      const billed = billOpenRouter(response.usage as OpenRouterUsage | undefined, info)
      if (choice.message?.refusal || choice.finish_reason === 'content_filter') {
        throw new SuggestionError('refusal', 'The model declined to comment on this passage.', billed)
      }
      if (choice.finish_reason === 'length') {
        throw new SuggestionError('truncated', 'The model ran out of room before finishing. Try again, or pick another model.', billed)
      }
      const items = parseSuggestionBatch(extractJsonObject(choice.message?.content ?? ''))
      if (!items) throw new SuggestionError('bad_output', 'The model returned something unreadable. Try again, or pick another model.', billed)
      return { items, ...billed }
    } catch (err) {
      throw mapOpenRouterError(err)
    }
  },
}
