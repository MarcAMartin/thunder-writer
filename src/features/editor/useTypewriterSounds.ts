import { useEffect } from 'react'
import { useSettings } from '../../store/settings'
import { MIN_GAP_MS, playDelete, playStrike, soundForKey } from './typewriterSounds'

/**
 * While Typewriter sounds is on, each key press in the manuscript (not in the
 * title or other fields) makes a sound: a strike for typing, a knock for deleting.
 */
export function useTypewriterSounds(): void {
  const on = useSettings((s) => s.typewriterSounds)
  useEffect(() => {
    if (!on) return
    let last = Number.NEGATIVE_INFINITY
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null
      if (!target?.closest('.ed-prose[contenteditable="true"]')) return
      const sound = soundForKey(e)
      if (!sound) return
      const now = performance.now()
      if (now - last < MIN_GAP_MS) return
      last = now
      if (sound === 'delete') playDelete()
      else playStrike()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [on])
}
