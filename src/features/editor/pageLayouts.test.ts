import { describe, expect, it } from 'vitest'
import { describeSpread, effectiveLayout, isLeftPage, layoutFitScale, pageAtPoint, pagesOfSpread, sheetPosition, spreadOffset, spreadOfPage, stackSize, visibleWidth } from './pageLayouts'

const g = { pageWidth: 600, pageHeight: 900, pitch: 928 }
/** Flip view of a book whose page 1 is a right-hand page. */
const book = { ...g, flipShift: 1 }

describe('page layouts', () => {
  it('places sheets in a column, two across, or in one long row', () => {
    expect([0, 1, 2].map((i) => sheetPosition('scroll', i, g))).toEqual([{ left: 0, top: 0 }, { left: 0, top: 928 }, { left: 0, top: 1856 }])
    expect([0, 1, 2, 3].map((i) => sheetPosition('spread', i, g))).toEqual([
      { left: 0, top: 0 },
      { left: 628, top: 0 },
      { left: 0, top: 928 },
      { left: 628, top: 928 },
    ])
    // The flip view's pages meet at the spine, and page 1 sits alone on the right like a book's.
    expect([0, 1, 2].map((i) => sheetPosition('flip', i, g))).toEqual([{ left: 0, top: 0 }, { left: 600, top: 0 }, { left: 1200, top: 0 }])
    expect([0, 1, 2].map((i) => sheetPosition('flip', i, book))).toEqual([{ left: 600, top: 0 }, { left: 1200, top: 0 }, { left: 1800, top: 0 }])
    expect([0, 1, 2].map((i) => isLeftPage(i, book))).toEqual([false, true, false])
  })

  it('sizes the stack for the sheets', () => {
    expect(stackSize('scroll', 3, g)).toEqual({ width: 600, height: 2756 })
    expect(stackSize('spread', 3, g)).toEqual({ width: 1228, height: 1828 })
    expect(stackSize('flip', 3, g)).toEqual({ width: 1800, height: 900 })
    expect(stackSize('flip', 3, book)).toEqual({ width: 2400, height: 900 })
    expect(visibleWidth('flip', g)).toBe(1200)
    expect(visibleWidth('spread', g)).toBe(1228)
  })

  it('fits the window: the width, and in the scroll and flip views a whole page top to bottom', () => {
    expect(layoutFitScale('scroll', { width: 1000, height: 800 }, g, 32)).toBe(1)
    expect(layoutFitScale('scroll', { width: 1000, height: 600 }, g, 32, { fitHeight: true })).toBeCloseTo(600 / 900)
    expect(layoutFitScale('spread', { width: 2000, height: 300 }, g, 32, { fitHeight: true })).toBe(1)
    expect(layoutFitScale('spread', { width: 1000, height: 800 }, g, 32)).toBeCloseTo((1000 - 64) / 1228)
    expect(layoutFitScale('flip', { width: 2000, height: 450 }, g, 32)).toBe(0.5)
    expect(layoutFitScale('scroll', { width: 300, height: 800 }, g, 32)).toBe(0.5)
  })

  it('finds the page under a point and the spread that shows it', () => {
    expect(pageAtPoint('spread', 700, 1000, 9, g)).toBe(3)
    expect(pageAtPoint('flip', 1300, 50, 9, g)).toBe(2)
    expect(pageAtPoint('flip', 1300, 50, 9, book)).toBe(1)
    expect(pageAtPoint('scroll', 10, 99999, 3, g)).toBe(2)
    expect(spreadOfPage(5)).toBe(2)
    expect(spreadOfPage(5, book)).toBe(3)
    expect(spreadOffset(2, g)).toBe(2400)
    expect(pagesOfSpread(0, 9, book)).toEqual([-1, 0])
    expect(pagesOfSpread(1, 9, book)).toEqual([1, 2])
    expect(pagesOfSpread(4, 9, book)).toEqual([7, 8])
    expect(pagesOfSpread(4, 8, book)).toEqual([7, -1])
    expect(describeSpread(0, 9)).toBe('Pages 1–2 of 9')
    expect(describeSpread(0, 9, book)).toBe('Page 1 of 9')
    expect(describeSpread(1, 9, book)).toBe('Pages 2–3 of 9')
    expect(describeSpread(4, 9)).toBe('Page 9 of 9')
    expect(describeSpread(0, 1)).toBe('1 page')
  })

  it('falls back to scrolling on phones, for unknown values, and for side by side without browser support', () => {
    expect(effectiveLayout('flip', { spreadSupported: true, narrow: true })).toBe('scroll')
    expect(effectiveLayout('spread', { spreadSupported: false, narrow: false })).toBe('scroll')
    expect(effectiveLayout('spread', { spreadSupported: true, narrow: false })).toBe('spread')
    expect(effectiveLayout('sideways', { spreadSupported: true, narrow: false })).toBe('scroll')
    expect(effectiveLayout('flip', { spreadSupported: false, narrow: false })).toBe('flip')
  })
})
