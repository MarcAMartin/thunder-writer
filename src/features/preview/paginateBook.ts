/**
 * Pure book pagination: measured top-level blocks in, typeset pages out.
 *
 * It follows the same rules as the editor's `paginate` (src/features/editor/
 * pagination.ts): chapters on a new page, headings kept with what follows,
 * paragraphs split between lines with at least two lines of a paragraph on
 * each page. It adds book-only rules:
 *
 * - chapters open on a right-hand page (a blank left page is inserted when needed), with a chapter sink;
 * - a heading or scene break is kept with the first *legal* slice of the next
 *   paragraph (two lines, or all of a short paragraph), so neither is left alone at the foot of a page;
 * - with `linePitch`, text after headings, breaks and sinks snaps back to the
 *   baseline grid, so lines on facing pages line up;
 * - facing pages end on the same line: the book is laid out one spread at a
 *   time, and a spread the widow/orphan rules left ragged is re-set one or two lines short on both pages;
 * - a chapter's last page carries at least `minLastPageLines` lines: lines are
 *   pulled forward from the facing verso, or the previous spread runs a line short.
 *
 * Why not call `paginate` directly? It works on leaf blocks at absolute y
 * with a single line pitch per block, and returns spacer heights for the
 * editor's continuous scroll. Here each page is rendered on its own, so we
 * need, per page, which slice of which block to show, and real line boxes
 * (measured with Range.getClientRects) so a list or blockquote with several
 * paragraphs breaks exactly between rendered lines. A test checks that both
 * paginators give the same page count for uniform text.
 *
 * Streaming: blocks arrive in chunks (see layout.ts). Pages are committed a
 * spread at a time, one spread behind the input (the runt rule may still
 * re-set the previous spread). A block's `lines()` is exact only while its chunk
 * is mounted in the measuring container, so layout.ts calls `retainLines()`
 * before mounting the next chunk, which reads the line boxes of every block
 * that may still be (re)placed.
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
  /**
   * Long paragraphs only: the content position of line `k`'s first character,
   * or undefined if it can't be told (any more). Exact only while the block is
   * mounted in the measurer, like `lines()`; see retainLines.
   */
  lineStart?: (k: number) => number | undefined
}

/** A vertical slice of a block shown on a page. Coordinates in px. */
export interface Fragment {
  block: number
  /** Top of the slice on the page, relative to the top of the text area. */
  y: number
  /** Slice of the block, in the block's own coordinates. */
  clipTop: number
  clipBottom: number
  /**
   * For a slice of a list or blockquote: the paragraphs inside it that the slice
   * shows, with every paragraph's extent in block coordinates. The renderer
   * empties the others (keeping their height), so a 300-paragraph quote doesn't
   * print all its text on every page it crosses.
   */
  leaves?: { from: number; to: number; boxes: readonly LeafBox[] }
  /**
   * For a slice of a very long paragraph: the text it shows, as paragraph
   * content positions [from, to) (to = null: to the end), cut at line starts,
   * and the block y where that text begins. The renderer sets just this text.
   */
  text?: { from: number; to: number | null; top: number }
}

export interface LeafBox {
  top: number
  bottom: number
}

export interface BookPageModel {
  /** 0-based position in the book. */
  index: number
  fragments: Fragment[]
  /** Index into `chapters` of the chapter in effect on this page (-1 before the first). */
  chapter: number
  isChapterOpener: boolean
  isBlank: boolean
  /** Where the text ends, in px from the top of the text block (the depth the page was set to). */
  depth: number
}

export interface ChapterEntry {
  /** Title for the contents list and page labels ("Chapter N" for an empty heading). */
  title: string
  /**
   * Title as running heads and short heads read it: the heading's text, '' when
   * it's empty (the head then falls back to the book title, as in Word, the
   * print file and the editor's page sheets).
   */
  headTitle: string
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
  /**
   * Body line pitch in px. Turns on the baseline grid, spread balancing and
   * the runt rule (all of which work in whole lines). Without it the
   * paginator fills each page independently, like the editor.
   */
  linePitch?: number
  /** Facing pages end on the same line (default: on when linePitch is set). */
  balanceSpreads?: boolean
  /** Fewest lines on a chapter's last page (default 5 when linePitch is set; 0 = off). */
  minLastPageLines?: number
  /**
   * How deep (px from the text-block top) a balanced spread may run when set a
   * line long. Default contentHeight: never long. layout.ts allows one line
   * into the bottom margin when it clears the page number.
   */
  maxDepth?: number
}

