import { describe, expect, it } from 'vitest'
import { fitScale, pageScale } from './PageView'

describe('pageScale', () => {
  it('is the fitted page at 100% and grows with the zoom', () => {
    expect(pageScale(1200, 600, 100)).toBe(1)
    expect(pageScale(1200, 600, 150)).toBe(1.5)
    expect(pageScale(1200, 600, 250)).toBe(2.5)
    // A narrow window fits the page first, then zooms from there.
    const fit = fitScale(500, 600)
    expect(fit).toBeLessThan(1)
    expect(pageScale(500, 600, 200)).toBeCloseTo(fit * 2)
  })

  it('keeps the zoom between 100% and 250%', () => {
    expect(pageScale(1200, 600, 50)).toBe(1)
    expect(pageScale(1200, 600, 400)).toBe(2.5)
    expect(pageScale(1200, 600, Number.NaN)).toBe(1)
  })
})
