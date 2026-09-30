import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function getMatch(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

/** Tracks the OS "reduce motion" preference; false where matchMedia is unavailable. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(getMatch)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(QUERY)
    const onChange = () => setReduced(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}
