import type { CopyStatus } from './desktopCopy'

export type CopyAction = 'resume' | 'retry' | 'choose' | 'resolve'

export interface CopyStatusView {
  /** "Copy on your computer: My Novel.docx — saved 12:04 PM" */
  text: string
  /** Short form for tight spaces: "My Novel.docx · saved 12:04 PM" */
  short: string
  tone: 'ok' | 'busy' | 'warn' | 'error'
  action: CopyAction | null
  actionLabel: string | null
}

export const formatClock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** Status line for a desktop copy. */
export function describeCopyStatus(s: CopyStatus, clock: (at: number) => string = formatClock): CopyStatusView {
  const name = s.fileName || 'your file'
  const view = (detail: string, tone: CopyStatusView['tone'], action: CopyAction | null = null, actionLabel: string | null = null) => ({
    text: `Copy on your computer: ${name} — ${detail}`,
    short: `${name} · ${detail}`,
    tone,
    action,
    actionLabel,
  })
  switch (s.phase) {
    case 'writing':
      return view('saving…', 'busy')
    case 'needs-permission':
      return view('needs permission', 'warn', 'resume', 'Resume desktop copy')
    case 'missing':
      return view('file moved or deleted', 'error', 'choose', 'Choose where to save')
    case 'changed':
      return view('changed on your computer', 'warn', 'resolve', 'Choose which version to keep')
    case 'error':
      return view('write failed', 'error', 'retry', 'Retry')
    case 'ready':
      if (s.lastWrittenAt) return view(`saved ${clock(s.lastWrittenAt)}${s.pending ? ' · updating soon' : ''}`, 'ok')
      return view(s.pending ? 'updating soon' : 'set up', 'ok')
  }
}
