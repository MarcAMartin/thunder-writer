import type { Editor } from '@tiptap/core'
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import { EditorContext } from '../../shell/EditorContext'
import { currentDoc, useDocuments } from '../../store/documents'
import { ImportHost } from './ImportHost'
import { BUSY_NOTICE, importLocalFile, openImportPicker, useImportFlow } from './importFlow'
import { useManuscriptDrop } from './useManuscriptDrop'

const MD = '# Chapter 1\n\nIt was *dark*.\n\n![map](map.png)\n\n# Chapter 2\n\nLight came.'
const mdFile = () => new File([MD], 'My Book.md', { type: 'text/markdown' })

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function renderHost(path = '/write') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ImportHost />
      <button type="button" onClick={() => openImportPicker()}>
        Choose a file
      </button>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useDocuments.setState({ docs: {}, currentId: null, dirtyForDrive: {}, hydrated: true })
  useImportFlow.setState({ phase: { kind: 'idle' }, prompt: false, notice: null })
  document.querySelectorAll('input[type=file]').forEach((el) => el.remove())
})

describe('local import flow', () => {
  it('creates and opens a new manuscript, marked for Drive, and shows the result', async () => {
    renderHost()
    await act(async () => {
      await importLocalFile(mdFile())
    })
    const doc = currentDoc(useDocuments.getState())
    expect(doc?.title).toBe('My Book')
    expect(doc?.format.presetId).toBeTruthy()
    expect(useDocuments.getState().dirtyForDrive[doc!.id]).toBe(true)
    expect(await screen.findByRole('dialog', { name: 'Manuscript imported' })).toBeInTheDocument()
    expect(screen.getByText(/“My Book” is open as a new manuscript/)).toBeInTheDocument()
    expect(screen.getByText('Chapters').nextElementSibling).toHaveTextContent('2')
    expect(screen.getByText(/Detected 2 chapters/)).toBeInTheDocument()
    expect(screen.getByText(/1 image was left out/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start writing' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows errors plainly and creates nothing', async () => {
    renderHost()
    await act(async () => {
      await importLocalFile(new File(['%PDF-1.4'], 'book.pdf', { type: 'application/pdf' }))
    })
    expect(await screen.findByRole('dialog', { name: 'Couldn’t import that file' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/PDFs can’t be imported/)
    expect(Object.keys(useDocuments.getState().docs)).toHaveLength(0)
  })

  it('opens a file chooser from the button and imports the chosen file', async () => {
    renderHost()
    await userEvent.click(screen.getByRole('button', { name: 'Choose a file' }))
    const input = document.querySelector<HTMLInputElement>('input[type=file]')
    expect(input).not.toBeNull()
    expect(input!.accept).toContain('.docx')
    expect(input!.accept).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    await userEvent.upload(input!, mdFile())
    await waitFor(() => expect(useImportFlow.getState().phase.kind).toBe('done'))
    expect(document.querySelector('input[type=file]')).toBeNull()
  })

  it('shows an "Open a manuscript" prompt for /write?import=local', async () => {
    renderHost('/write?import=local')
    const dialog = await screen.findByRole('dialog', { name: 'Open a manuscript' })
    expect(dialog).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Choose a file…' }))
    const input = document.querySelector<HTMLInputElement>('input[type=file]')
    await userEvent.upload(input!, mdFile())
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Manuscript opened' })).toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: 'Open a manuscript' })).toBeNull()
  })
})

function DropTarget() {
  const dragging = useManuscriptDrop()
  return (
    <div data-testid="target" data-dragging={dragging}>
      <p data-testid="inner">pages</p>
    </div>
  )
}

describe('useManuscriptDrop', () => {
  it('imports a dropped file and ignores non-file drags', async () => {
    render(<DropTarget />)
    const target = screen.getByTestId('target')
    fireEvent.dragEnter(screen.getByTestId('inner'), { dataTransfer: { types: ['Files'] } })
    expect(target.dataset.dragging).toBe('true')
    fireEvent.dragEnter(target, { dataTransfer: { types: ['text/plain'] } })
    await act(async () => {
      fireEvent.drop(screen.getByTestId('inner'), { dataTransfer: { types: ['Files'], files: [mdFile()] } })
    })
    expect(target.dataset.dragging).toBe('false')
    await waitFor(() => expect(useImportFlow.getState().phase.kind).toBe('done'))
    expect(currentDoc(useDocuments.getState())?.title).toBe('My Book')
  })

  it('catches a file dropped anywhere in the window, so the browser never navigates to it', async () => {
    render(
      <>
        <DropTarget />
        <header data-testid="toolbar">toolbar</header>
      </>,
    )
    const over = createEvent.dragOver(screen.getByTestId('toolbar'), { dataTransfer: { types: ['Files'] } })
    fireEvent(screen.getByTestId('toolbar'), over)
    expect(over.defaultPrevented).toBe(true)
    const drop = createEvent.drop(document.body, { dataTransfer: { types: ['Files'], files: [mdFile()] } })
    await act(async () => {
      fireEvent(document.body, drop)
    })
    expect(drop.defaultPrevented).toBe(true)
    await waitFor(() => expect(useImportFlow.getState().phase.kind).toBe('done'))
    // Text drags inside the editor are left alone.
    const textOver = createEvent.dragOver(screen.getByTestId('toolbar'), { dataTransfer: { types: ['text/plain'] } })
    fireEvent(screen.getByTestId('toolbar'), textOver)
    expect(textOver.defaultPrevented).toBe(false)
  })

  it('imports only the first of several dropped files and says so', async () => {
    render(<DropTarget />)
    const other = new File(['x'], 'Notes.txt', { type: 'text/plain' })
    await act(async () => {
      fireEvent.drop(screen.getByTestId('inner'), { dataTransfer: { types: ['Files'], files: [mdFile(), other] } })
    })
    await waitFor(() => expect(useImportFlow.getState().phase.kind).toBe('done'))
    const phase = useImportFlow.getState().phase
    expect(phase.kind === 'done' && phase.result.warnings.at(-1)).toMatch(/Only “My Book.md” was imported; “Notes.txt” was left out/)
  })
})

describe('import feedback', () => {
  it('tells the writer when a drop arrives while another import is running', async () => {
    renderHost()
    useImportFlow.setState({ phase: { kind: 'importing', name: 'Big.docx' } })
    await act(async () => {
      expect(await importLocalFile(mdFile())).toBeNull()
    })
    expect(useImportFlow.getState().notice).toBe(BUSY_NOTICE)
    expect(screen.getByRole('status')).toHaveTextContent(/already in progress/)
  })

  it('offers Google Drive in the ?import=local prompt instead of telling Google Docs writers to download a .docx', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '698829428298-abc.apps.googleusercontent.com')
    vi.stubEnv('VITE_GOOGLE_API_KEY', 'AIza-build')
    render(
      <MemoryRouter initialEntries={['/write?import=local']}>
        <ImportHost />
        <LocationProbe />
      </MemoryRouter>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Open a manuscript' })
    expect(dialog).not.toHaveTextContent(/Download › Microsoft Word/)
    expect(dialog).toHaveTextContent(/Google Docs\? Import it straight from Google Drive/)
    await userEvent.click(screen.getByRole('button', { name: 'Import from Google Drive…' }))
    expect(screen.getByTestId('location')).toHaveTextContent('open=picker')
    expect(screen.queryByRole('dialog', { name: 'Open a manuscript' })).toBeNull()
    vi.unstubAllEnvs()
  })

  it('in a build without the Drive import, the ?import=local prompt explains the .docx download instead', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '698829428298-abc.apps.googleusercontent.com')
    vi.stubEnv('VITE_GOOGLE_API_KEY', '')
    render(
      <MemoryRouter initialEntries={['/write?import=local']}>
        <ImportHost />
      </MemoryRouter>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Open a manuscript' })
    expect(screen.queryByRole('button', { name: /Import from Google Drive/ })).not.toBeInTheDocument()
    expect(dialog).toHaveTextContent(/Google Docs\? Choose File › Download › Microsoft Word \(\.docx\) there/)
    vi.unstubAllEnvs()
  })

  it('"Start writing" puts the cursor in the new manuscript', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const focus = vi.fn()
    const editor = { commands: { focus } } as unknown as Editor
    render(
      <MemoryRouter>
        <EditorContext.Provider value={{ editor, bridge: null }}>
          <ImportHost />
        </EditorContext.Provider>
      </MemoryRouter>,
    )
    await act(async () => {
      await importLocalFile(mdFile())
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Start writing' }))
    await act(async () => {
      vi.runAllTimers()
    })
    expect(focus).toHaveBeenCalledWith('start')
    vi.useRealTimers()
  })

  it('returns focus to the File button when the file chooser is cancelled', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    openImportPicker({ returnFocus: () => trigger })
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!
    input.dispatchEvent(new Event('cancel'))
    expect(document.activeElement).toBe(trigger)
    expect(document.querySelector('input[type=file]')).toBeNull()
    trigger.remove()
  })
})

describe('the blank first manuscript', () => {
  it('is replaced by the import instead of lingering as an extra "Untitled Manuscript"', async () => {
    const blank = useDocuments.getState().createDoc()
    renderHost()
    await act(async () => {
      await importLocalFile(mdFile())
    })
    const docs = Object.values(useDocuments.getState().docs)
    expect(docs.map((d) => d.title)).toEqual(['My Book'])
    expect(useDocuments.getState().docs[blank.id]).toBeUndefined()
  })

  it('is kept once the writer has typed in it or renamed it', async () => {
    const typed = useDocuments.getState().createDoc({
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
    })
    renderHost()
    await act(async () => {
      await importLocalFile(mdFile())
    })
    expect(useDocuments.getState().docs[typed.id]).toBeDefined()
    expect(Object.keys(useDocuments.getState().docs)).toHaveLength(2)
  })
})
