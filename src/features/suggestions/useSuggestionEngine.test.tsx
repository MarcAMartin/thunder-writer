import { act, renderHook, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../../store/session'
import { useSettings } from '../../store/settings'
import { NO_TRIVIA_NOTE } from './prompt'
import {
  SuggestionError,
  type GenerateRequest,
  type GenerateResult,
  type SuggestionProvider,
  type TriviaRequest,
  type TriviaResult,
} from './providers/types'
import { fakeBridge, resetStores } from './testUtils'
import { useSuggestionEngine } from './useSuggestionEngine'

vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }))

const DOC = 'It was a dark and stormy nite. The captain looked away from the sea.'

function fakeProvider(impl: (req: GenerateRequest) => Promise<GenerateResult>) {
  const generateSuggestions = vi.fn(impl)
  const provider: SuggestionProvider = { id: 'claude', generateSuggestions }
  return { provider, generateSuggestions }
}

const okResult = (): GenerateResult => ({
  items: [
    { kind: 'spelling', title: 'nite → night', detail: 'Typo.', quote: 'stormy nite', replacement: 'stormy night' },
    { kind: 'style', title: 'Misquoted', detail: 'x', quote: 'not in the doc', replacement: null },
    { kind: 'general', title: 'Idea', detail: 'What is the captain avoiding?', quote: null, replacement: null },
  ],
  usage: { inputTokens: 1000, outputTokens: 200, costUsd: 0.002 },
  costKnown: true,
})

/** Minimal stand-in for a TipTap editor's event API. */
function fakeEditor() {
  const handlers = new Set<() => void>()
  const ed = {
    isFocused: true,
    on: (_: string, h: () => void) => handlers.add(h),
    off: (_: string, h: () => void) => handlers.delete(h),
  }
  return { editor: ed as unknown as Editor, emit: () => handlers.forEach((h) => h()), ed }
}

beforeEach(() => resetStores())
afterEach(() => vi.useRealTimers())