const EPS = 0.5
const MIN_LINES = 2
/** A spread may run this many lines short to balance… */
const NEAR_SHORT_LINES = 2
/** …or, as the very last resort, this many. */
const MAX_SHORT_LINES = 3
/** The verso facing a chapter's last page may give up at most this many lines to it. */
const MAX_VERSO_GIVE = 3

type Reason = 'full' | 'chapter' | 'blank' | 'end'

interface Pos {
  block: number
  /** First line of `block` still to place (0 = the whole block). */
  line: number
}

interface LaidPage {
  page: BookPageModel
  end: Pos
  reason: Reason
  chapters: ChapterEntry[]
}

/** Pages laid out together: a spread (verso + recto), or page 1 alone on the right. */
interface Unit {
  start: Pos
  firstPage: number
  chapterBase: number
  laid: LaidPage[]
}

/** Thrown when a layout step needs a block that hasn't arrived yet. */
const NEED_MORE: unique symbol = Symbol('need more blocks')

const isSticky = (b: MeasuredBookBlock) => b.kind === 'heading' || b.kind === 'chapter' || b.kind === 'break'
const endOf = (u: Unit) => u.laid[u.laid.length - 1].end
const round2 = (n: number) => Math.round(n * 100) / 100

export class BookPaginator {
  readonly pages: BookPageModel[] = []
  readonly chapters: ChapterEntry[] = []
  /** Blocks by index; released (undefined) once no page can be re-set over them. */
  private blocks: (MeasuredBookBlock | undefined)[] = []
  /** heightSum[i] = total height of blocks 0..i-1 (cheap "is there enough to fill a spread?" check). */
  private heightSum: number[] = [0]
  private lastNewPageChapter = -1
  private inputDone = false
  private finished = false
  /** Position after the committed pages. */
  private pos: Pos = { block: 0, line: 0 }
  /** Laid out but not yet committed: the runt rule may still re-set it. */
  private tentative: Unit | null = null
  private released = 0

  constructor(private readonly opts: BookPaginateOptions) {}

  /** Number of blocks accepted so far. */
  get count(): number {
    return this.blocks.length
  }

  private get L(): number {
    const l = this.opts.linePitch
    return l && l > 0 ? l : 0
  }
  private get balancing(): boolean {
    return this.L > 0 && this.opts.balanceSpreads !== false
  }
  private get minLast(): number {
    return this.L > 0 ? (this.opts.minLastPageLines ?? 5) : 0
  }

  push(block: MeasuredBookBlock): void {
    if (this.finished) throw new Error('BookPaginator: push after finish')
    const i = this.blocks.length
    this.blocks.push(block)
    this.heightSum.push(this.heightSum[i] + block.height)
    if (block.kind === 'chapter' && this.opts.chapterStartsNewPage) this.lastNewPageChapter = i
    this.pump()
  }

  /** Lays out everything still pending and closes the last page. Returns all pages. */
  finish(): BookPageModel[] {
    if (!this.finished) {
      this.inputDone = true
      this.pump()
      if (this.tentative) this.commit(this.tentative)
      this.tentative = null
      if (this.pages.length === 0) this.pages.push(this.blankModel(0, -1))
      this.finished = true
    }
    return this.pages
  }

  /**
   * Reads (and caches) the line boxes of every block that may still be placed
   * or re-set, while the current measuring chunk is mounted. Plain paragraphs
   * whose height is a whole number of lines are skipped: their evenly spaced
   * fallback lines are exact.
   */
  retainLines(): void {
    const L = this.L
    const from = this.tentative ? this.tentative.start.block : this.pos.block
    for (let i = from; i < this.blocks.length; i++) {
      const b = this.blocks[i]
      if (!b || (b.kind !== 'text' && b.kind !== 'container')) continue
      if (L && b.kind === 'text' && !b.lineStart) {
        const n = b.height / L
        if (Math.abs(n - Math.round(n)) < 0.02) continue
      }
      const lines = b.lines()
      // A long paragraph may still break before any line not yet placed: note where each starts.
      // (The pump leaves at most a few pages unplaced, so this stays small.)
      if (b.lineStart) {
        const first = i === from ? (this.tentative ? this.tentative.start.line : this.pos.line) : 0
        for (let k = Math.max(1, first); k < lines.length; k++) b.lineStart(k)
      }
    }
  }

