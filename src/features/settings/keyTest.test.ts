import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOpenRouterModels } from '../suggestions/providers/openrouterModels'
import { testOpenRouter } from './keyTest'

const catalog = { data: [{ id: 'anthropic/claude-haiku-5.5', name: 'Anthropic: Claude Haiku 5.5' }] }
const respond = (keyStatus: number, keyBody: unknown = {}) =>
  vi.fn(async (url: RequestInfo | URL) =>
    String(url).endsWith('/key') ? new Response(JSON.stringify(keyBody), { status: keyStatus }) : new Response(JSON.stringify(catalog)),
  )

beforeEach(() => resetOpenRouterModels())

describe('testOpenRouter', () => {
  it('checks the key for free, then the model id, and reports credit left', async () => {
    const fetchImpl = respond(200, { data: { limit: 10, limit_remaining: 7.5 } })
    const out = await testOpenRouter('sk-or-v1-x', 'anthropic/claude-haiku-5.5', fetchImpl)
    expect(out).toEqual({ ok: true, message: 'Key works. Anthropic: Claude Haiku 5.5 is available. $7.50 of this key’s limit left.' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/key')
    expect(init.headers).toEqual({ Authorization: 'Bearer sk-or-v1-x' })
  })

  it('says when the key is rejected, the model is unknown, or OpenRouter is unreachable', async () => {
    expect(await testOpenRouter('bad', 'x', respond(401))).toMatchObject({ ok: false, message: expect.stringMatching(/rejected this key/) })
    expect(await testOpenRouter('k', 'nobody/nothing', respond(200, { data: {} }))).toEqual({
      ok: true,
      message: 'Key works. Couldn’t find model “nobody/nothing” in OpenRouter’s catalog; check the id.',
    })
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await testOpenRouter('k', 'x', offline)).toMatchObject({ ok: false, message: expect.stringMatching(/Could not reach OpenRouter/) })
  })
})