describe('useSuggestionEngine', () => {
  it('manual generate adds verified suggestions, records usage, and passes the prompt', async () => {
    const fb = fakeBridge(DOC)
    const { provider, generateSuggestions } = fakeProvider(async () => okResult())
    const { result } = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => provider }))

    act(() => {
      expect(result.current.generate()).toEqual({ fire: true, count: 2, trivia: false })
    })
    await waitFor(() => expect(useSession.getState().suggestions).toHaveLength(2))

    const st = useSession.getState()
    expect(st.suggestions.map((s) => s.title)).toEqual(['nite → night', 'Idea'])
    expect(st.usage).toEqual({ inputTokens: 1000, outputTokens: 200, costUsd: 0.002 })
    expect(st.generating).toBe(false)
    const req = generateSuggestions.mock.calls[0][0]
    expect(req).toMatchObject({ apiKey: 'sk-test', model: 'claude-haiku-4-5', maxItems: 2 })
    expect(req.user).toContain('stormy nite')
    expect(req.signal).toBeInstanceOf(AbortSignal)
  })

  it('never exceeds maxOpenSuggestions', async () => {
    useSettings.setState({ maxOpenSuggestions: 1 })
    const fb = fakeBridge(DOC)
    const { provider, generateSuggestions } = fakeProvider(async () => okResult())
    const { result } = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => provider }))
    act(() => void result.current.generate())
    await waitFor(() => expect(useSession.getState().suggestions).toHaveLength(1))
    expect(generateSuggestions.mock.calls[0][0].maxItems).toBe(1)
    act(() => {
      expect(result.current.generate()).toMatchObject({ fire: false, reason: 'full' })
    })
  })

  it('surfaces a bad key as an error that points to Settings', async () => {
    const fb = fakeBridge(DOC)
    const { provider } = fakeProvider(async () => {
      throw new SuggestionError('auth', 'Your Claude API key was rejected. Check it in Settings.')
    })
    const { result } = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => provider }))
    act(() => void result.current.generate())
    await waitFor(() => expect(useSession.getState().aiError).toMatch(/rejected/))
    expect(result.current.errorKind).toBe('auth')
    expect(useSession.getState().generating).toBe(false)
  })

  it('records billed usage from failed-but-billed responses and flags unknown pricing', async () => {
    useSettings.setState({ claudeModel: 'claude-custom-x' })
    const fb = fakeBridge(DOC)
    const { provider } = fakeProvider(async () => {
      throw new SuggestionError('truncated', 'ran out of room', {
        usage: { inputTokens: 5, outputTokens: 7, costUsd: 0 },
        costKnown: false,
      })
    })
    const { result } = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => provider }))
    act(() => void result.current.generate())
    await waitFor(() => expect(result.current.unpricedModel).toBe('claude-custom-x'))
    expect(useSession.getState().usage.outputTokens).toBe(7)
  })

  it('aborts the in-flight request on unmount', async () => {
    const fb = fakeBridge(DOC)
    let seen: AbortSignal | undefined
    const { provider } = fakeProvider(
      (req) =>
        new Promise((_, reject) => {
          seen = req.signal
          req.signal?.addEventListener('abort', () => reject(new SuggestionError('aborted', 'cancelled')))
        }),
    )
    const { result, unmount } = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => provider }))
    act(() => void result.current.generate())
    expect(useSession.getState().generating).toBe(true)
    unmount()
    expect(seen?.aborted).toBe(true)
    await waitFor(() => expect(useSession.getState().generating).toBe(false))
    expect(useSession.getState().aiError).toBeNull()
  })

  it('automatic mode fires after the writer pauses, only for focused edits', async () => {
    vi.useFakeTimers()
    const fb = fakeBridge(DOC)
    const fe = fakeEditor()
    const { provider, generateSuggestions } = fakeProvider(async () => okResult())
    renderHook(() => useSuggestionEngine(fb.bridge, fe.editor, { providerFor: () => provider }))

    fe.ed.isFocused = false
    act(() => fe.emit()) // programmatic load: ignored
    await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)))
    expect(generateSuggestions).not.toHaveBeenCalled()

    fe.ed.isFocused = true
    act(() => fe.emit())
    await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)))
    expect(generateSuggestions).not.toHaveBeenCalled()
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)))
    expect(generateSuggestions).toHaveBeenCalledTimes(1)
  })

  it('automatic mode stays off when disabled', async () => {
    vi.useFakeTimers()
    useSettings.setState({ suggestionsEnabled: false })
    const fb = fakeBridge(DOC)
    const fe = fakeEditor()
    const { provider, generateSuggestions } = fakeProvider(async () => okResult())
    renderHook(() => useSuggestionEngine(fb.bridge, fe.editor, { providerFor: () => provider }))
    act(() => fe.emit())
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)))
    expect(generateSuggestions).not.toHaveBeenCalled()
  })

  it('drops the response of a request made for a manuscript that was switched away from', async () => {
    const first = fakeBridge(DOC)
    const second = fakeBridge('A completely different manuscript about gardens and bees.')
    let resolve!: (r: GenerateResult) => void
    let seen: AbortSignal | undefined
    const { provider } = fakeProvider(
      (req) =>
        new Promise((res) => {
          seen = req.signal
          resolve = res
        }),
    )
    const { result, rerender } = renderHook(
      ({ bridge }) => useSuggestionEngine(bridge, null, { providerFor: () => provider }),
      { initialProps: { bridge: first.bridge } },
    )
    act(() => void result.current.generate())
    expect(useSession.getState().generating).toBe(true)
    rerender({ bridge: second.bridge })
    expect(seen?.aborted).toBe(true)
    await act(async () => resolve(okResult()))
    await waitFor(() => expect(useSession.getState().generating).toBe(false))
    // Unquoted "general" cards from the old manuscript must not land on the new one; usage still counts.
    expect(useSession.getState().suggestions).toHaveLength(0)
    expect(useSession.getState().usage.costUsd).toBeCloseTo(0.002)
    expect(useSession.getState().aiError).toBeNull()
  })

  it('never lets persisted settings go below the cooldown/idle floors', async () => {
    vi.useFakeTimers()
    useSettings.setState({ suggestionCooldownSec: 0, suggestionIdleSec: 0, maxOpenSuggestions: 5 })
    const fb = fakeBridge(DOC)
    const fe = fakeEditor()
    const { provider, generateSuggestions } = fakeProvider(async () => ({ ...okResult(), items: [] }))
    renderHook(() => useSuggestionEngine(fb.bridge, fe.editor, { providerFor: () => provider }))
    act(() => fe.emit())
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)))
    expect(generateSuggestions).toHaveBeenCalledTimes(1)
    // More writing right away: the 5 s cooldown floor still applies.
    fb.setText(DOC + ' And then the storm broke over the harbour with a roar.')
    act(() => fe.emit())
    await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)))
    expect(generateSuggestions).toHaveBeenCalledTimes(1)
    await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)))
    expect(generateSuggestions).toHaveBeenCalledTimes(2)
  })
})