  /* ------------------------------ driver ------------------------------ */

  private pump() {
    for (;;) {
      const prev = this.tentative
      const start = prev ? endOf(prev) : this.pos
      const firstPage = prev ? prev.firstPage + prev.laid.length : this.pages.length
      if (start.block >= this.blocks.length && this.inputDone) return
      if (!this.inputDone && !this.enoughFrom(start)) return
      const chapterBase = prev ? prev.chapterBase + chaptersIn(prev) : this.chapters.length
      let unit: Unit
      let before: Unit | null = prev
      try {
        unit = this.layUnit(start, firstPage, chapterBase)
        if (unit.laid.length === 0) return
        const shifted = this.fixBalance(prev, unit)
        before = shifted.prev
        unit = shifted.unit
        const fixed = this.fixRunt(before, unit)
        before = fixed.prev
        unit = fixed.unit
      } catch (e) {
        if (e === NEED_MORE) return
        throw e
      }
      if (before) this.commit(before)
      this.tentative = unit
    }
  }

  /** Is there (probably) enough input after `start` to lay out a whole spread? */
  private enoughFrom(start: Pos): boolean {
    if (this.lastNewPageChapter > start.block) return true
    const rest = this.heightSum[this.blocks.length] - this.heightSum[Math.min(start.block, this.blocks.length)]
    return rest > this.opts.contentHeight * 3
  }

  private commit(u: Unit) {
    for (const l of u.laid) {
      this.pages.push(l.page)
      for (const c of l.chapters) this.chapters.push(c)
    }
    this.pos = endOf(u)
    // Nothing before the committed position can be re-set any more.
    for (; this.released < this.pos.block; this.released++) this.blocks[this.released] = undefined
  }

  private block(i: number): MeasuredBookBlock | null {
    if (i < this.blocks.length) {
      const b = this.blocks[i]
      if (!b) throw new Error('BookPaginator: block released')
      return b
    }
    if (this.inputDone) return null
    throw NEED_MORE
  }

  private startsNewPage(b: MeasuredBookBlock) {
    return b.kind === 'chapter' && this.opts.chapterStartsNewPage
  }

  private snap(y: number): number {
    const L = this.L
    return L ? Math.ceil(y / L - 0.02) * L : y
  }
  private gridFloor(y: number): number {
    const L = this.L
    return L ? Math.floor(y / L + 0.02) * L : y
  }

  private blankModel(index: number, chapter: number): BookPageModel {
    return { index, fragments: [], chapter, isChapterOpener: false, isBlank: false, depth: 0 }
  }

  /* ------------------------------ spreads ------------------------------ */

  /**
   * `level` 0: balance only strictly, within two lines of full; 1: then also
   * with an orphan allowed; 2: then also three lines short.
   */
  private layUnit(start: Pos, firstPage: number, chapterBase: number, level = 0): Unit {
    const H = this.opts.contentHeight
    const n = this.opts.isRecto(firstPage) ? 1 : 2
    let laid = this.layPages(start, firstPage, chapterBase, new Array(n).fill(H))
    if (this.balancing && laid.length === 2 && isFullText(laid[0]) && isFullText(laid[1]) && !this.balanced(laid[0], laid[1])) {
      // Each depth a spread may be set to, with the recto set to match the verso's actual depth. An
      // orphan (a paragraph's first line alone at the foot of a page; widows are never allowed) is
      // accepted before a spread two lines short, and a ragged spread is the last resort.
      const L = this.L
      const tried = new Set<string>()
      for (const o of this.balanceOptions(level)) {
        const v = this.layPage(firstPage, start, o.T, chapterBase, o.orphans)
        const d = v.page.depth
        const key = `${Math.round(d / L)}${o.orphans}`
        if (!isFullText(v) || !this.depthOk(d, level >= 2) || tried.has(key)) continue
        tried.add(key)
        const r = this.layPage(firstPage + 1, v.end, d, chapterBase + v.chapters.length, o.orphans)
        if (isFullText(r) && this.balanced(v, r)) {
          laid = [v, r]
          break
        }
      }
    }
    return { start, firstPage, chapterBase, laid }
  }

