/** H:MM:SS for the session timer. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Spoken form for screen readers, e.g. "1 hour 2 minutes". */
export function describeElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const parts: string[] = []
  if (h) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`)
  parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`)
  return parts.join(' ')
}

export function formatCost(usd: number): string {
  const v = Number.isFinite(usd) && usd > 0 ? usd : 0
  return `$${v.toFixed(4)}`
}

const nf = new Intl.NumberFormat('en-US')
export const formatCount = (n: number) => nf.format(Math.max(0, Math.round(n)))
