import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { TiptapEditorHTMLElement } from '@tiptap/core'
import { useDocuments } from '../../store/documents'
import { useSession } from '../../store/session'
import { useSettings } from '../../store/settings'
import type { HeaderFooterSettings, ThunderDoc } from '../../types'
import type { BookPreviewProps } from '../preview/BookPreview'
import { DEFAULT_HEADER_FOOTER, normalizeHeaderFooter } from '../preview/headerFooter'
import { isPreviewShortcut } from './BookTools'
import { chapterTitlesOf } from './bookChapters'
import { sheetFurniture } from './PageView'
import { sheetBlocksOf, sheetsOf } from './usePagination'

vi.mock('../suggestions/SuggestionsPane', () => ({ SuggestionsPane: () => <aside data-testid="pane" /> }))
vi.mock('../storage/FileMenu', () => ({ FileMenu: () => <div data-testid="filemenu" /> }))

// The typesetting engine is tested in features/preview; here only the wiring matters.
const previewProps: BookPreviewProps[] = []
vi.mock('../preview/BookPreview', () => ({
  BookPreview: (props: BookPreviewProps) => {
    previewProps.push(props)
    return (
      <div role="dialog" aria-label="Book preview stub">
        <button
          type="button"
          onClick={() => props.onHeaderFooterChange?.({ ...normalizeHeaderFooter(props.headerFooter), authorName: 'Ada Lovelace', rectoHead: 'chapter' })}
        >
          change heads
        </button>
        <button type="button" onClick={() => props.onLayoutOptionsChange?.({ chaptersStartRecto: false, justify: false, chapterSink: 0.2 })}>
          change layout
        </button>
        <button type="button" onClick={props.onClose}>
          close stub
        </button>
      </div>
    )
  },
}))

const { WriterPage } = await import('./WriterPage')

const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = emptyRects
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const chapter = (text: string) => ({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] })

const DOC: ThunderDoc = {
  id: 'doc-1',
  title: 'The Storm',
  content: { type: 'doc', content: [chapter('One'), para('First.'), chapter('Two'), para('Second.'), para('Third.')] },
  format: { presetId: 'trade-6x9', chapterStartsNewPage: true },
  createdAt: 1,
  updatedAt: 1,
}

const initialDocs = useDocuments.getState()

beforeEach(() => {
  previewProps.length = 0
  useDocuments.setState({ ...initialDocs, docs: { [DOC.id]: DOC }, currentId: DOC.id, hydrated: true, dirtyForDrive: {} }, true)
  useSession.getState().resetSession()
})
afterEach(() => cleanup())

async function renderPage() {
  render(
    <MemoryRouter initialEntries={['/write']}>
      <WriterPage />
    </MemoryRouter>,
  )
  await waitFor(() => expect(document.querySelector('.ed-prose')).not.toBeNull())
  const dom = document.querySelector('.ed-prose') as TiptapEditorHTMLElement
  return dom.editor!
}

describe('Preview shortcut', () => {
  it('is Cmd+Option+P on a Mac (the physical key: Option types π) and Ctrl+Alt+P elsewhere', () => {
    const k = (o: Partial<KeyboardEvent>) => ({ key: 'p', code: 'KeyP', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o })
    expect(isPreviewShortcut(k({ metaKey: true, altKey: true, key: 'π' }), true)).toBe(true)
    expect(isPreviewShortcut(k({ ctrlKey: true, altKey: true }), false)).toBe(true)
    expect(isPreviewShortcut(k({ ctrlKey: true, altKey: true, key: 'P' }), false)).toBe(true)
    // Not print (Mod+P), not Firefox's private window (Mod+Shift+P), not the other platform's chord.
    expect(isPreviewShortcut(k({ metaKey: true }), true)).toBe(false)
    expect(isPreviewShortcut(k({ ctrlKey: true, shiftKey: true }), false)).toBe(false)
    expect(isPreviewShortcut(k({ metaKey: true, altKey: true, shiftKey: true }), true)).toBe(false)
    expect(isPreviewShortcut(k({ ctrlKey: true, altKey: true }), true)).toBe(false)
    expect(isPreviewShortcut(k({ metaKey: true, altKey: true }), false)).toBe(false)
    // AltGr (Ctrl+Alt) typing a character on the P key of some layouts is left alone.
    expect(isPreviewShortcut(k({ ctrlKey: true, altKey: true, key: '§' }), false)).toBe(false)
  })
})

