import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import type { EditorBridge } from '../../contracts'
import { EditorContext } from '../../shell/EditorContext'
import { useSession } from '../../store/session'
import { useSettings } from '../../store/settings'
import type { Suggestion } from '../../types'
import { resetTriviaMemory } from './triviaMemory'

/** In-memory EditorBridge over a plain string, for tests. */
export function fakeBridge(initial: string) {
  let text = initial
  const bridge = {
    getPlainText: vi.fn(() => text),
    getTextNearCursor: vi.fn((n: number) => text.slice(-n)),
    hasQuote: vi.fn((q: string) => text.includes(q)),
    highlightQuote: vi.fn((q: string) => text.includes(q)),
    clearHighlight: vi.fn(),
    replaceQuote: vi.fn((q: string, r: string) => {
      if (!text.includes(q)) return false
      text = text.replace(q, r)
      return true
    }),
  } satisfies EditorBridge
  return { bridge, getText: () => text, setText: (t: string) => (text = t) }
}

export function Wrapper({ bridge, children }: { bridge: EditorBridge | null; children: ReactNode }) {
  return (
    <MemoryRouter>
      <EditorContext.Provider value={{ editor: null, bridge }}>{children}</EditorContext.Provider>
    </MemoryRouter>
  )
}

export function suggestion(p: Partial<Suggestion> = {}): Suggestion {
  return {
    id: 's1',
    kind: 'spelling',
    title: 'Spelling: “nite”',
    detail: 'Did you mean “night”? “Nite” is informal.',
    quote: 'stormy nite',
    replacement: 'stormy night',
    status: 'open',
    createdAt: 0,
    provider: 'claude',
    model: 'claude-haiku-4-5',
    ...p,
  }
}

export function resetStores(settings: Partial<ReturnType<typeof useSettings.getState>> = {}) {
  useSession.getState().resetSession()
  resetTriviaMemory()
  useSession.setState({ contextFiles: [] })
  useSettings.setState({
    provider: 'claude',
    claudeApiKey: 'sk-test',
    openaiApiKey: '',
    suggestionsEnabled: true,
    suggestionsCollapsed: false,
    maxOpenSuggestions: 2,
    suggestionCooldownSec: 45,
    suggestionIdleSec: 4,
    triviaWebSearch: true,
    triviaCooldownSec: 600,
    ...settings,
  })
}
