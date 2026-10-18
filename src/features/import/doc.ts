import * as CFB from 'cfb'
import { decodeCp1252 } from './cp1252'
import { ImportError } from './types'

/**
 * Word 97–2003 (.doc) files: an OLE compound file whose "WordDocument" stream
 * holds the text, located through the piece table (the CLX) in the "0Table"
 * or "1Table" stream (MS-DOC 2.4.1). Only the main document's text is read;
 * formatting isn't, so the result is plain paragraphs (chapter lines are
 * recognised later, as in a text file).
 */

const PASSWORD_MESSAGE =
  'This Word file is password-protected, so it can’t be read. In Word, remove the password (File › Info › Protect Document), save it, then import it again.'

const OLD_WORD_MESSAGE =
  'This .doc was saved by Word 95 or older, which Thunder Writer can’t read. Open it in Word or Pages and save it as Word Document (.docx), then import that.'

const NOT_WORD_MESSAGE =
  'This file isn’t a Word document Thunder Writer can read. If it opens in Word or Pages, save it as Word Document (.docx) and import that.'

const toBytes = (c: CFB.CFB$Blob | undefined): Uint8Array | null => {
  if (!c) return null
  if (c instanceof Uint8Array) return c
  return Uint8Array.from(c as ArrayLike<number>)
}

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8)
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
const i32 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)

/** Byte offsets in the File Information Block (MS-DOC 2.5.1). */
const FIB = {
  wIdent: 0x0000,
  flags: 0x000a,
  ccpText: 0x004c,
  fcClx: 0x01a2,
  lcbClx: 0x01a6,
}

const WORD97_IDENT = 0xa5ec
const WORD95_IDENT = 0xa5dc
const F_ENCRYPTED = 0x0100
const F_WHICH_TBL_STM = 0x0200
const F_COMPRESSED = 0x40000000

/** The main document's raw text, characters exactly as Word stores them (with its control characters). */
export function readDocText(bytes: Uint8Array): string {
  let cfb: CFB.CFB$Container
  try {
    cfb = CFB.read(bytes, { type: 'array' })
  } catch {
    throw new ImportError('corrupt', NOT_WORD_MESSAGE)
  }
  // An encrypted .docx is an OLE file too, holding the encrypted package instead.
  if (CFB.find(cfb, 'EncryptedPackage') || CFB.find(cfb, 'EncryptionInfo')) throw new ImportError('unsupported', PASSWORD_MESSAGE)
  const word = toBytes(CFB.find(cfb, 'WordDocument')?.content)
  if (!word || word.length < FIB.lcbClx + 4) throw new ImportError('unsupported', NOT_WORD_MESSAGE)

  const ident = u16(word, FIB.wIdent)
  if (ident === WORD95_IDENT) throw new ImportError('unsupported', OLD_WORD_MESSAGE)
  if (ident !== WORD97_IDENT) throw new ImportError('unsupported', NOT_WORD_MESSAGE)
  const flags = u16(word, FIB.flags)
  if (flags & F_ENCRYPTED) throw new ImportError('unsupported', PASSWORD_MESSAGE)

  const table = toBytes(CFB.find(cfb, flags & F_WHICH_TBL_STM ? '1Table' : '0Table')?.content)
  if (!table) throw new ImportError('corrupt', NOT_WORD_MESSAGE)
  const ccpText = Math.max(0, i32(word, FIB.ccpText))
  const fcClx = u32(word, FIB.fcClx)
  const lcbClx = u32(word, FIB.lcbClx)
  if (fcClx + lcbClx > table.length || lcbClx === 0) throw new ImportError('corrupt', NOT_WORD_MESSAGE)

  // CLX: any number of Prc (0x01) property blocks, then one Pcdt (0x02) with the piece table.
  let at = fcClx
  const end = fcClx + lcbClx
  while (at < end && table[at] === 0x01) at += 3 + u16(table, at + 1)
  if (table[at] !== 0x02) throw new ImportError('corrupt', NOT_WORD_MESSAGE)
  const lcb = u32(table, at + 1)
  const plc = at + 5
  const pieces = Math.floor((lcb - 4) / 12)
  if (pieces <= 0 || plc + lcb > table.length) throw new ImportError('corrupt', NOT_WORD_MESSAGE)

  const utf16 = new TextDecoder('utf-16le')
  let text = ''
  for (let i = 0; i < pieces; i++) {
    const cpStart = u32(table, plc + i * 4)
    const cpEnd = u32(table, plc + (i + 1) * 4)
    if (cpStart >= ccpText) break
    const length = Math.min(cpEnd, ccpText) - cpStart
    if (length <= 0) continue
    const pcd = plc + (pieces + 1) * 4 + i * 8
    const fc = u32(table, pcd + 2)
    if (fc & F_COMPRESSED) {
      const from = (fc & ~F_COMPRESSED) / 2
      text += decodeCp1252(word.subarray(from, from + length))
    } else {
      text += utf16.decode(word.subarray(fc, fc + length * 2))
    }
  }
  return text
}

/**
 * Word's control characters to plain paragraphs: paragraph marks, line and
 * page breaks and table cells end paragraphs; a field keeps its result and
 * drops its code; pictures and other anchors are removed.
 */
export function docTextToParagraphs(raw: string): string[] {
  let out = ''
  // Fields: 0x13 code 0x14 result 0x15, possibly nested. Inside a code part, drop text.
  const inCode: boolean[] = []
  for (const ch of raw) {
    const c = ch.charCodeAt(0)
    if (c === 0x13) {
      inCode.push(true)
      continue
    }
    if (c === 0x14) {
      if (inCode.length) inCode[inCode.length - 1] = false
      continue
    }
    if (c === 0x15) {
      inCode.pop()
      continue
    }
    if (inCode.length && inCode[inCode.length - 1]) continue
    if (c === 0x0d || c === 0x0b || c === 0x0c || c === 0x07) out += '\n'
    else if (c === 0x09) out += '\t'
    else if (c === 0x1e) out += '-' // non-breaking hyphen
    else if (c === 0x1f) continue // optional hyphen
    else if (c === 0xa0) out += ' '
    else if (c < 0x20) continue // pictures (0x01), drawn objects (0x08), footnote marks (0x02)…
    else out += ch
  }
  return out
    .split('\n')
    .map((p) => p.replace(/[ \t]+/g, ' ').trim())
    .filter((p) => p.length > 0)
}

/** A .doc file as plain text, one paragraph per blank-line-separated block (for the text importer). */
export function docToText(bytes: Uint8Array): string {
  return docTextToParagraphs(readDocText(bytes)).join('\n\n')
}
