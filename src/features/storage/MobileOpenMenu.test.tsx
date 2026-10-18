import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocuments } from '../../store/documents'
import { useExportUi } from '../export/exportUi'
import { makeDoc } from './testDocs'

const drive = vi.hoisted(() => ({ saveDocToDrive: vi.fn<(id: string) => Promise<string>>() }))
const files = vi.hoisted(() => ({ openFromComputer: vi.fn(async () => undefined) }))
vi.mock('./driveSession', async (importActual) => ({
  ...(await importActual<typeof import('./driveSession')>()),
  saveDocToDrive: drive.saveDocToDrive,
}))
vi.mock('../import/openFromComputer', async (importActual) => ({
  ...(await importActual<typeof import('../import/openFromComputer')>()),
  openFromComputer: files.openFromComputer,
}))

const { MobileOpenMenu } = await import('./MobileOpenMenu')

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname + loc.search}</div>
}
const renderMenu = () =>
  render(
    <MemoryRouter initialEntries={['/write']}>
      <MobileOpenMenu />
      <Where />
    </MemoryRouter>,
  )
const withDrive = () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '698829428298-abc.apps.googleusercontent.com')
  vi.stubEnv('VITE_GOOGLE_API_KEY', 'AIza-build')
}

beforeEach(() => {
  const doc = makeDoc({ id: 'd1', title: 'The Long Storm' })
  useDocuments.setState({ docs: { d1: doc }, currentId: 'd1', hydrated: true, dirtyForDrive: {} })
  useExportUi.setState({ toast: null })
  drive.saveDocToDrive.mockReset()
  files.openFromComputer.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('File menu (phones)', () => {
  it('opens and saves on this phone, in Google Drive, or starts a new manuscript', async () => {
    withDrive()
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'File' }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Open from Files…',
      'Save to Files…',
      'Save to Google Drive',
      'Your manuscripts in Google Drive',
      'Import a Google Doc or Word file from Drive',
      'New manuscript',
    ])
    // The hidden File menu opens its Drive list for ?open=drive.
    await user.click(screen.getByRole('menuitem', { name: 'Your manuscripts in Google Drive' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/write?open=drive')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Open from Files uses the phone’s file picker, straight from the tap', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'File' }))
    await user.click(screen.getByRole('menuitem', { name: 'Open from Files…' }))
    expect(files.openFromComputer).toHaveBeenCalledTimes(1)
  })

  it('Save to Google Drive saves this manuscript there and says autosave has taken over', async () => {
    withDrive()
    drive.saveDocToDrive.mockResolvedValue('file-1')
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'File' }))
    await user.click(screen.getByRole('menuitem', { name: 'Save to Google Drive' }))
    expect(drive.saveDocToDrive).toHaveBeenCalledWith('d1')
    await waitFor(() => expect(useExportUi.getState().toast?.text).toMatch(/“The Long Storm” saved to Google Drive\. Changes now save there automatically\./))
  })

  it('Save to Files offers Word, PDF, older Word, a Thunder Writer file or plain text, and hands the file to the share sheet', async () => {
    const share = vi.fn(async () => undefined)
    const canShare = vi.fn(() => true)
    Object.assign(navigator, { share, canShare })
    try {
      const user = userEvent.setup()
      renderMenu()
      await user.click(screen.getByRole('button', { name: 'File' }))
      await user.click(screen.getByRole('menuitem', { name: 'Save to Files…' }))
      const dialog = await screen.findByRole('dialog', { name: 'Save to Files' })
      expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['docx', 'pdf', 'doc', 'thunder', 'txt'])
      const save = await screen.findByRole('button', { name: 'Save…' })
      await waitFor(() => expect(save).toBeEnabled())
      await user.click(save)
      expect(share).toHaveBeenCalledTimes(1)
      const sent = (share.mock.calls[0] as unknown as [{ files: File[] }])[0].files[0]
      expect(sent.name).toBe('The Long Storm.docx')
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
      expect(useExportUi.getState().toast?.text).toMatch(/saved where you chose/)
    } finally {
      Object.assign(navigator, { share: undefined, canShare: undefined })
    }
  })

  it('without Google Drive in this build, offers this phone and a new manuscript', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'File' }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Open from Files…', 'Save to Files…', 'New manuscript'])
    await user.click(screen.getByRole('menuitem', { name: 'New manuscript' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/write?new=1')
  })
})
