import type { Editor } from '@tiptap/core'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorContext } from '../../shell/EditorContext'
import { useDocuments } from '../../store/documents'
import { DriveError } from './drive'
import type { DriveImportOutcome } from './driveImport'
import type { PickedFile } from './picker'
import { makeDoc } from './testDocs'

vi.mock('../import/importManuscript', () => ({
  importManuscript: vi.fn(async () => {
    throw new Error('stub')
  }),
  IMPORT_ACCEPT: [],
  IMPORT_MIME_TYPES: [],
}))

const session = vi.hoisted(() => ({
  pickDriveFile: vi.fn<() => Promise<PickedFile | null>>(),
  importPickedDriveFile: vi.fn<(f: PickedFile) => Promise<DriveImportOutcome>>(),
}))

vi.mock('./driveSession', async (importActual) => {
  const actual = await importActual<typeof import('./driveSession')>()
  return {
    ...actual,
    isDriveConfigured: () => true,
    isPickerConfigured: () => true,
    pickDriveFile: session.pickDriveFile,
    importPickedDriveFile: session.importPickedDriveFile,
  }
})

const { FileMenu } = await import('./FileMenu')

const FILE: PickedFile = { id: 'G1', name: 'The Long Storm (draft 3)', mimeType: 'application/vnd.google-apps.document' }
const CONTENT = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It began.' }] }] }
const OUTCOME: DriveImportOutcome = {
  kind: 'manuscript',
  file: FILE,
  result: {
    title: 'The Long Storm',
    content: CONTENT,
    wordCount: 84213,
    chapterCount: 32,
    warnings: ['3 images were skipped.', 'Detected 32 chapters from Heading 1.'],
  },
}

const renderAt = (url = '/write') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <FileMenu />
    </MemoryRouter>,
  )

const openImport = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /file/i }))
  await user.click(screen.getByRole('menuitem', { name: 'Import from Google Drive…' }))
}

