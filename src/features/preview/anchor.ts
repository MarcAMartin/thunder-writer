import type { BookPageModel } from './paginateBook'

/**
 * A place in the text that survives a re-layout: the top-level block and the
 * offset (px, in the block's own coordinates) of the first text on a page.
 * Page and view indices change whenever an option re-flows the book (justify,
 * chapter sink, first page number); block offsets don't, because those
 * options never change how a block breaks into lines.
 */
export interface TextAnchor {
  block: number
  offset: number
}

/** The first text on `pages` (in order), or on the next page that has any (a view can be blank). */
export function anchorOfPages(pages: readonly BookPageModel[], indices: readonly number[]): TextAnchor | null {
  if (indices.length === 0) return null
  for (const i of indices) {
    const f = pages[i]?.fragments[0]
    if (f) return { block: f.block, offset: f.clipTop }
  }
  for (let i = Math.max(...indices) + 1; i < pages.length; i++) {
    const f = pages[i].fragments[0]
    if (f) return { block: f.block, offset: f.clipTop }
  }
  return null
}

/**
 * The page showing `a` (the first page with text at or after it), or null if
 * the pages laid out so far don't reach it yet.
 */
export function pageOfAnchor(pages: readonly BookPageModel[], a: TextAnchor): number | null {
  for (let i = 0; i < pages.length; i++) {
    for (const f of pages[i].fragments) {
      if (f.block > a.block || (f.block === a.block && f.clipBottom > a.offset + 0.5)) return i
    }
  }
  return null
}
