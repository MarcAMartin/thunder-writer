/**
 * Pure book pagination: measured top-level blocks in, typeset pages out.
 *
 * It follows the same rules as the editor's `paginate` (src/features/editor/
 * pagination.ts): chapters on a new page, headings kept with the first line
 * of what follows, paragraphs split between lines with at least two lines of
 * a paragraph on each page. It adds book-only rules: chapters open on a
 * right-hand page (a blank left page is inserted when needed), a chapter
 * sink, and a page model with fragments.
 *
 * Why not call `paginate` directly? It works on leaf blocks at absolute y
 * with a single line pitch per block, and returns spacer heights for the
 * editor's continuous scroll. Here each page is rendered on its own, so we
 * need, per page, which slice of which block to show. We also need real line
 * boxes (measured with Range.getClientRects), so a paragraph with a
 * larger inline font, or a list or blockquote with several paragraphs,
 * breaks exactly between rendered lines. The widow/orphan and keep-with-next
 * rules are the same, and a test checks that both paginators give the same
 * page count for uniform text.
 *
 * Streaming: blocks arrive in chunks (see layout.ts). `lines()` is only valid
 * while the block's chunk is mounted in the measuring container, so it is
 * called only for the block being placed and for the one block of lookahead
 * that keep-with-next needs.
 */

export type BookBlockKind = 'text' | 'heading' | 'chapter' | 'break' | 'container'

/** One rendered line, in px relative to the block's top edge. `leaf` = which paragraph inside the block. */
export interface LineBox {
  top: number
  bottom: number
  leaf: number
}

export interface MeasuredBookBlock {
  kind: BookBlockKind
  /** Border-box height in px (includes the block's own padding). */
  height: number
  /** Line boxes, top to bottom; they tile the block's content box. Called lazily. */
  lines: () => readonly LineBox[]
  /** Chapter title, for kind 'chapter'. */
  title?: string
  /** Padding above the heading text (part of `height`), used to size the chapter sink. */
  padTop?: number
}

/** A vertical slice of a block shown on a page. Coordinates in px. */
export interface Fragment {
  block: number
  /** Top of the slice on the page, relative to the top of the text area. */
  y: number
  /** Slice of the block, in the block's own coordinates. */
  clipTop: number
  clipBottom: number
}

export interface BookPageModel {
  /** 0-based position in the book. */
  index: number
  fragments: Fragment[]
  /** Index into `chapters` of the chapter in effect on this page (-1 before the first). */
  chapter: number
  isChapterOpener: boolean
  isBlank: boolean
}

export interface ChapterEntry {
  title: string
  block: number
  /** Page index where the chapter starts. */
  page: number
}

export interface BookPaginateOptions {
  /** Text-block height in px. */
  contentHeight: number
  chapterStartsNewPage: boolean
  /** Only meaningful with chapterStartsNewPage. */
  chaptersStartRecto: boolean
  /** Is page `index` a right-hand page? (Depends on the first page number.) */
  isRecto: (index: number) => boolean
  /** Heading top of a chapter opener sits this far down the text block (0 = no sink). */
  chapterSink: number
  widowOrphanControl?: boolean
}

const EPS = 0.5
const MIN_LINES = 2

export class BookPaginator {
  readonly pages: BookPageModel[] = []
  readonly chapters: ChapterEntry[] = []
  private page: BookPageModel
  private cursor = 0
  private blockCount = 0
  /** Headings waiting to see the first line of what follows (keep-with-next). */
  private pending: { index: number; block: MeasuredBookBlock }[] = []
  private finished = false

  constructor(private readonly opts: BookPaginateOptions) {
    this.page = this.newPage(0)
  }

  /** Number of blocks accepted so far. */
  get count(): number {
    return this.blockCount
  }

  push(block: MeasuredBookBlock): void {
    if (this.finished) throw new Error('BookPaginator: push after finish')
    const index = this.blockCount++
    if (block.kind === 'heading' || block.kind === 'chapter') {
      this.pending.push({ index, block })
      return
    }
    this.flushPending(block)
    this.place(index, block)
  }

  /** Places anything still pending and closes the last page. Returns all pages. */
  finish(): BookPageModel[] {
    if (!this.finished) {
      this.flushPending(null)
      this.finished = true
      if (this.page.fragments.length > 0 || this.pages.length === 0) this.pages.push(this.page)
    }
    return this.pages
  }

  private newPage(index: number): BookPageModel {
    return {
      index,
      fragments: [],
      chapter: this.chapters.length - 1,
      isChapterOpener: false,
      isBlank: false,
    }
  }

  private get pageEmpty() {
    return this.page.fragments.length === 0
  }

  private closePage() {
    this.pages.push(this.page)
    this.page = this.newPage(this.pages.length)
    this.cursor = 0
    this.chapterStartedHere = false
  }

  /** A chapter heading has been placed on the current page. */
  private chapterStartedHere = false

  private get H() {
    return this.opts.contentHeight
  }

