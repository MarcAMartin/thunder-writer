import OpenAI from 'openai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const parse = vi.fn()
const create = vi.fn()
const ctorOptions: unknown[] = []

vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>()
  class FakeOpenAI extends actual.default {
    constructor(opts: ConstructorParameters<typeof actual.default>[0]) {
      super(opts)
      ctorOptions.push(opts)
      Object.defineProperty(this, 'responses', { value: { parse, create } })
    }
  }
  return { ...actual, default: FakeOpenAI }
})

import { isOpenAIReasoningModel, mapOpenAIError, openaiInstructions, openaiProvider, openaiSupportsWebSearch } from './openai'

const req = { apiKey: 'sk-oa', model: 'gpt-4.1-nano', system: 'SYS', contextBlock: 'CTX', user: 'USER', maxItems: 2 }
const item = { kind: 'style', title: 'T', detail: 'D', quote: null, replacement: null }
const response = (extra: Record<string, unknown> = {}) => ({
  status: 'completed',
  incomplete_details: null,
  output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }],
  output_parsed: { suggestions: [item] },
  usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 600 }, output_tokens: 50 },
  ...extra,
})

beforeEach(() => {
  parse.mockReset()
  create.mockReset()
  ctorOptions.length = 0
})

describe('openaiProvider', () => {
  it('uses the Responses API with strict JSON output and prices cached input', async () => {
    parse.mockResolvedValue(response())
    const out = await openaiProvider.generateSuggestions(req)
    expect(ctorOptions[0]).toMatchObject({ apiKey: 'sk-oa', dangerouslyAllowBrowser: true })
    const body = parse.mock.calls[0][0]
    expect(body).toMatchObject({ model: 'gpt-4.1-nano', instructions: 'SYS\n\nCTX', input: 'USER', store: false })
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true })
    expect(body).not.toHaveProperty('reasoning')
    expect(out.items).toEqual([item])
    expect(out.usage).toMatchObject({ inputTokens: 1000, outputTokens: 50 })
    expect(out.usage.costUsd).toBeCloseTo((400 * 0.1 + 600 * 0.025 + 50 * 0.4) / 1e6)
  })

  it('keeps reasoning effort low on reasoning models', async () => {
    parse.mockResolvedValue(response())
    await openaiProvider.generateSuggestions({ ...req, model: 'gpt-6-luna' })
    expect(parse.mock.calls[0][0].reasoning).toEqual({ effort: 'low' })
  })

  it('refusals and truncation become typed errors', async () => {
    parse.mockResolvedValue(response({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }))
    await expect(openaiProvider.generateSuggestions(req)).rejects.toMatchObject({ kind: 'refusal' })
    parse.mockResolvedValue(response({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_parsed: null }))
    await expect(openaiProvider.generateSuggestions(req)).rejects.toMatchObject({ kind: 'truncated' })
    parse.mockResolvedValue(response({ output_parsed: null }))
    await expect(openaiProvider.generateSuggestions(req)).rejects.toMatchObject({ kind: 'bad_output' })
  })
})

describe('helpers', () => {
  it('detects reasoning families', () => {
    expect(isOpenAIReasoningModel('gpt-5-nano')).toBe(true)
    expect(isOpenAIReasoningModel('gpt-6-luna')).toBe(true)
    expect(isOpenAIReasoningModel('o4-mini')).toBe(true)
    expect(isOpenAIReasoningModel('gpt-4.1-nano')).toBe(false)
  })
  it('omits the context block when empty', () => {
    expect(openaiInstructions('S', '')).toBe('S')
  })
  it('maps errors', () => {
    const h = new Headers()
    expect(mapOpenAIError(new OpenAI.AuthenticationError(401, undefined, 'x', h)).kind).toBe('auth')
    expect(mapOpenAIError(new OpenAI.RateLimitError(429, undefined, 'x', h)).kind).toBe('rate_limit')
    expect(mapOpenAIError(new OpenAI.APIConnectionError({ message: 'x' })).kind).toBe('network')
  })
})

