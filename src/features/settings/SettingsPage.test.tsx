import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CLAUDE_MODEL, useSettings } from '../../store/settings'
import { parseNumberField } from './fields'
import { SettingsPage } from './SettingsPage'

vi.mock('./keyTest', () => ({
  testApiKey: vi.fn(async () => ({ ok: false, message: 'Claude rejected this key.' })),
}))

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsPage />
    </MemoryRouter>,
  )

describe('SettingsPage', () => {
  beforeEach(() => {
    useSettings.setState(useSettings.getInitialState())
  })

  it('renders every section with navigation home and back to writing', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    for (const name of ['AI provider', 'Claude', 'OpenAI', 'Suggestions', 'Google Drive', 'Appearance', 'Data in this browser'])
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Thunder Writer home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /back to writing/i })).toHaveAttribute('href', '/write')
    expect(screen.getByLabelText('Model', { selector: '#' + screen.getAllByLabelText('Model')[0].id })).toHaveValue(
      DEFAULT_CLAUDE_MODEL,
    )
    expect(document.body.textContent).not.toMatch(/log ?in|sign ?up/i)
  })

  it('switches provider and theme immediately', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('radio', { name: /openai/i }))
    expect(useSettings.getState().provider).toBe('openai')
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(useSettings.getState().theme).toBe('dark')
    expect(await screen.findByText('✓ Saved')).toBeInTheDocument()
  })

  it('stores API keys as password fields with show/hide', async () => {
    const user = userEvent.setup()
    renderPage()
    const key = screen.getByLabelText('Claude API key')
    expect(key).toHaveAttribute('type', 'password')
    await user.type(key, ' sk-ant-123 ')
    expect(useSettings.getState().claudeApiKey).toBe('sk-ant-123')
    await user.click(screen.getByRole('button', { name: 'Show Claude API key' }))
    expect(key).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide Claude API key' }))
    expect(key).toHaveAttribute('type', 'password')
  })

  it('tests a key and shows the result', async () => {
    const user = userEvent.setup()
    useSettings.setState({ claudeApiKey: 'sk-ant-bad' })
    renderPage()
    const buttons = screen.getAllByRole('button', { name: 'Test key' })
    expect(buttons[1]).toBeDisabled() // no OpenAI key yet
    await user.click(buttons[0])
    expect(await screen.findByText(/rejected this key/)).toBeInTheDocument()
  })

  it('clamps number fields and saves suggestion cadence', () => {
    renderPage()
    const maxOpen = screen.getByLabelText('Open suggestions at once')
    fireEvent.change(maxOpen, { target: { value: '9' } })
    fireEvent.blur(maxOpen)
    expect(useSettings.getState().maxOpenSuggestions).toBe(5)
    const cooldown = screen.getByLabelText('Cooldown between requests')
    fireEvent.change(cooldown, { target: { value: '90' } })
    expect(useSettings.getState().suggestionCooldownSec).toBe(90)
    fireEvent.click(screen.getByRole('switch', { name: 'Suggest while I write' }))
    expect(useSettings.getState().suggestionsEnabled).toBe(false)
  })

  it('saves the Google client id and autosave interval', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('OAuth client ID'), { target: { value: ' id.apps.googleusercontent.com ' } })
    expect(useSettings.getState().googleClientId).toBe('id.apps.googleusercontent.com')
    fireEvent.change(screen.getByLabelText('Autosave to Drive at most every'), { target: { value: '120' } })
    expect(useSettings.getState().driveAutosaveSec).toBe(120)
    expect(screen.getByText('http://localhost:5173')).toBeInTheDocument()
  })

  it('restores the default model if the field is left empty', () => {
    renderPage()
    const model = screen.getAllByLabelText('Model')[0]
    fireEvent.change(model, { target: { value: '' } })
    fireEvent.blur(model)
    expect(useSettings.getState().claudeModel).toBe(DEFAULT_CLAUDE_MODEL)
  })
})

describe('parseNumberField', () => {
  it('parses, clamps and rounds', () => {
    expect(parseNumberField('', 0, 10)).toBeNull()
    expect(parseNumberField('abc', 0, 10)).toBeNull()
    expect(parseNumberField('-3', 0, 10)).toBe(0)
    expect(parseNumberField('30', 0, 10)).toBe(10)
    expect(parseNumberField('2.6', 1, 5, true)).toBe(3)
  })

  it('web-searched trivia is on by default, explains cost and privacy, and has a bounded cooldown', async () => {
    const user = userEvent.setup()
    renderPage()
    const toggle = screen.getByRole('switch', { name: 'Current-events trivia (web search)' })
    expect(toggle).toBeChecked()
    expect(toggle).toHaveAccessibleDescription(/\$0\.01 per search on Claude/)
    expect(toggle).toHaveAccessibleDescription(/search queries derived from your manuscript/)
    const cooldown = screen.getByLabelText('Web-searched trivia at most every')
    expect(cooldown).toHaveValue(600)
    fireEvent.change(cooldown, { target: { value: '5' } })
    fireEvent.blur(cooldown)
    expect(useSettings.getState().triviaCooldownSec).toBe(120)
    await user.click(toggle)
    expect(useSettings.getState().triviaWebSearch).toBe(false)
    expect(screen.queryByLabelText('Web-searched trivia at most every')).toBeNull()
  })
})
