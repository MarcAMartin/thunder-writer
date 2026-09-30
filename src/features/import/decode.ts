/** Turning the bytes of a text-based file (txt, Markdown, HTML) into a string. */

export interface DecodedText {
  text: string
  /** Encoding actually used. */
  encoding: string
  /** True when the file wasn't valid UTF-8 and a legacy encoding was guessed. */
  guessed: boolean
}

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

function tryDecode(label: string, bytes: Uint8Array, fatal: boolean): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes)
  } catch {
    return null
  }
}

/** Windows-1252's 0x80–0x9F block (the rest matches Latin-1). 0 = undefined byte, kept as-is. */
const CP1252_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
]

/**
 * Windows-1252 decoded by hand: some TextDecoder implementations (Node's, for
 * one) treat the label as plain Latin-1 and turn curly quotes into control characters.
 */
export function decodeWindows1252(bytes: Uint8Array): string {
  let out = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const codes = Array.from(bytes.subarray(i, i + CHUNK), (b) => (b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] || b : b))
    out += String.fromCharCode(...codes)
  }
  return out
}

/** `<meta charset="…">` or `content="text/html; charset=…"` in the first KB of an HTML file. */
function htmlCharset(bytes: Uint8Array): string | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048))
  const m = /<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9._:-]+)/i.exec(head)
  return m ? m[1].toLowerCase() : null
}

/**
 * Length of the well-formed UTF-8 sequence starting at `i`, or 0 when the byte
 * there doesn't start one (the WHATWG/Unicode definition: no overlongs, no
 * surrogates, nothing above U+10FFFF). ASCII counts as a 1-byte sequence.
 */
function utf8SeqLength(b: Uint8Array, i: number): number {
  const c = b[i]
  if (c < 0x80) return 1
  const cont = (k: number, lo = 0x80, hi = 0xbf) => i + k < b.length && b[i + k] >= lo && b[i + k] <= hi
  if (c >= 0xc2 && c <= 0xdf) return cont(1) ? 2 : 0
  if (c === 0xe0) return cont(1, 0xa0) && cont(2) ? 3 : 0
  if ((c >= 0xe1 && c <= 0xec) || c === 0xee || c === 0xef) return cont(1) && cont(2) ? 3 : 0
  if (c === 0xed) return cont(1, 0x80, 0x9f) && cont(2) ? 3 : 0
  if (c === 0xf0) return cont(1, 0x90) && cont(2) && cont(3) ? 4 : 0
  if (c >= 0xf1 && c <= 0xf3) return cont(1) && cont(2) && cont(3) ? 4 : 0
  if (c === 0xf4) return cont(1, 0x80, 0x8f) && cont(2) && cont(3) ? 4 : 0
  return 0
}

/**
 * A file that is mostly UTF-8 with a few stray legacy bytes (a passage pasted
 * from an old ANSI file): the valid UTF-8 is read as UTF-8 and only the
 * invalid bytes as Windows-1252. Returns null when the file is essentially
 * legacy text (fewer valid multi-byte sequences than invalid bytes), which is
 * then read as Windows-1252 throughout.
 */
function decodeMixed(bytes: Uint8Array): string | null {
  let multi = 0
  let invalid = 0
  for (let i = 0; i < bytes.length; ) {
    const n = utf8SeqLength(bytes, i)
    if (n === 0) {
      invalid++
      i++
    } else {
      if (n > 1) multi++
      i += n
    }
  }
  if (multi <= invalid) return null
  const utf8 = new TextDecoder('utf-8')
  let out = ''
  let runStart = 0
  for (let i = 0; i < bytes.length; ) {
    const n = utf8SeqLength(bytes, i)
    if (n > 0) {
      i += n
      continue
    }
    if (i > runStart) out += utf8.decode(bytes.subarray(runStart, i))
    out += decodeWindows1252(bytes.subarray(i, i + 1))
    i++
    runStart = i
  }
  if (runStart < bytes.length) out += utf8.decode(bytes.subarray(runStart))
  return out
}

/**
 * UTF-8 (the norm) with a byte-order mark honoured for UTF-16. A file that isn't
 * valid UTF-8 was most likely saved by an older Windows/Word install, so it is
 * read as Windows-1252 (or the charset an HTML file declares). A UTF-8 file
 * with only a few stray legacy bytes keeps its UTF-8 and has just those bytes
 * read as Windows-1252. Never throws.
 */
export function decodeText(data: ArrayBuffer | string, opts: { html?: boolean } = {}): DecodedText {
  if (typeof data === 'string') return { text: stripBom(data), encoding: 'utf-16', guessed: false }
  const bytes = new Uint8Array(data)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: stripBom(tryDecode('utf-16le', bytes, false) ?? ''), encoding: 'utf-16le', guessed: false }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: stripBom(tryDecode('utf-16be', bytes, false) ?? ''), encoding: 'utf-16be', guessed: false }
  }
  const utf8 = tryDecode('utf-8', bytes, true)
  if (utf8 !== null) return { text: stripBom(utf8), encoding: 'utf-8', guessed: false }
  if (opts.html) {
    const declared = htmlCharset(bytes)
    if (declared && /^(windows-1252|cp1252|iso-8859-1|latin1|us-ascii|ascii)$/.test(declared)) {
      return { text: stripBom(decodeWindows1252(bytes)), encoding: 'windows-1252', guessed: false }
    }
    if (declared && declared !== 'utf-8' && declared !== 'utf8') {
      const text = tryDecode(declared, bytes, false)
      if (text !== null) return { text: stripBom(text), encoding: declared, guessed: false }
    }
  }
  const mixed = decodeMixed(bytes)
  if (mixed !== null) return { text: stripBom(mixed), encoding: MIXED_ENCODING, guessed: true }
  return { text: stripBom(decodeWindows1252(bytes)), encoding: 'windows-1252', guessed: true }
}

/** `encoding` of a mostly-UTF-8 file with a few Windows-1252 bytes. */
export const MIXED_ENCODING = 'utf-8+windows-1252'

export const ENCODING_WARNING =
  'This file wasn’t saved as UTF-8, so it was read as Western (Windows-1252). If any accented letters or quotation marks look wrong, re-save the file as UTF-8 and import it again.'

export const MIXED_ENCODING_WARNING =
  'Most of this file is UTF-8, but a few characters weren’t (perhaps a passage pasted from an older file). Those were read as Western (Windows-1252); check any curly quotes or accented letters near them.'

/** The writer-facing note for a guessed encoding, or null when the file decoded cleanly. */
export function encodingWarning(d: DecodedText): string | null {
  if (!d.guessed) return null
  return d.encoding === MIXED_ENCODING ? MIXED_ENCODING_WARNING : ENCODING_WARNING
}