  /**
   * Ways to set a ragged spread, best first: full depth, a line short, a line
   * long (if the margin allows), two lines short; from level 1 the same again
   * with an orphan allowed; from level 2, three lines short.
   */
  private balanceOptions(level: number): { T: number; orphans: boolean }[] {
    const L = this.L
    const full = this.gridFloor(this.opts.contentHeight)
    const near = [full, full - L]
    if (full + L <= this.maxDepth + EPS) near.push(full + L)
    for (let k = 2; k <= NEAR_SHORT_LINES; k++) near.push(full - k * L)
    const far: number[] = []
    for (let k = NEAR_SHORT_LINES + 1; k <= MAX_SHORT_LINES; k++) far.push(full - k * L)
    const out: { T: number; orphans: boolean }[] = near.map((T) => ({ T, orphans: false }))
    if (level >= 1) for (const T of near) out.push({ T, orphans: true })
    if (level >= 2) for (const T of far) out.push({ T, orphans: false }, { T, orphans: true })
    return out.filter((o) => o.T > L)
  }

  private get maxDepth() {
    return Math.max(this.opts.contentHeight, this.opts.maxDepth ?? 0)
  }

  private depthOk(d: number, far = false) {
    const full = this.gridFloor(this.opts.contentHeight)
    return full - d <= (far ? MAX_SHORT_LINES : NEAR_SHORT_LINES) * this.L + EPS && d <= this.maxDepth + EPS
  }

  private needsBalance(u: Unit) {
    const l = u.laid
    return this.balancing && l.length === 2 && isFullText(l[0]) && isFullText(l[1]) && !this.balanced(l[0], l[1])
  }

  /**
   * A spread that can't be balanced on its own (a short paragraph that may not
   * split pins both breaks) usually can once the text arrives a line or two
   * earlier: re-set the previous spread one or two lines short, still balanced.
   */
  private fixBalance(prev: Unit | null, u: Unit): { prev: Unit | null; unit: Unit } {
    if (!this.needsBalance(u)) return { prev, unit: u }
    const prevOk = !!prev && prev.laid.every(isFullText)
    const shift = (level: number) => {
      if (!prev || !prevOk) return null
      for (const k of [1, -1, 2]) {
        const p2 = this.shorten(prev, k)
        if (!p2) continue
        const u2 = this.layUnit(endOf(p2), u.firstPage, p2.chapterBase + chaptersIn(p2), level)
        if (u2.laid.length === u.laid.length && !this.needsBalance(u2)) return { prev: p2, unit: u2 }
      }
      return null
    }
    const here = (level: number) => {
      const u2 = this.layUnit(u.start, u.firstPage, u.chapterBase, level)
      return this.needsBalance(u2) ? null : { prev, unit: u2 }
    }
    // Strict first (move the previous spread), then allow an orphan, then three lines short.
    return shift(0) ?? here(1) ?? shift(1) ?? here(2) ?? shift(2) ?? { prev, unit: u }
  }

  /** `u` re-set `k` lines shorter (negative: longer) than its shorter page, on every page; null if that breaks it or its balance. */
  private shorten(u: Unit, k: number): Unit | null {
    const L = this.L
    const T = this.gridFloor(Math.min(...u.laid.map((l) => l.page.depth))) - k * L
    if (T <= L || !this.depthOk(T)) return null
    const laid = this.layPages(u.start, u.firstPage, u.chapterBase, u.laid.map(() => T))
    if (laid.length !== u.laid.length || !laid.every(isFullText)) return null
    // Still balanced, and no page ends up shorter (or longer) than a spread may run.
    if (laid.some((l) => !this.depthOk(l.page.depth))) return null
    if (laid.length === 2 && !this.balanced(laid[0], laid[1])) return null
    return { ...u, laid }
  }

  private balanced(a: LaidPage, b: LaidPage) {
    return Math.abs(a.page.depth - b.page.depth) < this.L / 2
  }

