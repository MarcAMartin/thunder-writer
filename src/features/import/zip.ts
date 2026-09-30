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

const isXmlPart = (name: string) => /\.(xml|rels)$/i.test(name)

export interface DocxPackage {
  entries: ZipEntry[]
  /** Reads a small part as text (null when absent or the browser can't inflate). */
  readText(name: string): Promise<string | null>
}

/**
 * Checks a .docx is a sane zip whose XML parts fit within MAX_DOCX_XML_BYTES,
 * measured by actually inflating them (declared sizes can lie). Images and
 * other media are never inflated: the importer drops them.
 */
export async function vetDocx(bytes: Uint8Array, cap = MAX_DOCX_XML_BYTES): Promise<DocxPackage> {
  const entries = readZipDirectory(bytes)
  if (!entries.some((e) => e.name === '[Content_Types].xml') || !entries.some((e) => /^word\/.+\.xml$/i.test(e.name))) {
    throw new ImportError('corrupt', 'This file isn’t a Word document (.docx), or it is damaged. Try opening it in Word and saving it again.')
  }
  const xml = entries.filter((e) => isXmlPart(e.name))
  let declared = 0
  for (const e of xml) {
    if (e.uncompressedSize === ZIP64 || e.compressedSize === ZIP64) throw tooLarge(cap)
    declared += e.uncompressedSize
  }
  if (declared > cap) throw tooLarge(cap)
  if (canInflate()) {
    let budget = cap
    for (const e of xml) budget -= (await inflate(bytes, e, budget, false, cap)).size
  }
  return {
    entries,
    async readText(name) {
      const e = entries.find((x) => x.name === name)
      if (!e || !canInflate()) return null
      const { data } = await inflate(bytes, e, cap, true, cap)
      return data ? new TextDecoder('utf-8').decode(data) : null
    },
  }
}
