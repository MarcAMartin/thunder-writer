import { describe, expect, it } from 'vitest'
import { paginate, type MeasuredBlock } from '../editor/pagination'
import { BookPaginator, paginateBook, type BookPaginateOptions, type MeasuredBookBlock } from './paginateBook'
import { chapter, heading, LINE, sceneBreak, synth, text } from './testing'

/** 10-line pages. */
const H = 10 * LINE
const opts = (p: Partial<BookPaginateOptions> = {}): BookPaginateOptions => ({
  contentHeight: H,
  chapterStartsNewPage: true,
  chaptersStartRecto: true,
  isRecto: (i) => i % 2 === 0,
  chapterSink: 0,
  ...p,
})

/** Lines per page for each page, from fragment heights. */
const linesPerPage = (pages: { fragments: { clipTop: number; clipBottom: number }[] }[]) =>
  pages.map((p) => p.fragments.reduce((n, f) => n + (f.clipBottom - f.clipTop) / LINE, 0))

describe('paginateBook: filling and splitting', () => {
  it('fills a page and splits a paragraph at a line boundary', () => {
    const { pages } = paginateBook([text(6), text(6)], opts())
    expect(pages).toHaveLength(2)
    expect(pages[0].fragments).toEqual([
      { block: 0, y: 0, clipTop: 0, clipBottom: 6 * LINE },
      { block: 1, y: 6 * LINE, clipTop: 0, clipBottom: 4 * LINE },
    ])
    expect(pages[1].fragments).toEqual([{ block: 1, y: 0, clipTop: 4 * LINE, clipBottom: 6 * LINE }])
  })

  it('avoids a widow: never one last line alone at the top of a page', () => {
    // 9 + 2 lines: 1 line of block 1 fits; a 1-line orphan is avoided too → block 1 moves whole.
    const { pages } = paginateBook([text(9), text(2)], opts())
    expect(linesPerPage(pages)).toEqual([9, 2])
    // 7 + 4: 3 would fit, leaving 1 → widow; break after 2 instead.
    const r = paginateBook([text(7), text(4)], opts())
    expect(r.pages[0].fragments[1]).toEqual({ block: 1, y: 7 * LINE, clipTop: 0, clipBottom: 2 * LINE })
    expect(linesPerPage(r.pages)).toEqual([9, 2])
  })

  it('avoids an orphan: never one first line alone at the bottom of a page', () => {
    const { pages } = paginateBook([text(9), text(5)], opts())
    expect(linesPerPage(pages)).toEqual([9, 5])
    expect(pages[1].fragments[0]).toMatchObject({ block: 1, clipTop: 0 })
  })

  it('can be switched off', () => {
    const { pages } = paginateBook([text(9), text(5)], opts({ widowOrphanControl: false }))
    expect(linesPerPage(pages)).toEqual([10, 4])
  })

  it('splits a very long paragraph across several pages', () => {
    const { pages } = paginateBook([text(35)], opts())
    expect(linesPerPage(pages)).toEqual([10, 10, 10, 5])
    expect(pages[3].fragments[0]).toEqual({ block: 0, y: 0, clipTop: 30 * LINE, clipBottom: 35 * LINE })
  })

  it('breaks lists/quotes between their paragraphs when a split would strand a line', () => {
    // Room for 5 quote lines (5px pad + 5×20 ≤ 120). Line 5 is the 2nd of the 3-line second paragraph:
    // breaking there leaves 2 above but 1 below (widow), breaking after its 1st line is an orphan, so
    // the break falls between the paragraphs, after line 3.
    const quote = synth('container', 12, { pad: 5, padBottom: 5, leaves: [3, 3, 6] })
    const { pages } = paginateBook([text(4), quote], opts())
    expect(pages[0].fragments[1]).toMatchObject({ block: 1, y: 4 * LINE, clipTop: 0, clipBottom: 5 + 3 * LINE })
    expect(pages[1].fragments[0]).toMatchObject({ block: 1, y: 0, clipTop: 5 + 3 * LINE, clipBottom: quote.height })
    // Each slice names the paragraphs it shows, so the renderer can empty the rest.
    expect(pages[0].fragments[1].leaves).toMatchObject({ from: 0, to: 0 })
    expect(pages[1].fragments[0].leaves).toMatchObject({ from: 1, to: 2 })
    expect(pages[1].fragments[0].leaves!.boxes).toEqual([
      { top: 5, bottom: 5 + 3 * LINE },
      { top: 5 + 3 * LINE, bottom: 5 + 6 * LINE },
      { top: 5 + 6 * LINE, bottom: 5 + 12 * LINE },
    ])
  })

  it('splits inside a list/quote paragraph with at least 2 lines on each side', () => {
    const quote = synth('container', 12, { pad: 5, padBottom: 5, leaves: [3, 6, 3] })
    const { pages } = paginateBook([text(4), quote], opts())
    expect(pages[0].fragments[1]).toMatchObject({ block: 1, y: 4 * LINE, clipTop: 0, clipBottom: 5 + 5 * LINE })
    expect(pages[1].fragments[0]).toMatchObject({ clipTop: 5 + 5 * LINE })
  })

  it('moves an unbreakable block that does not fit to the next page', () => {
    const { pages } = paginateBook([text(9), sceneBreak(), text(2)], opts())
    expect(pages[1].fragments[0]).toMatchObject({ block: 1, y: 0 })
  })

  it('lets a block taller than a page overflow on its own page rather than loop', () => {
    const tall = synth('break', 14)
    const { pages } = paginateBook([text(2), tall, text(2)], opts())
    expect(pages.map((p) => p.fragments.map((f) => f.block))).toEqual([[0], [1], [2]])
  })
})

