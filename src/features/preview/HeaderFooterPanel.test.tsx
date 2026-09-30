import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_HEADER_FOOTER, type HeaderFooterSettings } from './headerFooter'
import { HeaderFooterPanel, type HeaderFooterPanelProps } from './HeaderFooterPanel'

function Bound({ spy, initial = DEFAULT_HEADER_FOOTER, ...rest }: { spy: (v: HeaderFooterSettings) => void; initial?: HeaderFooterSettings } & Partial<HeaderFooterPanelProps>) {
  const [v, setV] = useState(initial)
  return (
    <HeaderFooterPanel
      value={v}
      title="The Frozen River"
      onChange={(n) => {
        setV(n)
        spy(n)
      }}
      {...rest}
    />
  )
}

describe('HeaderFooterPanel', () => {
  it('is a labelled group of labelled controls', () => {
    render(<Bound spy={() => {}} />)
    expect(screen.getByRole('group', { name: 'Headers & footers' })).toBeInTheDocument()
    for (const name of ['Running heads', 'Left pages', 'Right pages', 'Author name', 'Page numbers', 'First page number', 'Footer line']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument()
    }
  })

  it('a running-head preset sets both sides', async () => {
    const spy = vi.fn()
    render(<Bound spy={spy} />)
    await userEvent.selectOptions(screen.getByLabelText('Running heads'), 'title-chapter')
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ versoHead: 'title', rectoHead: 'chapter' }))
    expect(screen.getByLabelText('Left pages')).toHaveValue('title')
    expect(screen.getByLabelText('Right pages')).toHaveValue('chapter')
  })

  it('custom text appears only for custom heads', async () => {
    const spy = vi.fn()
    render(<Bound spy={spy} />)
    expect(screen.queryByLabelText('Right page custom text')).toBeNull()
    await userEvent.selectOptions(screen.getByLabelText('Right pages'), 'custom')
    await userEvent.type(screen.getByLabelText('Right page custom text'), 'Hi')
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ rectoHead: 'custom', rectoCustom: 'Hi' }))
    expect(screen.getByLabelText('Running heads')).toHaveValue('custom')
  })

  it('updates the diagram description live', async () => {
    render(<Bound spy={() => {}} />)
    const img = () => screen.getByRole('img', { name: /Spread diagram/ })
    expect(img().getAttribute('aria-label')).toMatch(/Right page: running head “The Frozen River”, page number at the bottom centre/)
    await userEvent.selectOptions(screen.getByLabelText('Page numbers'), 'header-outside')
    expect(img().getAttribute('aria-label')).toMatch(/Right page: .*page number at the top right/)
    await userEvent.click(screen.getByRole('button', { name: 'Chapter opening' }))
    expect(img().getAttribute('aria-label')).toMatch(/Right page \(chapter opening\): no running head, page number at the bottom centre/)
  })

  it('toggles the options', async () => {
    const spy = vi.fn()
    render(<Bound spy={spy} />)
    await userEvent.click(screen.getByLabelText('Small capitals for running heads'))
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ smallCapsRunningHeads: false }))
    await userEvent.click(screen.getByLabelText('No running head on chapter opening pages'))
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ suppressOnChapterOpeners: false }))
    expect(screen.queryByLabelText('Page number on chapter openings')).toBeNull()
  })

  it('accepts only valid first page numbers', async () => {
    const spy = vi.fn()
    render(<Bound spy={spy} />)
    const input = screen.getByLabelText('First page number')
    await userEvent.clear(input)
    await userEvent.type(input, '7')
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ firstPageNumber: 7 }))
  })

  it('offers short running heads for chapter titles that are too long, and saves them by title', async () => {
    const spy = vi.fn()
    const long = 'A Very Long Chapter Title That Surely Will Not Fit'
    render(
      <Bound
        spy={spy}
        initial={{ ...DEFAULT_HEADER_FOOTER, rectoHead: 'chapter' }}
        chapterTitles={['One', long]}
        fit={{ verso: false, recto: false, footer: false, chapters: [long] }}
      />,
    )
    expect(screen.getByText(/One chapter title is too long/)).toBeInTheDocument()
    const input = screen.getByLabelText(`Short running head for “${long}”`)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await userEvent.type(input, 'Long')
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ shortHeads: { [long]: 'Long' } }))
    await userEvent.clear(input)
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ shortHeads: {} }))
  })

  it('warns when a head or the footer line is too long, and hides short heads when no head shows the chapter', () => {
    render(
      <Bound
        spy={() => {}}
        initial={{ ...DEFAULT_HEADER_FOOTER, footer: 'custom', footerCustom: 'x' }}
        chapterTitles={['One']}
        fit={{ verso: true, recto: false, footer: true, chapters: [] }}
      />,
    )
    expect(screen.getAllByRole('note')).toHaveLength(2)
    expect(screen.queryByText('Short running heads')).toBeNull()
  })

  it('the diagram squeezes a long head between the folios instead of printing over them', () => {
    render(<Bound spy={() => {}} initial={{ ...DEFAULT_HEADER_FOOTER, pageNumbers: 'header-outside' }} title="The Frozen River of the North" />)
    const heads = [...document.querySelectorAll('.bp-dg-head')]
    const head = heads.find((t) => t.textContent === 'The Frozen River of the North')!
    expect(head.getAttribute('textLength')).not.toBeNull()
    expect(Number(head.getAttribute('textLength'))).toBeLessThan(96 - 28 - 2 * 10)
  })
})
