import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../../store/session'
import { useSettings } from '../../store/settings'
import { SuggestionsPane } from './SuggestionsPane'
import { fakeBridge, resetStores, suggestion, Wrapper } from './testUtils'

const idb = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  createStore: vi.fn(() => ({})),
  get: vi.fn(async (k: string) => idb.get(k)),
  set: vi.fn(async (k: string, v: unknown) => void idb.set(k, v)),
}))

const generateSuggestions = vi.fn()
vi.mock('./providers/claude', () => ({
  claudeProvider: { id: 'claude', generateSuggestions: (...a: unknown[]) => generateSuggestions(...a) },
}))

const DOC = 'It was a dark and stormy nite. The captain looked away.'

function renderPane(doc = DOC) {
  const fb = fakeBridge(doc)
  render(
    <Wrapper bridge={fb.bridge}>
      <SuggestionsPane />
    </Wrapper>,
  )
  return fb
}

beforeEach(() => {
  idb.clear()
  generateSuggestions.mockReset()
  resetStores()
})

describe('SuggestionsPane', () => {
  it('without an API key links the writer to Settings', () => {
    useSettings.setState({ claudeApiKey: '' })
    renderPane()
    const link = screen.getByRole('link', { name: 'Add your Claude or OpenAI key' })
    expect(link).toHaveAttribute('href', '/settings#ai')
    expect(screen.getByRole('button', { name: /Generate Suggestions/ })).toBeDisabled()
  })

  it('lists open suggestions only and keeps resolved ones in History', () => {
    useSession.getState().addSuggestions([
      suggestion({ id: 'a', title: 'Open one' }),
      suggestion({ id: 'b', title: 'Old one', status: 'declined' }),
      suggestion({ id: 'c', title: 'Hidden one', status: 'hidden' }),
    ])
    renderPane()
    const list = screen.getByRole('list', { name: 'Open suggestions' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('Open one')).toBeInTheDocument()
    expect(screen.getByText('History (1)')).toBeInTheDocument()
    expect(screen.queryByText('Hidden one')).toBeNull()
  })

  it('Hide Suggestions collapses to a rail with a count badge, and back', async () => {
    useSession.getState().addSuggestions([suggestion({ id: 'a' }), suggestion({ id: 'b', title: 'Two', quote: 'captain' })])
    renderPane()
    await userEvent.click(screen.getByRole('button', { name: /Hide Suggestions/ }))
    expect(useSettings.getState().suggestionsCollapsed).toBe(true)
    const show = screen.getByRole('button', { name: 'Show suggestions (2 open)' })
    expect(show).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(show)
    expect(screen.getByRole('heading', { name: 'Suggestions' })).toBeInTheDocument()
  })

  it('Generate Suggestions asks the provider and shows the result', async () => {
    generateSuggestions.mockResolvedValue({
      items: [{ kind: 'spelling', title: 'nite → night', detail: 'Typo.', quote: 'stormy nite', replacement: 'stormy night' }],
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.0001 },
      costKnown: true,
    })
    renderPane()
    await userEvent.click(screen.getByRole('button', { name: /Generate Suggestions/ }))
    expect(await screen.findByText('nite → night')).toBeInTheDocument()
    expect(generateSuggestions).toHaveBeenCalledTimes(1)
    expect(useSession.getState().usage.inputTokens).toBe(10)
  })

  it('explains when the pane is full instead of asking for more', () => {
    useSession.getState().addSuggestions([suggestion({ id: 'a' }), suggestion({ id: 'b', title: 'Two', quote: 'captain' })])
    renderPane()
    expect(screen.getByRole('button', { name: /Generate Suggestions/ })).toBeDisabled()
    expect(screen.getByText('Resolve an open suggestion to get another.')).toBeInTheDocument()
  })

  it('shows AI errors in an alert that can be dismissed', async () => {
    useSession.getState().setAiError('Claude is rate-limiting requests right now.')
    renderPane()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('rate-limiting')
    await userEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('loads persisted context files on mount and can add and remove one', async () => {
    idb.set('thunder-writer:context-files', [{ id: 'x', name: 'poem.txt', text: 'Roses.', addedAt: 1 }])
    renderPane()
    await waitFor(() => expect(useSession.getState().contextFiles).toHaveLength(1))
    await userEvent.click(screen.getByText(/Context files/))
    expect(screen.getByText('poem.txt')).toBeInTheDocument()

    const input = screen.getByTestId('sg-context-input') as HTMLInputElement
    await userEvent.upload(input, new File(['Chapter one of my last book.'], 'book1.md', { type: 'text/markdown' }))
    await waitFor(() => expect(useSession.getState().contextFiles).toHaveLength(2))
    expect(idb.get('thunder-writer:context-files')).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'Remove context file poem.txt' }))
    await waitFor(() => expect(useSession.getState().contextFiles.map((f) => f.name)).toEqual(['book1.md']))
  })

  it('rejects unsupported context files with a message', async () => {
    renderPane()
    await userEvent.click(screen.getByText(/Context files/))
    const input = screen.getByTestId('sg-context-input') as HTMLInputElement
    await userEvent.upload(input, new File(['x'], 'novel.docx'), { applyAccept: false })
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't a supported format/)
  })
})