describe('paginateBook: headings', () => {
  it('keeps a heading with the first line of the next paragraph', () => {
    // 8 lines used; heading (2 lines) fits exactly but the next line would not → heading moves.
    const { pages } = paginateBook([text(8), heading(), text(3)], opts({ chapterStartsNewPage: false }))
    expect(pages[0].fragments.map((f) => f.block)).toEqual([0])
    expect(pages[1].fragments.map((f) => f.block)).toEqual([1, 2])
  })

  it('keeps a run of headings together with what follows', () => {
    const { pages } = paginateBook([text(6), heading(), heading(), text(4)], opts({ chapterStartsNewPage: false }))
    expect(pages[0].fragments.map((f) => f.block)).toEqual([0])
    expect(pages[1].fragments.map((f) => f.block)).toEqual([1, 2, 3])
  })

  it('never leaves a heading alone at the foot of a page when the next paragraph cannot split after one line', () => {
    // 7 lines used, heading 2 lines: 1 line would fit after it, but a paragraph can't break after its first line.
    const { pages } = paginateBook([text(7), heading(), text(6)], opts({ chapterStartsNewPage: false }))
    expect(pages[0].fragments.map((f) => f.block)).toEqual([0])
    expect(pages[1].fragments.map((f) => f.block)).toEqual([1, 2])
    // With room for 2 lines after it, the heading stays and the paragraph splits 2 / 4.
    const r = paginateBook([text(6), heading(), text(6)], opts({ chapterStartsNewPage: false }))
    expect(r.pages[0].fragments.map((f) => [f.block, f.clipBottom])).toEqual([
      [0, 6 * LINE],
      [1, 2 * LINE],
      [2, 2 * LINE],
    ])
  })

  it('keeps a short paragraph whole with its heading', () => {
    // A 3-line paragraph can't split (1 + 2 or 2 + 1 strands a line), so heading + 3 lines must fit.
    const { pages } = paginateBook([text(6), heading(), text(3)], opts({ chapterStartsNewPage: false }))
    expect(pages[0].fragments.map((f) => f.block)).toEqual([0])
  })

  it('keeps a scene break with the next two lines, so no page ends on the ornament', () => {
    // 8 lines + a 2-line break fills the page exactly: the break moves over with the paragraph.
    const a = paginateBook([text(8), sceneBreak(), text(5)], opts())
    expect(a.pages[0].fragments.map((f) => f.block)).toEqual([0])
    expect(a.pages[1].fragments.map((f) => f.block)).toEqual([1, 2])
    // 6 lines + break + 2 lines fits: the break stays, with two lines after it.
    const b = paginateBook([text(6), sceneBreak(), text(5)], opts())
    expect(b.pages[0].fragments.map((f) => [f.block, f.clipBottom])).toEqual([
      [0, 6 * LINE],
      [1, 2 * LINE],
      [2, 2 * LINE],
    ])
  })

  it('a heading at the very end is still placed', () => {
    const { pages } = paginateBook([text(2), heading()], opts({ chapterStartsNewPage: false }))
    expect(pages[0].fragments.map((f) => f.block)).toEqual([0, 1])
  })
})

