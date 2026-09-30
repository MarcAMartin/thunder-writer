import { MAX_IMPORT_BYTES, tooLargeMessage } from '../import/limits'
import { ImportError, type ImportResult, type ImportSource } from '../import/types'
import type { ThunderDoc } from '../../types'
import { BACKUP_SUFFIX, DRIVE_API, DOC_SUFFIX, DriveError, isDriveError, type DriveClient } from './drive'
import { DOCX_MIME, GDOC_MIME, THUNDER_JSON_MIME, type PickedFile } from './picker'
import { parseEnvelope } from './schema'

/**
 * Downloading a file the writer picked in the Google Picker and turning it into
 * a new manuscript. Read-only against Drive: the original file is only ever
 * fetched (GET), never written.
 */

/** Google Docs are exported as HTML; the export endpoint stops at about 10 MB. */
export const GDOC_EXPORT_MIME = 'text/html'

const TEXT_MIMES = new Set(['text/plain', 'text/markdown', 'text/x-markdown', 'text/html'])
const TEXT_EXT = /\.(txt|text|md|markdown|html?)$/i

export type DownloadKind = 'gdoc' | 'binary' | 'text' | 'thunder'

/** A Thunder Writer save, or the .bak Thunder Writer keeps of one before overwriting it. */
export const isThunderFile = (f: Pick<PickedFile, 'name' | 'mimeType'>) => {
  const name = f.name.toLowerCase()
  return (
    (name.endsWith(DOC_SUFFIX) || name.endsWith(DOC_SUFFIX + BACKUP_SUFFIX)) &&
    (f.mimeType === THUNDER_JSON_MIME || f.mimeType === '' || f.mimeType === 'text/plain')
  )
}

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
  // supportsAllDrives: files picked from a Shared drive are otherwise reported as not found.
  return `${DRIVE_API}/${id}?alt=media&supportsAllDrives=true`
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

const tooLarge = (name: string, bytes?: number) => new ImportError('too_large', tooLargeMessage(name, bytes))

/**
 * Reads a download's body, stopping as soon as more than `limit` bytes have
 * arrived (a Content-Length over the limit stops it before anything is read),
 * so an oversized file is never held in memory in full.
 */
export async function readBodyLimited(res: Response, name: string, limit = MAX_IMPORT_BYTES): Promise<ArrayBuffer> {
  const declared = Number(res.headers.get('Content-Length'))
  if (Number.isFinite(declared) && declared > limit) {
    await res.body?.cancel().catch(() => undefined)
    throw tooLarge(name, declared)
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = await res.arrayBuffer()
    if (buf.byteLength > limit) throw tooLarge(name, buf.byteLength)
    return buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge(name)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out.buffer
}

/** Body read with the size limit; an interrupted download becomes a friendly network error. */
async function readPicked(res: Response, file: PickedFile): Promise<ArrayBuffer> {
  try {
    return await readBodyLimited(res, file.name)
  } catch (e) {
    if (e instanceof ImportError) throw e
    throw new DriveError('network', 'The download from Google Drive was interrupted. Try again.')
  }
}

/**
 * Downloads a picked file into the shape importManuscript() takes. Text,
 * Markdown and HTML files stay as bytes, so the importer can detect their
 * encoding (UTF-16, Windows-1252, an HTML <meta charset>) exactly as for a
 * file from the computer; only Google's own HTML export is decoded here, as
 * Google always serves it as UTF-8.
 */
export async function downloadPickedFile(client: Pick<DriveClient, 'request'>, file: PickedFile): Promise<ImportSource> {
  const kind = downloadKind(file)
  if (!kind || kind === 'thunder') throw new ImportError('unsupported', `${file.name}: ${UNSUPPORTED}`)
  if (file.sizeBytes && file.sizeBytes > MAX_IMPORT_BYTES) throw tooLarge(file.name, file.sizeBytes)
  let res: Response
  try {
    res = await client.request(downloadUrl(file, kind))
  } catch (e) {
    throw mapImportDownloadError(e, kind)
  }
  const data = await readPicked(res, file)
  if (kind === 'gdoc') {
    return { name: file.name, mimeType: GDOC_EXPORT_MIME, data: new TextDecoder('utf-8').decode(data), format: 'gdoc-html' }
  }
  if (kind === 'binary') return { name: file.name, mimeType: file.mimeType || DOCX_MIME, data }
  return { name: file.name, mimeType: file.mimeType || undefined, data }
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
    if (file.sizeBytes && file.sizeBytes > MAX_IMPORT_BYTES) throw tooLarge(file.name, file.sizeBytes)
    let res: Response
    try {
      res = await deps.client.request(downloadUrl(file, 'thunder'))
    } catch (e) {
      throw mapImportDownloadError(e, 'thunder')
    }
    const bytes = await readPicked(res, file)
    let data: unknown
    try {
      data = JSON.parse(new TextDecoder('utf-8').decode(bytes))
    } catch {
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
