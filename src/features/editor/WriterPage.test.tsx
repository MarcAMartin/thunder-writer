import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { TiptapEditorHTMLElement } from '@tiptap/core'
import { DEFAULT_FORMAT, useDocuments } from '../../store/documents'
import { useSession } from '../../store/session'
import { useImportFlow } from '../import/importFlow'
import { useExportUi } from '../export'
import type { ThunderDoc } from '../../types'

// Sibling features are built independently; isolate the editor from them.
vi.mock('../suggestions/SuggestionsPane', () => ({ SuggestionsPane: () => <aside data-testid="pane" /> }))
vi.mock('../storage/FileMenu', () => ({
  FileMenu: ({ afterMenu, afterStatus }: { afterMenu?: React.ReactNode; afterStatus?: React.ReactNode }) => (
    <div data-testid="filemenu">
      {afterMenu}
      {afterStatus}
    </div>
  ),
}))

const { WriterPage } = await import('./WriterPage')

// jsdom has no layout; ProseMirror's scroll-into-view asks Ranges for rects.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = emptyRects
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}

const initialDocs = useDocuments.getState()

function renderPage(url = '/write') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <WriterPage />
    </MemoryRouter>,
  )
}

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

/** Home › Start Writing. */
function renderNew(url = '/write?new=1') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <WriterPage />
      <Where />
    </MemoryRouter>,
  )
}

function getEditor() {
  const dom = document.querySelector('.ed-prose') as TiptapEditorHTMLElement | null
  if (!dom?.editor) throw new Error('editor not mounted')
  return dom.editor
}

const docWith = (text: string): ThunderDoc => ({
  id: 'doc-1',
  title: 'The Storm',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  format: { presetId: 'trade-5x8', chapterStartsNewPage: true },
  createdAt: 1,
  updatedAt: 1,
})

beforeEach(() => {
  useDocuments.setState({ ...initialDocs, docs: {}, currentId: null, hydrated: false, dirtyForDrive: {} }, true)
  useSession.getState().resetSession()
  useImportFlow.setState({ phase: { kind: 'idle' }, prompt: false })
  useExportUi.setState({ toast: null, chooserOpen: false, chooserNote: null, chooserDismissed: false })
})

afterEach(() => {
  cleanup()
})

