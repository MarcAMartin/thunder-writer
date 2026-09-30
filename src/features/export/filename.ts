import { EXPORT_FORMATS, type ExportKind } from './formats'

const FALLBACK = 'Untitled Manuscript'
const MAX_BASE = 120
// Windows reserves these device names regardless of extension.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/**
 * A file name that is legal on Windows and macOS: no \ / : * ? " < > |,
 * no control characters, no leading dots (hidden on macOS), no trailing
 * dots or spaces (stripped by Windows), not a reserved device name.
 */
export function sanitizeBaseName(title: string | null | undefined): string {
  let s = (title ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
  if (s.length > MAX_BASE) s = s.slice(0, MAX_BASE).replace(/[.\s]+$/, '')
  // Don't leave half of a surrogate pair at the cut.
  s = s.replace(/[\uD800-\uDBFF]$/, '')
  if (!s) return FALLBACK
  if (RESERVED.test(s)) s = `${s} manuscript`
  return s
}

/** "My Novel.docx", "My Novel.thunder.json"… */
export function exportFileName(title: string | null | undefined, kind: ExportKind): string {
  return sanitizeBaseName(title) + EXPORT_FORMATS[kind].ext
}
