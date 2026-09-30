import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { currentDoc, useDocuments } from '../../store/documents'
import { ImportButton } from './ImportButton'
import { ImportHost } from './ImportHost'
import { importLocalFile, useImportFlow } from './importFlow'
import { useManuscriptDrop } from './useManuscriptDrop'

const MD = '# Chapter 1\n\nIt was *dark*.\n\n![map](map.png)\n\n# Chapter 2\n\nLight came.'
const mdFile = () => new File([MD], 'My Book.md', { type: 'text/markdown' })

function renderHost(path = '/write') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ImportHost />
      <ImportButton />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useDocuments.setState({ docs: {}, currentId: null, dirtyForDrive: {}, hydrated: true })
  useImportFlow.setState({ phase: { kind: 'idle' }, prompt: false })
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
    await userEvent.click(screen.getByRole('button', { name: 'Import manuscript…' }))
    const input = document.querySelector<HTMLInputElement>('input[type=file]')
    expect(input).not.toBeNull()
    expect(input!.accept).toContain('.docx')
    expect(input!.accept).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    await userEvent.upload(input!, mdFile())
    await waitFor(() => expect(useImportFlow.getState().phase.kind).toBe('done'))
    expect(document.querySelector('input[type=file]')).toBeNull()
  })

  it('shows a "Choose a file to import" prompt for /write?import=local', async () => {
    renderHost('/write?import=local')
    const dialog = await screen.findByRole('dialog', { name: 'Import a manuscript' })
    expect(dialog).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Choose a file to import' }))
    const input = document.querySelector<HTMLInputElement>('input[type=file]')
    await userEvent.upload(input!, mdFile())
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Manuscript imported' })).toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: 'Import a manuscript' })).toBeNull()
  })
})

function DropTarget() {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useManuscriptDrop(ref)
  return (
    <div ref={ref} data-testid="target" data-dragging={dragging}>
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
})
