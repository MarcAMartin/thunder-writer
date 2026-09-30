import { describe, expect, it } from 'vitest'
import { buildViews, chapterAtPage, fractionOfView, pagesOfView, viewAtFraction, viewCount, viewLabel, viewOfPage, viewPages } from './spreads'

describe('buildViews (spreads)', () => {
  it('page 1 sits alone on the right; then verso/recto pairs', () => {
    expect(buildViews(5, true, 'spread').map((v) => [v.left, v.right])).toEqual([
      [null, 0],
      [1, 2],
      [3, 4],
    ])
  })

  it('an even page count ends with a verso alone on the left', () => {
    expect(buildViews(4, true, 'spread').map((v) => [v.left, v.right])).toEqual([
      [null, 0],
      [1, 2],
      [3, null],
    ])
  })

  it('a book starting on a verso (even first page number) pairs from the start', () => {
    expect(buildViews(3, false, 'spread').map((v) => [v.left, v.right])).toEqual([
      [0, 1],
      [2, null],
    ])
  })

  it('single mode: one page per view', () => {
    expect(buildViews(3, true, 'single').map((v) => [v.left, v.right])).toEqual([
      [null, 0],
      [null, 1],
      [null, 2],
    ])
  })

  it('single page and empty books', () => {
    expect(buildViews(1, true, 'spread').map((v) => [v.left, v.right])).toEqual([[null, 0]])
    expect(buildViews(0, true, 'spread')).toEqual([])
  })

  it('viewOfPage and viewCount agree with buildViews', () => {
    for (const first of [true, false]) {
      for (const mode of ['spread', 'single'] as const) {
        for (let n = 1; n <= 9; n++) {
          const views = buildViews(n, first, mode)
          expect(viewCount(n, first, mode)).toBe(views.length)
          for (let p = 0; p < n; p++) expect(pagesOfView(views[viewOfPage(p, n, first, mode)])).toContain(p)
        }
      }
    }
  })
})

describe('labels and mapping', () => {
  it('labels ranges', () => {
    expect(viewLabel([44, 45], 389)).toBe('Pages 44–45 of 389')
    expect(viewLabel([1], 389)).toBe('Page 1 of 389')
    expect(viewLabel([], 3)).toBe('')
    // Numbering from 2: 401 pages numbered 2–402, so the range is named rather than "of 402".
    expect(viewLabel([8, 9], 402, 2)).toBe('Pages 8–9 (2–402)')
    expect(viewPages([8, 9])).toBe('Pages 8–9')
  })

  it('finds the chapter running on a page', () => {
    const chapters = [
      { title: 'One', page: 0 },
      { title: 'Two', page: 12 },
      { title: 'Three', page: 30 },
    ]
    expect(chapterAtPage(chapters, 0)?.title).toBe('One')
    expect(chapterAtPage(chapters, 11)?.title).toBe('One')
    expect(chapterAtPage(chapters, 12)?.title).toBe('Two')
    expect(chapterAtPage(chapters, 400)?.title).toBe('Three')
    expect(chapterAtPage([{ title: 'Late', page: 3 }], 1)).toBeNull()
  })

  it('maps scrubber fractions to views and back', () => {
    expect(fractionOfView(0, 195)).toBe(0)
    expect(fractionOfView(194, 195)).toBe(1)
    expect(viewAtFraction(0.5, 195)).toBe(97)
    expect(viewAtFraction(-1, 195)).toBe(0)
    expect(viewAtFraction(2, 195)).toBe(194)
    for (let v = 0; v < 195; v += 7) expect(viewAtFraction(fractionOfView(v, 195), 195)).toBe(v)
    expect(viewAtFraction(0.7, 1)).toBe(0)
  })
})
