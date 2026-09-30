import { MAX_DOCX_ENTRIES, MAX_DOCX_XML_BYTES, formatMB } from './limits'
import { ImportError } from './types'

/**
 * Just enough ZIP reading to vet a .docx before mammoth unpacks it: the entry
 * list comes from the central directory, and the XML parts are inflated with
 * the browser's DecompressionStream while counting bytes, so a "zip bomb" is
 * stopped at the limit instead of exhausting memory. Mammoth (via JSZip) does
 * the real conversion afterwards.
 */

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

const CORRUPT = 'This .docx file looks damaged and can’t be read. Try opening it in Word and saving it again.'
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
const ZIP64 = 0xffffffff

const tooLarge = (limit = MAX_DOCX_XML_BYTES) =>
  new ImportError(
    'too_large',
    `This Word file expands to more than ${formatMB(limit)} of text data, which is far more than any manuscript. It may be damaged or deliberately malformed, so it wasn’t opened.`,
  )

export function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  // End of central directory: 22 bytes plus an optional comment of up to 64 KB.
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ImportError('corrupt', CORRUPT)
  const count = u16(bytes, eocd + 10)
  const cdOffset = u32(bytes, eocd + 16)
  if (count > MAX_DOCX_ENTRIES) throw new ImportError('corrupt', CORRUPT)
  if (cdOffset === ZIP64 || cdOffset >= bytes.length) throw new ImportError('corrupt', CORRUPT)
  const names = new TextDecoder('utf-8')
  const entries: ZipEntry[] = []
  let p = cdOffset
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new ImportError('corrupt', CORRUPT)
    const nameLen = u16(bytes, p + 28)
    const extraLen = u16(bytes, p + 30)
    const commentLen = u16(bytes, p + 32)
    const entry: ZipEntry = {
      method: u16(bytes, p + 10),
      compressedSize: u32(bytes, p + 20),
      uncompressedSize: u32(bytes, p + 24),
      localHeaderOffset: u32(bytes, p + 42),
      name: names.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
    }
    entries.push(entry)
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function entryData(bytes: Uint8Array, e: ZipEntry): Uint8Array {
  const o = e.localHeaderOffset
  if (o + 30 > bytes.length || u32(bytes, o) !== 0x04034b50) throw new ImportError('corrupt', CORRUPT)
  const start = o + 30 + u16(bytes, o + 26) + u16(bytes, o + 28)
  const end = start + e.compressedSize
  if (end > bytes.length) throw new ImportError('corrupt', CORRUPT)
  return bytes.subarray(start, end)
}

const canInflate = () => typeof DecompressionStream === 'function' && typeof ReadableStream === 'function'

/**
 * Inflates one entry, giving up (too_large) once more than `limit` bytes come
 * out. With `keep` false only the size is measured and nothing is retained.
 */
async function inflate(bytes: Uint8Array, e: ZipEntry, limit: number, keep: boolean, cap: number): Promise<{ size: number; data?: Uint8Array }> {
  const raw = entryData(bytes, e)
  if (e.method === 0) {
    if (raw.length > limit) throw tooLarge(cap)
    return { size: raw.length, data: keep ? raw : undefined }
  }
  if (e.method !== 8) throw new ImportError('corrupt', CORRUPT)
  const input = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(raw.slice())
      c.close()
    },
  })
  const reader = input.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel().catch(() => undefined)
        throw tooLarge(cap)
      }
      if (keep) chunks.push(value)
    }
  } catch (err) {
    if (err instanceof ImportError) throw err
    throw new ImportError('corrupt', CORRUPT)
  }
  if (!keep) return { size }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return { size, data: out }
}

/**
 * Parts the importer never reads: pictures, audio/video, embedded fonts and
 * embedded objects. Everything else is measured, whatever its name, because
 * mammoth finds the parts it reads through relationships, not by file name.
 */
const isMediaName = (name: string) =>
  /\/embeddings\//i.test(name) ||
  /\.(png|jpe?g|jfif|gif|bmp|tiff?|emf|wmf|emz|wmz|svg|webp|ico|wdp|heic|mp4|m4v|mov|avi|wmv|mp3|m4a|wav|odttf|ttf|otf|fntdata)$/i.test(name)

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
/** Parts mammoth reads through the main document's relationships (docx-reader.js findPartPaths). */
const RELATED_PARTS = ['styles', 'numbering', 'footnotes', 'endnotes', 'comments'] as const
export type RelatedPart = (typeof RELATED_PARTS)[number]

interface Relationship {
  type: string
  target: string
}

