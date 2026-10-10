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

/** Gap between sheets side by side, in unscaled px (the same as between rows). */
export const COLUMN_GAP = 28

export interface SheetGeometry {
  pageWidth: number
  pageHeight: number
  /** Page height plus the gap below it. */
  pitch: number
}

const colPitch = (g: SheetGeometry) => g.pageWidth + COLUMN_GAP

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
  if (layout === 'flip') return { left: i * colPitch(g), top: 0 }
  return { left: 0, top: i * g.pitch }
}

/** Size of the whole page stack for `sheets` sheets (unscaled px). */
export function stackSize(layout: PageLayout, sheets: number, g: SheetGeometry): { width: number; height: number } {
  const n = Math.max(1, sheets)
  if (layout === 'spread') return { width: 2 * g.pageWidth + COLUMN_GAP, height: Math.ceil(n / 2) * g.pitch - (g.pitch - g.pageHeight) }
  if (layout === 'flip') return { width: n * colPitch(g) - COLUMN_GAP, height: g.pageHeight }
  return { width: g.pageWidth, height: n * g.pitch - (g.pitch - g.pageHeight) }
}

/** The part of the stack on screen at once: a two-page spread in the flip view, else the whole stack width. */
export function visibleWidth(layout: PageLayout, g: SheetGeometry): number {
  return layout === 'scroll' ? g.pageWidth : 2 * g.pageWidth + COLUMN_GAP
}

/**
 * Scale (<= 1) at which the layout fits the window: the page (or two pages)
 * fits the width, and in the flip view a whole spread fits the height too.
 */
export function layoutFitScale(
  layout: PageLayout,
  available: { width: number; height: number },
  g: SheetGeometry,
  sidePadding: number,
): number {
  const w = visibleWidth(layout, g)
  const min = layout === 'scroll' ? 0.5 : 0.25
  if (!(available.width > 0) || !(w > 0)) return 1
  let fit = Math.min(1, (available.width - sidePadding * 2) / w)
  if (layout === 'flip' && available.height > 0) fit = Math.min(fit, available.height / g.pageHeight)
  return Math.max(min, fit)
}

/** Which page a point in the stack (unscaled px) is on, clamped to the pages that exist. */
export function pageAtPoint(layout: PageLayout, x: number, y: number, sheets: number, g: SheetGeometry): number {
  const col = Math.max(0, Math.floor(x / colPitch(g)))
  const row = Math.max(0, Math.floor(y / g.pitch))
  const i = layout === 'spread' ? row * 2 + Math.min(col, 1) : layout === 'flip' ? col : row
  return Math.min(Math.max(0, sheets - 1), i)
}

/** The flip view's spread (0-based) that shows page `i`. */
export const spreadOfPage = (i: number) => Math.max(0, Math.floor(i / 2))

/** How far the stack shifts left to show spread `spread` (unscaled px). */
export const spreadOffset = (spread: number, g: SheetGeometry) => spread * 2 * colPitch(g)

/** "Pages 3–4 of 9" for the flip view's page details. */
export function describeSpread(spread: number, pages: number): string {
  const first = spread * 2 + 1
  const last = Math.min(pages, first + 1)
  if (pages <= 1) return '1 page'
  return first === last ? `Page ${first} of ${pages}` : `Pages ${first}–${last} of ${pages}`
}
