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
 * UTF-8 (the norm) with a byte-order mark honoured for UTF-16. A file that isn't
 * valid UTF-8 was most likely saved by an older Windows/Word install, so it is
 * read as Windows-1252 (or the charset an HTML file declares). Never throws.
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
  return { text: stripBom(decodeWindows1252(bytes)), encoding: 'windows-1252', guessed: true }
}

export const ENCODING_WARNING =
  'This file wasn’t saved as UTF-8, so it was read as Western (Windows-1252). If any accented letters or quotation marks look wrong, re-save the file as UTF-8 and import it again.'
