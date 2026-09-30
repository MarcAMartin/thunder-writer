import Anthropic from '@anthropic-ai/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
const ctorOptions: unknown[] = []

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>()
  class FakeAnthropic extends actual.default {
    constructor(opts: ConstructorParameters<typeof actual.default>[0]) {
      super(opts)
      ctorOptions.push(opts)
      Object.defineProperty(this, 'messages', { value: { create } })
    }
  }
  return { ...actual, default: FakeAnthropic }
})

import { CLAUDE_WEB_SEARCH_TOOL, claudeProvider, claudeSystemBlocks, mapClaudeError } from './claude'
import { SuggestionError } from './types'

const req = { apiKey: 'sk-ant', model: 'claude-haiku-4-5', system: 'SYS', contextBlock: 'CTX', user: 'USER', maxItems: 2 }

const response = (text: string, extra: Record<string, unknown> = {}) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 },
  ...extra,
})

beforeEach(() => {
  create.mockReset()
  ctorOptions.length = 0
})

describe('claudeSystemBlocks', () => {
  it('puts the cache breakpoint after the context files', () => {
    expect(claudeSystemBlocks('S', 'C')).toEqual([
      { type: 'text', text: 'S' },
      { type: 'text', text: 'C', cache_control: { type: 'ephemeral' } },
    ])
    expect(claudeSystemBlocks('S', '')).toEqual([{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }])
  })
})

describe('claudeProvider', () => {
  it('calls the API from the browser with a JSON schema and returns items + cost', async () => {
    create.mockResolvedValue(
      response(JSON.stringify({ suggestions: [{ kind: 'Grammar', title: 'T', detail: 'D', quote: 'q', replacement: null }] })),
    )
    const out = await claudeProvider.generateSuggestions(req)
    expect(ctorOptions[0]).toMatchObject({ apiKey: 'sk-ant', dangerouslyAllowBrowser: true })
    const body = create.mock.calls[0][0]
    expect(body).toMatchObject({ model: 'claude-haiku-4-5', messages: [{ role: 'user', content: 'USER' }] })
    expect(body.output_config.format.type).toBe('json_schema')
    expect(body.output_config.format.schema.properties.suggestions.items.properties.kind.enum).toContain('trivia')
    expect(body).not.toHaveProperty('thinking')
    expect(out.items).toEqual([{ kind: 'grammar', title: 'T', detail: 'D', quote: 'q', replacement: null }])
    expect(out.usage.inputTokens).toBe(3000)
    expect(out.usage.costUsd).toBeCloseTo((1000 * 1 + 2000 * 0.1 + 100 * 5) / 1e6)
    expect(out.costKnown).toBe(true)
  })

  it('skips malformed items and maps unknown kinds to general', async () => {
    create.mockResolvedValue(
      response(JSON.stringify({ suggestions: [{ kind: 'vibes', title: 'Ok', detail: '' }, { title: 42 }] })),
    )
    const out = await claudeProvider.generateSuggestions(req)
    expect(out.items).toEqual([{ kind: 'general', title: 'Ok', detail: '', quote: null, replacement: null }])
  })

  it.each([
    ['refusal', 'refusal'],
    ['max_tokens', 'truncated'],
  ])('stop_reason %s becomes a %s error that still carries usage', async (stop, kind) => {
    create.mockResolvedValue(response('{"suggestions":[', { stop_reason: stop }))
    const err = await claudeProvider.generateSuggestions(req).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SuggestionError)
    expect((err as SuggestionError).kind).toBe(kind)
    expect((err as SuggestionError).usage?.outputTokens).toBe(100)
  })

  it('unparseable output is a bad_output error', async () => {
    create.mockResolvedValue(response('not json'))
    await expect(claudeProvider.generateSuggestions(req)).rejects.toMatchObject({ kind: 'bad_output' })
  })

  it('reports unknown model pricing', async () => {
    create.mockResolvedValue(response('{"suggestions":[]}'))
    const out = await claudeProvider.generateSuggestions({ ...req, model: 'claude-next-9' })
    expect(out.costKnown).toBe(false)
    expect(out.usage.costUsd).toBe(0)
  })
})

