import { ImportError, type ImportResult, type ImportSource } from '../import/types'
import type { ThunderDoc } from '../../types'
import { DRIVE_API, DOC_SUFFIX, DriveError, isDriveError, type DriveClient } from './drive'
import { DOCX_MIME, GDOC_MIME, THUNDER_JSON_MIME, type PickedFile } from './picker'
import { parseEnvelope } from './schema'

/**
 * Downloading a file the writer picked in the Google Picker and turning it into
 * a new manuscript. Read-only against Drive: the original file is only ever
 * fetched (GET), never written.
 */

/** Google Docs are exported as HTML; the export endpoint stops at about 10 MB. */
export const GDOC_EXPORT_MIME = 'text/html'

/** Generous cap for a single manuscript file download. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024

const TEXT_MIMES = new Set(['text/plain', 'text/markdown', 'text/x-markdown', 'text/html'])
const TEXT_EXT = /\.(txt|text|md|markdown|html?)$/i

export type DownloadKind = 'gdoc' | 'binary' | 'text' | 'thunder'

export const isThunderFile = (f: Pick<PickedFile, 'name' | 'mimeType'>) =>
  f.name.toLowerCase().endsWith(DOC_SUFFIX) && (f.mimeType === THUNDER_JSON_MIME || f.mimeType === '' || f.mimeType === 'text/plain')

const UNSUPPORTED =
  'Thunder Writer can import Google Docs, Word (.docx), plain text, Markdown and HTML files.'

/** How a picked file is downloaded, or null when it isn't something we can import. */
export function downloadKind(f: Pick<PickedFile, 'name' | 'mimeType'>): DownloadKind | null {
  if (isThunderFile(f)) return 'thunder'
  if (f.mimeType === GDOC_MIME) return 'gdoc'
  // Other Google-native types (Sheets, Slides…) can't be downloaded with alt=media.
  if (f.mimeType.startsWith('application/vnd.google-apps.')) return null
  if (f.mimeType === DOCX_MIME || /\.docx$/i.test(f.name)) return 'binary'
  if (TEXT_MIMES.has(f.mimeType) || TEXT_EXT.test(f.name)) return 'text'
  return null
}

/** The GET a picked file is downloaded with (export for Google Docs, alt=media otherwise). */
export function downloadUrl(f: Pick<PickedFile, 'id'>, kind: DownloadKind): string {
  const id = encodeURIComponent(f.id)
  if (kind === 'gdoc') return `${DRIVE_API}/${id}/export?mimeType=${encodeURIComponent(GDOC_EXPORT_MIME)}`
  return `${DRIVE_API}/${id}?alt=media`
}

export const CANT_OPEN_MESSAGE = 'Thunder Writer can’t open that file — pick it again from Google Drive.'

export const EXPORT_TOO_LARGE_MESSAGE =
  'This Google Doc is too large for Google to export directly (the limit is about 10 MB). In Google Docs, choose File › Download › Microsoft Word (.docx), then import that .docx file instead.'

/** Rewrites Drive errors from a picked-file download into writer-facing advice. */
export function mapImportDownloadError(e: unknown, kind: DownloadKind): unknown {
  if (!isDriveError(e)) return e
  if (e.code === 'auth') {
    return new DriveError('auth', 'Your Google Drive session expired. Reconnect Google Drive, then pick the file again.', e.status, e.reason)
  }
  if (kind === 'gdoc' && e.status === 403 && e.reason === 'exportSizeLimitExceeded') {
    return new DriveError('forbidden', EXPORT_TOO_LARGE_MESSAGE, e.status, e.reason)
  }
  if (e.code === 'forbidden' || e.code === 'not_found') {
    return new DriveError(e.code, CANT_OPEN_MESSAGE, e.status, e.reason)
  }
  return e
}

/** Downloads a picked file into the shape importManuscript() takes. */
export async function downloadPickedFile(client: Pick<DriveClient, 'request'>, file: PickedFile): Promise<ImportSource> {
  const kind = downloadKind(file)
  if (!kind || kind === 'thunder') throw new ImportError('unsupported', `${file.name}: ${UNSUPPORTED}`)
  if (file.sizeBytes && file.sizeBytes > MAX_IMPORT_BYTES) {
    throw new ImportError('too_large', `${file.name} is larger than 50 MB, too big to import as one manuscript.`)
  }
  let res: Response
  try {
    res = await client.request(downloadUrl(file, kind))
  } catch (e) {
    throw mapImportDownloadError(e, kind)
  }
  try {
    if (kind === 'gdoc') return { name: file.name, mimeType: GDOC_EXPORT_MIME, data: await res.text(), format: 'gdoc-html' }
    if (kind === 'binary') return { name: file.name, mimeType: file.mimeType || DOCX_MIME, data: await res.arrayBuffer() }
    return { name: file.name, mimeType: file.mimeType || undefined, data: await res.text() }
  } catch {
    throw new DriveError('network', 'The download from Google Drive was interrupted. Try again.')
  }
}

export type DriveImportOutcome =
  | { kind: 'manuscript'; file: PickedFile; result: ImportResult }
  | { kind: 'thunder'; file: PickedFile; doc: ThunderDoc }

export interface ImportPickedDeps {
  client: Pick<DriveClient, 'request'>
  importManuscript: (source: ImportSource) => Promise<ImportResult>
}

/**
 * Downloads and converts a picked file. A .thunder.json file is validated as a
 * Thunder Writer manuscript; anything else goes through importManuscript().
 */
export async function importPickedFile(file: PickedFile, deps: ImportPickedDeps): Promise<DriveImportOutcome> {
  if (downloadKind(file) === 'thunder') {
    let data: unknown
    try {
      const res = await deps.client.request(downloadUrl(file, 'thunder'))
      data = await res.json()
    } catch (e) {
      if (isDriveError(e)) throw mapImportDownloadError(e, 'thunder')
      throw new DriveError('invalid_file', `${file.name} is not a readable Thunder Writer file.`)
    }
    const parsed = parseEnvelope(data)
    if (!parsed.ok) throw new DriveError('invalid_file', parsed.reason)
    return { kind: 'thunder', file, doc: parsed.doc }
  }
  const source = await downloadPickedFile(deps.client, file)
  const result = await deps.importManuscript(source)
  return { kind: 'manuscript', file, result }
}

/** Friendly single-line message for any error from the Drive import flow. */
export function importErrorMessage(e: unknown): string {
  if (e instanceof ImportError || isDriveError(e)) return e.message
  if (e instanceof Error && e.message) return e.message
  return 'Something went wrong importing that file.'
}
