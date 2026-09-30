import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocuments } from '../../store/documents'
import { useSettings } from '../../store/settings'
import { FileMenu } from './FileMenu'
import { makeDoc } from './testDocs'

// Owned by features/import; FileMenu only reaches it through the Drive import flow.
vi.mock('../import/importManuscript', () => ({
  importManuscript: vi.fn(async () => {
    throw new Error('not used here')
  }),
  IMPORT_ACCEPT: ['.docx', '.txt', '.md', '.html'],
  IMPORT_MIME_TYPES: ['text/plain'],
}))

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search + l.hash}</div>
}

const renderAt = (url = '/write') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <FileMenu />
      <Where />
    </MemoryRouter>,
  )

describe('FileMenu', () => {
  beforeEach(() => {
    // A developer's .env.local may set a client id; these tests control it explicitly.
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    vi.stubEnv('VITE_GOOGLE_API_KEY', '')
    useSettings.setState({ googleClientId: '', googleApiKey: '', googleProjectNumber: '' })
    const doc = makeDoc({ id: 'a', title: 'Alpha', updatedAt: 10 })
    useDocuments.setState({
      docs: { a: doc, b: makeDoc({ id: 'b', title: 'Beta', updatedAt: 5 }) },
      currentId: 'a',
      hydrated: true,
      dirtyForDrive: {},
    })
  })

  it('shows the local save status', () => {
    renderAt()
    expect(screen.getByRole('status')).toHaveTextContent('Saved locally')
  })

  it('hosts Save to computer: slots beside the button and status, and a menu item that returns focus to File', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <MemoryRouter initialEntries={['/write']}>
        <FileMenu afterMenu={<button type="button">Save to computer</button>} afterStatus={<span>copy badge</span>} onSaveToComputer={onSave} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'Save to computer' })).toBeInTheDocument()
    expect(screen.getByText('copy badge')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^file/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Save to computer…' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /^file/i })).toHaveFocus()
  })

  it('has no Save to computer item unless the page provides it', async () => {
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: /file/i }))
    expect(screen.queryByRole('menuitem', { name: 'Save to computer…' })).not.toBeInTheDocument()
  })

  it('creates a new manuscript from the menu', async () => {
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: /file/i }))
    const menu = screen.getByRole('menu', { name: 'File' })
    expect(within(menu).getByRole('menuitem', { name: 'New manuscript' })).toHaveFocus()
    await user.click(within(menu).getByRole('menuitem', { name: 'New manuscript' }))
    await vi.waitFor(() => expect(Object.keys(useDocuments.getState().docs)).toHaveLength(3))
    expect(useDocuments.getState().docs[useDocuments.getState().currentId!].title).toBe('Untitled Manuscript')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('offers "Import manuscript…" for local Word, text and Markdown files, opening a file chooser', async () => {
    const user = userEvent.setup()
    const clicked: HTMLInputElement[] = []
    const spy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      clicked.push(this)
    })
    renderAt()
    await user.click(screen.getByRole('button', { name: /file/i }))
    const menu = screen.getByRole('menu', { name: 'File' })
    await user.click(within(menu).getByRole('menuitem', { name: /import manuscript/i }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(clicked).toHaveLength(1)
    expect(clicked[0].type).toBe('file')
    expect(clicked[0].accept).toContain('.docx')
    spy.mockRestore()
    clicked[0].remove()
  })

  it('supports keyboard navigation and Escape', async () => {
    const user = userEvent.setup()
    renderAt()
    const trigger = screen.getByRole('button', { name: /file/i })
    await user.click(trigger)
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Open manuscript…' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('links Drive setup to Settings when no client id is configured', async () => {
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: /file/i }))
    const link = screen.getByRole('menuitem', { name: /set up in settings/i })
    expect(link).toHaveAttribute('href', '/settings#drive')
    expect(screen.queryByRole('menuitem', { name: 'Save to Drive' })).not.toBeInTheDocument()
  })

  it('shows Drive actions when a client id is configured', async () => {
    useSettings.setState({ googleClientId: 'abc.apps.googleusercontent.com' })
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: /file/i }))
    for (const name of ['Connect Google Drive', 'Save to Drive', 'Open from Drive…', 'Load settings from Drive', 'Save settings to Drive'])
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument()
  })

  it('opens the Drive dialog from ?open=drive and clears the param', async () => {
    renderAt('/write?open=drive&x=1')
    const dialog = await screen.findByRole('dialog', { name: 'Open from Google Drive' })
    expect(within(dialog).getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings#drive')
    expect(screen.getByTestId('where')).toHaveTextContent('/write?x=1')
  })

  it('asks to connect before listing Drive files when configured', async () => {
    useSettings.setState({ googleClientId: 'abc.apps.googleusercontent.com' })
    renderAt('/write?open=drive')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Connect Google Drive' })).toBeInTheDocument()
  })

  it('lists local manuscripts, opens one and deletes with confirmation', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm')
    renderAt()
    await user.click(screen.getByRole('button', { name: /file/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Open manuscript…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Open manuscript' })
    const rows = within(dialog).getAllByRole('listitem')
    expect(rows.map((r) => within(r).getAllByRole('button')[0].textContent)).toEqual([
      expect.stringContaining('Alpha'),
      expect.stringContaining('Beta'),
    ])

    confirm.mockReturnValueOnce(false)
    await user.click(within(dialog).getByRole('button', { name: /delete alpha/i }))
    expect(useDocuments.getState().docs.a).toBeDefined()

    confirm.mockReturnValueOnce(true)
    await user.click(within(dialog).getByRole('button', { name: /delete alpha/i }))
    expect(useDocuments.getState().docs.a).toBeUndefined()
    expect(useDocuments.getState().currentId).toBe('b')

    await user.click(within(dialog).getByRole("button", { name: /^Beta/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    confirm.mockRestore()
  })

  it('offers "Import from Google Drive…" separately from "Open from Drive…" when the Picker is set up', async () => {
    useSettings.setState({ googleClientId: '698829428298-abc.apps.googleusercontent.com', googleApiKey: 'AIza-test' })
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: /file/i }))
    const menu = screen.getByRole('menu', { name: 'File' })
    expect(within(menu).getByRole('menuitem', { name: 'Open from Drive…' })).toBeInTheDocument()
    const item = within(menu).getByRole('menuitem', { name: 'Import from Google Drive…' })
    expect(item.tagName).toBe('BUTTON')
    expect(within(menu).queryByText(/needs a Google API key/)).not.toBeInTheDocument()
  })

  it('explains the missing Google API key and links the import item to Settings', async () => {
    useSettings.setState({ googleClientId: '698829428298-abc.apps.googleusercontent.com', googleApiKey: '' })
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: /file/i }))
    const item = screen.getByRole('menuitem', { name: 'Import from Google Drive…' })
    expect(item).toHaveAttribute('href', '/settings#drive')
    expect(item).toHaveAccessibleDescription(/needs a Google API key/)
    expect(screen.getByText(/Importing Google Docs and Word files needs a Google API key/)).toBeInTheDocument()
  })

  it('opens the import prompt from ?open=picker without opening the Picker, and clears the param', async () => {
    useSettings.setState({ googleClientId: '698829428298-abc.apps.googleusercontent.com', googleApiKey: 'AIza-test' })
    renderAt('/write?open=picker')
    const dialog = await screen.findByRole('dialog', { name: 'Import from Google Drive' })
    expect(within(dialog).getByRole('button', { name: 'Choose a file from Google Drive…' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/write$/)
  })

  it('?open=picker without a Google API key points to Settings', async () => {
    useSettings.setState({ googleClientId: '698829428298-abc.apps.googleusercontent.com' })
    renderAt('/write?open=picker')
    const dialog = await screen.findByRole('dialog', { name: 'Import from Google Drive' })
    expect(within(dialog).getByText(/needs a Google API key/)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings#drive')
  })

  it('shows the Drive import action in the Open from Drive dialog', async () => {
    useSettings.setState({ googleClientId: '698829428298-abc.apps.googleusercontent.com' })
    renderAt('/write?open=drive')
    const dialog = await screen.findByRole('dialog', { name: 'Open from Google Drive' })
    // No API key yet: the action leads to Settings.
    expect(within(dialog).getByRole('link', { name: /Import from Google Drive…/ })).toHaveAttribute('href', '/settings#drive')
  })

  it('imports a backup without its Drive link, so it can never autosave over the Drive file', async () => {
    const user = userEvent.setup()
    renderAt()
    const envelope = {
      app: 'thunder-writer',
      version: 1,
      savedAt: 1,
      doc: { ...makeDoc({ id: 'imp', title: 'Old backup' }), driveFileId: 'SOMEONES-FILE', driveSyncedAt: 1 },
    }
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await user.upload(input, new File([JSON.stringify(envelope)], 'b.thunder.json', { type: 'application/json' }))
    await vi.waitFor(() => expect(useDocuments.getState().currentId).toBe('imp'))
    const d = useDocuments.getState().docs.imp
    expect(d.title).toBe('Old backup')
    expect(d.driveFileId).toBeUndefined()
    expect(d.driveSyncedAt).toBeUndefined()
  })
})
