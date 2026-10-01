import { useEffect } from 'react'
import { useSettings } from '../../store/settings'
import { keySize, MIN_GAP_MS, playDelete, playRelease, playStrike, soundForKey, type KeySize } from './typewriterSounds'

/**
 * While Typewriter sounds is on, each key press in the manuscript (not in the
 * title or other fields) makes a sound: a click-clack for typing, with a
 * second click as the key comes back up, and a deeper knock for deleting.
 */
export function useTypewriterSounds(): void {
  const on = useSettings((s) => s.typewriterSounds)
  useEffect(() => {
    if (!on) return
    let last = Number.NEGATIVE_INFINITY
    /** Keys that clicked going down, so only they click coming up (key repeat sends no keyup). */
    const down = new Map<string, KeySize>()
    const inManuscript = (e: Event) => {
      const target = e.target instanceof Element ? e.target : null
      return !!target?.closest('.ed-prose[contenteditable="true"]')
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!inManuscript(e)) return
      const sound = soundForKey(e)
      if (!sound) return
      const now = performance.now()
      if (now - last < MIN_GAP_MS) return
      last = now
      if (sound === 'delete') playDelete()
      else {
        const size = keySize(e.key)
        playStrike(size)
        if (!e.repeat) down.set(e.code || e.key, size)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const size = down.get(e.code || e.key)
      if (!size) return
      down.delete(e.code || e.key)
      playRelease(size)
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', onKeyUp, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
    }
  }, [on])
}
