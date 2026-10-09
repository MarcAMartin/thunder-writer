import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
const ctorOptions: unknown[] = []

vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>()
  class FakeOpenAI extends actual.default {
    constructor(opts: ConstructorParameters<typeof actual.default>[0]) {
      super(opts)
      ctorOptions.push(opts)
      Object.defineProperty(this, 'chat', { value: { completions: { create } } })
    }
  }
  return { ...actual, default: FakeOpenAI }
})

import { getProvider } from './index'
import { billOpenRouter, extractJsonObject, openrouterProvider, openrouterResponseFormat, OPENROUTER_FORMAT_INSTRUCTIONS } from './openrouter'
import { resetOpenRouterModels } from './openrouterModels'

const catalog = {
  data: [
    { id: 'anthropic/claude-haiku-5.5', name: 'Anthropic: Claude Haiku 5.5', pricing: { prompt: '0.0000001', completion: '0.0000005' }, supported_parameters: ['response_format', 'structured_outputs'] },
    { id: 'meta-llama/llama-mini', name: 'Llama Mini', pricing: { prompt: '0.00000002', completion: '0.00000004' }, supported_parameters: ['response_format'] },
    { id: 'tiny/plain', name: 'Plain', pricing: { prompt: '0', completion: '0' }, supported_parameters: [] },
  ],
}
const item = { kind: 'style', title: 'T', detail: 'D', quote: null, replacement: null }
const req = { apiKey: 'sk-or-v1-x', model: 'anthropic/claude-haiku-5.5', system: 'SYS', contextBlock: 'CTX', user: 'USER', maxItems: 2 }
const reply = (content: string, extra: Record<string, unknown> = {}) => ({
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content, refusal: null } }],
  usage: { prompt_tokens: 1000, completion_tokens: 50, cost: 0.000125 },
  ...extra,
})
const apiError = (status: number, message: string) => OpenAI.APIError.generate(status, { error: { message } }, message, new Headers())

beforeEach(() => {
  create.mockReset()
  ctorOptions.length = 0
  resetOpenRouterModels()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(catalog))))
})
afterEach(() => vi.unstubAllGlobals())

describe('openrouterProvider', () => {
  it('is the provider for "openrouter"', () => {
    expect(getProvider('openrouter')).toBe(openrouterProvider)
  })

  it('calls OpenRouter with the strict schema, the reply shape in the instructions, and its own cost', async () => {
    create.mockResolvedValue(reply(JSON.stringify({ suggestions: [item] })))
    const out = await openrouterProvider.generateSuggestions(req)
    expect(ctorOptions[0]).toMatchObject({
      apiKey: 'sk-or-v1-x',
      baseURL: 'https://openrouter.ai/api/v1',
      dangerouslyAllowBrowser: true,
      defaultHeaders: { 'HTTP-Referer': 'https://www.thunderwriter.app', 'X-Title': 'Thunder Writer' },
    })
    const body = create.mock.calls[0][0]
    expect(body.model).toBe('anthropic/claude-haiku-5.5')
    expect(body.messages[0]).toEqual({ role: 'system', content: `SYS\n\nCTX\n\n${OPENROUTER_FORMAT_INSTRUCTIONS}` })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'USER' })
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } })
    expect(body.usage).toEqual({ include: true })
    expect(body.reasoning).toEqual({ effort: 'low', exclude: true })
    expect(out.items).toEqual([item])
    expect(out.usage).toEqual({ inputTokens: 1000, outputTokens: 50, costUsd: 0.000125 })
    expect(out.costKnown).toBe(true)
  })

  it('uses JSON mode or no format for models without strict schemas', async () => {
    create.mockResolvedValue(reply(JSON.stringify({ suggestions: [] })))
    await openrouterProvider.generateSuggestions({ ...req, model: 'meta-llama/llama-mini' })
    expect(create.mock.calls[0][0].response_format).toEqual({ type: 'json_object' })
    await openrouterProvider.generateSuggestions({ ...req, model: 'tiny/plain' })
    expect(create.mock.calls[1][0]).not.toHaveProperty('response_format')
  })

  it('reads the JSON out of fenced or chatty replies', async () => {
    create.mockResolvedValue(reply('Here you go:\n```json\n' + JSON.stringify({ suggestions: [item] }) + '\n```'))
    expect((await openrouterProvider.generateSuggestions(req)).items).toEqual([item])
    expect(extractJsonObject('Sure! {"suggestions":[]} Hope that helps.')).toEqual({ suggestions: [] })
    expect(extractJsonObject('no json here')).toBeNull()
  })

  it('prices from the catalog when OpenRouter sends no cost, and says when the price is unknown', () => {
    const haiku = { promptUsd: 0.0000001, completionUsd: 0.0000005 }
    expect(billOpenRouter({ prompt_tokens: 1000, completion_tokens: 100 }, haiku as never)).toEqual({
      usage: { inputTokens: 1000, outputTokens: 100, costUsd: 0.00015 },
      costKnown: true,
    })
    expect(billOpenRouter({ prompt_tokens: 10, completion_tokens: 1 }, null)).toMatchObject({ costKnown: false, usage: { costUsd: 0 } })
  })

  it('still asks for the schema when the catalog cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    create.mockResolvedValue(reply(JSON.stringify({ suggestions: [item] }), { usage: { prompt_tokens: 5, completion_tokens: 5 } }))
    const out = await openrouterProvider.generateSuggestions(req)
    expect(create.mock.calls[0][0].response_format.type).toBe('json_schema')
    expect(out.costKnown).toBe(false)
    expect(openrouterResponseFormat(null)?.type).toBe('json_schema')
  })

  it('retries once without the output format when the model rejects it', async () => {
    create.mockRejectedValueOnce(apiError(400, 'response_format json_schema is not supported by this provider'))
    create.mockResolvedValueOnce(reply(JSON.stringify({ suggestions: [item] })))
    const out = await openrouterProvider.generateSuggestions(req)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1][0]).not.toHaveProperty('response_format')
    expect(out.items).toEqual([item])
  })

  it('turns failures into messages a writer can act on', async () => {
    create.mockRejectedValueOnce(apiError(402, 'Insufficient credits'))
    await expect(openrouterProvider.generateSuggestions(req)).rejects.toMatchObject({ kind: 'permission', message: expect.stringMatching(/out of credits/) })
    create.mockRejectedValueOnce(apiError(401, 'User not found.'))
    await expect(openrouterProvider.generateSuggestions(req)).rejects.toMatchObject({ kind: 'auth', message: expect.stringMatching(/OpenRouter API key/) })
    create.mockRejectedValueOnce(apiError(404, 'No endpoints found'))
    await expect(openrouterProvider.generateSuggestions(req)).rejects.toMatchObject({ kind: 'bad_request' })
    create.mockResolvedValueOnce({ ...reply('{"suggestions":['), choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: '{"suggestions":[' } }] })
    await expect(openrouterProvider.generateSuggestions(req)).rejects.toMatchObject({ kind: 'truncated', usage: { costUsd: 0.000125 } })
    create.mockResolvedValueOnce({ error: { message: 'Upstream provider timed out' } })
    await expect(openrouterProvider.generateSuggestions(req)).rejects.toMatchObject({ kind: 'server', message: expect.stringMatching(/Upstream provider timed out/) })
    create.mockResolvedValueOnce(reply('I would rather not.'))
    await expect(openrouterProvider.generateSuggestions(req)).rejects.toMatchObject({ kind: 'bad_output' })
  })

  it('has no web search (trivia comes from the model)', () => {
    expect(openrouterProvider.generateTrivia).toBeUndefined()
  })
})