describe('paginateBook: chapters', () => {
  it('starts chapters on a new right-hand page, inserting a blank left page', () => {
    // Page 0 (recto): ch1 + text. Page 1 (verso) would be next → blank; ch2 on page 2.
    const { pages, chapters } = paginateBook([chapter('One'), text(4), chapter('Two'), text(4)], opts())
    expect(pages).toHaveLength(3)
    expect(pages[1]).toMatchObject({ isBlank: true, fragments: [] })
    expect(pages[2]).toMatchObject({ isChapterOpener: true, isBlank: false })
    expect(chapters.map((c) => [c.title, c.page])).toEqual([
      ['One', 0],
      ['Two', 2],
    ])
  })

  it('labels an empty chapter heading "Chapter N" for the contents, but gives running heads no title', () => {
    const { chapters } = paginateBook([chapter('One'), text(2), chapter('  '), text(2)], opts({ chaptersStartRecto: false }))
    expect(chapters.map((c) => [c.title, c.headTitle])).toEqual([
      ['One', 'One'],
      ['Chapter 2', ''],
    ])
  })

  it('needs no blank page when the chapter already falls on a recto', () => {
    const { pages } = paginateBook([chapter('One'), text(9), text(6), chapter('Two'), text(2)], opts())
    // ch1 (3 lines) + 7 lines on p0, the rest on p1 (verso), ch2 on p2 (recto).
    expect(pages.map((p) => p.isBlank)).toEqual([false, false, false])
    expect(pages[2].isChapterOpener).toBe(true)
  })

  it('with recto starts off, chapters start on the very next page', () => {
    const { pages } = paginateBook([chapter('One'), text(4), chapter('Two'), text(4)], opts({ chaptersStartRecto: false }))
    expect(pages).toHaveLength(2)
    expect(pages[1].isChapterOpener).toBe(true)
  })

  it('an even first page number makes page 0 a verso: the first chapter gets a blank verso first', () => {
    const { pages } = paginateBook([chapter('One'), text(2)], opts({ isRecto: (i) => i % 2 === 1 }))
    expect(pages[0].isBlank).toBe(true)
    expect(pages[1].isChapterOpener).toBe(true)
  })

  it('chapters flow on when chapterStartsNewPage is off, and the page takes the first chapter starting on it', () => {
    const { pages, chapters } = paginateBook([chapter('One'), text(2), chapter('Two'), text(2)], opts({ chapterStartsNewPage: false }))
    expect(pages).toHaveLength(1)
    expect(chapters.map((c) => c.page)).toEqual([0, 0])
    expect(pages[0].chapter).toBe(0)
  })

  it('sinks the chapter heading a third of the way down the text block', () => {
    const ch = chapter('One', 3 * LINE) // 2 lines of padding above the text
    const { pages } = paginateBook([ch, text(2)], opts({ chapterSink: 1 / 3, contentHeight: 30 * LINE }))
    // sink = 10 lines − 2 lines of the heading's own padding.
    expect(pages[0].fragments[0].y).toBe(8 * LINE)
  })

  it('the sink never pushes the heading and first lines off the page', () => {
    const ch = chapter('One', 8 * LINE)
    const { pages } = paginateBook([ch, text(1)], opts({ chapterSink: 0.6 }))
    const f = pages[0].fragments[0]
    expect(f.y + ch.height).toBeLessThanOrEqual(H)
    expect(pages[0].fragments.map((x) => x.block)).toEqual([0, 1])
  })

  it('tracks the chapter in effect on each page', () => {
    const { pages } = paginateBook([text(3), chapter('One'), text(25)], opts())
    expect(pages.map((p) => p.chapter)).toEqual([-1, -1, 0, 0, 0])
    expect(pages[1].isBlank).toBe(true)
  })
})

