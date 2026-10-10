import { describe, expect, it } from 'vitest'
import { describeSpread, effectiveLayout, layoutFitScale, pageAtPoint, sheetPosition, spreadOffset, spreadOfPage, stackSize, visibleWidth } from './pageLayouts'

const g = { pageWidth: 600, pageHeight: 900, pitch: 928 }

describe('page layouts', () => {
  it('places sheets in a column, two across, or in one long row', () => {
    expect([0, 1, 2].map((i) => sheetPosition('scroll', i, g))).toEqual([{ left: 0, top: 0 }, { left: 0, top: 928 }, { left: 0, top: 1856 }])
    expect([0, 1, 2, 3].map((i) => sheetPosition('spread', i, g))).toEqual([
      { left: 0, top: 0 },
      { left: 628, top: 0 },
      { left: 0, top: 928 },
      { left: 628, top: 928 },
    ])
    expect([0, 1, 2].map((i) => sheetPosition('flip', i, g))).toEqual([{ left: 0, top: 0 }, { left: 628, top: 0 }, { left: 1256, top: 0 }])
  })

  it('sizes the stack for the sheets', () => {
    expect(stackSize('scroll', 3, g)).toEqual({ width: 600, height: 2756 })
    expect(stackSize('spread', 3, g)).toEqual({ width: 1228, height: 1828 })
    expect(stackSize('flip', 3, g)).toEqual({ width: 1856, height: 900 })
    expect(visibleWidth('flip', g)).toBe(1228)
  })

  it('fits the window: the width, and in the flip view the height of a spread', () => {
    expect(layoutFitScale('scroll', { width: 1000, height: 800 }, g, 32)).toBe(1)
    expect(layoutFitScale('spread', { width: 1000, height: 800 }, g, 32)).toBeCloseTo((1000 - 64) / 1228)
    expect(layoutFitScale('flip', { width: 2000, height: 450 }, g, 32)).toBe(0.5)
    expect(layoutFitScale('scroll', { width: 300, height: 800 }, g, 32)).toBe(0.5)
  })

  it('finds the page under a point and the spread that shows it', () => {
    expect(pageAtPoint('spread', 700, 1000, 9, g)).toBe(3)
    expect(pageAtPoint('flip', 1300, 50, 9, g)).toBe(2)
    expect(pageAtPoint('scroll', 10, 99999, 3, g)).toBe(2)
    expect(spreadOfPage(5)).toBe(2)
    expect(spreadOffset(2, g)).toBe(2512)
    expect(describeSpread(0, 9)).toBe('Pages 1–2 of 9')
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
