import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocuments } from '../../store/documents'
import { registerPendingFlush } from '../../store/pendingEdits'
import type { ThunderDoc } from '../../types'
import { makeDoc } from './testDocs'

const drive = vi.hoisted(() => ({ remote: null as ThunderDoc | null }))

vi.mock('./driveSession', async (importActual) => {
  const actual = await importActual<typeof import('./driveSession')>()
  return {
    ...actual,
    isDriveConfigured: () => true,
    auth: { hasValidToken: true },
    listDriveDocs: vi.fn(async () => [{ id: 'F', name: 'Storm.thunder.json' }]),
    downloadDriveDoc: vi.fn(async () => drive.remote),
  }
})

const { DriveModal } = await import('./DriveModal')

const words = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

describe('DriveModal', () => {
  beforeEach(() => {
    // Local copy with edits Drive doesn't have (synced at 500, edited at 1000)...
    const local = makeDoc({ id: 'a', title: 'Storm', driveFileId: 'F', driveSyncedAt: 500, updatedAt: 1000, content: words('Laptop edits') })
    useDocuments.setState({ docs: { a: local }, currentId: 'a', hydrated: true, dirtyForDrive: {} })
    // ...while the Drive copy is NEWER (saved later from another device).
    drive.remote = makeDoc({ id: 'a', title: 'Storm', driveFileId: 'F', updatedAt: 1500, content: words('Desktop edits') })
  })

  const open = async () => {
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <DriveModal onClose={onClose} />
      </MemoryRouter>,
    )
    await userEvent.click(await screen.findByRole('button', { name: /Storm/ }))
    return onClose
  }

  it('asks before replacing unsynced local edits even when the Drive copy is newer', async () => {
    const flushed = vi.fn()
    const unregister = registerPendingFlush(flushed)
    await open()
    expect(flushed).toHaveBeenCalled() // editor debounce flushed before comparing
    expect(await screen.findByText(/has edits in this browser that aren’t in Google Drive yet/)).toBeInTheDocument()
    expect(useDocuments.getState().docs.a.content).toEqual(words('Laptop edits'))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('list', { name: 'Manuscripts in Google Drive' })).toBeInTheDocument()
    expect(useDocuments.getState().docs.a.content).toEqual(words('Laptop edits'))
    unregister()
  })

  it('"Keep both" loses nothing', async () => {
    const onClose = await open()
    await userEvent.click(await screen.findByRole('button', { name: 'Keep both' }))
    expect(onClose).toHaveBeenCalled()
    const docs = Object.values(useDocuments.getState().docs)
    expect(docs.map((d) => d.content)).toEqual(expect.arrayContaining([words('Laptop edits'), words('Desktop edits')]))
  })

  it('opens straight away when the local copy has nothing unsynced', async () => {
    useDocuments.setState((s) => ({ docs: { a: { ...s.docs.a, driveSyncedAt: 1000 } } }))
    const onClose = await open()
    expect(onClose).toHaveBeenCalled()
    expect(useDocuments.getState().docs.a.content).toEqual(words('Desktop edits'))
  })
})
