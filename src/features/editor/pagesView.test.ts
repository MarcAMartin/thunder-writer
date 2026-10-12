import { describe, expect, it } from 'vitest'
import { followPages, keptScrollTop } from './pagesView'

describe('followPages', () => {
  it('follows the top of the first page when the view was at the top', () => {
    // Entering Focus Mode at the top: the page starts lower (room for Exit Focus Mode) and grows.
    const before = { scale: 1.25, pageTop: 48, scrollTop: 0, clientHeight: 1100 }
    const after = { scale: 1.5, pageTop: 76, scrollTop: 0, clientHeight: 1300 }
    expect(followPages(before, after)).toEqual({ oldY: 48, newY: 76, ratio: 1.2 })
  })

  it('follows the line at the middle of the window otherwise', () => {
    const before = { scale: 1, pageTop: 48, scrollTop: 2000, clientHeight: 1000 }
    // That line is 2452 px into the pages; at 1.5× it is 3678, and this view put it 600 px down.
    const after = { scale: 1.5, pageTop: 76, scrollTop: 76 + 3678 - 600, clientHeight: 1200 }
    const { oldY, newY, ratio } = followPages(before, after)
    expect(oldY).toBe(500)
    expect(newY).toBeCloseTo(600)
    expect(ratio).toBe(1.5)
  })

  it('is a plain slide when the scale doesn’t change', () => {
    const v = { scale: 1, pageTop: 48, scrollTop: 0, clientHeight: 900 }
    expect(followPages(v, { ...v, pageTop: 76 })).toEqual({ oldY: 48, newY: 76, ratio: 1 })
  })
})

describe('keptScrollTop', () => {
  it('stays at the top if the view was there', () => {
    expect(keptScrollTop({ scale: 1, pageTop: 48, scrollTop: 0, clientHeight: 900 }, { scale: 1.4, pageTop: 76, clientHeight: 1200 })).toBe(0)
  })

  it('keeps the middle line in the middle, even when the window and the page top move too (Focus Mode)', () => {
    const before = { scale: 1.4, pageTop: 76, scrollTop: 1400, clientHeight: 1300 }
    const after = { scale: 1.25, pageTop: 48, clientHeight: 1100 }
    const top = keptScrollTop(before, after)
    // The same line, measured in each layout, sits at the middle of each window.
    const line = (before.scrollTop + before.clientHeight / 2 - before.pageTop) / before.scale
    expect(after.pageTop + line * after.scale - top).toBeCloseTo(after.clientHeight / 2)
    expect(followPages(before, { ...after, scrollTop: top }).newY).toBeCloseTo(after.clientHeight / 2)
  })
})