describe('WriterPage', () => {
  it('waits for hydration, then creates a document when there is none', async () => {
    renderPage()
    expect(screen.getByText(/Opening your manuscript/)).toBeInTheDocument()
    act(() => useDocuments.getState().hydrate([], null))
    await waitFor(() => expect(useDocuments.getState().currentId).not.toBeNull())
    expect(Object.keys(useDocuments.getState().docs)).toHaveLength(1)
    await waitFor(() => expect(document.querySelector('.ed-prose')).not.toBeNull())
    expect(screen.getByTestId('pane')).toBeInTheDocument()
    expect(screen.getByTestId('filemenu')).toBeInTheDocument()
    // File, Export to computer and Backups lead the first row of formatting controls.
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' })
    expect(within(toolbar).getByTestId('filemenu')).toBe(toolbar.querySelector('.ed-group')?.firstElementChild)
  })

  it('opens the most recent existing doc instead of creating a new one', async () => {
    useDocuments.getState().hydrate([docWith('Once upon a time.')], null)
    renderPage()
    await waitFor(() => expect(useDocuments.getState().currentId).toBe('doc-1'))
    expect(Object.keys(useDocuments.getState().docs)).toHaveLength(1)
    await waitFor(() => expect(getEditor().getText()).toContain('Once upon a time.'))
  })

  it('?new=1 (Start Writing) opens a fresh manuscript and keeps the existing one', async () => {
    useDocuments.getState().hydrate([docWith('Once upon a time.')], 'doc-1')
    renderNew('/write?new=1&x=1')
    await waitFor(() => expect(Object.keys(useDocuments.getState().docs)).toHaveLength(2))
    const { currentId, docs } = useDocuments.getState()
    expect(currentId).not.toBe('doc-1')
    expect(docs[currentId!].title).toBe('Untitled Manuscript')
    expect(docs['doc-1'].title).toBe('The Storm')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/write\?x=1$/))
    await waitFor(() => expect(getEditor().getText()).toBe(''))
    // The previous manuscript never loaded into the editor on the way.
    expect(Object.keys(useDocuments.getState().docs)).toHaveLength(2)
  })

  it('?new=1 replaces a blank manuscript left from an earlier Start Writing', async () => {
    const old: ThunderDoc = { ...docWith(''), id: 'blank', title: 'Untitled Manuscript', content: null, format: DEFAULT_FORMAT }
    useDocuments.getState().hydrate([old], 'blank')
    renderNew()
    await waitFor(() => expect(useDocuments.getState().currentId).not.toBe('blank'))
    expect(useDocuments.getState().docs.blank).toBeUndefined()
    expect(Object.keys(useDocuments.getState().docs)).toHaveLength(1)
  })

  it('?new=1 keeps a manuscript with no text yet whose book format the writer already chose', async () => {
    const setUp: ThunderDoc = { ...docWith(''), id: 'set-up', title: 'Untitled Manuscript', content: null }
    useDocuments.getState().hydrate([setUp], 'set-up')
    renderNew()
    await waitFor(() => expect(useDocuments.getState().currentId).not.toBe('set-up'))
    expect(useDocuments.getState().docs['set-up']).toBeDefined()
    expect(Object.keys(useDocuments.getState().docs)).toHaveLength(2)
  })

  it('?new=1 waits for storage and makes exactly one manuscript when there are none', async () => {
    renderNew()
    expect(screen.getByText(/Opening your manuscript/)).toBeInTheDocument()
    act(() => useDocuments.getState().hydrate([], null))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/write$/))
    expect(Object.keys(useDocuments.getState().docs)).toHaveLength(1)
  })

  it('loads content without dirtying, then debounces edits into the store', async () => {
    useDocuments.getState().hydrate([docWith('Once upon a time.')], 'doc-1')
    renderPage()
    await waitFor(() => expect(getEditor().getText()).toBe('Once upon a time.'))
    expect(useDocuments.getState().dirtyForDrive).toEqual({})
    expect(screen.getByDisplayValue('The Storm')).toBeInTheDocument()

    act(() => {
      getEditor().chain().focus('end').insertContent(' The end.').run()
    })
    await waitFor(
      () => {
        const content = JSON.stringify(useDocuments.getState().docs['doc-1'].content)
        expect(content).toContain('The end.')
      },
      { timeout: 2000 },
    )
    expect(useDocuments.getState().dirtyForDrive['doc-1']).toBe(true)
    await waitFor(() => expect(screen.getByText('Words').nextElementSibling).toHaveTextContent('6'), { timeout: 2000 })
  })

  it('reflects content replaced from outside (e.g. a Drive load)', async () => {
    useDocuments.getState().hydrate([docWith('Old text.')], 'doc-1')
    renderPage()
    await waitFor(() => expect(getEditor().getText()).toBe('Old text.'))
    act(() => useDocuments.getState().upsertDoc(docWith('Fresh from Drive.')))
    await waitFor(() => expect(getEditor().getText()).toBe('Fresh from Drive.'))
  })

  it('changes the book format from the toolbar', async () => {
    useDocuments.getState().hydrate(
      [{ ...docWith('x'), format: { presetId: 'trade-5x8', fontSizePt: 14, chapterStartsNewPage: true } }],
      'doc-1',
    )
    renderPage()
    await waitFor(() => expect(document.querySelector('.ed-prose')).not.toBeNull())
    fireEvent.change(screen.getByLabelText('Book size'), { target: { value: 'manuscript-letter' } })
    const f = useDocuments.getState().docs['doc-1'].format
    expect(f.presetId).toBe('manuscript-letter')
    expect(f.fontSizePt).toBeUndefined()
    fireEvent.change(screen.getByLabelText('Font size in points'), { target: { value: '13' } })
    expect(useDocuments.getState().docs['doc-1'].format.fontSizePt).toBe(13)
    fireEvent.click(screen.getByLabelText('Chapters start new page'))
    expect(useDocuments.getState().docs['doc-1'].format.chapterStartsNewPage).toBe(false)
  })

  it('applies formatting through toolbar buttons', async () => {
    useDocuments.getState().hydrate([docWith('Bold move.')], 'doc-1')
    renderPage()
    await waitFor(() => expect(getEditor().getText()).toBe('Bold move.'))
    act(() => {
      getEditor().commands.selectAll()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    expect(getEditor().getHTML()).toContain('<strong>Bold move.</strong>')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.change(screen.getByLabelText('Paragraph style'), { target: { value: 'h1' } })
    expect(getEditor().getHTML()).toMatch(/^<h1/)
  })

  it('puts Export to computer in the header and opens the dialog from it', async () => {
    useDocuments.getState().hydrate([docWith('x')], 'doc-1')
    renderPage()
    await waitFor(() => expect(getEditor().getText()).toBe('x'))
    fireEvent.click(screen.getByRole('button', { name: /Export to computer/ }))
    expect(screen.getByRole('menuitem', { name: /Word document \(\.docx\)/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Keep a copy on my computer/ }))
    expect(await screen.findByRole('dialog', { name: 'Export to your computer' })).toBeInTheDocument()
  })

  it('Cmd/Ctrl+S inside the editor: no browser Save page, pending keystrokes reach the store at once', async () => {
    useDocuments.getState().hydrate([docWith('Once upon a time.')], 'doc-1')
    useExportUi.setState({ chooserDismissed: true })
    renderPage()
    await waitFor(() => expect(getEditor().getText()).toBe('Once upon a time.'))
    act(() => {
      getEditor().chain().focus('end').insertContent(' Saved.').run()
    })
    // Still inside the editor's 400 ms debounce.
    expect(JSON.stringify(useDocuments.getState().docs['doc-1'].content)).not.toContain('Saved.')
    const prose = document.querySelector('.ed-prose')!
    const notPrevented = fireEvent.keyDown(prose, { key: 's', code: 'KeyS', ctrlKey: true })
    expect(notPrevented).toBe(false)
    expect(JSON.stringify(useDocuments.getState().docs['doc-1'].content)).toContain('Saved.')
    await waitFor(() => expect(useExportUi.getState().toast?.text).toBe('Saved in your browser.'))
  })

  it('leaves Cmd/Ctrl+Shift+S to the editor as strikethrough', async () => {
    useDocuments.getState().hydrate([docWith('Strike me.')], 'doc-1')
    renderPage()
    await waitFor(() => expect(getEditor().getText()).toBe('Strike me.'))
    act(() => {
      getEditor().commands.focus()
      getEditor().commands.selectAll()
    })
    const prose = document.querySelector('.ed-prose')!
    fireEvent.keyDown(prose, { key: 'S', code: 'KeyS', keyCode: 83, ctrlKey: true, shiftKey: true })
    expect(getEditor().getHTML()).toContain('<s>Strike me.</s>')
    expect(useExportUi.getState().chooserOpen).toBe(false)
  })

  it('renames the manuscript inline', async () => {
    useDocuments.getState().hydrate([docWith('x')], 'doc-1')
    renderPage()
    const input = await screen.findByLabelText('Manuscript title')
    fireEvent.change(input, { target: { value: 'Thunderhead' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(useDocuments.getState().docs['doc-1'].title).toBe('Thunderhead')
  })

  it('shows session stats in the status bar', async () => {
    useDocuments.getState().hydrate([docWith('x')], 'doc-1')
    renderPage()
    await waitFor(() => expect(document.querySelector('.ed-prose')).not.toBeNull())
    act(() => useSession.getState().addUsage({ inputTokens: 1200, outputTokens: 300, costUsd: 0.00234 }))
    expect(screen.getByText('$0.0023')).toBeInTheDocument()
    expect(screen.getByText('Time').nextElementSibling).toHaveTextContent(/0:00:0\d/)
  })

  it('keeps the session clock, cost, accepted count and open cards across a trip to Settings', async () => {
    useDocuments.getState().hydrate([docWith('x')], 'doc-1')
    const first = renderPage()
    await waitFor(() => expect(document.querySelector('.ed-prose')).not.toBeNull())
    const startedAt = useSession.getState().startedAt
    expect(useSession.getState().writingStarted).toBe(true)
    act(() => {
      const s = useSession.getState()
      s.addUsage({ inputTokens: 10, outputTokens: 5, costUsd: 0.03 })
      s.addSuggestions([
        { id: 'a', kind: 'general', title: 'A', detail: 'D', status: 'open', createdAt: 1, provider: 'claude', model: 'm' },
        { id: 'b', kind: 'general', title: 'B', detail: 'D', status: 'open', createdAt: 1, provider: 'claude', model: 'm' },
      ])
      s.setSuggestionStatus('b', 'accepted')
    })
    first.unmount() // navigate to /settings
    renderPage() // ...and back to /write
    await waitFor(() => expect(document.querySelector('.ed-prose')).not.toBeNull())
    const s = useSession.getState()
    expect(s.startedAt).toBe(startedAt)
    expect(s.usage.costUsd).toBeCloseTo(0.03)
    expect(s.suggestionsAccepted).toBe(1)
    expect(s.suggestions.map((x) => [x.id, x.status])).toEqual([
      ['a', 'open'],
      ['b', 'accepted'],
    ])
    expect(screen.getByText('$0.0300')).toBeInTheDocument()
  })

  it('never loads (or overwrites) a manuscript whose content the editor schema cannot represent', async () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Precious words ' }, { type: 'text', text: 'here', marks: [{ type: 'link', attrs: { href: 'x' } }] }] },
      ],
    }
    const bad: ThunderDoc = { ...docWith(''), content }
    useDocuments.getState().hydrate([bad], 'doc-1')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(/can’t be opened safely/)
    // The (empty) editor is never shown or written back.
    expect(document.querySelector('.ed-prose')).toBeNull()
    await new Promise((r) => setTimeout(r, 500))
    expect(useDocuments.getState().docs['doc-1'].content).toBe(content)
    expect(useDocuments.getState().dirtyForDrive['doc-1']).toBeUndefined()
    // TipTap never received the content (it would log the whole manuscript and load an empty doc).
    expect(warn.mock.calls.some((c) => String(c[0]).includes('Invalid content'))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Open a repaired copy' }))
    await waitFor(() => expect(useDocuments.getState().currentId).not.toBe('doc-1'))
    const repaired = useDocuments.getState().docs[useDocuments.getState().currentId!]
    expect(repaired.title).toBe('The Storm (repaired)')
    await waitFor(() => expect(getEditor().getText()).toBe('Precious words here'))
    expect(useDocuments.getState().docs['doc-1'].content).toBe(content)
    warn.mockRestore()
  })

  it('stops editing (without saving) when unreadable content replaces the open doc from outside', async () => {
    useDocuments.getState().hydrate([docWith('Fine so far.')], 'doc-1')
    renderPage()
    await waitFor(() => expect(getEditor().getText()).toBe('Fine so far.'))
    const content = { type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'x' }] }] }
    act(() => useDocuments.getState().upsertDoc({ ...docWith(''), content, updatedAt: 5 }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/can’t be opened safely/)
    await new Promise((r) => setTimeout(r, 500))
    expect(useDocuments.getState().docs['doc-1'].content).toBe(content)
  })

  it("hides the previous manuscript's open suggestions when switching docs", async () => {
    const other = { ...docWith('Another tale.'), id: 'doc-2', title: 'Other' }
    useDocuments.getState().hydrate([docWith('Once upon a time.'), other], 'doc-1')
    renderPage()
    await waitFor(() => expect(getEditor().getText()).toBe('Once upon a time.'))
    act(() =>
      useSession.getState().addSuggestions([
        { id: 's1', kind: 'general', title: 'T', detail: 'D', status: 'open', createdAt: 1, provider: 'claude', model: 'm' },
        { id: 's2', kind: 'general', title: 'T2', detail: 'D2', status: 'accepted', createdAt: 1, provider: 'claude', model: 'm' },
      ]),
    )
    act(() => useDocuments.getState().openDoc('doc-2'))
    await waitFor(() => expect(getEditor().getText()).toBe('Another tale.'))
    const byId = Object.fromEntries(useSession.getState().suggestions.map((x) => [x.id, x.status]))
    expect(byId).toEqual({ s1: 'hidden', s2: 'accepted' })
  })

  it('shows the "Open a manuscript" prompt for ?import=local', async () => {
    useDocuments.getState().hydrate([docWith('Once upon a time.')], 'doc-1')
    renderPage('/write?import=local')
    expect(await screen.findByRole('dialog', { name: 'Open a manuscript' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose a file…' })).toBeInTheDocument()
  })

  it('imports a manuscript dropped on the pages as a new, opened document', async () => {
    useDocuments.getState().hydrate([docWith('Once upon a time.')], 'doc-1')
    renderPage()
    await waitFor(() => expect(getEditor().getText()).toBe('Once upon a time.'))
    const file = new File(['Chapter 1\n\nThe rain came early.\n\nChapter 2\n\nIt did not stop.'], 'draft.txt', {
      type: 'text/plain',
    })
    const main = document.getElementById('manuscript')!
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' }
    fireEvent.dragEnter(main, { dataTransfer })
    fireEvent.drop(main, { dataTransfer })
    expect(await screen.findByRole('dialog', { name: 'Manuscript imported' })).toBeInTheDocument()
    await waitFor(() => expect(getEditor().getText()).toContain('The rain came early.'))
    const s = useDocuments.getState()
    expect(s.currentId).not.toBe('doc-1')
    expect(s.docs['doc-1'].content).toEqual(docWith('Once upon a time.').content)
    expect(s.dirtyForDrive[s.currentId!]).toBe(true)
  })
})
