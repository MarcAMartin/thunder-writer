/**
 * The three ways the editor lays out its pages (status bar › page view):
 *
 *   scroll  one page after another, scrolling down (the classic view)
 *   spread  two pages across, rows scrolling down
 *   flip    two pages at a time, turned like a book
 *
 * Pagination never changes between them: the text is still measured as one
 * column (see usePagination) and each page's text is a fixed-height band of
 * it. The side-by-side views let the browser flow that same column into CSS
 * columns one band tall, so every page stays editable in place.
 */

export type PageLayout = 'scroll' | 'spread' | 'flip'

export const PAGE_LAYOUTS: readonly PageLayout[] = ['scroll', 'spread', 'flip']

/** Gap between sheets side by side, in unscaled px (the same as between rows). The flip view's pages meet at the spine. */
export const COLUMN_GAP = 28

export interface SheetGeometry {
  pageWidth: number
  pageHeight: number
  /** Page height plus the gap below it. */
  pitch: number
  /**
   * Flip view: 1 when the first page is a right-hand page (an odd page
   * number), so it sits alone on the right like page 1 of a book; 0 when it
   * is a left-hand page.
   */
  flipShift?: number
}

/** Gap between the columns of a layout. */
export const columnGap = (layout: PageLayout) => (layout === 'flip' ? 0 : COLUMN_GAP)

const colPitch = (g: SheetGeometry, layout: PageLayout = 'spread') => g.pageWidth + columnGap(layout)
const shiftOf = (g: SheetGeometry) => (g.flipShift ? 1 : 0)

/** Rows of two need CSS multicol rows (`column-wrap`), which Chrome and Edge have; the flip view only needs plain columns. */
export function supportsSpread(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('column-wrap', 'wrap') && CSS.supports('column-height', '1px')
}

/** The layout to use: an unknown value, or the spread view without browser support, falls back to scrolling. */
export function effectiveLayout(wanted: unknown, opts: { spreadSupported: boolean; narrow: boolean }): PageLayout {
  if (opts.narrow) return 'scroll'
  if (wanted === 'flip') return 'flip'
  if (wanted === 'spread' && opts.spreadSupported) return 'spread'
  return 'scroll'
}

/** Top-left of sheet `i` in the page stack (unscaled px). */
export function sheetPosition(layout: PageLayout, i: number, g: SheetGeometry): { left: number; top: number } {
  if (layout === 'spread') return { left: (i % 2) * colPitch(g), top: Math.floor(i / 2) * g.pitch }
  if (layout === 'flip') return { left: (i + shiftOf(g)) * colPitch(g, 'flip'), top: 0 }
  return { left: 0, top: i * g.pitch }
}

/** Flip view: whether sheet `i` is the left page of its spread (its spine is on the right). */
export const isLeftPage = (i: number, g: SheetGeometry) => (i + shiftOf(g)) % 2 === 0

/** Size of the whole page stack for `sheets` sheets (unscaled px). */
export function stackSize(layout: PageLayout, sheets: number, g: SheetGeometry): { width: number; height: number } {
  const n = Math.max(1, sheets)
  if (layout === 'spread') return { width: 2 * g.pageWidth + COLUMN_GAP, height: Math.ceil(n / 2) * g.pitch - (g.pitch - g.pageHeight) }
  if (layout === 'flip') return { width: (n + shiftOf(g)) * colPitch(g, 'flip'), height: g.pageHeight }
  return { width: g.pageWidth, height: n * g.pitch - (g.pitch - g.pageHeight) }
}

/** The part of the stack on screen at once: a two-page spread in the flip view, else the whole stack width. */
export function visibleWidth(layout: PageLayout, g: SheetGeometry): number {
  return layout === 'scroll' ? g.pageWidth : 2 * g.pageWidth + columnGap(layout)
}

/**
 * Scale at which the layout fits the window. With `fitHeight` (every view on a
 * computer; phones fit the width only) a page fills the window's height:
 * smaller in a short window so the whole page shows, and larger on a tall
 * monitor so it reaches the bottom rather than leaving empty space, but never
 * wider than the window (one page across, or two in side by side and flip).
 * Without it, the page fits the width, at most at its natural size.
 */
export function layoutFitScale(
  layout: PageLayout,
  available: { width: number; height: number },
  g: SheetGeometry,
  sidePadding: number,
  opts: { fitHeight?: boolean } = {},
): number {
  const w = visibleWidth(layout, g)
  const fitHeight = opts.fitHeight ?? layout === 'flip'
  const min = layout === 'scroll' && !fitHeight ? 0.5 : 0.25
  if (!(available.width > 0) || !(w > 0)) return 1
  const widthFit = (available.width - sidePadding * 2) / w
  const fit =
    fitHeight && available.height > 0 ? Math.min(widthFit, available.height / g.pageHeight) : Math.min(1, widthFit)
  return Math.max(min, fit)
}

/** Which page a point in the stack (unscaled px) is on, clamped to the pages that exist. */
export function pageAtPoint(layout: PageLayout, x: number, y: number, sheets: number, g: SheetGeometry): number {
  const col = Math.max(0, Math.floor(x / colPitch(g, layout)))
  const row = Math.max(0, Math.floor(y / g.pitch))
  const i = layout === 'spread' ? row * 2 + Math.min(col, 1) : layout === 'flip' ? col - shiftOf(g) : row
  return Math.min(Math.max(0, sheets - 1), Math.max(0, i))
}

/** The flip view's spread (0-based) that shows page `i`. */
export const spreadOfPage = (i: number, g?: SheetGeometry) => Math.max(0, Math.floor((i + (g ? shiftOf(g) : 0)) / 2))

/** The pages of flip spread `spread` (left, right); -1 where that side is empty. */
export function pagesOfSpread(spread: number, pages: number, g: SheetGeometry): [number, number] {
  const left = spread * 2 - shiftOf(g)
  const ok = (i: number) => (i >= 0 && i < pages ? i : -1)
  return [ok(left), ok(left + 1)]
}

/** How far the stack shifts left to show spread `spread` (unscaled px). */
export const spreadOffset = (spread: number, g: SheetGeometry) => spread * 2 * colPitch(g, 'flip')

/** "Pages 2–3 of 9" for the flip view's page details. */
export function describeSpread(spread: number, pages: number, g?: SheetGeometry): string {
  if (pages <= 1) return '1 page'
  const shown = (g ? pagesOfSpread(spread, pages, g) : [spread * 2, spread * 2 + 1 < pages ? spread * 2 + 1 : -1]).filter((i) => i >= 0)
  if (shown.length === 0) return `${pages} pages`
  return shown.length === 1 ? `Page ${shown[0] + 1} of ${pages}` : `Pages ${shown[0] + 1}–${shown[1] + 1} of ${pages}`
}