  /** Lays consecutive pages with the given depth limits; stops at the end of the input. */
  private layPages(start: Pos, firstPage: number, chapterBase: number, limits: number[]): LaidPage[] {
    const out: LaidPage[] = []
    let pos = start
    let base = chapterBase
    for (let k = 0; k < limits.length; k++) {
      const index = firstPage + k
      const l = this.layPage(index, pos, limits[k], base)
      // Content ended exactly at the foot of the previous page: no empty page after it.
      if (l.reason === 'end' && l.page.fragments.length === 0 && index > 0) break
      out.push(l)
      base += l.chapters.length
      pos = l.end
      if (l.reason === 'end') break
    }
    return out
  }

  /**
   * The runt rule: a chapter's last page should carry at least `minLastPageLines`
   * lines. Lines come from the facing verso (which may run up to 3 lines short;
   * it faces a part-page anyway) or from the previous spread, re-set one or two
   * lines short on both pages. The cheapest fix that works wins.
   */
  private fixRunt(prev: Unit | null, u: Unit): { prev: Unit | null; unit: Unit } {
    const min = this.minLast
    const L = this.L
    const none = { prev, unit: u }
    if (!min || !L) return none
    const fi = u.laid.findIndex((l) => (l.reason === 'chapter' || l.reason === 'end') && !l.page.isBlank && l.page.fragments.length > 0)
    if (fi < 0) return none
    const f = u.laid[fi]
    if (f.page.isChapterOpener || this.lines(f) >= min) return none
    // Pages before f in this unit must be text running into it.
    if (u.laid.slice(0, fi).some((l) => !isFullText(l))) return none

    const canV = fi === 1
    const canP = !!prev && prev.laid.every(isFullText)
    const plans: { pd: number; vd: number }[] = []
    for (let pd = 0; pd <= (canP ? NEAR_SHORT_LINES : 0); pd++)
      for (let vd = 0; vd <= (canV ? MAX_VERSO_GIVE : 0); vd++) if (pd || vd) plans.push({ pd, vd })
    // Cheapest first; for a tie, prefer shortening a whole spread by a line over one page by two.
    plans.sort((a, b) => a.pd * 2 + a.vd - (b.pd * 2 + b.vd) || b.pd - a.pd)

    const H = this.opts.contentHeight
    for (const { pd, vd } of plans) {
      let p2 = prev
      if (pd && prev) {
        p2 = this.shorten(prev, pd)
        if (!p2) continue
      }
      const start = p2 ? endOf(p2) : u.start
      const chapterBase = p2 ? p2.chapterBase + chaptersIn(p2) : u.chapterBase
      const limits = u.laid.map(() => H)
      if (vd) limits[0] = this.gridFloor(u.laid[0].page.depth) - vd * L
      const laid = this.layPages(start, u.firstPage, chapterBase, limits)
      if (laid.length !== u.laid.length) continue
      if (laid.some((l, i) => l.reason !== u.laid[i].reason)) continue
      if (this.lines(laid[fi]) < min) continue
      if (vd && this.gridFloor(u.laid[0].page.depth) - laid[0].page.depth > MAX_VERSO_GIVE * L + EPS) continue
      return { prev: p2, unit: { start, firstPage: u.firstPage, chapterBase, laid } }
    }
    return none
  }

  private lines(l: LaidPage) {
    return Math.round(l.page.depth / this.L)
  }

  /* ------------------------------ one page ------------------------------ */

