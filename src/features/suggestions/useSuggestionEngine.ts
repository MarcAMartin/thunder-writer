import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { EditorBridge } from '../../contracts'
import { openSuggestions, useSession } from '../../store/session'
import type { AIProvider } from '../../types'
import { activeApiKey, activeModel, clampSetting, hasApiKey, useSettings } from '../../store/settings'
import { FOCUS_CHARS } from './constants'
import { buildPrompt, buildTriviaPrompt } from './prompt'
import { getProvider, SuggestionError, type SuggestionErrorKind, type SuggestionProvider } from './providers'
import { sanitizeItems, type RawSuggestionWithSources } from './sanitize'
import { requestCount, SuggestionScheduler, type Decision, type GateConfig } from './scheduler'
import { loadLastTriviaAt, loadSearchUnavailable, saveLastTriviaAt, saveSearchUnavailable, searchId } from './triviaMemory'

export interface EngineOptions {
  /** Override provider lookup (tests). */
  providerFor?: (id: AIProvider) => SuggestionProvider
}

export interface SuggestionEngine {
  /** Manual "Generate Suggestions". Returns why it did not fire, if it didn't. */
  generate: () => Decision
  /** Model id whose price is unknown (cost shown as "—"), if any request used one. */
  unpricedModel: string | null
  /** Kind of the last failure (cleared on success), to offer the right fix. */
  errorKind: SuggestionErrorKind | null
}

/**
 * Can this request use web-searched trivia? The writer's toggle, a provider
 * that can search, a model it can search with, and no "search unavailable"
 * answer yet for this key and model (kept in triviaMemory so it survives remounts).
 */
export function webTriviaAvailable(
  s: ReturnType<typeof useSettings.getState>,
  provider: SuggestionProvider,
  unavailableFor: string | null,
): boolean {
  if (!s.triviaWebSearch || typeof provider.generateTrivia !== 'function') return false
  const model = activeModel(s)
  if (provider.supportsWebSearch && !provider.supportsWebSearch(model)) return false
  return unavailableFor !== searchId(s.provider, model, activeApiKey(s))
}

export { activeModel }

/**
 * Background suggestion engine. Mounted once by SuggestionsPane. Watches the
 * editor for typing, and when the writer pauses (and cooldown/change/open-count
 * gates pass) asks the configured provider for 1-2 suggestions.
 */