  /** Puts the pending headings on the page, keeping them with the first line of `next`. */
  private flushPending(next: MeasuredBookBlock | null) {
    if (this.pending.length === 0) return
    const group = this.pending
    this.pending = []
    const first = group[0]
    if (first.block.kind === 'chapter') this.openChapterPage(first.block)

    if (!this.pageEmpty) {
      const groupHeight = group.reduce((h, g) => h + g.block.height, 0)
      let need = groupHeight
      if (next) need += firstLineBottom(next)
      if (this.cursor + need > this.H + EPS) {
        this.closePage()
      }
    }
    for (const g of group) {
      if (g !== first && g.block.kind === 'chapter') this.openChapterPage(g.block)
      this.place(g.index, g.block)
    }
  }

  /** A chapter heading starts a fresh page (and a right-hand one, if asked), with the sink. */
  private openChapterPage(block: MeasuredBookBlock) {
    if (!this.opts.chapterStartsNewPage) return
    if (!this.pageEmpty) this.closePage()
    if (this.opts.chaptersStartRecto && !this.opts.isRecto(this.page.index)) {
      this.page.isBlank = true
      this.closePage()
    }
    this.page.isChapterOpener = true
    const sink = Math.max(0, this.opts.chapterSink * this.H - (block.padTop ?? 0))
    // Never sink so far that the heading and a couple of lines no longer fit.
    this.cursor = Math.min(sink, Math.max(0, this.H - block.height - 48))
  }

  /** Records a chapter heading on the page it actually lands on. */
  private startChapter(index: number, block: MeasuredBookBlock) {
    const ch = this.chapters.length
    this.chapters.push({ title: block.title?.trim() || `Chapter ${ch + 1}`, block: index, page: this.page.index })
    // The chapter "in effect" on a page is the first one that starts on it, else the one running on from before.
    if (!this.chapterStartedHere) this.page.chapter = ch
    this.chapterStartedHere = true
    if (this.pageEmpty) this.page.isChapterOpener = true
  }

  private place(index: number, block: MeasuredBookBlock) {
    const breakable = block.kind === 'text' || block.kind === 'container'
    const remaining = this.H - this.cursor

    if (block.height <= remaining + EPS || !breakable) {
      // Unbreakable and it doesn't fit: next page (if taller than a page it overflows, as in the editor).
      if (block.height > remaining + EPS && !this.pageEmpty) this.closePage()
      if (block.kind === 'chapter') this.startChapter(index, block)
      this.addFragment(index, 0, block.height)
      return
    }

    const lines = block.lines()
    if (lines.length <= 1) {
      if (!this.pageEmpty) this.closePage()
      this.addFragment(index, 0, block.height)
      return
    }
    const widows = this.opts.widowOrphanControl ?? true
    const leafSpan = leafRanges(lines)

    let start = 0 // first line of the slice still to place
    for (let guard = 0; guard < 100000; guard++) {
      const clipTop = start === 0 ? 0 : lines[start].top
      const space = this.H - this.cursor
      // Everything left fits.
      if (block.height - clipTop <= space + EPS) {
        this.addFragment(index, clipTop, block.height)
        return
      }
      // Most lines that fit: slice [clipTop, lines[end-1].bottom].
      let end = start
      while (end < lines.length && lines[end].bottom - clipTop <= space + EPS) end++
      // Walk back to a legal break before line `end`.
      let brk = end
      while (brk > start && !(brk < lines.length && canBreak(lines, leafSpan, brk, widows))) brk--
      if (brk === start) {
        if (!this.pageEmpty) {
          this.closePage()
          continue
        }
        // Empty page and no legal break: take what fits (at least one line).
        brk = Math.max(start + 1, Math.min(end, lines.length - 1))
      }
      this.addFragment(index, clipTop, lines[brk].top)
      this.closePage()
      start = brk
    }
  }

  private addFragment(block: number, clipTop: number, clipBottom: number) {
    this.page.fragments.push({ block, y: round2(this.cursor), clipTop: round2(clipTop), clipBottom: round2(clipBottom) })
    this.cursor += clipBottom - clipTop
  }
}

function firstLineBottom(b: MeasuredBookBlock): number {
  if (b.kind !== 'text' && b.kind !== 'container') return b.height
  const lines = b.lines()
  return lines.length ? Math.min(b.height, lines[0].bottom) : b.height
}

/** For each line: [first line index, line count] of its leaf. */
function leafRanges(lines: readonly LineBox[]): { first: number; count: number }[] {
  const out: { first: number; count: number }[] = new Array(lines.length)
  let i = 0
  while (i < lines.length) {
    let j = i
    while (j < lines.length && lines[j].leaf === lines[i].leaf) j++
    const r = { first: i, count: j - i }
    for (let k = i; k < j; k++) out[k] = r
    i = j
  }
  return out
}

/** May a page break fall before line `k`? Between paragraphs: yes. Inside one: keep ≥2 lines on each side. */
function canBreak(lines: readonly LineBox[], spans: { first: number; count: number }[], k: number, widows: boolean): boolean {
  if (k <= 0 || k >= lines.length) return false
  if (lines[k - 1].leaf !== lines[k].leaf || !widows) return true
  const span = spans[k]
  const before = k - span.first
  const after = span.first + span.count - k
  return before >= MIN_LINES && after >= MIN_LINES
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Convenience for tests and small docs: paginate everything at once. */
export function paginateBook(blocks: readonly MeasuredBookBlock[], opts: BookPaginateOptions) {
  const p = new BookPaginator(opts)
  for (const b of blocks) p.push(b)
  const pages = p.finish()
  return { pages, chapters: p.chapters }
}
