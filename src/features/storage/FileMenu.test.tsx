import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocuments } from '../../store/documents'
import { FileMenu } from './FileMenu'
import { makeDoc } from './testDocs'

// Owned by features/import; FileMenu only reaches it through the Drive import flow.
const kept = vi.hoisted(() => [] as { id: string; reason: string }[])
/** Whether the mocked safety backup succeeds. */
const backup = vi.hoisted(() => ({ ok: true }))
vi.mock('../backups/backups', () => ({
  safetyBackup: vi.fn(async (doc: { id: string } | undefined, reason: string) => {
    if (doc && backup.ok) kept.push({ id: doc.id, reason })
    return backup.ok
  }),
  useBackups: { getState: () => ({ error: null }) },
}))

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

/** Drive comes from the build (VITE_GOOGLE_*), never from anything the writer enters. */
const CLIENT_ID = '698829428298-abc.apps.googleusercontent.com'
const withDrive = ({ picker = false } = {}) => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
  vi.stubEnv('VITE_GOOGLE_API_KEY', picker ? 'AIza-test' : '')
}

/** Nothing about Google Cloud setup may reach the writer. */
const SETUP_WORDING = /client id|api key|project number|set up in settings|open settings|\(set up\)/i

/** File › Open from computer…, in a browser without the native file picker (jsdom): the chooser it opens. */
async function openFromComputerInput(user: ReturnType<typeof userEvent.setup>) {
  const clicked: HTMLInputElement[] = []
  const spy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    clicked.push(this)
  })
  await user.click(screen.getByRole('button', { name: /^file/i }))
  await user.click(within(screen.getByRole('menu', { name: 'File' })).getByRole('menuitem', { name: 'Open from computer…' }))
  spy.mockRestore()
  expect(clicked).toHaveLength(1)
  return clicked[0]
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
    // A developer's .env.local may set these; each test decides whether this build has Drive.
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    vi.stubEnv('VITE_GOOGLE_API_KEY', '')
    vi.stubEnv('VITE_GOOGLE_PROJECT_NUMBER', '')
    kept.length = 0
    backup.ok = true
    const doc = makeDoc({ id: 'a', title: 'Alpha', updatedAt: 10 })
    useDocuments.setState({
      docs: { a: doc, b: makeDoc({ id: 'b', title: 'Beta', updatedAt: 5 }) },
      currentId: 'a',
      hydrated: true,
      dirtyForDrive: {},
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('shows the local save status', () => {
    renderAt()
    expect(screen.getByRole('status')).toHaveTextContent('Saved locally')
  })

  it('puts the save status (and what follows it) in the slot beside the title, like Google Docs', () => {
    const slot = document.createElement('div')
    document.body.appendChild(slot)
    const { unmount } = render(
      <MemoryRouter initialEntries={['/write']}>
        <div data-testid="menus">
          <FileMenu afterStatus={<span>copy badge</span>} statusContainer={slot} />
        </div>
      </MemoryRouter>,
    )
    expect(within(slot).getByRole('status')).toHaveTextContent('Saved locally')
    expect(within(slot).getByText('copy badge')).toBeInTheDocument()
    expect(within(screen.getByTestId('menus')).queryByRole('status')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('menus')).getByRole('button', { name: /^file/i })).toBeInTheDocument()
    unmount()
    slot.remove()
  })

  it('shows no status while the slot beside the title isn’t mounted yet', () => {
    render(
      <MemoryRouter initialEntries={['/write']}>
        <FileMenu statusContainer={null} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('hosts Export to computer: slots beside the button and status, and a menu item that returns focus to File', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <MemoryRouter initialEntries={['/write']}>
        <FileMenu afterMenu={<button type="button">Export to computer</button>} afterStatus={<span>copy badge</span>} onSaveToComputer={onSave} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'Export to computer' })).toBeInTheDocument()
    expect(screen.getByText('copy badge')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^file/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Export to computer…' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /^file/i })).toHaveFocus()
  })

  it('has no Export to computer item unless the page provides it', async () => {
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: /file/i }))
    expect(screen.queryByRole('menuitem', { name: 'Export to computer…' })).not.toBeInTheDocument()
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

  it('offers "Open from computer…" for Word, text, Markdown and Thunder Writer files, in place of the two import items', async () => {
    const user = userEvent.setup()
    renderAt()
    const input = await openFromComputerInput(user)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(input.type).toBe('file')
    expect(input.accept.split(',')).toEqual(expect.arrayContaining(['.docx', '.md', '.txt', '.json', '.bak']))
    input.remove()
    await user.click(screen.getByRole('button', { name: /^file/i }))
    const menu = screen.getByRole('menu', { name: 'File' })
    expect(within(menu).queryByRole('menuitem', { name: /import manuscript|import \.thunder\.json/i })).not.toBeInTheDocument()
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

  it('reports only this browser’s save status in a build without Drive, even for a manuscript once saved to Drive', () => {
    useDocuments.setState((s) => ({ docs: { ...s.docs, a: { ...s.docs.a, driveFileId: 'F', driveSyncedAt: 1 } } }))
    renderAt()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/^Saved locally$/)
    expect(within(status).queryByRole('button')).not.toBeInTheDocument()
  })

  it('leaves Google Drive out entirely in a build without it, with no setup instructions', async () => {
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: /file/i }))
    const menu = screen.getByRole('menu', { name: 'File' })
    expect(within(menu).queryByText(/google drive/i)).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: /drive/i })).not.toBeInTheDocument()
    expect(menu.textContent).not.toMatch(SETUP_WORDING)
  })

  it('offers only manuscript actions for Google Drive', async () => {
    withDrive()
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: /file/i }))
    const menu = screen.getByRole('menu', { name: 'File' })
    for (const name of ['Connect Google Drive', 'Save to Drive', 'Open from Drive…'])
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: /settings/i })).not.toBeInTheDocument()
    expect(menu.textContent).not.toMatch(SETUP_WORDING)
  })

  it('opens the Drive dialog from ?open=drive and clears the param', async () => {
    withDrive()
    renderAt('/write?open=drive&x=1')
    await screen.findByRole('dialog', { name: 'Open from Google Drive' })
    expect(screen.getByTestId('where')).toHaveTextContent('/write?x=1')
  })

  it('a stale ?open=drive link in a build without Drive just says it isn’t available', async () => {
    renderAt('/write?open=drive')
    const dialog = await screen.findByRole('dialog', { name: 'Open from Google Drive' })
    expect(dialog).toHaveTextContent('Google Drive isn’t available in this copy of Thunder Writer.')
    expect(dialog.textContent).not.toMatch(SETUP_WORDING)
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument()
  })

  it('asks to connect before listing Drive files when configured', async () => {
    withDrive()
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
    await vi.waitFor(() => expect(useDocuments.getState().docs.a).toBeUndefined())
    expect(kept).toEqual([{ id: 'a', reason: 'before-delete' }]) // still in Backups › All backups
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('Backups › All backups'))
    expect(useDocuments.getState().currentId).toBe('b')

    await user.click(within(dialog).getByRole("button", { name: /^Beta/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    confirm.mockRestore()
  })

  it('offers "Import from Google Drive…" separately from "Open from Drive…" when the Picker is available', async () => {
    withDrive({ picker: true })
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: /file/i }))
    const menu = screen.getByRole('menu', { name: 'File' })
    expect(within(menu).getByRole('menuitem', { name: 'Open from Drive…' })).toBeInTheDocument()
    const item = within(menu).getByRole('menuitem', { name: 'Import from Google Drive…' })
    expect(item.tagName).toBe('BUTTON')
    expect(menu.textContent).not.toMatch(SETUP_WORDING)
  })

  it('leaves out "Import from Google Drive…" when this build has no Picker key', async () => {
    withDrive()
    const user = userEvent.setup()
    renderAt()
    await user.click(screen.getByRole('button', { name: /file/i }))
    const menu = screen.getByRole('menu', { name: 'File' })
    expect(within(menu).getByRole('menuitem', { name: 'Open from Drive…' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Import from Google Drive…' })).not.toBeInTheDocument()
    expect(menu.textContent).not.toMatch(SETUP_WORDING)
  })

  it('opens the import prompt from ?open=picker without opening the Picker, and clears the param', async () => {
    withDrive({ picker: true })
    renderAt('/write?open=picker')
    const dialog = await screen.findByRole('dialog', { name: 'Import from Google Drive' })
    expect(within(dialog).getByRole('button', { name: 'Choose a file from Google Drive…' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/write$/)
  })

  it('?open=picker in a build without the Picker says importing isn’t available, with no setup steps', async () => {
    withDrive()
    renderAt('/write?open=picker')
    const dialog = await screen.findByRole('dialog', { name: 'Import from Google Drive' })
    expect(dialog).toHaveTextContent('Importing from Google Drive isn’t available in this copy of Thunder Writer.')
    expect(dialog.textContent).not.toMatch(SETUP_WORDING)
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the Drive import action in the Open from Drive dialog only when the Picker is available', async () => {
    withDrive({ picker: true })
    const { unmount } = renderAt('/write?open=drive')
    let dialog = await screen.findByRole('dialog', { name: 'Open from Google Drive' })
    expect(within(dialog).getByRole('button', { name: 'Import from Google Drive…' })).toBeInTheDocument()
    unmount()

    withDrive()
    renderAt('/write?open=drive')
    dialog = await screen.findByRole('dialog', { name: 'Open from Google Drive' })
    expect(within(dialog).queryByRole('button', { name: /Import from Google Drive/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument()
    expect(dialog.textContent).not.toMatch(SETUP_WORDING)
  })

  it('opens a Thunder Writer file without its Drive link, so it can never autosave over the Drive file', async () => {
    const user = userEvent.setup()
    renderAt()
    const envelope = {
      app: 'thunder-writer',
      version: 1,
      savedAt: 1,
      doc: { ...makeDoc({ id: 'imp', title: 'Old backup' }), driveFileId: 'SOMEONES-FILE', driveSyncedAt: 1 },
    }
    const input = await openFromComputerInput(user)
    await user.upload(input, new File([JSON.stringify(envelope)], 'b.thunder.json', { type: 'application/json' }))
    await vi.waitFor(() => expect(useDocuments.getState().currentId).toBe('imp'))
    const d = useDocuments.getState().docs.imp
    expect(d.title).toBe('Old backup')
    expect(d.driveFileId).toBeUndefined()
    expect(d.driveSyncedAt).toBeUndefined()
  })

  it('if no backup could be kept, delete asks again and can be called off', async () => {
    backup.ok = false
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false)
    renderAt()
    await user.click(screen.getByRole('button', { name: /file/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Open manuscript…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Open manuscript' })
    await user.click(within(dialog).getByRole('button', { name: /delete alpha/i }))
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/couldn’t keep a backup of "Alpha"\. Delete it anyway\? This cannot be undone/))
    expect(useDocuments.getState().docs.a).toBeDefined()
    confirm.mockRestore()
  })

  it('keeps a backup of the manuscript an opened file replaces, and opens Drive .bak files', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt()
    const input = await openFromComputerInput(user)
    const envelope = { app: 'thunder-writer', version: 1, savedAt: 1, doc: makeDoc({ id: 'a', title: 'Alpha, older' }) }
    await user.upload(input, new File([JSON.stringify(envelope)], 'Alpha.thunder.json.bak', { type: 'application/json' }))
    await vi.waitFor(() => expect(useDocuments.getState().docs.a.title).toBe('Alpha, older'))
    expect(kept).toEqual([{ id: 'a', reason: 'before-import' }])
    confirm.mockRestore()
  })
})