function readRelationships(xml: string | null): Relationship[] {
  if (!xml) return []
  const out: Relationship[] = []
  for (const m of xml.matchAll(/<(?:[\w-]+:)?Relationship\b([^>]*)>/g)) {
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(m[1])
    const type = attr('Type')
    const target = attr('Target')
    if (type && target) out.push({ type: type[1] ?? type[2], target: target[1] ?? target[2] })
  }
  return out
}

/** Resolves a relationship target against a folder, the way mammoth does ("../x" and "/x" included). */
function joinPart(base: string, target: string): string {
  const parts = target.startsWith('/') ? [] : base.split('/').filter(Boolean)
  for (const seg of target.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)
/** "word/document.xml" → "word/_rels/document.xml.rels". */
const relsPathFor = (path: string) => joinPart(dirname(path), `_rels/${basename(path)}.rels`)

export interface DocxParts {
  /** The main document part (usually word/document.xml). */
  document: string
  /** Styles, numbering, notes and comments parts, when the package has them. */
  related: Partial<Record<RelatedPart, string>>
}

export interface DocxPackage {
  entries: ZipEntry[]
  /** The parts mammoth will read, resolved from the package relationships. */
  parts: DocxParts
  /** Reads a small part as text (null when absent). */
  readText(name: string): Promise<string | null>
}

/** Browsers without DecompressionStream can't measure a .docx safely, so it isn't opened at all. */
export const NO_INFLATE_MESSAGE =
  'This browser can’t safely open Word files. Update it (or use a current version of Chrome, Edge, Firefox or Safari), or save the manuscript as plain text and import that.'

/**
 * Checks a .docx is a sane zip whose parts fit within MAX_DOCX_XML_BYTES,
 * measured by actually inflating them (declared sizes can lie). Every part is
 * counted except pictures, fonts and embedded objects, and those are counted
 * too if the package's relationships name one of them as a part mammoth reads
 * (the main document, styles, numbering, notes or comments), since a crafted
 * file can give its document any name. Pictures are otherwise never inflated:
 * the importer drops them.
 */
export async function vetDocx(bytes: Uint8Array, cap = MAX_DOCX_XML_BYTES): Promise<DocxPackage> {
  const entries = readZipDirectory(bytes)
  if (!entries.some((e) => e.name === '[Content_Types].xml') || !entries.some((e) => /^word\/.+\.xml$/i.test(e.name))) {
    throw new ImportError('corrupt', 'This file isn’t a Word document (.docx), or it is damaged. Try opening it in Word and saving it again.')
  }
  if (!canInflate()) throw new ImportError('unsupported', NO_INFLATE_MESSAGE)
  const byName = new Map(entries.map((e) => [e.name, e]))
  let budget = cap
  const counted = new Set<string>()
  /** Inflates a part within the remaining budget (counting it once) and decodes it. */
  const readPart = async (name: string, limit = budget): Promise<string | null> => {
    const e = byName.get(name)
    if (!e) return null
    const { size, data } = await inflate(bytes, e, limit, true, cap)
    if (!counted.has(name)) {
      counted.add(name)
      budget -= size
    }
    return data ? new TextDecoder('utf-8').decode(data) : null
  }

  // Which parts mammoth will read (docx-reader.js findPartPaths), resolved like it does.
  const pkgRels = readRelationships(await readPart('_rels/.rels'))
  const exists = (p: string) => byName.has(p)
  const find = (rels: Relationship[], type: string, base: string, fallback: string) =>
    rels.filter((r) => r.type === REL + type).map((r) => joinPart(base, r.target)).find(exists) ?? fallback
  const document = find(pkgRels, 'officeDocument', '', 'word/document.xml')
  const docRels = readRelationships(await readPart(relsPathFor(document)))
  const related: DocxParts['related'] = {}
  for (const name of RELATED_PARTS) {
    const p = find(docRels, name, dirname(document), `word/${name}.xml`)
    if (exists(p)) related[name] = p
  }
  const read = new Set([document, ...Object.values(related)])

  const measured = entries.filter((e) => !isMediaName(e.name) || read.has(e.name))
  let declared = 0
  for (const e of measured) {
    if (e.uncompressedSize === ZIP64 || e.compressedSize === ZIP64) throw tooLarge(cap)
    declared += e.uncompressedSize
  }
  if (declared > cap) throw tooLarge(cap)
  for (const e of measured) {
    if (!counted.has(e.name)) budget -= (await inflate(bytes, e, budget, false, cap)).size
  }

  return {
    entries,
    parts: { document, related },
    // Everything has been measured by now; later reads are only bounded by the cap.
    readText: (name) => readPart(name, cap),
  }
}
