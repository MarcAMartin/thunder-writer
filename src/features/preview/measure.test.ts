import { describe, expect, it } from 'vitest'
import { approximateLines, groupLines } from './measure'

describe('groupLines', () => {
  it('merges rects on the same line (e.g. an italic span) and orders lines', () => {
    const rects = [
      { top: 124, bottom: 142 }, // line 2
      { top: 100, bottom: 118 }, // line 1
      { top: 101, bottom: 117 }, // line 1, italic span
      { top: 148, bottom: 166 }, // line 3
    ]
    expect(groupLines(rects, 100)).toEqual([
      { top: 0, bottom: 18 },
      { top: 24, bottom: 42 },
      { top: 48, bottom: 66 },
    ])
  })

  it('keeps a taller inline run on its own line', () => {
    const rects = [
      { top: 0, bottom: 18 },
      { top: 20, bottom: 50 }, // big type
      { top: 30, bottom: 48 },
      { top: 56, bottom: 74 },
    ]
    expect(groupLines(rects)).toHaveLength(3)
  })

  it('handles no rects', () => {
    expect(groupLines([])).toEqual([])
  })
})

describe('approximateLines', () => {
  it('splits a height into whole lines', () => {
    expect(approximateLines(60, 20)).toEqual([
      { top: 0, bottom: 20, leaf: 0 },
      { top: 20, bottom: 40, leaf: 0 },
      { top: 40, bottom: 60, leaf: 0 },
    ])
    expect(approximateLines(0, 20)).toEqual([])
  })
})
