import { createStore, get, set, type UseStore } from 'idb-keyval'
import { z } from 'zod'
import type { ContextFile } from '../../types'
import {
  CONTEXT_FILE_EXTENSIONS,
  CONTEXT_FILE_MAX_BYTES,
  CONTEXT_FILES_IDB_KEY,
  CONTEXT_FILES_MAX_COUNT,
  CONTEXT_FILES_MAX_TOTAL_CHARS,
} from './constants'

// Context files live only in this browser's IndexedDB (never on a server).
// Their own database, named with the app prefix so Settings -> "Clear all local
// data" removes it (idb-keyval allows one object store per database, and
// 'thunder-writer' is taken by the storage feature's docs store).
export const CONTEXT_FILES_DB_NAME = 'thunder-writer-context'
const CONTEXT_FILES_STORE_NAME = 'files'
let contextStore: UseStore | undefined
const store = (): UseStore => (contextStore ??= createStore(CONTEXT_FILES_DB_NAME, CONTEXT_FILES_STORE_NAME))

const ContextFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  text: z.string(),
  addedAt: z.number(),
})
const ContextFilesSchema = z.array(ContextFileSchema)

export async function loadContextFiles(): Promise<ContextFile[]> {
  try {
    const raw: unknown = await get(CONTEXT_FILES_IDB_KEY, store())
    const parsed = ContextFilesSchema.safeParse(raw ?? [])
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

export async function saveContextFiles(files: ContextFile[]): Promise<void> {
  await set(CONTEXT_FILES_IDB_KEY, files, store())
}

export const CONTEXT_FILE_ACCEPT = CONTEXT_FILE_EXTENSIONS.join(',')

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

export function isSupportedContextFile(name: string): boolean {
  return (CONTEXT_FILE_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

function htmlToText(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, ' ')
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove())
  // Keep paragraph structure: add breaks after block-level elements.
  doc.querySelectorAll('p, div, br, li, h1, h2, h3, h4, h5, h6, blockquote, tr').forEach((el) => {
    el.append(doc.createTextNode('\n'))
  })
  return doc.body?.textContent ?? ''
}

/** Best-effort RTF -> text without a dependency: drops control words and groups. */
export function rtfToText(rtf: string): string {
  let s = rtf
  // Remove destination groups that hold metadata, fonts, colors, etc.
  s = s.replace(/\{\\\*[^{}]*\}/g, '')
  s = s.replace(/\{\\(fonttbl|colortbl|stylesheet|info|pict|header|footer)[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '')
  s = s.replace(/\\par[d]?\b ?/g, '\n')
  s = s.replace(/\\line\b ?/g, '\n')
  s = s.replace(/\\tab\b ?/g, '\t')
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  s = s.replace(/\\u(-?\d+)\??/g, (_, n: string) => {
    const code = Number(n)
    return String.fromCharCode(code < 0 ? code + 65536 : code)
  })
  s = s.replace(/\\([{}\\])/g, '$1')
  s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, '')
  s = s.replace(/[{}]/g, '')
  return s
}

function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Convert a file's raw text to plain prose according to its extension. */
export function extractText(name: string, raw: string): string {
  const ext = extensionOf(name)
  switch (ext) {
    case '.html':
    case '.htm':
      return normalizeWhitespace(htmlToText(raw))
    case '.rtf':
      return normalizeWhitespace(rtfToText(raw))
    default:
      return normalizeWhitespace(raw)
  }
}

export type AddResult = { ok: true; files: ContextFile[] } | { ok: false; error: string }

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const fmtChars = (n: number) => n.toLocaleString('en-US')

/** Validate and extract a new file, returning the updated list or a writer-facing error. */
export async function addContextFile(existing: ContextFile[], file: File, now = Date.now()): Promise<AddResult> {
  if (!isSupportedContextFile(file.name)) {
    return {
      ok: false,
      error: `"${file.name}" isn't a supported format. Use plain text, Markdown, HTML, JSON, or RTF (${CONTEXT_FILE_EXTENSIONS.join(', ')}). For Word or PDF files, save a copy as .txt first.`,
    }
  }
  if (existing.length >= CONTEXT_FILES_MAX_COUNT) {
    return { ok: false, error: `You can keep up to ${CONTEXT_FILES_MAX_COUNT} context files. Remove one to add another.` }
  }
  if (file.size > CONTEXT_FILE_MAX_BYTES) {
    return { ok: false, error: `"${file.name}" is larger than ${CONTEXT_FILE_MAX_BYTES / (1024 * 1024)} MB. Try a shorter excerpt.` }
  }
  let raw: string
  try {
    raw = await file.text()
  } catch {
    return { ok: false, error: `Couldn't read "${file.name}".` }
  }
  const text = extractText(file.name, raw)
  if (!text) return { ok: false, error: `"${file.name}" doesn't contain any readable text.` }
  const used = existing.reduce((n, f) => n + f.text.length, 0)
  if (used + text.length > CONTEXT_FILES_MAX_TOTAL_CHARS) {
    return {
      ok: false,
      error: `Context files are limited to ${fmtChars(CONTEXT_FILES_MAX_TOTAL_CHARS)} characters in total (${fmtChars(used)} used; "${file.name}" has ${fmtChars(text.length)}). Remove a file or add a shorter excerpt.`,
    }
  }
  const entry: ContextFile = { id: newId(), name: file.name, text, addedAt: now }
  return { ok: true, files: [...existing, entry] }
}
