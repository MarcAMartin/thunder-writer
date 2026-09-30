import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocuments } from '../../store/documents'
import type { ThunderDoc } from '../../types'
import { BookPreview } from './BookPreview'
import { clearLayoutCache } from './layout'
import { fakeMeasurer, manuscript } from './testing'

const DOC: ThunderDoc = {
  id: 'd1',
  title: 'The Frozen River',
  content: manuscript(4, 12, 5),
  format: { presetId: 'trade-6x9', chapterStartsNewPage: true },
  createdAt: 1,
  updatedAt: 2,
}

const env = { createMeasurer: fakeMeasurer() }

const realError = console.error
beforeEach(() => {
  // Layout slices and the page-turn fallback land on timers that waitFor awaits; hide only React's act() notice for them.
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return
    realError(...args)
  })
  clearLayoutCache()
  useDocuments.setState({ docs: { d1: DOC }, currentId: 'd1', hydrated: true })
})
afterEach(() => {
  vi.restoreAllMocks()
  useDocuments.setState({ docs: {}, currentId: null })
})

function Host(props: { onHf?: (v: unknown) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Preview
      </button>
      {open && <BookPreview docId="d1" onClose={() => setOpen(false)} layoutEnv={env} onHeaderFooterChange={props.onHf} />}
    </>
  )
}

async function openPreview(props: { onHf?: (v: unknown) => void } = {}) {
  const user = userEvent.setup()
  render(<Host {...props} />)
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  const dialog = await screen.findByRole('dialog', { name: 'Book preview: The Frozen River' })
  // Wait for the layout to finish.
  await waitFor(() => expect(within(dialog).getByText(/6 × 9 in · \d+ pages$/)).toBeInTheDocument())
  return { user, dialog }
}

const live = (dialog: HTMLElement) => dialog.querySelector('[aria-live="polite"]')!

