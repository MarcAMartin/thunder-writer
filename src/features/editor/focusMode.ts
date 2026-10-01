import { flushSync } from 'react-dom'
import { create } from 'zustand'

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

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Turns Focus Mode on or off, animated where the browser can. Resolves when the change has finished animating. */
export async function setFocusMode(on: boolean): Promise<void> {
  if (useFocusMode.getState().on === on) return
  const apply = () => flushSync(() => useFocusMode.setState({ on }))
  const doc = document as ViewTransitionDocument
  if (typeof doc.startViewTransition === 'function' && !prefersReducedMotion()) {
    // Which way the pages move (editor.css › Focus Mode).
    const direction = on ? 'tw-entering-focus' : 'tw-leaving-focus'
    document.documentElement.classList.add(direction)
    try {
      await doc.startViewTransition(apply).finished
      return
    } catch {
      // A transition that couldn't run still applied the change, or will below.
    } finally {
      document.documentElement.classList.remove(direction)
    }
  }
  if (useFocusMode.getState().on !== on) apply()
}

export const toggleFocusMode = () => setFocusMode(!useFocusMode.getState().on)
