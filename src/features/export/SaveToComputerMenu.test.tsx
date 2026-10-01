import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('idb-keyval', () => ({
  createStore: () => 'store',
  get: async () => undefined,
  set: async () => undefined,
  del: async () => undefined,
}))

import { useDocuments } from '../../store/documents'
import { __resetDesktopCopyForTests, useDesktopCopy } from './desktopCopy'
import { DesktopCopyBadge } from './DesktopCopyControl'
import { useExportUi } from './exportUi'
import { SaveToComputerMenu } from './SaveToComputerMenu'
import { makeExportDoc, p, t } from './testFixtures'

type Win = { showSaveFilePicker?: unknown }

beforeEach(() => {
  __resetDesktopCopyForTests()
  useExportUi.setState({ toast: null, chooserOpen: false, chooserNote: null, chooserDismissed: false })
  const doc = makeExportDoc([p(t('It began.'))], { id: 'd1' })
  useDocuments.getState().hydrate([doc], doc.id)
})
afterEach(() => {
  delete (window as Win).showSaveFilePicker
  vi.restoreAllMocks()
})

describe('SaveToComputerMenu', () => {
  it('reads "Export to computer" with a single space (the button’s gap only sets off the caret)', () => {
    render(<SaveToComputerMenu />)
    const trigger = screen.getByRole('button', { name: 'Export to computer' })
    // The text is one inline run: "Export" and " to computer" are not separate flex items.
    const text = trigger.firstElementChild as HTMLElement
    expect(text.textContent).toBe('Export to computer')
    expect(text.nextElementSibling).toHaveTextContent('▾')
    expect(trigger.children).toHaveLength(2)
  })

  it('lists every format with Word first, and supports keyboard navigation', async () => {
    const user = userEvent.setup()
    render(<SaveToComputerMenu />)
    const trigger = screen.getByRole('button', { name: /Export to computer/ })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    await user.click(trigger)
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('Word document (.docx)Recommended'),
      expect.stringContaining('PDF (.pdf)'),
      expect.stringContaining('Markdown (.md)'),
      expect.stringContaining('Plain text (.txt)'),
      expect.stringContaining('Print-ready web page (.html)'),
      expect.stringContaining('Thunder Writer backup (.thunder.json)'),
      expect.stringContaining('Keep a copy on my computer'),
    ])
    expect(items[0]).toHaveFocus()
    expect(items[1]).toHaveAccessibleDescription(/Book Preview .*Save as PDF/)
    await user.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    await user.keyboard('{End}')
    expect(items[6]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(items[0]).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('PDF opens the Book Preview to print (the print dialog’s “Save as PDF” makes the file)', async () => {
    const { usePdfRequest } = await import('../preview/pdfRequest')
    const before = usePdfRequest.getState().seq
    const user = userEvent.setup()
    render(<SaveToComputerMenu />)
    await user.click(screen.getByRole('button', { name: 'Export to computer' }))
    await user.click(screen.getByRole('menuitem', { name: /^PDF \(\.pdf\)/ }))
    expect(usePdfRequest.getState().seq).toBe(before + 1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('saves a Word file through the native Save dialog', async () => {
    const writes: Blob[] = []
    const handle = {
      name: 'My Novel.docx',
      createWritable: async () => ({ write: async (b: Blob) => void writes.push(b), close: async () => undefined, abort: async () => undefined }),
    }
    const picker = vi.fn(async (_o: unknown) => handle)
    ;(window as Win).showSaveFilePicker = picker
    render(<SaveToComputerMenu />)
    fireEvent.click(screen.getByRole('button', { name: /Export to computer/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Word document/ }))
    expect(picker).toHaveBeenCalledTimes(1) // inside the click
    expect(picker.mock.calls[0][0]).toMatchObject({ suggestedName: 'My Novel.docx', startIn: 'desktop' })
    await waitFor(() => expect(useExportUi.getState().toast?.text).toBe('Saved “My Novel.docx” to your computer.'))
    expect(writes[0].type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  })

  it('opens the desktop copy dialog from the last item', () => {
    render(<SaveToComputerMenu />)
    fireEvent.click(screen.getByRole('button', { name: /Export to computer/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Keep a copy on my computer/ }))
    expect(useExportUi.getState().chooserOpen).toBe(true)
  })
})

describe('DesktopCopyBadge', () => {
  it('renders nothing without a copy, and the status when there is one', () => {
    const { container, rerender } = render(<DesktopCopyBadge />)
    expect(container).toBeEmptyDOMElement()
    useDesktopCopy.setState({
      byDoc: { d1: { kind: 'docx', fileName: 'My Novel.docx', phase: 'needs-permission', lastWrittenAt: 1, pending: false, error: null } },
    })
    rerender(<DesktopCopyBadge />)
    expect(screen.getByRole('button', { name: /needs permission\. Click to allow access and resume/ })).toHaveTextContent(
      'Resume copy: My Novel.docx',
    )
  })
})