describe('Toolbar › Fewer tools', () => {
  it('folds the toolbar to one row of everyday tools, remembered, and unfolds it again', async () => {
    useSettings.getState().set({ toolbarCollapsed: false })
    await renderPage()
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' })
    const toggle = screen.getByRole('button', { name: 'Fewer tools' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', toolbar.id)
    fireEvent.click(toggle)
    expect(useSettings.getState().toolbarCollapsed).toBe(true)
    expect(toolbar).toHaveClass('ed-toolbar-collapsed')
    // Book setup is what folds away (editor.css hides these); Preview Book stays.
    expect(toolbar.querySelector('.ed-group-format')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Preview Book' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More tools' }))
    expect(useSettings.getState().toolbarCollapsed).toBe(false)
    expect(toolbar).not.toHaveClass('ed-toolbar-collapsed')
  })
})

describe('Toolbar › Preview', () => {
  it('has a labelled Preview button with a tooltip naming the shortcut', async () => {
    await renderPage()
    const btn = screen.getByRole('button', { name: 'Preview Book' })
    expect(btn).toHaveAttribute('title', expect.stringMatching(/Book preview.*\((⌘⌥P|Ctrl\+Alt\+P)\)/))
    expect(btn).toHaveAttribute('aria-keyshortcuts')
    expect(btn.querySelector('svg')).not.toBeNull()
  })

  it('opens the book preview at the block holding the cursor', async () => {
    const user = userEvent.setup()
    const editor = await renderPage()
    // Put the cursor in "Second." (top-level block 3).
    let pos = 0
    editor.state.doc.forEach((_node, offset, i) => {
      if (i === 3) pos = offset + 2
    })
    act(() => void editor.commands.setTextSelection(pos))
    await user.click(screen.getByRole('button', { name: 'Preview Book' }))
    await screen.findByRole('dialog', { name: 'Book preview stub' })
    const props = previewProps.at(-1)!
    expect(props.docId).toBe(DOC.id)
    expect(props.initialBlock).toBe(3)
  })

  it('opens with Ctrl+Alt+P from inside the editor, and not twice', async () => {
    const editor = await renderPage()
    act(() => void editor.commands.focus('end'))
    fireEvent.keyDown(editor.view.dom, { key: 'p', code: 'KeyP', ctrlKey: true, altKey: true })
    await screen.findByRole('dialog', { name: 'Book preview stub' })
    expect(previewProps.at(-1)!.initialBlock).toBe(4)
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', ctrlKey: true, altKey: true })
    expect(screen.getAllByRole('dialog', { name: 'Book preview stub' })).toHaveLength(1)
  })

  it('does not open over another open dialog', async () => {
    await renderPage()
    const other = document.createElement('div')
    other.setAttribute('role', 'dialog')
    other.setAttribute('aria-modal', 'true')
    document.body.appendChild(other)
    try {
      fireEvent.keyDown(window, { key: 'p', code: 'KeyP', ctrlKey: true, altKey: true })
      fireEvent.keyDown(window, { key: 'π', code: 'KeyP', metaKey: true, altKey: true })
      await new Promise((r) => setTimeout(r, 10))
      expect(screen.queryByRole('dialog', { name: 'Book preview stub' })).toBeNull()
    } finally {
      other.remove()
    }
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', ctrlKey: true, altKey: true })
    fireEvent.keyDown(window, { key: 'π', code: 'KeyP', metaKey: true, altKey: true })
    await screen.findByRole('dialog', { name: 'Book preview stub' })
  })

  it('saves header/footer and book layout changes made in the preview to the manuscript, and marks it for Drive', async () => {
    const user = userEvent.setup()
    await renderPage()
    await user.click(screen.getByRole('button', { name: 'Preview Book' }))
    const dialog = await screen.findByRole('dialog', { name: 'Book preview stub' })
    useDocuments.setState({ dirtyForDrive: {} })
    await user.click(within(dialog).getByRole('button', { name: 'change heads' }))
    await user.click(within(dialog).getByRole('button', { name: 'change layout' }))
    const s = useDocuments.getState()
    expect(s.docs[DOC.id].format.headerFooter).toMatchObject({ authorName: 'Ada Lovelace', rectoHead: 'chapter' })
    expect(s.docs[DOC.id].format.bookLayout).toEqual({ chaptersStartRecto: false, justify: false, chapterSink: 0.2 })
    expect(s.dirtyForDrive[DOC.id]).toBe(true)
    // Reopening passes the saved settings back in.
    await user.click(within(dialog).getByRole('button', { name: 'close stub' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Book preview stub' })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Preview Book' }))
    await screen.findByRole('dialog', { name: 'Book preview stub' })
    expect(previewProps.at(-1)!.headerFooter).toMatchObject({ authorName: 'Ada Lovelace' })
    expect(previewProps.at(-1)!.layoutOptions).toMatchObject({ chaptersStartRecto: false })
  })

  it('saves the Paper & ink chosen in the preview to the manuscript, and passes it back in', async () => {
    const user = userEvent.setup()
    await renderPage()
    await user.click(screen.getByRole('button', { name: 'Preview Book' }))
    await screen.findByRole('dialog', { name: 'Book preview stub' })
    useDocuments.setState({ dirtyForDrive: {} })
    act(() => previewProps.at(-1)!.onPrintChange!({ paper: 'groundwood', ink: 'bw' }))
    expect(useDocuments.getState().docs[DOC.id].format.print).toEqual({ paper: 'groundwood', ink: 'bw' })
    expect(useDocuments.getState().dirtyForDrive[DOC.id]).toBe(true)
    await waitFor(() => expect(previewProps.at(-1)!.print).toEqual({ paper: 'groundwood', ink: 'bw' }))
  })
})

