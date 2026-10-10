import { useEffect, useState } from 'react'

/**
 * Phones (either way up) and very narrow windows: the writer shows a simplified
 * layout (see WriterPage). Measured on the short side, so tablets, even an
 * iPad mini held upright (744 px), get the full desktop app, while a phone
 * held sideways (about 430 px tall, touch) keeps the phone layout.
 */
export const NARROW_QUERY = '(max-width: 599px), (max-height: 499px) and (pointer: coarse)'

const matches = (query: string) => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches

/** Whether a CSS media query matches, kept up to date as the window changes. */
export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => matches(query))
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const update = () => setOn(mq.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [query])
  return on
}
