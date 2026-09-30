import { useSettings } from '../store/settings'
import type { ThemeMode } from '../types'

const ORDER: ThemeMode[] = ['light', 'dark', 'system']
const LABEL: Record<ThemeMode, string> = { light: '☀ Light', dark: '☾ Dark', system: '◐ Auto' }

export function ThemeToggle() {
  const theme = useSettings((s) => s.theme)
  const set = useSettings((s) => s.set)
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
  return (
    <button
      type="button"
      className="tw-btn tw-btn-ghost"
      onClick={() => set({ theme: next })}
      title={`Theme: ${theme} (click for ${next})`}
      aria-label={`Theme: ${theme}. Switch to ${next}`}
    >
      {LABEL[theme]}
    </button>
  )
}
