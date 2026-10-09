import { beforeEach, describe, expect, it, vi } from 'vitest'
import { describeOpenRouterPrice, findOpenRouterModel, loadOpenRouterModels, parseOpenRouterCatalog, resetOpenRouterModels } from './openrouterModels'

const catalog = {
  data: [
    { id: 'openai/gpt-6-luna', name: 'OpenAI: GPT-6 Luna', context_length: 1050000, pricing: { prompt: '0.0000001', completion: '0.0000005' }, supported_parameters: ['response_format', 'structured_outputs'] },
    { id: 'free/model', name: 'Free', pricing: { prompt: '0', completion: '0' } },
    { name: 'no id' },
    { id: 'odd/price', pricing: { prompt: '-1', completion: 'x' } },
  ],
}

beforeEach(() => resetOpenRouterModels())

describe('OpenRouter model catalog', () => {
  it('keeps id, name, prices and output formats, skipping odd entries', () => {
    const models = parseOpenRouterCatalog(catalog)
    expect(models.map((m) => m.id)).toEqual(['openai/gpt-6-luna', 'free/model', 'odd/price'])
    expect(models[0]).toEqual({
      id: 'openai/gpt-6-luna',
      name: 'OpenAI: GPT-6 Luna',
      promptUsd: 0.0000001,
      completionUsd: 0.0000005,
      contextLength: 1050000,
      structuredOutputs: true,
      responseFormat: true,
    })
    expect(models[2]).toMatchObject({ name: 'odd/price', promptUsd: null, completionUsd: null, structuredOutputs: false })
    expect(parseOpenRouterCatalog(null)).toEqual([])
  })

  it('describes prices per million tokens', () => {
    expect(describeOpenRouterPrice({ promptUsd: 0.0000001, completionUsd: 0.0000005 })).toBe('$0.10 in / $0.50 out per million tokens')
    expect(describeOpenRouterPrice({ promptUsd: 0.000003, completionUsd: 0.000015 })).toBe('$3 in / $15 out per million tokens')
    expect(describeOpenRouterPrice({ promptUsd: 0, completionUsd: 0 })).toBe('Free')
    expect(describeOpenRouterPrice({ promptUsd: null, completionUsd: 0 })).toBeNull()
  })

  it('fetches the catalog once, and again after a failure', async () => {
    const ok = vi.fn(async (_url: RequestInfo | URL) => new Response(JSON.stringify(catalog)))
    await loadOpenRouterModels(ok)
    await loadOpenRouterModels(ok)
    expect(ok).toHaveBeenCalledTimes(1)
    expect(ok.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/models')

    resetOpenRouterModels()
    const down = vi.fn(async (_url: RequestInfo | URL) => new Response('', { status: 503 }))
    expect(await findOpenRouterModel('openai/gpt-6-luna', down)).toBeNull()
    expect((await findOpenRouterModel(' openai/gpt-6-luna ', ok))?.name).toBe('OpenAI: GPT-6 Luna')
  })
})