describe('Import from Google Drive', () => {
  beforeEach(() => {
    session.pickDriveFile.mockReset()
    session.importPickedDriveFile.mockReset()
    useDocuments.setState({ docs: { a: makeDoc({ id: 'a', title: 'Alpha' }) }, currentId: 'a', hydrated: true, dirtyForDrive: {} })
  })

  it('opens the Picker from the menu click, imports the file as a new manuscript and shows the result', async () => {
    session.pickDriveFile.mockResolvedValue(FILE)
    session.importPickedDriveFile.mockResolvedValue(OUTCOME)
    const user = userEvent.setup()
    renderAt()
    await openImport(user)
    expect(session.pickDriveFile).toHaveBeenCalledTimes(1)

    const dialog = await screen.findByRole('dialog', { name: 'Import from Google Drive' })
    expect(await within(dialog).findByText(/84,213 words, 32 chapters/)).toBeInTheDocument()
    const notes = within(dialog).getByRole('list', { name: 'Import notes' })
    expect(within(notes).getAllByRole('listitem').map((li) => li.textContent)).toEqual(OUTCOME.kind === 'manuscript' ? OUTCOME.result.warnings : [])
    expect(within(dialog).getByText(/“The Long Storm \(draft 3\)” in Google Drive was not changed/)).toBeInTheDocument()
    expect(session.importPickedDriveFile).toHaveBeenCalledWith(FILE)

    // A brand-new, unlinked manuscript, opened, queued for Drive autosave.
    const st = useDocuments.getState()
    expect(Object.keys(st.docs)).toHaveLength(2)
    const doc = st.docs[st.currentId!]
    expect(doc.id).not.toBe('a')
    expect(doc.title).toBe('The Long Storm')
    expect(doc.content).toEqual(CONTENT)
    expect(doc.driveFileId).toBeUndefined()
    expect(st.dirtyForDrive[doc.id]).toBe(true)

    await user.click(within(dialog).getByRole('button', { name: 'Start writing' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does nothing when the writer cancels the Picker', async () => {
    session.pickDriveFile.mockResolvedValue(null)
    const user = userEvent.setup()
    renderAt()
    await openImport(user)
    await vi.waitFor(() => expect(session.pickDriveFile).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(session.importPickedDriveFile).not.toHaveBeenCalled()
    expect(Object.keys(useDocuments.getState().docs)).toEqual(['a'])
  })

  it('shows download errors and lets the writer pick again', async () => {
    session.pickDriveFile.mockResolvedValue(FILE)
    session.importPickedDriveFile.mockRejectedValue(
      new DriveError('forbidden', 'Thunder Writer can’t open that file — pick it again from Google Drive.', 403),
    )
    const user = userEvent.setup()
    renderAt()
    await openImport(user)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('pick it again from Google Drive')
    expect(Object.keys(useDocuments.getState().docs)).toEqual(['a'])

    session.pickDriveFile.mockResolvedValue(null)
    await user.click(within(alert).getByRole('button', { name: 'Pick a file again' }))
    expect(session.pickDriveFile).toHaveBeenCalledTimes(2)
  })

  it('offers to reconnect when the Drive session expired', async () => {
    session.pickDriveFile.mockRejectedValue(new DriveError('auth', 'Your Google Drive session expired.'))
    const user = userEvent.setup()
    renderAt()
    await openImport(user)
    expect(await screen.findByRole('button', { name: 'Reconnect and pick a file' })).toBeInTheDocument()
  })

  it('?open=picker waits for a click before opening the Picker', async () => {
    session.pickDriveFile.mockResolvedValue(FILE)
    session.importPickedDriveFile.mockResolvedValue(OUTCOME)
    const user = userEvent.setup()
    renderAt('/write?open=picker')
    const btn = await screen.findByRole('button', { name: 'Choose a file from Google Drive…' })
    expect(session.pickDriveFile).not.toHaveBeenCalled()
    await user.click(btn)
    expect(session.pickDriveFile).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/84,213 words/)).toBeInTheDocument()
  })

  it('opens a picked .thunder.json as a new copy', async () => {
    const remote = makeDoc({ id: 'a', title: 'Alpha', driveFileId: 'SOMEONE', content: CONTENT })
    session.pickDriveFile.mockResolvedValue({ id: 'T', name: 'Alpha.thunder.json', mimeType: 'application/json' })
    session.importPickedDriveFile.mockResolvedValue({
      kind: 'thunder',
      file: { id: 'T', name: 'Alpha.thunder.json', mimeType: 'application/json' },
      doc: remote,
    })
    const user = userEvent.setup()
    renderAt()
    await openImport(user)
    expect(await screen.findByText(/is ready/)).toBeInTheDocument()
    const st = useDocuments.getState()
    expect(Object.keys(st.docs)).toHaveLength(2)
    expect(st.docs.a.title).toBe('Alpha') // the existing local copy is untouched
    expect(st.docs[st.currentId!].driveFileId).toBeUndefined()
  })

  it('starts the import from the Open from Drive dialog', async () => {
    session.pickDriveFile.mockResolvedValue(null)
    const user = userEvent.setup()
    renderAt('/write?open=drive')
    const dialog = await screen.findByRole('dialog', { name: 'Open from Google Drive' })
    await user.click(within(dialog).getByRole('button', { name: 'Import from Google Drive…' }))
    expect(session.pickDriveFile).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Open from Google Drive' })).not.toBeInTheDocument()
  })
})

describe('Import from Google Drive — after the import', () => {
  beforeEach(() => {
    session.pickDriveFile.mockReset()
    session.importPickedDriveFile.mockReset()
  })

  it('"Start writing" puts the cursor in the new manuscript, and a blank first manuscript is replaced', async () => {
    useDocuments.setState({ docs: {}, currentId: null, hydrated: true, dirtyForDrive: {} })
    const blank = useDocuments.getState().createDoc()
    session.pickDriveFile.mockResolvedValue(FILE)
    session.importPickedDriveFile.mockResolvedValue(OUTCOME)
    const focus = vi.fn()
    const editor = { commands: { focus } } as unknown as Editor
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <EditorContext.Provider value={{ editor, bridge: null }}>
          <FileMenu />
        </EditorContext.Provider>
      </MemoryRouter>,
    )
    await openImport(user)
    const dialog = await screen.findByRole('dialog', { name: 'Import from Google Drive' })
    await within(dialog).findByText(/84,213 words/)
    expect(Object.values(useDocuments.getState().docs).map((d) => d.title)).toEqual(['The Long Storm'])
    expect(useDocuments.getState().docs[blank.id]).toBeUndefined()
    await user.click(within(dialog).getByRole('button', { name: 'Start writing' }))
    await vi.waitFor(() => expect(focus).toHaveBeenCalledWith('start'))
  })
})