  /** `orphans`: a paragraph may leave just its first line at the foot of the page (spread balancing only). */
  private layPage(index: number, start: Pos, limit: number, chapterBase: number, orphans = false): LaidPage {
    const o = this.opts
    const H = o.contentHeight
    const widows = o.widowOrphanControl ?? true
    const page = this.blankModel(index, chapterBase - 1)
    const chapters: ChapterEntry[] = []
    let cursor = 0
    let pos = start
    let startedHere = false
    const empty = () => page.fragments.length === 0
    /** Blank space at the end of the last fragment (a quote's space below): not text depth. */
    let trail = 0
    const add = (block: number, clipTop: number, clipBottom: number, leaves?: Fragment['leaves'], trailing = 0) => {
      const f: Fragment = { block, y: round2(cursor), clipTop: round2(clipTop), clipBottom: round2(clipBottom) }
      if (leaves) f.leaves = leaves
      page.fragments.push(f)
      cursor += clipBottom - clipTop
      trail = trailing
    }
    const setText = (t: Fragment['text']) => {
      if (t) page.fragments[page.fragments.length - 1].text = t
    }
    const done = (reason: Reason): LaidPage => {
      page.depth = round2(cursor - trail)
      return { page, end: pos, reason, chapters }
    }

    for (;;) {
      const b = this.block(pos.block)
      if (!b) return done('end')

      if (isSticky(b)) {
        // A run of headings / breaks, kept with the first legal slice of what follows.
        const group: number[] = [pos.block]
        let j = pos.block + 1
        for (;;) {
          const g = this.block(j)
          if (!g || !isSticky(g) || this.startsNewPage(g)) break
          group.push(j++)
        }
        if (this.startsNewPage(b)) {
          if (!empty()) return done('chapter')
          if (o.chaptersStartRecto && !o.isRecto(index)) {
            page.isBlank = true
            return done('blank')
          }
          page.isChapterOpener = true
          const sink = Math.max(0, o.chapterSink * H - (b.padTop ?? 0))
          // Never sink so far that the heading and a couple of lines no longer fit.
          cursor = Math.min(sink, Math.max(0, H - b.height - 48))
        }
        const next = this.block(j)
        const follow = next && !this.startsNewPage(next) ? next : null
        let need = 0
        for (const gi of group) need += this.block(gi)!.height
        if (follow) need = this.snap(cursor + need) - cursor + firstSliceBottom(follow, widows)
        if (!empty() && cursor + need > limit + EPS) return done('full')
        for (const gi of group) {
          const g = this.block(gi)!
          if (g.kind === 'chapter') {
            const ci = chapterBase + chapters.length
            const headTitle = g.title?.trim() ?? ''
            chapters.push({ title: headTitle || `Chapter ${ci + 1}`, headTitle, block: gi, page: index })
            // The chapter "in effect" on a page is the first one that starts on it, else the one running on from before.
            if (!startedHere) page.chapter = ci
            startedHere = true
            if (empty()) page.isChapterOpener = true
          }
          add(gi, 0, g.height)
        }
        cursor = this.snap(cursor)
        pos = { block: j, line: 0 }
        continue
      }

      // A paragraph, list or quote: whole if it fits, else split between lines.
      const space = limit - cursor
      const isBox = b.kind === 'container'
      if (pos.line === 0 && b.height <= space + EPS && !(isBox && empty())) {
        add(pos.block, 0, b.height, undefined, isBox ? trailingSpace(b) : 0)
        cursor = this.snap(cursor)
        pos = { block: pos.block + 1, line: 0 }
        continue
      }
      const lines = b.lines()
      if (pos.line === 0 && lines.length <= 1 && !(isBox && b.height <= space + EPS)) {
        if (!empty()) return done('full')
        // Taller than a page and unbreakable: it overflows on its own page, as in the editor.
        add(pos.block, 0, b.height)
        pos = { block: pos.block + 1, line: 0 }
        continue
      }
      // A quote's space above is dropped at the top of a page, as typesetters do.
      const clipTop = pos.line > 0 ? lines[pos.line].top : isBox && empty() && cursor === 0 && lines.length ? lines[0].top : 0
      const leafInfo = (from: number, to: number) => (isBox ? leafSlice(lines, from, to) : undefined)
      /** Lines [from, to) of a long paragraph, as text positions (when measure.ts recorded them). */
      const textInfo = (from: number, to: number): Fragment['text'] => {
        if (!b.lineStart) return undefined
        const a = from === 0 ? 0 : b.lineStart(from)
        const z = to >= lines.length ? null : b.lineStart(to)
        if (a === undefined || z === undefined) return undefined
        return { from: a, to: z, top: from === 0 ? 0 : lines[from].top }
      }
      const lastBottom = lines.length ? lines[lines.length - 1].bottom : b.height
      if (b.height - clipTop <= space + EPS) {
        add(pos.block, clipTop, b.height, pos.line > 0 ? leafInfo(pos.line, lines.length) : undefined, b.height - lastBottom)
        if (pos.line > 0) setText(textInfo(pos.line, lines.length))
        cursor = this.snap(cursor)
        pos = { block: pos.block + 1, line: 0 }
        continue
      }
      // …and its space below at the foot of one: the rest fits without it, and the page ends there.
      if (isBox && lastBottom - clipTop <= space + EPS) {
        add(pos.block, clipTop, lastBottom, pos.line > 0 ? leafInfo(pos.line, lines.length) : undefined)
        pos = { block: pos.block + 1, line: 0 }
        return done('full')
      }
      const spans = leafRanges(lines)
      let end = pos.line
      while (end < lines.length && lines[end].bottom - clipTop <= space + EPS) end++
      // Walk back to a legal break before line `end`.
      let brk = end
      while (brk > pos.line && !(brk < lines.length && canBreak(lines, spans, brk, widows, orphans))) brk--
      if (brk === pos.line) {
        if (!empty()) return done('full')
        // Empty page and no legal break: take what fits (at least one line).
        brk = Math.max(pos.line + 1, Math.min(end, lines.length - 1))
      }
      add(pos.block, clipTop, lines[brk].top, leafInfo(pos.line, brk))
      setText(textInfo(pos.line, brk))
      pos = { block: pos.block, line: brk }
      return done('full')
    }
  }
}