describe('paginateBook: baseline grid and spreads (linePitch)', () => {
  const grid = (p: Partial<BookPaginateOptions> = {}) => opts({ linePitch: LINE, ...p })
  /** Depth in lines of every page. */
  const depths = (pages: { depth: number }[]) => pages.map((p) => p.depth / LINE)

  it('snaps text after a heading back onto the line grid', () => {
    const odd = synth('heading', 1, { pad: 17 }) // 37 px: 1.85 lines
    const { pages } = paginateBook([text(3), odd, text(4)], grid({ chapterStartsNewPage: false }))
    const f = pages[0].fragments
    expect(f[1]).toMatchObject({ y: 3 * LINE, clipBottom: 37 })
    expect(f[2].y).toBe(5 * LINE) // not 3 × 20 + 37
  })

  it('balances a spread the widow rule left ragged: both pages end on the same line', () => {
    // Page 1 alone (recto), then spread 2–3. Without balancing, page 2 ends a line short (the widow rule
    // moves the 2nd line of a 3-line paragraph over) and page 3 is full.
    const blocks = [text(10), text(9), text(3), text(30)]
    const ragged = paginateBook(blocks, opts())
    expect(depths(ragged.pages).slice(1, 3)).toEqual([9, 10])
    const { pages } = paginateBook(blocks, grid())
    expect(pages[1].depth).toBe(pages[2].depth)
    expect(depths(pages).slice(1, 3)).toEqual([9, 9])
    // Nothing lost: every block's slices tile it.
    const total = pages.flatMap((p) => p.fragments).reduce((n, f) => n + f.clipBottom - f.clipTop, 0)
    expect(total).toBe(52 * LINE)
  })

  it('every spread of a long run of mixed paragraphs backs up exactly', () => {
    let seed = 3
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    const blocks: MeasuredBookBlock[] = []
    for (let i = 0; i < 400; i++) blocks.push(rnd() < 0.08 ? heading() : text(1 + Math.floor(rnd() * 8)))
    const { pages } = paginateBook(blocks, grid({ chapterStartsNewPage: false }))
    let checked = 0
    let ragged = 0
    for (let v = 1; v + 1 < pages.length - 1; v += 2) {
      checked++
      if (pages[v].depth !== pages[v + 1].depth) ragged++
    }
    expect(checked).toBeGreaterThan(50)
    // Balancing runs at most 2 lines short, so a rare spread may stay ragged; nearly all must match.
    expect(ragged / checked).toBeLessThan(0.05)
  })

  it('never leaves a chapter ending with a runt page of fewer than 5 lines', () => {
    // Chapter One: opener (3-line heading) on page 1 + 7 + 10 + 10 lines, then 2 lines on page 4.
    const blocks = [chapter('One'), text(7), text(10), text(10), text(2), chapter('Two'), text(4)]
    const plain = paginateBook(blocks, opts())
    expect(depths(plain.pages).slice(0, 4)).toEqual([10, 10, 10, 2])
    const { pages } = paginateBook(blocks, grid())
    const lastOfOne = pages.findIndex((p) => p.isChapterOpener && p.index > 0) - 1
    const end = pages[lastOfOne].isBlank ? pages[lastOfOne - 1] : pages[lastOfOne]
    expect(end.depth / LINE).toBeGreaterThanOrEqual(5)
    // The facing verso gave up the lines; the spread before it is untouched or balanced.
    expect(pages[1].depth).toBe(pages[2].depth)
  })

  it('pulls lines from the previous spread when the runt is on a left-hand page', () => {
    // Page 1 (recto) + spread 2–3 full, then 2 lines on page 4 (verso) before chapter Two.
    const blocks = [text(10), text(10), text(10), text(2), chapter('Two'), text(4)]
    const plain = paginateBook(blocks, opts())
    expect(depths(plain.pages).slice(0, 4)).toEqual([10, 10, 10, 2])
    const { pages } = paginateBook(blocks, grid())
    expect(depths(pages).slice(0, 4)).toEqual([10, 8, 8, 6])
  })

  it("drops a quote's space above at the top of a page and below at the foot of one", () => {
    const quote = () => synth('container', 3, { pad: LINE, padBottom: LINE }) // 1 line space + 3 lines + 1 line space
    // 6 lines + 3 quote lines fill the page once the space below is dropped.
    const a = paginateBook([text(6), quote(), text(4)], grid())
    expect(a.pages[0].fragments[1]).toMatchObject({ block: 1, clipTop: 0, clipBottom: 4 * LINE })
    expect(a.pages[0].depth).toBe(10 * LINE)
    expect(a.pages[1].fragments[0]).toMatchObject({ block: 2, y: 0 })
    // At the top of a page it starts with its first line, not a blank one.
    const b = paginateBook([text(10), quote(), text(4)], grid())
    expect(b.pages[1].fragments[0]).toMatchObject({ block: 1, y: 0, clipTop: LINE, clipBottom: 5 * LINE })
    expect(b.pages[1].fragments[1].y).toBe(4 * LINE)
  })

  it('may leave an orphan, as a last resort, to balance a spread', () => {
    // Spread 2–3: 4-line paragraphs can only split 2 | 2, so the only way to end both pages on one line
    // (within two lines of full) needs a paragraph's first line alone at the foot of page 2.
    const blocks = [text(10), text(3), text(3), text(3), text(4), text(4), text(4), text(30)]
    const strict = paginateBook(blocks, opts())
    expect(depths(strict.pages).slice(1, 3)).not.toEqual([10, 10])
    const { pages } = paginateBook(blocks, grid())
    expect(pages[1].depth).toBe(pages[2].depth)
  })

  it('can be switched off', () => {
    const blocks = [text(10), text(9), text(3), text(30)]
    const { pages } = paginateBook(blocks, grid({ balanceSpreads: false, minLastPageLines: 0 }))
    expect(depths(pages).slice(1, 3)).toEqual([9, 10])
  })

  it('streams the same pages as a batch run, committing a spread at a time', () => {
    const blocks = [chapter('One'), text(7), heading(), text(5), sceneBreak(), text(12), text(9), text(3), chapter('Two'), text(30), text(2)]
    const batch = paginateBook(blocks, grid()).pages
    const p = new BookPaginator(grid())
    const seen: number[] = []
    for (const b of blocks) {
      p.push(b)
      seen.push(p.pages.length)
    }
    expect(p.finish()).toEqual(batch)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })
})

