import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    // This build has Google Drive (the deployment's own Cloud project).
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '698829428298-abc.apps.googleusercontent.com')
    vi.stubEnv('VITE_GOOGLE_API_KEY', 'AIza-build')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('renders every section with navigation home and back to writing', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    for (const name of ['AI provider', 'Claude', 'OpenAI', 'OpenRouter', 'Suggestions', 'Google Drive', 'Appearance', 'Data in this browser'])
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
    await user.click(screen.getByRole('radio', { name: /OpenAI \(ChatGPT\)/ }))
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

  it('asks for no Google Cloud values: the Drive section is only about saving manuscripts', () => {
    renderPage()
    const drive = screen.getByRole('region', { name: 'Google Drive' })
    expect(drive).toHaveTextContent(/“Thunder Writer” folder in your own Drive/)
    fireEvent.change(within(drive).getByLabelText('Autosave to Drive at most every'), { target: { value: '120' } })
    expect(useSettings.getState().driveAutosaveSec).toBe(120)
    // Only the manuscript: no preference sync through Drive either.
    expect(within(drive).queryByRole('button')).not.toBeInTheDocument()
    // No client id, API key or project number fields, and no Cloud Console instructions, anywhere.
    const page = document.body.textContent ?? ''
    expect(page).not.toMatch(/client id|google api key|project number|cloud console|googleusercontent|AIza/i)
    expect(screen.queryByLabelText(/OAuth client ID|Google API key|project number/i)).not.toBeInTheDocument()
  })

  it('leaves the Google Drive section out of a build without Drive', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    renderPage()
    expect(screen.queryByRole('region', { name: 'Google Drive' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/google drive/i)
  })

    it('restores the default model if the field is left empty', () => {
    renderPage()
    const model = screen.getAllByLabelText('Model')[0]
    fireEvent.change(model, { target: { value: '' } })
    fireEvent.blur(model)
    expect(useSettings.getState().claudeModel).toBe(DEFAULT_CLAUDE_MODEL)
  })
})

describe('SettingsPage: OpenRouter', () => {
  const catalog = {
    data: [
      { id: 'anthropic/claude-haiku-5.5', name: 'Anthropic: Claude Haiku 5.5', pricing: { prompt: '0.0000001', completion: '0.0000005' }, supported_parameters: ['structured_outputs'] },
      { id: 'google/gemini-3.8-flash', name: 'Google: Gemini 3.8 Flash', pricing: { prompt: '0.00000075', completion: '0.00000375' } },
    ],
  }
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(async () => {
    useSettings.setState(useSettings.getInitialState())
    ;(await import('../suggestions/providers/openrouterModels')).resetOpenRouterModels()
    fetchMock = vi.fn(async () => new Response(JSON.stringify(catalog)))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('is a provider choice with its own key and a searchable model list with prices', async () => {
    const user = userEvent.setup()
    renderPage()
    // Nothing is fetched from openrouter.ai until OpenRouter is in use.
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('radio', { name: /OpenRouter \(any model\)/ }))
    expect(useSettings.getState().provider).toBe('openrouter')

    const section = screen.getByRole('region', { name: 'OpenRouter' })
    expect(within(section).getByText('Active provider')).toBeInTheDocument()
    const key = within(section).getByLabelText('OpenRouter API key')
    expect(key).toHaveAttribute('type', 'password')
    await user.type(key, 'sk-or-v1-abc')
    expect(useSettings.getState().openrouterApiKey).toBe('sk-or-v1-abc')

    expect(await within(section).findByText(/Anthropic: Claude Haiku 5\.5: \$0\.10 in \/ \$0\.50 out per million tokens/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models', expect.anything())
    const model = within(section).getByLabelText('Model')
    const options = [...document.querySelectorAll(`#${model.getAttribute('list')} option`)].map((o) => o.getAttribute('value'))
    expect(options).toEqual(['anthropic/claude-haiku-5.5', 'google/gemini-3.8-flash'])

    fireEvent.change(model, { target: { value: 'google/gemini-3.8-flash' } })
    expect(useSettings.getState().openrouterModel).toBe('google/gemini-3.8-flash')
    expect(within(section).getByText(/Gemini 3\.8 Flash: \$0\.75 in \/ \$3\.75 out/)).toBeInTheDocument()
    fireEvent.change(model, { target: { value: 'nobody/nothing' } })
    expect(within(section).getByText(/Not in OpenRouter’s catalog/)).toBeInTheDocument()
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
