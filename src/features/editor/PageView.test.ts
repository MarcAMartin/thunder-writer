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

describe('pageSnapshot (the turning leaf)', () => {
  it('copies just one page of text, from its page-break spacer to the next', async () => {
    const { pageSnapshot } = await import('./PageView')
    const root = document.createElement('div')
    root.innerHTML =
      '<h1>One</h1><p>first page</p>' +
      '<div class="ed-pb" data-page="2"></div><p>second <span class="ed-pb ed-pb-inline" data-page="3"></span>third page</p>' +
      '<p>still third</p>'
    expect(pageSnapshot(root, 0)).toBe('<h1>One</h1><p>first page</p>')
    expect(pageSnapshot(root, 1)).toBe('<p>second </p>')
    // Page 3 starts mid-paragraph: its first line continues the paragraph, without an indent.
    expect(pageSnapshot(root, 2)).toBe('<p class="ed-turn-cont">third page</p><p>still third</p>')
    expect(pageSnapshot(root, 5)).toBe('')
    expect(pageSnapshot(root, -1)).toBe('')
  })
})