describe('paginateBook: very long paragraphs', () => {
  it('records the text each page shows, cut at line starts, when the measurer can tell', () => {
    // 25 lines of 10 characters each.
    const long = { ...text(25), lineStart: (k: number) => k * 10 }
    const { pages } = paginateBook([long], opts())
    expect(pages.map((p) => p.fragments[0].text)).toEqual([
      { from: 0, to: 100, top: 0 },
      { from: 100, to: 200, top: 10 * LINE },
      { from: 200, to: null, top: 20 * LINE },
    ])
  })

  it('falls back to clipping the whole paragraph where a line start is unknown', () => {
    const long = { ...text(25), lineStart: (k: number) => (k === 20 ? undefined : k * 10) }
    const { pages } = paginateBook([long], opts())
    expect(pages[1].fragments[0].text).toBeUndefined()
    expect(pages[2].fragments[0].text).toBeUndefined()
  })
})

describe('BookPaginator streaming', () => {
  it('matches the batch result when blocks arrive one at a time', () => {
    const blocks = [chapter('One'), text(7), heading(), text(5), sceneBreak(), text(12), chapter('Two'), text(30)]
    const batch = paginateBook(blocks, opts()).pages
    const p = new BookPaginator(opts())
    const seen: number[] = []
    for (const b of blocks) {
      p.push(b)
      seen.push(p.pages.length)
    }
    expect(p.finish()).toEqual(batch)
    // Pages only ever complete, never change.
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  it('calls lines() only for blocks being placed (the measuring DOM is chunked)', () => {
    let calls = 0
    const counted = (b: MeasuredBookBlock): MeasuredBookBlock => ({ ...b, lines: () => (calls++, b.lines()) })
    paginateBook([text(3), text(3), text(3)].map(counted), opts())
    expect(calls).toBe(0) // everything fitted whole
  })

  it('an empty document is one blank-free page', () => {
    const { pages } = paginateBook([], opts())
    expect(pages).toHaveLength(1)
    expect(pages[0].fragments).toEqual([])
  })
})

describe('agreement with the editor paginator', () => {
  it('gives the same page count for plain paragraphs', () => {
    const counts = [3, 8, 1, 12, 5, 2, 9, 4, 4, 17, 6, 1, 1, 7, 3, 11, 2, 5]
    const book = paginateBook(counts.map(text), opts({ chapterStartsNewPage: false }))
    let top = 0
    const editorBlocks: MeasuredBlock[] = counts.map((n) => {
      const b = { top, height: n * LINE, lineHeight: LINE, kind: 'text' as const }
      top += n * LINE
      return b
    })
    const ed = paginate(editorBlocks, { contentHeight: H, pagePitch: H + 28, chapterStartsNewPage: false })
    expect(book.pages.length).toBe(ed.pageCount)
  })
})
