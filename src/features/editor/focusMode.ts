import { flushSync } from 'react-dom'
import { create } from 'zustand'
import { followPages, readPagesView } from './pagesView'
import { MEASURE_NOW_EVENT } from './toolbarFold'

/**
 * Focus Mode: everything but the manuscript slips away (header, toolbar,
 * suggestions, status bar) and the pages glide to the middle; Exit Focus Mode
 * (or Escape) brings it all back. The move is a View Transition where the
 * browser has them (Chrome, Edge, Safari 18) and motion is welcome; otherwise
 * the switch is a quick fade, or instant with reduced motion.
 */

interface FocusModeState {
  on: boolean
}

export const useFocusMode = create<FocusModeState>()(() => ({ on: false }))

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } }

/** CSS variables the pages' transition reads (editor.css › Focus Mode). */
const PAGE_VARS = ['--tw-pages-old-y', '--tw-pages-new-y', '--tw-pages-r'] as const

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Turns Focus Mode on or off, animated where the browser can. Resolves when the change has finished animating. */
export async function setFocusMode(on: boolean): Promise<void> {
  if (useFocusMode.getState().on === on) return
  const apply = () => {
    flushSync(() => useFocusMode.setState({ on }))
    // The window's height changes, and with it the fitted page: the new picture must already have it.
    window.dispatchEvent(new Event(MEASURE_NOW_EVENT))
  }
  const doc = document as ViewTransitionDocument
  if (typeof doc.startViewTransition === 'function' && !prefersReducedMotion()) {
    // Which way the pages move (editor.css › Focus Mode).
    const direction = on ? 'tw-entering-focus' : 'tw-leaving-focus'
    const root = document.documentElement
    root.classList.add(direction)
    // The pages usually change scale too (they fill the window's height). Both pictures follow one spot of
    // the manuscript and zoom together, so the text never shows twice.
    const before = readPagesView()
    try {
      await doc.startViewTransition(() => {
        apply()
        const after = before && readPagesView()
        if (!before || !after) return
        const { oldY, newY, ratio } = followPages(before, after)
        root.style.setProperty('--tw-pages-old-y', `${oldY}px`)
        root.style.setProperty('--tw-pages-new-y', `${newY}px`)
        root.style.setProperty('--tw-pages-r', String(ratio))
      }).finished
      return
    } catch {
      // A transition that couldn't run still applied the change, or will below.
    } finally {
      root.classList.remove(direction)
      for (const v of PAGE_VARS) root.style.removeProperty(v)
    }
  }
  if (useFocusMode.getState().on !== on) apply()
}

export const toggleFocusMode = () => setFocusMode(!useFocusMode.getState().on)
