import { describe, expect, it } from 'vitest'
import { createGapMap, sameBreaks, paginate, type MeasuredBlock } from './pagination'

const L = 20
/** Stack blocks top-to-bottom with no gaps; `lines` per text block. */
function stack(spec: (number | 'h1' | 'h2' | 'hr')[]): MeasuredBlock[] {
  let y = 0
  return spec.map((s) => {
    const b: MeasuredBlock =
      s === 'h1'
        ? { top: y, height: 60, lineHeight: 30, kind: 'chapter' }
        : s === 'h2'
          ? { top: y, height: 30, lineHeight: 30, kind: 'heading' }
          : s === 'hr'
            ? { top: y, height: 20, lineHeight: 20, kind: 'atom' }
            : { top: y, height: s * L, lineHeight: L, kind: 'text' }
    y += b.height
    return b
  })
}

const opts = { contentHeight: 200, pagePitch: 300, chapterStartsNewPage: true }

describe('paginate', () => {
  it('returns a single page when everything fits', () => {
    expect(paginate(stack([3, 3, 4]), opts)).toEqual({ breaks: [], pageCount: 1 })
    expect(paginate([], opts).pageCount).toBe(1)
  })

  it('breaks a paragraph between lines at the page boundary', () => {
    // 6 lines (120px) + 6 lines: second paragraph spans 120..240, page ends at 200 -> 4 lines fit.
    const { breaks, pageCount } = paginate(stack([6, 6]), opts)
    expect(pageCount).toBe(2)
    expect(breaks).toHaveLength(1)
    expect(breaks[0]).toMatchObject({ blockIndex: 1, lineIndex: 4, y: 200, pageNumber: 2, reason: 'overflow' })
    // A full page used -> spacer is exactly the non-content part of the pitch.
    expect(breaks[0].spacer).toBe(100)
  })

  it('splits a very long paragraph over several pages', () => {
    const { breaks, pageCount } = paginate(stack([25]), opts) // 500px -> 10 + 10 + 5 lines
    expect(pageCount).toBe(3)
    expect(breaks.map((b) => b.lineIndex)).toEqual([10, 20])
    expect(breaks.map((b) => b.y)).toEqual([200, 400])
  })

  it('snaps breaks to line boundaries when the page height is not a multiple of the line pitch', () => {
    const { breaks } = paginate(stack([15]), { ...opts, contentHeight: 210 })
    expect(breaks[0].lineIndex).toBe(10)
    expect(breaks[0].y).toBe(200)
    // Page used 200 of 210 -> spacer grows by the unused 10px.
    expect(breaks[0].spacer).toBe(100)
  })

  it('applies orphan control (no single first line at the bottom)', () => {
    // 9 lines = 180px, next paragraph of 4 lines: only 1 line would fit -> move whole paragraph.
    const { breaks } = paginate(stack([9, 4]), opts)
    expect(breaks[0]).toMatchObject({ blockIndex: 1, lineIndex: 0, y: 180 })
    expect(breaks[0].spacer).toBe(120)
  })

  it('applies widow control (no single last line at the top)', () => {
    // 7 lines, then 4 lines: 3 fit, 1 would be a widow -> 2 fit.
    const { breaks } = paginate(stack([7, 4]), opts)
    expect(breaks[0]).toMatchObject({ blockIndex: 1, lineIndex: 2, y: 180 })
    const off = paginate(stack([7, 4]), { ...opts, widowOrphanControl: false })
    expect(off.breaks[0]).toMatchObject({ blockIndex: 1, lineIndex: 3, y: 200 })
  })

  it('starts each chapter on a new page when enabled', () => {
    const blocks = stack(['h1', 2, 'h1', 2])
    const on = paginate(blocks, opts)
    expect(on.pageCount).toBe(2)
    expect(on.breaks[0]).toMatchObject({ blockIndex: 2, lineIndex: 0, y: 100, reason: 'chapter' })
    // Spacer fills the rest of page 1 (100px unused) plus the non-content part.
    expect(on.breaks[0].spacer).toBe(200)
    const off = paginate(blocks, { ...opts, chapterStartsNewPage: false })
    expect(off.pageCount).toBe(1)
  })

  it('does not insert a chapter break when the chapter is already at the top of a page', () => {
    const blocks = stack([10, 'h1', 2])
    const { breaks } = paginate(blocks, opts)
    expect(breaks).toHaveLength(1)
    expect(breaks[0]).toMatchObject({ blockIndex: 1, lineIndex: 0, y: 200 })
  })

  it('moves unbreakable blocks and headings whole, keeping headings with the next line', () => {
    // 9 lines (180) + h2 (30) straddles 200 -> moved.
    expect(paginate(stack([9, 'h2', 3]), opts).breaks[0]).toMatchObject({ blockIndex: 1, lineIndex: 0, reason: 'overflow' })
    // 8 lines (160) + h2 (160..190) fits, but next line (190..210) does not -> keep with next.
    expect(paginate(stack([8, 'h2', 3]), opts).breaks[0]).toMatchObject({
      blockIndex: 1,
      lineIndex: 0,
      reason: 'keep-with-next',
    })
    // An atom block straddling the page end moves whole.
    const withRule: MeasuredBlock[] = [...stack([9]), { top: 180, height: 40, lineHeight: 40, kind: 'atom' }]
    expect(paginate(withRule, opts).breaks[0]).toMatchObject({ blockIndex: 1, lineIndex: 0, y: 180 })
  })

  it('handles single-line paragraphs as unbreakable', () => {
    const blocks = stack(Array.from({ length: 12 }, () => 1)) // 12 x 20px
    const { breaks, pageCount } = paginate(blocks, opts)
    expect(pageCount).toBe(2)
    expect(breaks[0]).toMatchObject({ blockIndex: 10, lineIndex: 0, y: 200 })
  })

  it('lets an unbreakable block taller than a page overflow instead of looping', () => {
    const blocks: MeasuredBlock[] = [{ top: 0, height: 500, lineHeight: 500, kind: 'atom' }]
    expect(paginate(blocks, opts).pageCount).toBe(1)
  })

  it('breaks before a block separated from the page end by whitespace', () => {
    const blocks: MeasuredBlock[] = [
      { top: 0, height: 190, lineHeight: 190, kind: 'atom' },
      { top: 205, height: 40, lineHeight: L, kind: 'text' },
    ]
    const { breaks } = paginate(blocks, opts)
    expect(breaks[0]).toMatchObject({ blockIndex: 1, lineIndex: 0, y: 205, spacer: 95 })
  })

  it('is stable: the same input gives the same output', () => {
    const blocks = stack(['h1', 12, 7, 'h1', 30, 'h2', 4])
    expect(paginate(blocks, opts)).toEqual(paginate(blocks, opts))
  })
})

