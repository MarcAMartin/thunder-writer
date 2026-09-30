import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { resolveFormat } from '../editor/presets'
import { BookPage } from './BookPage'
import { DEFAULT_BOOK_LAYOUT, DEFAULT_HEADER_FOOTER, type HeaderFooterSettings } from './headerFooter'
import { bookGeometry, type BookLayout } from './layout'
import type { BookPageModel } from './paginateBook'
import { buildRenderModel } from './renderModel'

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const format = resolveFormat({ presetId: 'trade-6x9', chapterStartsNewPage: true })
const model = buildRenderModel({
  type: 'doc',
  content: [
    p('A prologue before any chapter.'),
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'One' }] },
    { type: 'blockquote', content: ['q0', 'q1', 'q2', 'q3', 'q4'].map(p) },
    p('More text.'),
  ],
})
const pg = (index: number, fragments: BookPageModel['fragments'], extra: Partial<BookPageModel> = {}): BookPageModel => ({
  index,
  fragments,
  chapter: index === 0 ? -1 : 0,
  isChapterOpener: false,
  isBlank: false,
  depth: 0,
  ...extra,
})
const boxes = [0, 1, 2, 3, 4].map((i) => ({ top: 20 * i, bottom: 20 * i + 20 }))
const layout: BookLayout = {
  key: 'k',
  model,
  format,
  options: DEFAULT_BOOK_LAYOUT,
  geometry: bookGeometry(format),
  pages: [
    pg(0, [{ block: 0, y: 0, clipTop: 0, clipBottom: 20 }]),
    pg(1, [
      { block: 1, y: 200, clipTop: 0, clipBottom: 60 },
      { block: 2, y: 260, clipTop: 0, clipBottom: 40, leaves: { from: 0, to: 1, boxes } },
    ], { isChapterOpener: true }),
    pg(2, [
      { block: 2, y: 0, clipTop: 40, clipBottom: 100, leaves: { from: 2, to: 4, boxes } },
      { block: 3, y: 60, clipTop: 0, clipBottom: 20 },
    ]),
  ],
  chapters: [{ title: 'One', block: 1, page: 1 }],
  firstIsRecto: true,
  done: true,
  progress: 1,
  timings: { modelMs: 0, firstSpreadMs: 0, totalMs: 0 },
}
const S = (x: Partial<HeaderFooterSettings> = {}): HeaderFooterSettings => ({ ...DEFAULT_HEADER_FOOTER, authorName: 'Mara Vance', ...x })
const renderPage = (index: number, settings = S()) => render(<BookPage layout={layout} index={index} settings={settings} title="The Frozen River" />).container

describe('BookPage', () => {
  it('the first page opens the book: no running head even when a prologue comes before chapter one', () => {
    const c = renderPage(0)
    expect(c.querySelector('.bp-head')).toBeNull()
    expect(c.querySelector('.bp-foot')?.textContent).toBe('1')
    // An ordinary text page has one.
    expect(renderPage(2).querySelector('.bp-head')?.textContent).toContain('The Frozen River')
  })

  it('a slice of a long quote carries only its own paragraphs’ text; the others keep their height, empty', () => {
    const c = renderPage(2)
    const leaves = [...c.querySelectorAll<HTMLElement>('.bp-slice blockquote p')]
    expect(leaves).toHaveLength(5)
    expect(leaves.map((l) => l.textContent)).toEqual(['', '', 'q2', 'q3', 'q4'])
    expect(leaves[0].style.height).toBe('20px')
    expect(renderPage(1).querySelector('.bp-slice blockquote')?.textContent).toBe('q0q1')
  })

  it('puts the footer line on its own row when the page number has the centre', () => {
    const c = renderPage(2, S({ footer: 'custom', footerCustom: 'Advance reader copy, not for sale' }))
    expect(c.querySelector('.bp-foot .bp-slot-c')?.textContent).toBe('3')
    expect(c.querySelector('.bp-foot .bp-note')?.textContent).toBe('Advance reader copy, not for sale')
    // With the number in the corner, the line takes the centre.
    const d = renderPage(2, S({ footer: 'custom', footerCustom: 'ARC', pageNumbers: 'footer-outside' }))
    expect(d.querySelector('.bp-foot .bp-slot-c')?.textContent).toBe('ARC')
    expect(d.querySelector('.bp-foot .bp-note')).toBeNull()
  })

  it('sets only its own lines of a very long paragraph', () => {
    const long = buildRenderModel({ type: 'doc', content: [p('alpha bravo charlie delta echo foxtrot')] })
    const l: BookLayout = {
      ...layout,
      model: long,
      pages: [pg(0, [{ block: 0, y: 0, clipTop: 40, clipBottom: 80, text: { from: 12, to: 26, top: 40 } }], { chapter: -1 })],
      chapters: [],
    }
    const c = render(<BookPage layout={l} index={0} settings={S()} title="T" />).container
    const para = c.querySelector('.bp-slice p') as HTMLElement
    expect(para.textContent).toBe('charlie delta ')
    // Not the paragraph's first line (no indent), and its last line is a middle line (justified).
    expect(para).toHaveClass('bp-noindent', 'bp-cut-end')
    expect((c.querySelector('.bp-slice-in') as HTMLElement).style.top).toBe('0px')
  })

  it('never ends a head in an ellipsis', () => {
    const c = renderPage(2, S({ rectoHead: 'custom', rectoCustom: 'x'.repeat(150) }))
    expect(c.querySelector('.bp-head .bp-slot-c')?.textContent).toBe('x'.repeat(150))
    expect(c.querySelector('.bp-head')?.textContent).not.toContain('…')
  })
})
