import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_HEADER_FOOTER, type HeaderFooterSettings } from './headerFooter'
import { HeaderFooterPanel } from './HeaderFooterPanel'

function Bound({ spy }: { spy: (v: HeaderFooterSettings) => void }) {
  const [v, setV] = useState(DEFAULT_HEADER_FOOTER)
  return (
    <HeaderFooterPanel
      value={v}
      title="The Frozen River"
      onChange={(n) => {
        setV(n)
        spy(n)
      }}
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
})