describe('mapClaudeError', () => {
  const h = new Headers()
  it('maps SDK errors most-specific first', () => {
    expect(mapClaudeError(new Anthropic.AuthenticationError(401, undefined, 'bad key', h)).kind).toBe('auth')
    expect(mapClaudeError(new Anthropic.AuthenticationError(401, undefined, 'bad key', h)).message).toMatch(/Settings/)
    expect(mapClaudeError(new Anthropic.RateLimitError(429, undefined, 'slow', h)).kind).toBe('rate_limit')
    expect(mapClaudeError(new Anthropic.APIConnectionError({ message: 'offline' })).kind).toBe('network')
    expect(mapClaudeError(new Anthropic.APIUserAbortError()).kind).toBe('aborted')
    expect(mapClaudeError(new Anthropic.InternalServerError(500, undefined, 'boom', h)).kind).toBe('server')
  })
})

describe('claudeProvider.generateTrivia (web search)', () => {
  const treq = { apiKey: 'sk-ant', model: 'claude-haiku-4-5', system: 'TSYS', contextBlock: 'CTX', user: 'TUSER' }
  const ITEM = {
    kind: 'trivia',
    title: 'Right whales rebound off Nantucket',
    detail: 'Possibly relevant: surveyors reported a record right-whale count this spring.',
    quote: null,
    replacement: null,
    source_urls: ['https://science.example/right-whales'],
  }
  const json = JSON.stringify(ITEM)
  const cut = json.indexOf('"detail"')
  const serverToolUse = { type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: { query: 'right whale count Nantucket 2026' } }
  const searchResult = {
    type: 'web_search_tool_result',
    tool_use_id: 'srvtoolu_01',
    content: [
      { type: 'web_search_result', url: 'https://news.example/whales', title: 'Record whale count', encrypted_content: 'enc1', page_age: 'September 2, 2026' },
      { type: 'web_search_result', url: 'https://science.example/right-whales', title: 'Right whales rebound', encrypted_content: 'enc2', page_age: null },
    ],
  }
  const citedText = [
    { type: 'text', text: "I'll look for recent whale news.", citations: null },
    serverToolUse,
    searchResult,
    // The final answer, split across text blocks where citations attach.
    { type: 'text', text: json.slice(0, cut), citations: null },
    {
      type: 'text',
      text: json.slice(cut),
      citations: [
        {
          type: 'web_search_result_location',
          url: 'https://news.example/whales',
          title: 'Record whale count',
          encrypted_index: 'idx',
          cited_text: 'Surveyors counted a record number of right whales...',
        },
      ],
    },
  ]
  const searchResponse = (content: unknown[], extra: Record<string, unknown> = {}) => ({
    content,
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 6000,
      output_tokens: 200,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
    },
    ...extra,
  })

  it('sends only the basic web search tool (max_uses 1), no output_config, and returns the cited item', async () => {
    create.mockResolvedValue(searchResponse(citedText))
    const out = await claudeProvider.generateTrivia!(treq)
    const body = create.mock.calls[0][0]
    expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }])
    expect(CLAUDE_WEB_SEARCH_TOOL).toEqual(body.tools[0])
    // No SDK retries: a retried (timed-out) search request could bill a second search.
    expect(ctorOptions[0]).toMatchObject({ maxRetries: 0 })
    expect(body).not.toHaveProperty('output_config')
    expect(body.messages).toEqual([{ role: 'user', content: 'TUSER' }])
    expect(body.system.map((b: { text: string }) => b.text)).toEqual(['TSYS', 'CTX'])
    expect(out.outcome).toBe('ok')
    expect(out.item).toMatchObject({ kind: 'trivia', title: ITEM.title, replacement: null })
    expect(out.item?.sources).toEqual([
      { url: 'https://news.example/whales', title: 'Record whale count' },
      { url: 'https://science.example/right-whales', title: 'Right whales rebound' },
    ])
    // $0.01 per search on top of tokens.
    expect(out.usage.webSearches).toBe(1)
    expect(out.usage.costUsd).toBeCloseTo((6000 * 1 + 200 * 5) / 1e6 + 0.01)
    expect(out.costKnown).toBe(true)
  })

  it('an error OBJECT in web_search_tool_result (HTTP 200) yields no item, never unsourced text', async () => {
    create.mockResolvedValue(
      searchResponse(
        [
          serverToolUse,
          { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_01', content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' } },
          { type: 'text', text: json, citations: null },
        ],
        { usage: { input_tokens: 900, output_tokens: 60, server_tool_use: { web_search_requests: 0 } } },
      ),
    )
    const out = await claudeProvider.generateTrivia!(treq)
    expect(out).toMatchObject({ item: null, outcome: 'search_error', searchErrorCode: 'too_many_requests' })
    expect(out.usage).not.toHaveProperty('webSearches') // failed searches are not billed
    expect(out.usage.costUsd).toBeCloseTo((900 + 60 * 5) / 1e6)
  })

  it('max_uses_exceeded after a successful search keeps the sourced answer', async () => {
    create.mockResolvedValue(
      searchResponse([
        ...citedText.slice(0, 3),
        { type: 'server_tool_use', id: 'srvtoolu_02', name: 'web_search', input: { query: 'more' } },
        { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_02', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
        ...citedText.slice(3),
      ]),
    )
    const out = await claudeProvider.generateTrivia!(treq)
    expect(out.outcome).toBe('ok')
    expect(out.searchErrorCode).toBe('max_uses_exceeded')
  })

  it('continues a pause_turn once by re-sending the assistant content, summing usage', async () => {
    const paused = searchResponse([{ type: 'text', text: 'Searching.', citations: null }, serverToolUse], { stop_reason: 'pause_turn' })
    create.mockResolvedValueOnce(paused).mockResolvedValueOnce(
      searchResponse(citedText.slice(2), { usage: { input_tokens: 3000, output_tokens: 100, server_tool_use: { web_search_requests: 0 } } }),
    )
    const out = await claudeProvider.generateTrivia!(treq)
    expect(create).toHaveBeenCalledTimes(2)
    const second = create.mock.calls[1][0]
    expect(second.messages).toEqual([
      { role: 'user', content: 'TUSER' },
      { role: 'assistant', content: paused.content },
    ])
    expect(second.messages).toHaveLength(2) // no extra "continue" user message
    expect(second.tools).toEqual(create.mock.calls[0][0].tools) // same tools on the continuation
    expect(out.outcome).toBe('ok')
    expect(out.usage).toMatchObject({ inputTokens: 9000, outputTokens: 300, webSearches: 1 })
  })

  it('gives up after one continuation with a billed truncated error', async () => {
    create.mockResolvedValue(searchResponse([serverToolUse], { stop_reason: 'pause_turn' }))
    const err = await claudeProvider.generateTrivia!(treq).catch((e: unknown) => e)
    expect(create).toHaveBeenCalledTimes(2)
    expect(err).toMatchObject({ kind: 'truncated' })
    expect((err as SuggestionError).usage?.webSearches).toBe(2)
  })

  it.each([
    ['refusal', 'refusal'],
    ['max_tokens', 'truncated'],
  ])('stop_reason %s becomes a %s error carrying usage', async (stop, kind) => {
    create.mockResolvedValue(searchResponse(citedText, { stop_reason: stop }))
    const err = await claudeProvider.generateTrivia!(treq).catch((e: unknown) => e)
    expect(err).toMatchObject({ kind })
    expect((err as SuggestionError).usage?.webSearches).toBe(1)
  })

  it('NONE after searching is not an error', async () => {
    create.mockResolvedValue(searchResponse([serverToolUse, searchResult, { type: 'text', text: 'NONE', citations: null }]))
    const out = await claudeProvider.generateTrivia!(treq)
    expect(out).toMatchObject({ item: null, outcome: 'none' })
    expect(out.usage.webSearches).toBe(1)
  })

  it('maps "web search is not enabled" (org setting) to a friendly search_unavailable error', async () => {
    const h = new Headers()
    create.mockRejectedValue(
      new Anthropic.BadRequestError(
        400,
        { type: 'error', error: { type: 'invalid_request_error', message: 'Web search is not enabled for this organization.' } },
        'Web search is not enabled for this organization.',
        h,
      ),
    )
    const err = await claudeProvider.generateTrivia!(treq).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SuggestionError)
    expect((err as SuggestionError).kind).toBe('search_unavailable')
    expect((err as SuggestionError).message).toBe(
      "Web search isn't enabled for your Claude organization — enable it in the Claude Console or turn off web-searched trivia in Settings.",
    )
    expect((err as SuggestionError).message).not.toContain('sk-ant')
    // Other bad requests keep their normal mapping.
    create.mockRejectedValue(new Anthropic.BadRequestError(400, undefined, 'max_tokens: too large', h))
    await expect(claudeProvider.generateTrivia!(treq)).rejects.toMatchObject({ kind: 'bad_request' })
    create.mockRejectedValue(new Anthropic.AuthenticationError(401, undefined, 'bad key', h))
    await expect(claudeProvider.generateTrivia!(treq)).rejects.toMatchObject({ kind: 'auth' })
  })

  it('the regular suggestions request never carries the search tool', async () => {
    create.mockResolvedValue(response('{"suggestions":[]}'))
    await claudeProvider.generateSuggestions(req)
    expect(create.mock.calls[0][0]).not.toHaveProperty('tools')
  })
})
