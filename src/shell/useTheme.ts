import { useEffect } from 'react'
import { useSettings } from '../store/settings'

/** Applies the chosen theme as data-theme on <html>; "system" follows the OS. */
export function useTheme() {
  const theme = useSettings((s) => s.theme)
  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      root.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}
