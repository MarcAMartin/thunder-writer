import { hasGooglePicker } from '../storage/googleConfig'
import { ImportError, type ImportFormat, type ImportSource } from './types'

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
/** Drive's type for native Google Docs; they reach the importer already exported as HTML. */
export const GDOC_MIME = 'application/vnd.google-apps.document'

/** MIME types matching IMPORT_ACCEPT, for <input accept> and Picker filters. */
export const IMPORT_MIME_TYPES = [DOCX_MIME, 'text/plain', 'text/markdown', 'text/x-markdown', 'text/html']

const EXT_FORMAT: Record<string, ImportFormat> = {
  docx: 'docx',
  txt: 'text',
  text: 'text',
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  mkd: 'markdown',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
}

const MIME_FORMAT: Record<string, ImportFormat> = {
  [DOCX_MIME]: 'docx',
  [GDOC_MIME]: 'gdoc-html',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/plain': 'text',
}

const SUPPORTED = 'Thunder Writer can import Word (.docx), Google Docs, plain text (.txt), Markdown (.md) and HTML files.'

/** Google Drive for desktop shows each Google Doc on disk as a tiny ".gdoc" link file. */
const GOOGLE_SHORTCUT_EXT = new Set(['gdoc', 'gsheet', 'gslides', 'gdraw', 'gform'])

/** Offers File › Import from Google Drive… only in a build that has it. */
export const googleShortcutMessage = () =>
  hasGooglePicker()
    ? 'This is a shortcut to a Google Doc, not the document itself. Use File › Import from Google Drive… to import it, or in Google Docs choose File › Download › Microsoft Word (.docx) and import that.'
    : 'This is a shortcut to a Google Doc, not the document itself. In Google Docs, choose File › Download › Microsoft Word (.docx), then import that.'

/** The JSON inside a Drive for desktop shortcut: {"doc_id": "…", "email": "…"} or {"url": "https://docs.google.com/…"}. */
function isGoogleShortcut(head: string): boolean {
  const s = head.replace(/^\uFEFF/, '').trimStart()
  return s.startsWith('{') && /"(?:doc_id|resource_id)"\s*:|"url"\s*:\s*"https:\/\/docs\.google\.com\//.test(s.slice(0, 2048))
}

const UNSUPPORTED_EXT: Record<string, string> = {
  doc: 'Older Word “.doc” files can’t be read. In Word, choose File › Save As › Word Document (.docx), then import the .docx.',
  dot: 'Older Word “.doc” files can’t be read. In Word, choose File › Save As › Word Document (.docx), then import the .docx.',
  rtf: 'RTF files can’t be read. Open the file in Word or TextEdit and save it as Word Document (.docx) or plain text, then import that.',
  odt: 'OpenDocument (.odt) files can’t be read yet. In LibreOffice or Word, save a copy as Word Document (.docx), then import that.',
  pages: 'Pages files can’t be read. In Pages, choose File › Export To › Word, then import the .docx.',
  pdf: 'PDFs can’t be imported because they don’t keep paragraphs. Export your manuscript from the app you wrote it in as .docx or plain text instead.',
  epub: 'EPUB files can’t be imported. Export your manuscript from the app you wrote it in as .docx or plain text instead.',
  scriv: 'Scrivener projects can’t be read directly. In Scrivener, choose File › Compile and compile to Word (.docx), then import that.',
  json: 'This looks like a JSON file. To open a Thunder Writer backup (.thunder.json), use File › Open from computer… instead.',
}

/** Lower-case extension without the dot ("" if none). */
export function fileExtension(name: string): string {
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(name.trim())
  return m ? m[1].toLowerCase() : ''
}

/**
 * The file name without an importable extension: "My Novel draft 3.docx" →
 * "My Novel draft 3". Only known extensions are removed, so a Google Doc named
 * "Book 2. The Return" keeps its whole name.
 */
