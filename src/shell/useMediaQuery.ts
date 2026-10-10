import { useEffect, useState } from 'react'

/** Phones and narrow windows: the writer shows a simplified layout (see WriterPage). */
export const NARROW_QUERY = '(max-width: 760px)'

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