export function useSuggestionEngine(
  bridge: EditorBridge | null,
  editor: Editor | null,
  options: EngineOptions = {},
): SuggestionEngine {
  const bridgeRef = useRef(bridge)
  const providerForRef = useRef(options.providerFor ?? getProvider)
  const authFailedKeyRef = useRef<string | null>(null)
  const schedulerRef = useRef<SuggestionScheduler | null>(null)
  const [unpricedModel, setUnpricedModel] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<SuggestionErrorKind | null>(null)

  useEffect(() => {
    bridgeRef.current = bridge
    providerForRef.current = options.providerFor ?? getProvider
  })

  useEffect(() => {
    const getConfig = (): GateConfig => {
      const s = useSettings.getState()
      const key = activeApiKey(s)
      return {
        autoEnabled: s.suggestionsEnabled && authFailedKeyRef.current !== key,
        hasKey: hasApiKey(s),
        // Clamped here too: persisted or synced values must never bypass the floors.
        idleMs: clampSetting('suggestionIdleSec', s.suggestionIdleSec) * 1000,
        cooldownMs: clampSetting('suggestionCooldownSec', s.suggestionCooldownSec) * 1000,
        maxOpen: clampSetting('maxOpenSuggestions', s.maxOpenSuggestions),
        triviaSearch: webTriviaAvailable(s, providerForRef.current(s.provider), loadSearchUnavailable()),
        triviaCooldownMs: clampSetting('triviaCooldownSec', s.triviaCooldownSec) * 1000,
      }
    }

    const run = async (count: number, text: string, signal: AbortSignal, trivia: boolean): Promise<boolean> => {
      const b = bridgeRef.current
      if (!b) return false
      const settings = useSettings.getState()
      const session = useSession.getState()
      const providerId = settings.provider
      const provider = providerForRef.current(providerId)
      const apiKey = activeApiKey(settings).trim()
      const model = activeModel(settings)
      const thisSearch = searchId(providerId, model, apiKey)
      // Web-searched trivia on: regular requests leave trivia to the searched request.
      const searchedTrivia = webTriviaAvailable(settings, provider, loadSearchUnavailable())
      const material = {
        fullText: text,
        focus: b.getTextNearCursor(FOCUS_CHARS),
        contextFiles: session.contextFiles,
        previous: session.suggestions,
      }
      const stale = () => signal.aborted || bridgeRef.current !== b

      const record = (usage: SuggestionError['usage'], costKnown: boolean | undefined) => {
        if (!usage) return
        useSession.getState().addUsage(usage)
        if (costKnown === false) setUnpricedModel(model)
      }

      /** Sanitise and add; returns how many cards were added. */
      const accept = (raw: RawSuggestionWithSources[], max: number): number => {
        const store = useSession.getState()
        // The writer may have resolved or received suggestions meanwhile; re-check room.
        const room = requestCount(useSettings.getState().maxOpenSuggestions, openSuggestions(store).length)
        const items = sanitizeItems(raw, {
          maxItems: Math.min(room, max),
          existing: store.suggestions,
          hasQuote: (q) => bridgeRef.current?.hasQuote(q) ?? false,
          provider: providerId,
          model,
        })
        if (items.length > 0) store.addSuggestions(items)
        return items.length
      }

      const toError = (e: unknown) =>
        e instanceof SuggestionError ? e : new SuggestionError('server', 'Something went wrong while fetching suggestions.', { cause: e })

      /** Show a failure to the writer (unless it was a cancellation). */
      const report = (err: SuggestionError) => {
        if (err.kind === 'aborted' || signal.aborted) return
        // A rejected key would fail every time: pause automatic requests until it changes.
        if (err.kind === 'auth') authFailedKeyRef.current = apiKey
        useSession.getState().setAiError(err.message)
        setErrorKind(err.kind)
      }

      const succeed = () => {
        useSession.getState().setAiError(null)
        setErrorKind(null)
        if (authFailedKeyRef.current === apiKey) authFailedKeyRef.current = null
      }

      /** The regular (never searched) request. Resolves true on success; failures are reported. */
      const regular = async (n: number): Promise<boolean> => {
        // Re-read: a search found unavailable a moment ago brings back knowledge-only trivia.
        const skipTrivia = webTriviaAvailable(useSettings.getState(), provider, loadSearchUnavailable())
        const prompt = buildPrompt({ ...material, maxItems: n, searchedTrivia: skipTrivia })
        try {
          const res = await provider.generateSuggestions({
            apiKey,
            model,
            system: prompt.system,
            contextBlock: prompt.contextBlock,
            user: prompt.user,
            maxItems: prompt.maxItems,
            signal,
          })
          record(res.usage, res.costKnown)
          // Made for a manuscript that is no longer open: its cards would be about the wrong book.
          if (stale()) return false
          const items = skipTrivia ? res.items.filter((i) => i.kind !== 'trivia') : res.items
          accept(items, prompt.maxItems)
          succeed()
          return true
        } catch (e) {
          const err = toError(e)
          record(err.usage, err.costKnown)
          report(err)
          return false
        }
      }

      if (!trivia || !searchedTrivia || !provider.generateTrivia) return regular(count)

      /**
       * The web-searched trivia request. Never fatal on its own: a search that
       * is unavailable, errors, or finds nothing falls back to a regular request.
       */
      const searched = async (): Promise<{ added: boolean; fatal?: SuggestionError; notice?: string }> => {
        const prompt = buildTriviaPrompt({ ...material, now: Date.now() })
        try {
          const res = await provider.generateTrivia!({
            apiKey,
            model,
            system: prompt.system,
            contextBlock: prompt.contextBlock,
            user: prompt.user,
            signal,
          })
          record(res.usage, res.costKnown)
          if (stale() || !res.item) return { added: false }
          return { added: accept([res.item], 1) > 0 }
        } catch (e) {
          const err = toError(e)
          record(err.usage, err.costKnown)
          if (err.kind === 'aborted' || err.kind === 'auth' || signal.aborted) return { added: false, fatal: err }
          if (err.kind === 'search_unavailable') {
            saveSearchUnavailable(thisSearch)
            return { added: false, notice: err.message }
          }
          return { added: false }
        }
      }

      // One slot for searched trivia; any other slot goes to a regular request in parallel.
      const regularPending = count > 1 ? regular(count - 1) : null
      const t = await searched()
      if (t.fatal) {
        if (regularPending) await regularPending
        report(t.fatal)
        return false
      }
      let ok: boolean
      if (regularPending) ok = (await regularPending) || t.added
      else if (t.added) {
        succeed()
        ok = true
      } else {
        // Nothing from the search: fill the slot the ordinary way instead of leaving it empty.
        ok = stale() ? false : await regular(count)
      }
      // Tell the writer once why searched trivia stopped; plain suggestions carry on.
      if (ok && t.notice && !stale()) {
        useSession.getState().setAiError(t.notice)
        setErrorKind('search_unavailable')
      }
      return ok
    }
    const scheduler = new SuggestionScheduler({
      getConfig,
      getOpenCount: () => openSuggestions(useSession.getState()).length,
      getText: () => bridgeRef.current?.getPlainText() ?? '',
      run,
      onInFlightChange: (v) => useSession.getState().setGenerating(v),
      // Persisted: leaving for Settings, reloading or opening another tab must not reset the search cooldown.
      triviaClock: { load: loadLastTriviaAt, save: saveLastTriviaAt },
    })
    schedulerRef.current = scheduler
    scheduler.start()
    return () => {
      scheduler.stop()
      schedulerRef.current = null
      useSession.getState().setGenerating(false)
    }
  }, [])

  // Switching manuscripts (a new editor, hence a new bridge) cancels a request made for the old one.
  useEffect(() => {
    return () => schedulerRef.current?.abort()
  }, [bridge])

  // Typing detection: count document changes made while the editor has focus
  // (so loading a file or accepting a suggestion is not treated as new writing).
  useEffect(() => {
    if (!editor) return
    const onUpdate = () => {
      if (editor.isFocused) schedulerRef.current?.noteEdit()
    }
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [editor])

  const generate = useCallback((): Decision => {
    const s = schedulerRef.current
    if (!s) return { fire: false, reason: 'in_flight' }
    return s.requestNow()
  }, [])

  return { generate, unpricedModel, errorKind }
}
