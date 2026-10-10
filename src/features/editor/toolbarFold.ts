import { flushSync } from 'react-dom'
import { useSettings } from '../../store/settings'

/**
 * Collapse tools / Show tools: folds the toolbar to one row and makes the
 * header compact, animated with a View Transition where the browser has one.
 * The header rolls up or down (its two pictures crossfade inside a box that
 * crops as it shrinks) and the pages glide and grow into their new size
 * instead of popping (editor.css › html.tw-tools-fold).
 */

/** Asks the page view to re-measure its frame at once (it normally waits for a ResizeObserver). */
export const MEASURE_NOW_EVENT = 'tw:measure-now'

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } }

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The pages' frame and the size of a page in it, to line the old and new pictures up. */
function measurePages() {
  const scroll = document.querySelector<HTMLElement>('.ed-scroll')
  const sheet = scroll?.querySelector<HTMLElement>('.ed-sheet')
  return { height: scroll?.clientHeight ?? 0, scrollTop: scroll?.scrollTop ?? 0, page: sheet?.getBoundingClientRect().height ?? 0 }
}

export async function setToolsCollapsed(collapsed: boolean): Promise<void> {
  const apply = () => {
    flushSync(() => useSettings.getState().set({ toolbarCollapsed: collapsed }))
    // The new picture of the pages must already have their new size.
    window.dispatchEvent(new Event(MEASURE_NOW_EVENT))
  }
  const doc = document as ViewTransitionDocument
  if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion()) {
    apply()
    return
  }
  const root = document.documentElement
  const before = measurePages()
  root.classList.add('tw-tools-fold')
  try {
    await doc.startViewTransition(() => {
      apply()
      const after = measurePages()
      // The new picture of the pages starts at the old page size, lined up on the line the
      // writer was looking at (the middle of the frame, or the top when it is scrolled to the top).
      const r = before.page > 0 && after.page > 0 ? before.page / after.page : 1
      const dy = after.scrollTop < 1 ? 0 : before.height / 2 - (r * after.height) / 2
      root.style.setProperty('--tw-pages-from', String(r))
      root.style.setProperty('--tw-pages-dy', `${dy}px`)
    }).finished
  } catch {
    // A transition that couldn't run has still applied the change (or does so below).
  } finally {
    root.classList.remove('tw-tools-fold')
    root.style.removeProperty('--tw-pages-from')
    root.style.removeProperty('--tw-pages-dy')
  }
  if (useSettings.getState().toolbarCollapsed !== collapsed) apply()
}