describe('BookPreview', () => {
  it('opens as a modal dialog and focuses it', async () => {
    const { dialog } = await openPreview()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveFocus()
    // Page 1 alone on the right, with its chapter.
    expect(dialog.querySelector('.bp-scrub-label')).toHaveTextContent(/^Page 1 of \d+$/)
    expect(within(dialog).getByRole('button', { name: 'Previous spread' })).toBeDisabled()
    // Only the visible spread ±1 is mounted, never the whole book.
    expect(dialog.querySelectorAll('.bp-sheet:not(.bp-sheet-preload)').length).toBe(1)
    expect(dialog.querySelectorAll('.bp-page[data-page]').length).toBeLessThanOrEqual(6)
  })

  it('closes on Escape and gives focus back to the opener', async () => {
    const { user } = await openPreview()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveFocus()
  })

  it('closes with the close button', async () => {
    const { user, dialog } = await openPreview()
    await user.click(within(dialog).getByRole('button', { name: 'Close preview' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('traps focus inside the dialog', async () => {
    const { user, dialog } = await openPreview()
    const close = within(dialog).getByRole('button', { name: 'Close preview' })
    await user.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    // Shift+Tab from the first control wraps to the last one, and Tab from the last wraps to the first.
    const focusables = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select')]
    focusables[focusables.length - 1].focus()
    await user.tab()
    expect(focusables[0]).toHaveFocus()
    await user.tab({ shift: true })
    expect(focusables[focusables.length - 1]).toHaveFocus()
    expect(close).toBeInTheDocument()
  })

  it('turns pages with the keyboard and announces them', async () => {
    const { user, dialog } = await openPreview()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(live(dialog).textContent).toMatch(/^Pages 2–3 of \d+/))
    await user.keyboard('{PageDown}')
    await waitFor(() => expect(live(dialog).textContent).toMatch(/^Pages 4–5 of/))
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(live(dialog).textContent).toMatch(/^Pages 2–3 of/))
    await user.keyboard('{End}')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Next spread' })).toBeDisabled())
    await user.keyboard('{Home}')
    await waitFor(() => expect(live(dialog).textContent).toMatch(/^Page 1 of/))
  })

  it('turns pages with the buttons, and a queue of presses ends in the right place', async () => {
    const { user, dialog } = await openPreview()
    const next = within(dialog).getByRole('button', { name: 'Next spread' })
    await user.click(next)
    await user.click(next)
    await user.click(next)
    await waitFor(() => expect(live(dialog).textContent).toMatch(/^Pages 6–7 of/))
  })

  it('jumps to a chapter from the contents', async () => {
    const { user, dialog } = await openPreview()
    await user.click(within(dialog).getByRole('button', { name: 'Contents' }))
    const toc = within(dialog).getByRole('navigation', { name: 'Contents' })
    const items = within(toc).getAllByRole('button')
    expect(items).toHaveLength(4)
    await user.click(items[2])
    await waitFor(() => expect(live(dialog).textContent).toMatch(/Chapter 3$/))
    expect(items[2]).toHaveAttribute('aria-current', 'true')
  })

  it('goes to a typed page number', async () => {
    const { user, dialog } = await openPreview()
    await user.type(within(dialog).getByLabelText('Go to page'), '9{Enter}')
    await waitFor(() => expect(live(dialog).textContent).toMatch(/^Pages 8–9 of/))
  })

  it('scrubs with the slider without animating', async () => {
    const { dialog } = await openPreview()
    const slider = within(dialog).getByRole('slider', { name: 'Position in book' })
    fireEvent.change(slider, { target: { value: '3' } })
    expect(live(dialog).textContent).toMatch(/^Pages 6–7 of/)
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/^Pages 6–7 of \d+, Chapter \d$/))
    // Chapter ticks
    expect(dialog.querySelectorAll('.bp-tick')).toHaveLength(4)
  })

  it('shows every spread in the overview and jumps to the one picked', async () => {
    const { user, dialog } = await openPreview()
    await user.click(within(dialog).getByRole('button', { name: 'All pages' }))
    const thumbs = dialog.querySelectorAll('.bp-thumb')
    expect(thumbs.length).toBeGreaterThan(3)
    await user.click(within(dialog).getByRole('button', { name: /^Pages 4–5/ }))
    expect(dialog.querySelector('.bp-overview')).toBeNull()
    expect(live(dialog).textContent).toMatch(/^Pages 4–5 of/)
  })

  it('switches to single pages, keeping the page in view', async () => {
    const { user, dialog } = await openPreview()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(live(dialog).textContent).toMatch(/^Pages 2–3/))
    await user.click(within(dialog).getByRole('button', { name: 'Single page' }))
    expect(live(dialog).textContent).toMatch(/^Page 3 of/)
    expect(within(dialog).getByRole('button', { name: 'Next page' })).toBeEnabled()
  })

  it('edits headers and footers live and reports changes', async () => {
    const onHf = vi.fn()
    const { user, dialog } = await openPreview({ onHf })
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(live(dialog).textContent).toMatch(/^Pages 2–3/))
    // Page 2 (verso) shows the title until an author is set; page 3 (recto) the title.
    await waitFor(() => expect(dialog.querySelectorAll('.bp-head').length).toBeGreaterThan(0))
    await user.click(within(dialog).getByRole('button', { name: 'Headers & footers' }))
    const panel = within(dialog).getByRole('complementary', { name: 'Headers and footers' })
    await user.type(within(panel).getByLabelText('Author name'), 'Mara')
    expect(onHf).toHaveBeenLastCalledWith(expect.objectContaining({ authorName: 'Mara' }))
    expect(within(dialog.querySelector('.bp-verso')! as HTMLElement).getByText('Mara')).toBeInTheDocument()
    await user.selectOptions(within(panel).getByLabelText('Running heads'), 'none')
    expect(dialog.querySelectorAll('.bp-page .bp-head')).toHaveLength(0)
    expect(within(panel).getByRole('img', { name: /Spread diagram/ })).toBeInTheDocument()
  })

  it('Escape closes an open panel before the preview', async () => {
    const { user, dialog } = await openPreview()
    await user.click(within(dialog).getByRole('button', { name: 'Contents' }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(dialog).queryByRole('navigation', { name: 'Contents' })).toBeNull()
  })

  it('re-lays out when the text changes, but not when only header/footer settings are saved to the format', async () => {
    const calls = { chunks: [] as number[] }
    const counting = { createMeasurer: fakeMeasurer(60, calls) }
    const Persisting = () => (
      <BookPreview
        docId="d1"
        onClose={() => {}}
        layoutEnv={counting}
        onHeaderFooterChange={(hf) => useDocuments.getState().updateFormat('d1', { headerFooter: hf } as never)}
      />
    )
    const user = userEvent.setup()
    render(<Persisting />)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByText(/6 × 9 in · \d+ pages$/)).toBeInTheDocument())
    const measured = calls.chunks.length
    await user.click(within(dialog).getByRole('button', { name: 'Headers & footers' }))
    await user.type(within(dialog).getByLabelText('Author name'), 'Ann')
    expect(useDocuments.getState().docs.d1.updatedAt).toBeGreaterThan(DOC.updatedAt)
    expect(calls.chunks.length).toBe(measured)
    act(() => useDocuments.getState().updateContent('d1', manuscript(2, 3, 5)))
    await waitFor(() => expect(calls.chunks.length).toBeGreaterThan(measured))
    await waitFor(() => expect(within(dialog).getByText(/6 × 9 in · \d+ pages$/)).toBeInTheDocument())
  })

  it('says so when the document is gone', async () => {
    act(() => useDocuments.setState({ docs: {} }))
    render(<BookPreview docId="missing" onClose={() => {}} layoutEnv={env} />)
    expect(await screen.findByText('This manuscript is no longer available.')).toBeInTheDocument()
  })
})
