import { describe, expect, it } from 'vitest'
import { approximateLines, findLineStarts, groupLines } from './measure'

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

describe('findLineStarts', () => {
  it('finds the first character of each line, across text runs (marks) and positions', () => {
    // Two runs: "aaaa bbbb " (pos 0) and "cccc dddd" (pos 11, after a hard break). 5 characters a line, 20 px lines.
    const runs = [
      { length: 10, pos: 0 },
      { length: 9, pos: 11 },
    ]
    const centre = (run: number, offset: number) => {
      const global = run === 0 ? offset : 10 + offset
      return Math.floor(global / 5) * 20 + 10
    }
    expect(findLineStarts(runs, [20, 40, 60], centre)).toEqual([5, 11, 16])
  })

  it('reports null where a boundary has no character after it, and skips characters without a box', () => {
    const runs = [{ length: 6, pos: 0 }]
    const centre = (_r: number, o: number) => (o === 3 ? null : o < 3 ? 10 : 30)
    expect(findLineStarts(runs, [20, 100], centre)).toEqual([3, null])
  })
})
