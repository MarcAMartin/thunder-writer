import { describe, expect, it } from 'vitest'
import { anchorOfPages, pageOfAnchor } from './anchor'
import type { BookPageModel, Fragment } from './paginateBook'

const page = (index: number, frags: Omit<Fragment, 'y'>[], blank = false): BookPageModel => ({
  index,
  fragments: frags.map((f) => ({ ...f, y: 0 })),
  chapter: 0,
  isChapterOpener: false,
  isBlank: blank,
  depth: 0,
})

describe('text anchors', () => {
  // Block 1 splits across pages 0 and 1 at 100 px; page 2 is blank; block 3 on page 3.
  const pages = [
    page(0, [{ block: 0, clipTop: 0, clipBottom: 50 }, { block: 1, clipTop: 0, clipBottom: 100 }]),
    page(1, [{ block: 1, clipTop: 100, clipBottom: 180 }, { block: 2, clipTop: 0, clipBottom: 40 }]),
    page(2, [], true),
    page(3, [{ block: 3, clipTop: 0, clipBottom: 60 }]),
  ]

  it('is the first text of a view, or of the next page with text when the view is blank', () => {
    expect(anchorOfPages(pages, [1])).toEqual({ block: 1, offset: 100 })
    expect(anchorOfPages(pages, [2])).toEqual({ block: 3, offset: 0 })
    expect(anchorOfPages(pages, [])).toBeNull()
  })

  it('finds the page showing it, even when the pages broke differently', () => {
    expect(pageOfAnchor(pages, { block: 1, offset: 100 })).toBe(1)
    expect(pageOfAnchor(pages, { block: 1, offset: 20 })).toBe(0)
    expect(pageOfAnchor(pages, { block: 3, offset: 0 })).toBe(3)
    // Not laid out yet.
    expect(pageOfAnchor(pages.slice(0, 2), { block: 3, offset: 0 })).toBeNull()
  })
})
