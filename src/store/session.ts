import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { AIUsage, ContextFile, Suggestion, SuggestionStatus } from '../types'

/**
 * Per-writing-session state: suggestions, context files, stats. The session
 * spans the browser tab, not a visit to /write: leaving for Settings and coming
 * back keeps the clock, cost, accepted count and open cards. The running totals
 * (clock, cost, accepted) are also kept in sessionStorage so a reload of the
 * tab doesn't zero them. Context files are persisted by the suggestions feature.
 */
export interface SessionState {
  /** Epoch ms when the writer first opened the editor this session. */
  startedAt: number
  /** True once the editor has been opened in this session (the clock is running). */
  writingStarted: boolean
  suggestions: Suggestion[]
  /** Suggestion id currently highlighted in the document, if any. */
  activeSuggestionId: string | null
  suggestionsAccepted: number
  usage: AIUsage
  /** True while an AI request is in flight. */
  generating: boolean
  /** Last AI error message to surface to the writer, cleared on next success. */
  aiError: string | null
  contextFiles: ContextFile[]

  addSuggestions: (items: Suggestion[]) => void
  setSuggestionStatus: (id: string, status: SuggestionStatus) => void
  setActiveSuggestion: (id: string | null) => void
  addUsage: (u: AIUsage) => void
  setGenerating: (v: boolean) => void
  setAiError: (msg: string | null) => void
  setContextFiles: (files: ContextFile[]) => void
  /** Starts the session clock the first time the editor opens; later calls do nothing. */
  startWritingSession: () => void
  /** Explicitly starts over: clears suggestions and zeroes the totals. */
  resetSession: () => void
}

const emptyUsage: AIUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      startedAt: Date.now(),
      writingStarted: false,
      suggestions: [],
      activeSuggestionId: null,
      suggestionsAccepted: 0,
      usage: emptyUsage,
      generating: false,
      aiError: null,
      contextFiles: [],

      addSuggestions: (items) => set((s) => ({ suggestions: [...s.suggestions, ...items] })),
      setSuggestionStatus: (id, status) =>
        set((s) => {
          const prev = s.suggestions.find((x) => x.id === id)
          if (!prev || prev.status === status) return s
          return {
            suggestions: s.suggestions.map((x) => (x.id === id ? { ...x, status } : x)),
            suggestionsAccepted: s.suggestionsAccepted + (status === 'accepted' ? 1 : 0),
            activeSuggestionId: s.activeSuggestionId === id && status !== 'open' ? null : s.activeSuggestionId,
          }
        }),
      setActiveSuggestion: (id) => set({ activeSuggestionId: id }),
      addUsage: (u) =>
        set((s) => {
          const webSearches = (s.usage.webSearches ?? 0) + (u.webSearches ?? 0)
          return {
            usage: {
              inputTokens: s.usage.inputTokens + u.inputTokens,
              outputTokens: s.usage.outputTokens + u.outputTokens,
              costUsd: s.usage.costUsd + u.costUsd,
              // Only present once a search has been billed, so the totals stay tidy.
              ...(webSearches > 0 ? { webSearches } : {}),
            },
          }
        }),
      setGenerating: (v) => set({ generating: v }),
      setAiError: (msg) => set({ aiError: msg }),
      setContextFiles: (files) => set({ contextFiles: files }),
      startWritingSession: () => {
        if (get().writingStarted) return
        set({ startedAt: Date.now(), writingStarted: true })
      },
      resetSession: () =>
        set({
          startedAt: Date.now(),
          writingStarted: false,
          suggestions: [],
          activeSuggestionId: null,
          suggestionsAccepted: 0,
          usage: emptyUsage,
          generating: false,
          aiError: null,
        }),
    }),
    {
      name: 'thunder-writer:session',
      version: 1,
      // sessionStorage: survives reloads of this tab, gone when the tab closes.
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({
        startedAt: s.startedAt,
        writingStarted: s.writingStarted,
        suggestionsAccepted: s.suggestionsAccepted,
        usage: s.usage,
      }),
    },
  ),
)

export const openSuggestions = (s: Pick<SessionState, 'suggestions'>) =>
  s.suggestions.filter((x) => x.status === 'open')