export function stripKnownExtension(name: string): string {
  const trimmed = name.trim()
  const ext = fileExtension(trimmed)
  if (ext && (ext in EXT_FORMAT || ext in UNSUPPORTED_EXT || GOOGLE_SHORTCUT_EXT.has(ext))) return trimmed.slice(0, -(ext.length + 1)).trim()
  return trimmed
}

const startsWith = (b: Uint8Array | null, sig: number[]) => !!b && b.length >= sig.length && sig.every((v, i) => b[i] === v)

export const isZip = (b: Uint8Array | null) => startsWith(b, [0x50, 0x4b, 0x03, 0x04])
/** OLE compound file: an old .doc, or a password-protected .docx. */
export const isOle = (b: Uint8Array | null) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

export const OLE_MESSAGE =
  'This Word file is either password-protected or in the older .doc format, so it can’t be read. In Word, remove the password (File › Info › Protect Document) and save it as Word Document (.docx), then import that.'

function sniffTextStart(head: string): ImportFormat | null {
  const s = head.replace(/^\uFEFF/, '').trimStart().slice(0, 512).toLowerCase()
  if (s.startsWith('<!doctype html') || s.startsWith('<html') || /^<(head|body|meta|p|h[1-6]|div)[\s>]/.test(s)) return 'html'
  return null
}

/**
 * Picks the converter for a source: an explicit `format` wins, then a known
 * extension, then the MIME type, then the first bytes of the file.
 */
export function sniffFormat(source: ImportSource, bytes: Uint8Array | null): ImportFormat {
  if (source.format) return source.format
  const ext = fileExtension(source.name)
  if (GOOGLE_SHORTCUT_EXT.has(ext)) throw new ImportError('unsupported', googleShortcutMessage())
  if (ext in UNSUPPORTED_EXT) throw new ImportError('unsupported', UNSUPPORTED_EXT[ext])
  if (ext in EXT_FORMAT) return EXT_FORMAT[ext]
  const mime = (source.mimeType ?? '').split(';')[0].trim().toLowerCase()
  if (mime === 'application/msword') throw new ImportError('unsupported', UNSUPPORTED_EXT.doc)
  if (mime === 'application/pdf') throw new ImportError('unsupported', UNSUPPORTED_EXT.pdf)
  const head = typeof source.data === 'string' ? source.data.slice(0, 2048) : bytes ? new TextDecoder('latin1').decode(bytes.subarray(0, 2048)) : ''
  // A local file with Drive's Google Docs type is a Drive for desktop shortcut, never the document.
  if (isGoogleShortcut(head)) throw new ImportError('unsupported', googleShortcutMessage())
  if (mime in MIME_FORMAT) {
    const f = MIME_FORMAT[mime]
    // A generic text/plain label on something that is really HTML.
    if (f === 'text' && typeof source.data === 'string' && sniffTextStart(source.data) === 'html') return 'html'
    return f
  }
  if (isZip(bytes)) return 'docx'
  if (isOle(bytes)) throw new ImportError('unsupported', OLE_MESSAGE)
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) throw new ImportError('unsupported', UNSUPPORTED_EXT.pdf)
  if (startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) throw new ImportError('unsupported', UNSUPPORTED_EXT.rtf)
  if (sniffTextStart(head) === 'html') return 'html'
  if (mime === '' || mime.startsWith('text/') || mime === 'application/octet-stream') {
    if (bytes && looksBinary(bytes)) throw new ImportError('unsupported', SUPPORTED)
    return 'text'
  }
  throw new ImportError('unsupported', SUPPORTED)
}

/** NUL bytes in the first few KB mean this isn't a text file (UTF-16 has a BOM and is handled separately). */
function looksBinary(b: Uint8Array): boolean {
  if (startsWith(b, [0xff, 0xfe]) || startsWith(b, [0xfe, 0xff])) return false
  const n = Math.min(b.length, 4096)
  for (let i = 0; i < n; i++) if (b[i] === 0) return true
  return false
}