describe('Toolbar › Headers & footers…', () => {
  it('sits right after File, Export and Backups, in the same button style', async () => {
    await renderPage()
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' })
    const button = within(toolbar).getByRole('button', { name: 'Headers & footers…' })
    expect(button).toHaveClass('tw-btn')
    // The first group: the File menu (stubbed here; it brings Export and Backups), then this button.
    const first = toolbar.querySelector('.ed-group')!
    expect([...first.children]).toEqual([
      screen.getByTestId('filemenu'),
      button,
      within(toolbar).getByRole('button', { name: 'Focus Mode' }),
    ])
    expect(within(screen.getByRole('group', { name: 'Book format' })).queryByRole('button', { name: /Headers/ })).toBeNull()
  })

  it('opens the header/footer panel and saves each change', async () => {
    const user = userEvent.setup()
    await renderPage()
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' })
    await user.click(within(toolbar).getByRole('button', { name: 'Headers & footers…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Headers & footers' })
    useDocuments.setState({ dirtyForDrive: {} })
    await user.type(within(dialog).getByLabelText('Author name'), 'Jo')
    expect(useDocuments.getState().docs[DOC.id].format.headerFooter?.authorName).toBe('Jo')
    await user.selectOptions(within(dialog).getByLabelText('Page numbers'), 'footer-outside')
    expect(useDocuments.getState().docs[DOC.id].format.headerFooter?.pageNumbers).toBe('footer-outside')
    await user.click(within(dialog).getByLabelText('Justify text'))
    expect(useDocuments.getState().docs[DOC.id].format.bookLayout?.justify).toBe(false)
    expect(useDocuments.getState().dirtyForDrive[DOC.id]).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Headers & footers' })).toBeNull())
  })
})

describe('editor page sheets', () => {
  const hf = (over: Partial<HeaderFooterSettings> = {}) => ({ ...DEFAULT_HEADER_FOOTER, ...over })

  it('show the running head and page number the printed book has, alternating left and right pages', () => {
    const settings = hf({ authorName: 'Ada', pageNumbers: 'footer-outside' })
    const first = sheetFurniture(settings, 'The Storm', 0)
    expect(first.headerText).toBe('') // the first page opens the book
    expect(first.footer.right).toBe('1')
    const verso = sheetFurniture(settings, 'The Storm', 1)
    expect(verso.header.center).toBe('Ada')
    expect(verso.footer.left).toBe('2')
    const recto = sheetFurniture(settings, 'The Storm', 2)
    expect(recto.header.center).toBe('The Storm')
    expect(recto.footer.right).toBe('3')
    // A first page number of 2 makes the first sheet a left-hand page.
    expect(sheetFurniture(hf({ firstPageNumber: 2, pageNumbers: 'footer-outside' }), 'T', 0).footer.left).toBe('2')
  })

  it('know the chapter in effect and the chapter openings from the page breaks', () => {
    const blocks = [
      { kind: 'text' as const },
      { kind: 'chapter' as const, title: 'One' },
      { kind: 'text' as const },
      { kind: 'text' as const },
      { kind: 'chapter' as const, title: 'Two  Words' },
      { kind: 'text' as const },
    ]
    // Page 2 starts at chapter One, page 3 mid-paragraph in block 3, page 4 at chapter Two.
    const breaks = [
      { blockIndex: 1, lineIndex: 0 },
      { blockIndex: 3, lineIndex: 4 },
      { blockIndex: 4, lineIndex: 0 },
    ]
    expect(sheetsOf(blocks, breaks, 4)).toEqual([
      { chapterTitle: '', isChapterOpener: false },
      { chapterTitle: 'One', isChapterOpener: true },
      { chapterTitle: 'One', isChapterOpener: false },
      { chapterTitle: 'Two Words', isChapterOpener: true },
    ])
    const settings = hf({ rectoHead: 'chapter', versoHead: 'chapter' })
    const sheets = sheetsOf(blocks, breaks, 4)
    expect(sheetFurniture(settings, 'Book', 1, sheets[1]).headerText).toBe('') // opener
    expect(sheetFurniture(settings, 'Book', 2, sheets[2]).headerText).toBe('One')
    // A chapter that starts mid-page is in effect from that page on, but doesn't make it an opener.
    expect(sheetsOf([{ kind: 'text' }, { kind: 'chapter', title: 'A' }], [], 1)).toEqual([{ chapterTitle: 'A', isChapterOpener: false }])
  })

  it('start chapters only at a top-level Heading 1, not at one inside a quote or list', () => {
    const node = (textContent: string) => ({ textContent })
    const blocks = sheetBlocksOf([
      { kind: 'chapter', nested: false, node: node('One') },
      { kind: 'text', nested: false, node: node('x') },
      { kind: 'chapter', nested: true, node: node('Quoted') },
      { kind: 'text', nested: true, node: node('y') },
    ])
    expect(blocks).toEqual([{ kind: 'chapter', title: 'One' }, { kind: 'text' }, { kind: 'heading' }, { kind: 'text' }])
    // The quoted H1 starts page 2, but chapter One stays in effect and the sheet isn't an opener.
    expect(sheetsOf(blocks, [{ blockIndex: 2, lineIndex: 0 }], 2)).toEqual([
      { chapterTitle: 'One', isChapterOpener: true },
      { chapterTitle: 'One', isChapterOpener: false },
    ])
  })

  it('are drawn faintly in the margins, outside the editable text', async () => {
    useDocuments.getState().updateFormat(DOC.id, { headerFooter: { authorName: 'Ada Lovelace', footer: 'custom', footerCustom: 'ARC' } })
    await renderPage()
    const sheets = document.querySelector('.ed-sheets')!
    expect(sheets).toHaveAttribute('aria-hidden', 'true')
    const heads = [...sheets.querySelectorAll('.ed-head')].map((e) => e.textContent)
    expect(document.querySelector('.ed-prose')!.textContent).not.toContain('Ada Lovelace')
    // In jsdom there is one sheet (no layout): the book's first page carries no head, only its number and the footer line.
    expect(heads).toEqual([])
    expect(sheets.querySelector('.ed-folio')?.textContent).toContain('1')
    expect(sheets.querySelector('.ed-footnote')?.textContent).toBe('ARC')
  })
})

describe('chapterTitlesOf', () => {
  it('lists chapter headings as the preview reads them', () => {
    expect(chapterTitlesOf(DOC.content)).toEqual(['One', 'Two'])
    expect(chapterTitlesOf(null)).toEqual([])
  })
})

describe('Focus Mode', () => {
  afterEach(() => {
    delete (document as { startViewTransition?: unknown }).startViewTransition
  })

  it('shows only the manuscript, with Exit Focus Mode on top; Exit and Escape bring everything back', async () => {
    const user = userEvent.setup()
    await renderPage()
    const focusBtn = screen.getByRole('button', { name: 'Focus Mode' })
    expect(focusBtn).toHaveAttribute('aria-pressed', 'false')
    await user.click(focusBtn)
    const app = document.querySelector('.ed-app')!
    expect(app).toHaveClass('ed-focus')
    // The suggestions pane is gone (its engine pauses); the header and status bar are hidden.
    expect(screen.queryByTestId('pane')).toBeNull()
    expect(document.querySelector('.ed-main')).toBeInTheDocument()
    const exit = screen.getByRole('button', { name: 'Exit Focus Mode' })
    // Light or dark, still reachable in Focus Mode.
    expect(document.querySelector('.ed-focus-theme')?.querySelector('button')).toHaveAccessibleName(/^Theme: /)
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.ed-prose')))

    await user.click(exit)
    expect(app).not.toHaveClass('ed-focus')
    expect(screen.getByTestId('pane')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Exit Focus Mode' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Focus Mode' }))
    expect(app).toHaveClass('ed-focus')
    await user.keyboard('{Escape}')
    expect(app).not.toHaveClass('ed-focus')
  })

  it('Escape closes an open dialog first, not Focus Mode', async () => {
    const user = userEvent.setup()
    await renderPage()
    await user.click(screen.getByRole('button', { name: 'Focus Mode' }))
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    await user.keyboard('{Escape}')
    expect(document.querySelector('.ed-app')).toHaveClass('ed-focus')
    dialog.remove()
  })

  it('animates with a View Transition where the browser has one', async () => {
    const start = vi.fn((update: () => void) => {
      update()
      return { finished: Promise.resolve() }
    })
    ;(document as { startViewTransition?: unknown }).startViewTransition = start
    const user = userEvent.setup()
    await renderPage()
    await user.click(screen.getByRole('button', { name: 'Focus Mode' }))
    expect(start).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.ed-app')).toHaveClass('ed-focus')
  })

  it('is off again on the next visit to the writer page', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <MemoryRouter initialEntries={['/write']}>
        <WriterPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelector('.ed-prose')).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'Focus Mode' }))
    unmount()
    const { useFocusMode } = await import('./focusMode')
    expect(useFocusMode.getState().on).toBe(false)
  })
})