describe('openaiProvider.generateTrivia (web search)', () => {
  const treq = { apiKey: 'sk-oa', model: 'gpt-6-luna', system: 'TSYS', contextBlock: 'CTX', user: 'TUSER' }
  const ITEM = {
    kind: 'trivia',
    title: 'Right whales rebound',
    detail: 'Possibly relevant: a record count this spring.',
    quote: null,
    replacement: null,
    source_urls: ['https://science.example/right-whales'],
  }
  const searchOut = (text: string, extra: Record<string, unknown> = {}) => ({
    status: 'completed',
    incomplete_details: null,
    output: [
      {
        type: 'web_search_call',
        id: 'ws_1',
        status: 'completed',
        action: { type: 'search', queries: ['right whales 2026'], sources: [{ type: 'url', url: 'https://science.example/right-whales' }] },
      },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text,
            annotations: [{ type: 'url_citation', url: 'https://news.example/whales', title: 'Record whale count', start_index: 0, end_index: 10 }],
          },
        ],
      },
    ],
    usage: { input_tokens: 4000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 300 },
    ...extra,
  })

  it('uses the Responses web_search tool without a JSON schema, and returns url_citation sources', async () => {
    create.mockResolvedValue(searchOut(JSON.stringify(ITEM)))
    const out = await openaiProvider.generateTrivia!(treq)
    const body = create.mock.calls[0][0]
    expect(body.tools).toEqual([{ type: 'web_search' }])
    // One billed search per trivia attempt, and no SDK retries that could run another.
    expect(body.max_tool_calls).toBe(1)
    expect(ctorOptions[0]).toMatchObject({ maxRetries: 0 })
    expect(body).not.toHaveProperty('text')
    expect(body.include).toEqual(['web_search_call.action.sources'])
    expect(body).toMatchObject({ model: 'gpt-6-luna', instructions: 'TSYS\n\nCTX', input: 'TUSER', store: false, reasoning: { effort: 'low' } })
    expect(out.outcome).toBe('ok')
    expect(out.item?.sources?.map((x) => x.url)).toEqual(['https://news.example/whales', 'https://science.example/right-whales'])
    expect(out.usage.webSearches).toBe(1)
    expect(out.usage.costUsd).toBeCloseTo((4000 * 0.1 + 300 * 0.5) / 1e6 + 0.01)
  })

  it('NONE, failed searches and unsupported models degrade gracefully', async () => {
    create.mockResolvedValue(searchOut('NONE'))
    expect(await openaiProvider.generateTrivia!(treq)).toMatchObject({ item: null, outcome: 'none' })

    const failed = searchOut(JSON.stringify(ITEM))
    failed.output = [{ type: 'web_search_call', id: 'ws_1', status: 'failed', action: { type: 'search' } }, failed.output[1]] as typeof failed.output
    create.mockResolvedValue(failed)
    const f = await openaiProvider.generateTrivia!(treq)
    expect(f).toMatchObject({ item: null, outcome: 'search_error' })
    expect(f.usage).not.toHaveProperty('webSearches')

    create.mockRejectedValue(new OpenAI.BadRequestError(400, undefined, "Tool 'web_search' is not supported with this model.", new Headers()))
    await expect(openaiProvider.generateTrivia!(treq)).rejects.toMatchObject({ kind: 'search_unavailable' })

    expect(openaiSupportsWebSearch('gpt-6-luna')).toBe(true)
    expect(openaiSupportsWebSearch('gpt-4.1-mini')).toBe(true)
    expect(openaiSupportsWebSearch('gpt-4.1-nano')).toBe(false)
  })

  it('retries once without max_tool_calls if the endpoint rejects it as unknown', async () => {
    create
      .mockRejectedValueOnce(new OpenAI.BadRequestError(400, undefined, "Unknown parameter: 'max_tool_calls'.", new Headers()))
      .mockResolvedValueOnce(searchOut(JSON.stringify(ITEM)))
    const out = await openaiProvider.generateTrivia!(treq)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0][0].max_tool_calls).toBe(1)
    expect(create.mock.calls[1][0]).not.toHaveProperty('max_tool_calls')
    expect(create.mock.calls[1][0].tools).toEqual([{ type: 'web_search' }])
    expect(out.outcome).toBe('ok')

    // Any other 400 is not retried.
    create.mockReset()
    create.mockRejectedValue(new OpenAI.BadRequestError(400, undefined, 'Invalid input.', new Headers()))
    await expect(openaiProvider.generateTrivia!(treq)).rejects.toMatchObject({ kind: 'bad_request' })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('bills web_search at $0.01 per call for non-reasoning models, plus the fixed block where it applies', async () => {
    create.mockResolvedValue(searchOut(JSON.stringify(ITEM)))
    const out = await openaiProvider.generateTrivia!({ ...treq, model: 'gpt-4o-mini' })
    // tokens + $0.01 + 8,000 x $0.15/M
    expect(out.usage.costUsd).toBeCloseTo((4000 * 0.15 + 300 * 0.6) / 1e6 + 0.01 + 8000 * 0.15 / 1e6, 8)
  })

  it('refusal and truncation are typed errors', async () => {
    create.mockResolvedValue(searchOut('x', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }))
    await expect(openaiProvider.generateTrivia!(treq)).rejects.toMatchObject({ kind: 'truncated' })
    const refused = searchOut('')
    refused.output[1] = { type: 'message', content: [{ type: 'refusal', refusal: 'no' }] } as unknown as (typeof refused.output)[1]
    create.mockResolvedValue(refused)
    await expect(openaiProvider.generateTrivia!(treq)).rejects.toMatchObject({ kind: 'refusal' })
  })

  it('the regular suggestions request never carries the search tool', async () => {
    parse.mockResolvedValue(response())
    await openaiProvider.generateSuggestions(req)
    expect(parse.mock.calls[0][0]).not.toHaveProperty('tools')
  })
})