/** A text page whose content runs on to the next page. */
const isFullText = (l: LaidPage) => l.reason === 'full' && !l.page.isBlank

function chaptersIn(u: Unit) {
  let n = 0
  for (const l of u.laid) n += l.chapters.length
  return n
}

/** Blank space below the last line of a list or quote (its padding). */
function trailingSpace(b: MeasuredBookBlock): number {
  const lines = b.lines()
  return lines.length ? Math.max(0, b.height - lines[lines.length - 1].bottom) : 0
}

/** Bottom of the smallest slice of `b` that may end a page: two lines, or the whole of a short paragraph. */
function firstSliceBottom(b: MeasuredBookBlock, widows: boolean): number {
  if (b.kind !== 'text' && b.kind !== 'container') return b.height
  const lines = b.lines()
  if (lines.length <= 1) return b.height
  const spans = leafRanges(lines)
  for (let k = 1; k < lines.length; k++) if (canBreak(lines, spans, k, widows)) return Math.min(b.height, lines[k - 1].bottom)
  return b.height
}

/** Which paragraphs of a container lines [from, to) cover, and every paragraph's extent. */
function leafSlice(lines: readonly LineBox[], from: number, to: number): Fragment['leaves'] {
  const boxes: LeafBox[] = []
  for (const l of lines) {
    const b = boxes[l.leaf]
    if (b) b.bottom = Math.max(b.bottom, l.bottom)
    else boxes[l.leaf] = { top: l.top, bottom: l.bottom }
  }
  // Leaves with no line (shouldn't happen) get an empty box so indices line up.
  for (let i = 0; i < boxes.length; i++) if (!boxes[i]) boxes[i] = { top: 0, bottom: 0 }
  return { from: lines[from].leaf, to: lines[Math.max(from, to - 1)].leaf, boxes }
}

const spanCache = new WeakMap<readonly LineBox[], { first: number; count: number }[]>()

/** For each line: [first line index, line count] of its leaf. */
function leafRanges(lines: readonly LineBox[]): { first: number; count: number }[] {
  const hit = spanCache.get(lines)
  if (hit) return hit
  const out: { first: number; count: number }[] = new Array(lines.length)
  let i = 0
  while (i < lines.length) {
    let j = i
    while (j < lines.length && lines[j].leaf === lines[i].leaf) j++
    const r = { first: i, count: j - i }
    for (let k = i; k < j; k++) out[k] = r
    i = j
  }
  spanCache.set(lines, out)
  return out
}

/**
 * May a page break fall before line `k`? Between paragraphs: yes. Inside one:
 * keep ≥2 lines on each side (≥1 before it when `orphans` is allowed).
 */
function canBreak(lines: readonly LineBox[], spans: { first: number; count: number }[], k: number, widows: boolean, orphans = false): boolean {
  if (k <= 0 || k >= lines.length) return false
  if (lines[k - 1].leaf !== lines[k].leaf || !widows) return true
  const span = spans[k]
  const before = k - span.first
  const after = span.first + span.count - k
  return before >= (orphans ? 1 : MIN_LINES) && after >= MIN_LINES
}

/** Convenience for tests and small docs: paginate everything at once. */
export function paginateBook(blocks: readonly MeasuredBookBlock[], opts: BookPaginateOptions) {
  const p = new BookPaginator(opts)
  for (const b of blocks) p.push(b)
  const pages = p.finish()
  return { pages, chapters: p.chapters }
}