describe('useSuggestionEngine: web-searched trivia', () => {
  const triviaOk = (): TriviaResult => ({
    item: {
      kind: 'trivia',
      title: 'Storm-season record set this year',
      detail: 'Possibly relevant: forecasters logged a record number of named storms.',
      quote: null,
      replacement: null,
      sources: [{ url: 'https://news.example/storms', title: 'Record storm season' }],
    },
    outcome: 'ok',
    usage: { inputTokens: 5000, outputTokens: 150, costUsd: 0.0158, webSearches: 1 },
    costKnown: true,
  })

  function searchingProvider(
    trivia: (req: TriviaRequest) => Promise<TriviaResult>,
    regular: (req: GenerateRequest) => Promise<GenerateResult> = async () => okResult(),
  ) {
    const generateSuggestions = vi.fn(regular)
    const generateTrivia = vi.fn(trivia)
    const provider: SuggestionProvider = { id: 'claude', generateSuggestions, generateTrivia, supportsWebSearch: () => true }
    return { provider, generateSuggestions, generateTrivia }
  }

  it('fills one slot with a sourced trivia card and the other with a regular (never searched) request', async () => {
    const fb = fakeBridge(DOC)
    const p = searchingProvider(async () => triviaOk())
    const { result } = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => p.provider }))
    act(() => {
      expect(result.current.generate()).toEqual({ fire: true, count: 2, trivia: true })
    })
    await waitFor(() => expect(useSession.getState().suggestions).toHaveLength(2))
    expect(p.generateTrivia).toHaveBeenCalledTimes(1)
    const treq = p.generateTrivia.mock.calls[0][0]
    expect(treq.user).toContain("Today's date is")
    expect(treq.user).toContain('stormy nite')
    const rreq = p.generateSuggestions.mock.calls[0][0]
    expect(rreq.maxItems).toBe(1)
    expect(rreq.user).toContain(NO_TRIVIA_NOTE)
    const cards = useSession.getState().suggestions
    const trivia = cards.find((c) => c.kind === 'trivia')
    expect(trivia?.sources).toEqual([{ url: 'https://news.example/storms', title: 'Record storm season' }])
    expect(useSession.getState().usage.webSearches).toBe(1)
    expect(useSession.getState().usage.costUsd).toBeCloseTo(0.0178)
  })

  it('drops knowledge-only trivia from regular results while search is on', async () => {
    const fb = fakeBridge(DOC)
    const p = searchingProvider(
      async () => ({ item: null, outcome: 'none', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.01, webSearches: 1 }, costKnown: true }),
      async () => ({
        ...okResult(),
        items: [
          { kind: 'trivia', title: 'Unsourced trivia', detail: 'x', quote: null, replacement: null },
          { kind: 'general', title: 'Idea', detail: 'y', quote: null, replacement: null },
        ],
      }),
    )
    useSettings.setState({ maxOpenSuggestions: 1 })
    const { result } = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => p.provider }))
    act(() => void result.current.generate())
    // NONE with one slot: falls back to a regular request for that slot.
    await waitFor(() => expect(useSession.getState().suggestions.map((s) => s.title)).toEqual(['Idea']))
    expect(p.generateSuggestions).toHaveBeenCalledTimes(1)
    expect(p.generateSuggestions.mock.calls[0][0].maxItems).toBe(1)
  })

  it('org-disabled web search: friendly notice, plain suggestions still arrive, no further searches', async () => {
    const fb = fakeBridge(DOC)
    const p = searchingProvider(async () => {
      throw new SuggestionError(
        'search_unavailable',
        "Web search isn't enabled for your Claude organization — enable it in the Claude Console or turn off web-searched trivia in Settings.",
      )
    })
    useSettings.setState({ maxOpenSuggestions: 1 })
    const { result } = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => p.provider }))
    act(() => void result.current.generate())
    await waitFor(() => expect(useSession.getState().suggestions).toHaveLength(1))
    expect(useSession.getState().aiError).toMatch(/enable it in the Claude Console/)
    expect(result.current.errorKind).toBe('search_unavailable')
    // Knowledge-only trivia is allowed again in the fallback request.
    expect(p.generateSuggestions.mock.calls[0][0].user).not.toContain(NO_TRIVIA_NOTE)

    // Later requests (even once the trivia cooldown would allow one) skip search for this key/model.
    useSession.getState().setSuggestionStatus(useSession.getState().suggestions[0].id, 'declined')
    const later = Date.now() + 700_000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    try {
      act(() => {
        expect(result.current.generate()).toMatchObject({ fire: true, trivia: false })
      })
      await waitFor(() => expect(p.generateSuggestions).toHaveBeenCalledTimes(2))
      expect(p.generateTrivia).toHaveBeenCalledTimes(1)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('remounting the engine (Settings and back, reload) inside the trivia cooldown does not search again', async () => {
    const fb = fakeBridge(DOC)
    const p = searchingProvider(async () => triviaOk())
    useSettings.setState({ maxOpenSuggestions: 1 })
    const first = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => p.provider }))
    act(() => {
      expect(first.result.current.generate()).toMatchObject({ fire: true, trivia: true })
    })
    await waitFor(() => expect(useSession.getState().suggestions).toHaveLength(1))
    first.unmount()
    useSession.getState().setSuggestionStatus(useSession.getState().suggestions[0].id, 'declined')

    const second = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => p.provider }))
    act(() => {
      expect(second.result.current.generate()).toMatchObject({ fire: true, trivia: false })
    })
    await waitFor(() => expect(p.generateSuggestions).toHaveBeenCalledTimes(1))
    expect(p.generateTrivia).toHaveBeenCalledTimes(1)
    second.unmount()
  })

  it('a "search unavailable" answer survives a remount (no repeated failing search or notice)', async () => {
    const fb = fakeBridge(DOC)
    const p = searchingProvider(async () => {
      throw new SuggestionError('search_unavailable', "Web search isn't enabled for your Claude organization.")
    })
    useSettings.setState({ maxOpenSuggestions: 1, triviaCooldownSec: 120 })
    const first = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => p.provider }))
    act(() => void first.result.current.generate())
    await waitFor(() => expect(useSession.getState().suggestions).toHaveLength(1))
    first.unmount()
    useSession.getState().setSuggestionStatus(useSession.getState().suggestions[0].id, 'declined')
    // The stored marker never contains the key itself.
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('sk-test')

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 700_000)
    try {
      const second = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => p.provider }))
      act(() => {
        expect(second.result.current.generate()).toMatchObject({ fire: true, trivia: false })
      })
      await waitFor(() => expect(p.generateSuggestions).toHaveBeenCalledTimes(2))
      expect(p.generateTrivia).toHaveBeenCalledTimes(1)
      second.unmount()
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('a rejected key during the search is reported like any other auth failure', async () => {
    const fb = fakeBridge(DOC)
    const p = searchingProvider(async () => {
      throw new SuggestionError('auth', 'Your Claude API key was rejected. Check it in Settings.')
    })
    useSettings.setState({ maxOpenSuggestions: 1 })
    const { result } = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => p.provider }))
    act(() => void result.current.generate())
    await waitFor(() => expect(result.current.errorKind).toBe('auth'))
    expect(p.generateSuggestions).not.toHaveBeenCalled()
  })

  it('with the toggle off, never searches and keeps knowledge-only trivia', async () => {
    useSettings.setState({ triviaWebSearch: false })
    const fb = fakeBridge(DOC)
    const p = searchingProvider(async () => triviaOk(), async () => ({
      ...okResult(),
      items: [{ kind: 'trivia', title: 'Old lighthouse fact', detail: 'As of my knowledge…', quote: null, replacement: null }],
    }))
    const { result } = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => p.provider }))
    act(() => {
      expect(result.current.generate()).toEqual({ fire: true, count: 2, trivia: false })
    })
    await waitFor(() => expect(useSession.getState().suggestions).toHaveLength(1))
    expect(p.generateTrivia).not.toHaveBeenCalled()
    expect(p.generateSuggestions.mock.calls[0][0].user).not.toContain(NO_TRIVIA_NOTE)
    expect(useSession.getState().suggestions[0].kind).toBe('trivia')
  })

  it('skips search for models the provider cannot search with', async () => {
    const fb = fakeBridge(DOC)
    const p = searchingProvider(async () => triviaOk())
    p.provider.supportsWebSearch = () => false
    const { result } = renderHook(() => useSuggestionEngine(fb.bridge, null, { providerFor: () => p.provider }))
    act(() => {
      expect(result.current.generate()).toMatchObject({ fire: true, trivia: false })
    })
    await waitFor(() => expect(p.generateSuggestions).toHaveBeenCalled())
    expect(p.generateTrivia).not.toHaveBeenCalled()
  })
})
