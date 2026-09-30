import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSession } from '../../store/session'
import { SuggestionCard } from './SuggestionCard'
import { fakeBridge, resetStores, suggestion } from './testUtils'
import { useSuggestionActions } from './useSuggestionActions'
import type { EditorBridge } from '../../contracts'
import type { Suggestion } from '../../types'

function Harness({ bridge, s }: { bridge: EditorBridge; s: Suggestion }) {
  const actions = useSuggestionActions(bridge)
  const active = useSession((st) => st.activeSuggestionId === s.id)
  const current = useSession((st) => st.suggestions.find((x) => x.id === s.id)) ?? s
  return (
    <ul>
      <SuggestionCard suggestion={current} active={active} actions={actions} />
    </ul>
  )
}

function mount(s = suggestion(), doc = 'It was a dark and stormy nite.') {
  const fb = fakeBridge(doc)
  useSession.getState().addSuggestions([s])
  render(<Harness bridge={fb.bridge} s={s} />)
  return fb
}

beforeEach(() => resetStores())

describe('SuggestionCard', () => {
  it('Accept replaces the quote via the bridge and counts as accepted', async () => {
    const fb = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(fb.bridge.replaceQuote).toHaveBeenCalledWith('stormy nite', 'stormy night')
    expect(fb.getText()).toBe('It was a dark and stormy night.')
    const st = useSession.getState()
    expect(st.suggestionsAccepted).toBe(1)
    expect(st.suggestions[0].status).toBe('accepted')
  })

  it('Accept without a replacement just marks it accepted', async () => {
    const fb = mount(suggestion({ kind: 'general', replacement: undefined }))
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(fb.bridge.replaceQuote).not.toHaveBeenCalled()
    expect(useSession.getState().suggestionsAccepted).toBe(1)
  })

  it('Accept on a vanished passage explains and stays open', async () => {
    mount(suggestion(), 'The writer rewrote everything.')
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(screen.getByRole('status')).toHaveTextContent(/has changed/)
    expect(useSession.getState().suggestions[0].status).toBe('open')
    expect(useSession.getState().suggestionsAccepted).toBe(0)
  })

  it('clicking the headline highlights the passage and toggles off', async () => {
    const fb = mount()
    const head = screen.getByRole('button', { name: /Spelling/ })
    await userEvent.click(head)
    expect(fb.bridge.highlightQuote).toHaveBeenCalledWith('stormy nite')
    expect(useSession.getState().activeSuggestionId).toBe('s1')
    expect(head).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(head)
    expect(fb.bridge.clearHighlight).toHaveBeenCalled()
    expect(useSession.getState().activeSuggestionId).toBeNull()
  })

  it('hover expands to show the before/after diff', () => {
    mount()
    expect(screen.queryByLabelText('Proposed change')).toBeNull()
    fireEvent.mouseEnter(screen.getByRole('listitem'))
    const diff = screen.getByLabelText('Proposed change')
    expect(diff.querySelector('del')).toHaveTextContent('nite')
    expect(diff.querySelector('ins')).toHaveTextContent('night')
    fireEvent.mouseLeave(screen.getByRole('listitem'))
    expect(screen.queryByLabelText('Proposed change')).toBeNull()
  })

  it('keyboard focus expands the card too', async () => {
    mount()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: /Spelling/ })).toHaveFocus()
    expect(screen.getByLabelText('Proposed change')).toBeInTheDocument()
  })

  it.each([
    ['Decline', 'declined'],
    ['Mark Done', 'done'],
    ['Hide', 'hidden'],
  ] as const)('%s sets status %s and clears an active highlight', async (label, status) => {
    const fb = mount()
    await userEvent.click(screen.getByRole('button', { name: /Spelling/ }))
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(useSession.getState().suggestions[0].status).toBe(status)
    expect(useSession.getState().suggestionsAccepted).toBe(0)
    expect(fb.bridge.clearHighlight).toHaveBeenCalled()
  })

  it('renders AI text as plain text, never HTML', () => {
    mount(suggestion({ title: '<img src=x onerror=alert(1)>', detail: '<b>bold</b>' }))
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument()
  })
})

describe('useSuggestionActions', () => {
  it('is safe without a bridge for passage-free suggestions', () => {
    const s = suggestion({ quote: undefined, replacement: undefined })
    useSession.getState().addSuggestions([s])
    const { result } = renderHook(() => useSuggestionActions(null))
    expect(result.current.accept(s)).toEqual({ ok: true })
    expect(useSession.getState().suggestionsAccepted).toBe(1)
  })

  it('shows web-search sources as safe external links with plain-text titles', () => {
    mount(
      suggestion({
        kind: 'trivia',
        title: 'Harbour bells recovered',
        quote: undefined,
        replacement: undefined,
        sources: [
          { url: 'https://news.example/bells', title: '<img src=x onerror=alert(1)>Bells found' },
          { url: 'javascript:alert(1)', title: 'Evil' },
          { url: 'data:text/html,<b>x</b>', title: 'Also evil' },
        ],
      }),
    )
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    const a = links[0]
    expect(a).toHaveAttribute('href', 'https://news.example/bells')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
    // Rendered as text, never as markup; the real domain leads, and the new tab is announced.
    expect(a.textContent).toBe('news.example — <img src=x onerror=alert(1)>Bells found (opens in a new tab)')
    expect(a.querySelector('img')).toBeNull()
    expect(a.querySelector('.sg-source-host')?.textContent).toBe('news.example')
    expect(a.querySelector('.sg-visually-hidden')?.textContent).toBe('(opens in a new tab)')
    expect(screen.getByText('Source:')).toBeInTheDocument()
  })

  it('always shows the source domain, so a misleading page title cannot hide where a link goes', () => {
    mount(
      suggestion({
        kind: 'trivia',
        title: 'Harbour bells recovered',
        quote: undefined,
        replacement: undefined,
        sources: [
          { url: 'https://www.phish.example/login', title: 'Anthropic Console: re-verify your API key' },
          { url: 'https://www.plain.example/x', title: '' },
        ],
      }),
    )
    const [phish, plain] = screen.getAllByRole('link')
    expect(phish).toHaveAccessibleName('phish.example — Anthropic Console: re-verify your API key (opens in a new tab)')
    // Title fell back to the host name: shown once, not twice.
    expect(plain.textContent).toBe('plain.example (opens in a new tab)')
  })

  it('shows no sources section for ordinary suggestions', () => {
    mount()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(/Sources?:/)).toBeNull()
  })
})
