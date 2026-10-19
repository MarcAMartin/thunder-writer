import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()

vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>()
  class FakeOpenAI extends actual.default {
    constructor(opts: ConstructorParameters<typeof actual.default>[0]) {
      super(opts)
      Object.defineProperty(this, 'chat', { value: { completions: { create } } })
    }
  }
  return { ...actual, default: FakeOpenAI }
})

import { THUNDER_AI_MARKUP, THUNDER_AI_MODEL } from '../../thunderAi/plans'
import { getProvider } from './index'
import { resetOpenRouterModels } from './openrouterModels'
import { thunderProvider } from './thunder'

const catalog = {
  data: [{ id: THUNDER_AI_MODEL, name: 'gpt-oss-20b', pricing: { prompt: '0.000000018', completion: '0.00000009' }, supported_parameters: ['structured_outputs'] }],
}
const req = { apiKey: 'sk-or-v1-bought', model: THUNDER_AI_MODEL, system: 'SYS', contextBlock: '', user: 'USER', maxItems: 2 }
const item = { kind: 'style', title: 'T', detail: 'D', quote: null, replacement: null }
const apiError = (status: number, message: string) => OpenAI.APIError.generate(status, { error: { message } }, message, new Headers())

beforeEach(() => {
  create.mockReset()
  resetOpenRouterModels()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(catalog))))
})
afterEach(() => vi.unstubAllGlobals())

describe('thunderProvider', () => {
  it('is the provider for "thunder"', () => {
    expect(getProvider('thunder')).toBe(thunderProvider)
  })

  it('asks OpenRouter on the fixed model and reports what the writer’s credit paid', async () => {
    create.mockResolvedValue({
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ suggestions: [item] }), refusal: null } }],
      usage: { prompt_tokens: 6000, completion_tokens: 800, cost: 0.0002 },
    })
    const out = await thunderProvider.generateSuggestions(req)
    expect(create.mock.calls[0][0]).toMatchObject({ model: THUNDER_AI_MODEL })
    expect(out.items).toHaveLength(1)
    expect(out.usage.costUsd).toBeCloseTo(0.0002 * THUNDER_AI_MARKUP, 10)
    expect(out.costKnown).toBe(true)
  })

  it('a refused key points the writer at their balance, not at OpenRouter', async () => {
    create.mockRejectedValue(apiError(402, 'Key limit exceeded'))
    const err = await thunderProvider.generateSuggestions(req).catch((e) => e)
    expect(err.kind).toBe('permission')
    expect(err.message).toMatch(/Thunder Writer AI/)
    expect(err.message).toMatch(/balance in Settings/)
    expect(err.message).not.toMatch(/OpenRouter|model/i)
  })

  it('never tells the writer to pick another model', async () => {
    create.mockRejectedValue(apiError(404, 'No endpoints found'))
    const err = await thunderProvider.generateSuggestions(req).catch((e) => e)
    expect(err.kind).toBe('server')
    expect(err.message).not.toMatch(/model in Settings|OpenRouter/)
  })

  it('names Thunder Writer AI when the key is rejected', async () => {
    create.mockRejectedValue(apiError(401, 'User not found'))
    const err = await thunderProvider.generateSuggestions(req).catch((e) => e)
    expect(err.kind).toBe('auth')
    expect(err.message).toMatch(/Thunder Writer AI key/)
  })
})
