/**
 * Pairing pages into what the reader sees at once ("views"). In spread mode a
 * view is a left (verso) and right (recto) page. Page 1 is a recto and sits
 * alone on the right, as in a real book, and a book ending on a verso ends
 * with that page alone on the left. In single mode each view is one page.
 */

export type ViewMode = 'spread' | 'single'

export interface View {
  index: number
  left: number | null
  right: number | null
}

/**
 * @param pageCount number of pages
 * @param firstIsRecto whether page index 0 is a right-hand page (odd first page number)
 */
export function buildViews(pageCount: number, firstIsRecto: boolean, mode: ViewMode): View[] {
  const n = Math.max(0, Math.floor(pageCount))
  if (n === 0) return []
  if (mode === 'single') return Array.from({ length: n }, (_, i) => ({ index: i, left: null, right: i }))
  const offset = firstIsRecto ? 1 : 0
  const views: View[] = []
  for (let slot = 0; slot < n + offset; slot += 2) {
    const l = slot - offset
    const r = slot + 1 - offset
    views.push({ index: views.length, left: l >= 0 && l < n ? l : null, right: r >= 0 && r < n ? r : null })
  }
  return views
}

/** The view that shows page `page`. */
export function viewOfPage(page: number, pageCount: number, firstIsRecto: boolean, mode: ViewMode): number {
  if (pageCount <= 0) return 0
  const p = clamp(Math.floor(page), 0, pageCount - 1)
  if (mode === 'single') return p
  return Math.floor((p + (firstIsRecto ? 1 : 0)) / 2)
}

export function viewCount(pageCount: number, firstIsRecto: boolean, mode: ViewMode): number {
  if (pageCount <= 0) return 0
  if (mode === 'single') return pageCount
  return Math.floor((pageCount - 1 + (firstIsRecto ? 1 : 0)) / 2) + 1
}

/** Pages shown by a view, in reading order. */
export function pagesOfView(v: Pick<View, 'left' | 'right'>): number[] {
  return [v.left, v.right].filter((p): p is number => p !== null)
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Printed page numbers of a view, e.g. "Pages 44–45" or "Page 1". */
export function viewPages(folios: number[]): string {
  if (folios.length === 0) return ''
  if (folios.length === 1) return `Page ${folios[0]}`
  return `Pages ${folios[0]}–${folios[folios.length - 1]}`
}

/**
 * Label for a view with where it sits in the book: "Pages 44–45 of 389". When
 * numbering doesn't start at 1, the page count and the last number differ, so
 * the range is spelled out instead: "Pages 8–9 (2–402)".
 */
export function viewLabel(folios: number[], lastFolio: number, firstFolio = 1): string {
  const pages = viewPages(folios)
  if (!pages) return ''
  return firstFolio === 1 ? `${pages} of ${lastFolio}` : `${pages} (${firstFolio}–${lastFolio})`
}

export interface ChapterMark {
  title: string
  page: number
}

/** The chapter running on `page` (last one starting at or before it), or null. */
export function chapterAtPage<T extends ChapterMark>(chapters: readonly T[], page: number): T | null {
  let lo = 0
  let hi = chapters.length - 1
  let found: T | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (chapters[mid].page <= page) {
      found = chapters[mid]
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/** Scrubber position (0..1) of a view. */
export function fractionOfView(view: number, count: number): number {
  return count <= 1 ? 0 : clamp(view / (count - 1), 0, 1)
}

/** The view under a scrubber position (0..1). */
export function viewAtFraction(fraction: number, count: number): number {
  if (count <= 1) return 0
  return clamp(Math.round(clamp(fraction, 0, 1) * (count - 1)), 0, count - 1)
}