describe('createGapMap', () => {
  it('converts between rendered and natural coordinates', () => {
    const map = createGapMap([
      { top: 200, height: 100 },
      { top: 500, height: 50 },
    ])
    expect(map.toNatural(100)).toBe(100)
    expect(map.toNatural(300)).toBe(200)
    expect(map.toNatural(250)).toBe(200) // inside the gap clamps to its natural position
    expect(map.toNatural(600)).toBe(450)
    expect(map.toRendered(100)).toBe(100)
    expect(map.toRendered(200)).toBe(300)
    expect(map.toRendered(399)).toBe(499)
    expect(map.toRendered(400)).toBe(550)
    for (const n of [0, 150, 210, 390, 420, 800]) expect(map.toNatural(map.toRendered(n))).toBe(n)
  })

  it('is the identity with no gaps', () => {
    const map = createGapMap([])
    expect(map.toNatural(123)).toBe(123)
    expect(map.toRendered(123)).toBe(123)
  })

  it('round-trips pagination spacers', () => {
    const blocks = stack([6, 6, 'h1', 25])
    const { breaks } = paginate(blocks, opts)
    // Render: each break inserts its spacer at natural y.
    let acc = 0
    const gaps = breaks.map((b) => {
      const g = { top: b.y + acc, height: b.spacer }
      acc += b.spacer
      return g
    })
    const map = createGapMap(gaps)
    // Each page starts at k * pagePitch in rendered coordinates.
    breaks.forEach((b) => expect(map.toRendered(b.y)).toBeCloseTo((b.pageNumber - 1) * opts.pagePitch, 5))
  })
})

describe('sameBreaks', () => {
  const b = (pos: number, height: number, inline = true) => ({ pos, inline, height })
  it('ignores sub-pixel noise', () => {
    expect(sameBreaks([b(3, 100.2), b(9, 50)], [b(3, 99.9), b(9, 50.1)])).toBe(true)
  })
  it('detects changed positions, kinds and counts', () => {
    expect(sameBreaks([b(3, 100)], [b(4, 100)])).toBe(false)
    expect(sameBreaks([b(3, 100)], [b(3, 100, false)])).toBe(false)
    expect(sameBreaks([b(3, 100)], [])).toBe(false)
  })
  it('catches small errors that accumulate across pages', () => {
    const a = [b(1, 100), b(2, 100), b(3, 100)]
    const c = [b(1, 100.5), b(2, 100.5), b(3, 100.5)]
    expect(sameBreaks(a, c)).toBe(false)
  })
})
