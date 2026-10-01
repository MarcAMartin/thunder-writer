/**
 * Why a backup was made. Everything except 'auto' is kept longer: 'manual' is
 * one the writer asked for, the rest are safety copies taken just before
 * something replaced or removed a manuscript.
 */
export type BackupReason =
  | 'auto'
  | 'manual'
  /** This browser's copy, just before the Google Drive version replaced it. */
  | 'before-drive-version'
  /** This browser's copy, just before an imported backup file replaced it. */
  | 'before-import'
  /** The manuscript, just before it was deleted from this browser. */
  | 'before-delete'
  /** The Google Drive version (e.g. saved on another computer) that "Keep this browser's version" overwrote. */
  | 'drive-version-replaced'
  /** A file on the computer, byte for byte, before Thunder Writer first saved over it (File › Open from computer). */
  | 'original-file'

export interface BackupMeta {
  id: string
  /** The manuscript it is a backup of (which may since have been deleted). */
  docId: string
  /** The manuscript's title when the backup was made. */
  title: string
  savedAt: number
  /** The manuscript's own updatedAt at the time: two backups with the same value hold the same text. */
  docUpdatedAt: number
  words: number
  reason: BackupReason
  /** For 'original-file': the file as it was, kept whole (not converted), so it downloads exactly as it was. */
  file?: { name: string; type: string; size: number }
}

export const REASON_LABEL: Record<BackupReason, string> = {
  auto: 'Automatic',
  manual: 'Backed up by you',
  'before-drive-version': 'Before the Google Drive version replaced it',
  'before-import': 'Before an imported file replaced it',
  'before-delete': 'Before it was deleted',
  'drive-version-replaced': 'The Google Drive version you replaced',
  'original-file': 'The file on your computer, before Thunder Writer saved over it',
}

/** Why it was kept, with the file's name for an original file: "The file on your computer, … (Novel.docx)". */
export const describeReason = (m: Pick<BackupMeta, 'reason' | 'file'>) => (m.file ? `${REASON_LABEL[m.reason]} (${m.file.name})` : REASON_LABEL[m.reason])

/** "84,213 words", or for an original file whose words couldn't be counted, its size ("1.2 MB"). */
export function describeSize(m: Pick<BackupMeta, 'words' | 'file'>): string {
  if (m.file && m.words === 0) {
    const kb = m.file.size / 1024
    return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`
  }
  return `${m.words.toLocaleString()} ${m.words === 1 ? 'word' : 'words'}`
}

const DAY_MS = 86_400_000

export const RETENTION = {
  /** The most recent backups of each manuscript, whatever their age. */
  keepRecent: 10,
  /** Beyond those, the newest backup of each day for this many days. */
  dailyForDays: 30,
  /** Backups the writer made and safety copies (anything but 'auto') are kept this long, up to `maxSafety` per manuscript. */
  safetyForDays: 90,
  maxSafety: 30,
} as const

const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/**
 * Which backups to delete. Per manuscript: keep the 10 newest; then, for each
 * of the last 30 days, the backup holding that day's latest text; and every
 * backup the writer made or safety copy for 90 days (at most 30). So recent
 * work can be stepped back through closely, older work day by day, and a
 * deliberate, replaced or deleted version is never among the first to go.
 *
 * Days go by the text's own time (docUpdatedAt), not when the backup was
 * saved: an automatic backup holds the version from before the edit that
 * triggered it, so the text a day ended with is saved the next morning.
 */
export function backupsToPrune(metas: readonly BackupMeta[], now: number): string[] {
  const byDoc = new Map<string, BackupMeta[]>()
  for (const m of metas) {
    const list = byDoc.get(m.docId)
    if (list) list.push(m)
    else byDoc.set(m.docId, [m])
  }
  const doomed: string[] = []
  for (const list of byDoc.values()) {
    const sorted = [...list].sort((a, b) => b.savedAt - a.savedAt)
    const latestOfDay = new Map<string, BackupMeta>()
    for (const m of sorted) {
      const day = dayKey(m.docUpdatedAt)
      const best = latestOfDay.get(day)
      if (!best || m.docUpdatedAt > best.docUpdatedAt) latestOfDay.set(day, m)
    }
    let kept = 0
    sorted.forEach((m, i) => {
      let keep = i < RETENTION.keepRecent
      if (m.reason !== 'auto' && now - m.savedAt <= RETENTION.safetyForDays * DAY_MS && kept < RETENTION.maxSafety) {
        kept++
        keep = true
      }
      if (latestOfDay.get(dayKey(m.docUpdatedAt)) === m && now - m.docUpdatedAt <= RETENTION.dailyForDays * DAY_MS) keep = true
      if (!keep) doomed.push(m.id)
    })
  }
  return doomed
}
