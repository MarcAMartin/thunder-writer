/**
 * Pure page-break math. The page view measures every rendered leaf block (in
 * "natural" coordinates, i.e. with any page-gap spacers we inserted removed) and
 * asks this module where pages end. Keeping it pure makes it cheap to test and
 * guarantees the result is a function of layout only, so re-measuring after the
 * spacers render converges instead of oscillating.
 */

export type BlockKind = 'text' | 'heading' | 'chapter' | 'atom'

export interface MeasuredBlock {
  /** Top edge in natural px, relative to the top of the text column. */
  top: number
  height: number
  /** Line pitch in px (used to break paragraphs between lines). */
  lineHeight: number
  kind: BlockKind
}

export interface PaginateOptions {
  /** Usable text height per page in px. */
  contentHeight: number
  /**
   * Distance in rendered px between the content tops of consecutive sheets
   * (page height + visual gap between sheets). Used to size spacers.
   */
  pagePitch: number
  chapterStartsNewPage: boolean
  /** Avoid a single line of a paragraph stranded at the bottom/top of a page. Default true. */
  widowOrphanControl?: boolean
}

export interface PageBreak {
  /** Index into the measured blocks of the block where the new page begins. */
  blockIndex: number
  /** 0 = the new page begins before the block; n > 0 = it begins before line n of that block. */
  lineIndex: number
  /** Natural y where the new page begins. */
  y: number
  /** Line pitch of the broken block (for locating line `lineIndex` in the DOM). */
  linePitch: number
  /** Height of the spacer to insert at the break so the next line lands on the next sheet. */
  spacer: number
  /** 1-based number of the page that begins here. */
  pageNumber: number
  /** Why the page broke (for UI hints and tests). */
  reason: 'overflow' | 'chapter' | 'keep-with-next'
}

export interface Pagination {
  breaks: PageBreak[]
  pageCount: number
}

const EPS = 0.5

export function paginate(blocks: readonly MeasuredBlock[], opts: PaginateOptions): Pagination {
  const H = opts.contentHeight
  const widows = opts.widowOrphanControl ?? true
  const breaks: PageBreak[] = []
  if (!(H > 0) || blocks.length === 0) return { breaks, pageCount: 1 }

  let pageStart = blocks[0].top

  const addBreak = (blockIndex: number, lineIndex: number, y: number, linePitch: number, reason: PageBreak['reason']) => {
    const used = y - pageStart
    breaks.push({
      blockIndex,
      lineIndex,
      y,
      linePitch,
      spacer: Math.max(0, round1(opts.pagePitch - used)),
      pageNumber: breaks.length + 2,
      reason,
    })
    pageStart = y
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const pitchOf = (blk: MeasuredBlock) => {
      const L = blk.lineHeight > 0 ? blk.lineHeight : blk.height || 1
      const lines = Math.max(1, Math.round(blk.height / L))
      return { lines, pitch: blk.height / lines }
    }
    const atPageStart = () => b.top <= pageStart + EPS

    // Chapters open on a fresh page.
    if (opts.chapterStartsNewPage && b.kind === 'chapter' && !atPageStart()) {
      addBreak(i, 0, b.top, pitchOf(b).pitch, 'chapter')
    }

    // Keep headings with the first line of what follows.
    if ((b.kind === 'heading' || b.kind === 'chapter') && !atPageStart()) {
      const next = blocks[i + 1]
      const pageEnd = pageStart + H
      const headingFits = b.top + b.height <= pageEnd + EPS
      if (headingFits && next) {
        const firstLine = Math.min(next.height, next.lineHeight > 0 ? next.lineHeight : next.height)
        if (next.top + firstLine > pageEnd + EPS) addBreak(i, 0, b.top, pitchOf(b).pitch, 'keep-with-next')
      }
    }

    // Split the block across as many pages as it needs.
    const { lines, pitch } = pitchOf(b)
    let lineOffset = 0
    for (let guard = 0; guard < 10000; guard++) {
      const pageEnd = pageStart + H
      const bottom = b.top + b.height
      if (bottom <= pageEnd + EPS) break
      const segTop = b.top + lineOffset * pitch

      // Block starts past the end of the page (only whitespace separates it): break before it.
      if (lineOffset === 0 && b.top >= pageEnd - EPS && !atPageStart()) {
        addBreak(i, 0, b.top, pitch, 'overflow')
        continue
      }
      const breakable = b.kind === 'text' && lines > 1
      if (!breakable) {
        if (lineOffset === 0 && !atPageStart()) {
          addBreak(i, 0, b.top, pitch, 'overflow')
          continue
        }
        // Unbreakable block taller than a page, already at the top: let it overflow.
        break
      }

      // Lines of this block (from lineOffset) that fit on the current page.
      let fit = Math.floor((pageEnd - segTop) / pitch + 1e-6)
      const remainingLines = lines - lineOffset
      if (fit >= remainingLines) break
      if (widows && remainingLines - fit === 1 && fit >= 2) fit -= 1 // widow
      if (widows && lineOffset === 0 && fit === 1 && !atPageStart()) fit = 0 // orphan
      if (fit <= 0) {
        if (lineOffset === 0 && !atPageStart()) {
          addBreak(i, 0, b.top, pitch, 'overflow')
          continue
        }
        fit = 1 // page shorter than a line; make progress anyway
      }
      lineOffset += fit
      addBreak(i, lineOffset, b.top + lineOffset * pitch, pitch, 'overflow')
    }
  }

  return { breaks, pageCount: breaks.length + 1 }
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}

/** A vertical gap we inserted into the rendered layout (rendered coordinates). */
export interface Gap {
  top: number
  height: number
}

/**
 * Maps between rendered coordinates (with page-gap spacers) and natural ones
 * (as if no spacers existed). Gaps must not overlap.
 */
export function createGapMap(gaps: readonly Gap[]) {
  const sorted = [...gaps].filter((g) => g.height > 0).sort((a, b) => a.top - b.top)
  // Natural y at which each gap sits.
  let acc = 0
  const naturalAt = sorted.map((g) => {
    const n = g.top - acc
    acc += g.height
    return n
  })
  return {
    toNatural(rendered: number): number {
      let out = rendered
      for (const g of sorted) {
        if (rendered <= g.top) break
        out -= Math.min(g.height, rendered - g.top)
      }
      return out
    },
    toRendered(natural: number): number {
      let out = natural
      for (let i = 0; i < sorted.length; i++) {
        if (natural + 1e-6 < naturalAt[i]) break
        out += sorted[i].height
      }
      return out
    },
  }
}

/**
 * True when two sets of rendered breaks are equivalent: same positions and
 * kinds, and every *cumulative* spacer offset within `tolerance` px. Comparing
 * cumulative offsets (where each page actually starts) rather than individual
 * heights lets sub-pixel measurement noise be ignored without drift building up
 * across pages, and stops the measure -> render -> measure loop from flapping.
 */
export function sameBreaks(
  a: readonly { pos: number; inline: boolean; height: number }[],
  b: readonly { pos: number; inline: boolean; height: number }[],
  tolerance = 0.75,
): boolean {
  if (a.length !== b.length) return false
  let ca = 0
  let cb = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i].pos !== b[i].pos || a[i].inline !== b[i].inline) return false
    ca += a[i].height
    cb += b[i].height
    if (Math.abs(ca - cb) > tolerance) return false
  }
  return true
}
