/**
 * Where the pages sit in their scroll area, read from the DOM. PageView uses it
 * to size and keep the page; focusMode.ts uses it so the Focus Mode transition
 * can zoom the old and new pictures of the pages together when the switch
 * changes their scale (the fitted page grows with Focus Mode's taller window).
 */

/** How far the first page starts below the top of the scroll content: page details, and Focus Mode's extra drop. */
export function pageTopIn(scroll: HTMLElement, zoom: HTMLElement): number {
  return zoom.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop
}

export interface PagesView {
  /** The page stack's transform scale. */
  scale: number
  pageTop: number
  scrollTop: number
  clientHeight: number
}

/** The writer page's pages as they are now, or null when there are none. */
export function readPagesView(root: ParentNode = document): PagesView | null {
  const scroll = root.querySelector<HTMLElement>('.ed-scroll')
  const zoom = root.querySelector<HTMLElement>('.ed-zoom')
  const stack = root.querySelector<HTMLElement>('.ed-stack')
  if (!scroll || !zoom || !stack || !(stack.offsetWidth > 0)) return null
  return {
    scale: stack.getBoundingClientRect().width / stack.offsetWidth,
    pageTop: pageTopIn(scroll, zoom),
    scrollTop: scroll.scrollTop,
    clientHeight: scroll.clientHeight,
  }
}

/**
 * The spot of the manuscript a change keeps in view, in unscaled px from the
 * top of the first page: that top if the view was at the top, otherwise the
 * line at the middle of the window.
 */
function keptSpot(v: PagesView): number {
  return v.scrollTop === 0 ? 0 : (v.scrollTop + v.clientHeight / 2 - v.pageTop) / v.scale
}

/**
 * Where to scroll after the pages change scale (zoom, a resized window, Focus
 * Mode) so the writer keeps their place: still at the top if they were, else
 * with the same line at the middle of the window.
 */
export function keptScrollTop(before: PagesView, after: Omit<PagesView, 'scrollTop'>): number {
  if (before.scrollTop === 0) return 0
  return Math.max(0, after.pageTop + keptSpot(before) * after.scale - after.clientHeight / 2)
}

/**
 * The kept spot followed across a change: its height in the scroll area
 * before and after, and how much the pages grew.
 */
export function followPages(before: PagesView, after: PagesView): { oldY: number; newY: number; ratio: number } {
  const point = keptSpot(before)
  return {
    oldY: before.pageTop + point * before.scale - before.scrollTop,
    newY: after.pageTop + point * after.scale - after.scrollTop,
    ratio: after.scale / before.scale,
  }
}
