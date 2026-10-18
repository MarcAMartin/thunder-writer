import { decodeCp1252 } from './cp1252'
import { ImportError } from './types'

/**
 * Rich Text Format to simple HTML (paragraphs, headings, bold, italic,
 * underline, strikethrough, centred/right/justified paragraphs, line
 * breaks), which the HTML importer then shapes into a manuscript. Many ".doc"
 * files from older apps and TextEdit are RTF inside. Headings come from the
 * style sheet ("heading 1"…) or a paragraph's outline level. Tables, pictures,
 * headers and footers, footnotes and other destinations are left out.
 */

/** Groups whose contents are never text in the body. */
const SKIP = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'shp', 'shpinst', 'nonshppict', 'header', 'headerl',
  'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'footnote', 'listtable', 'listoverridetable', 'rsidtbl',
  'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'fldinst', 'revtbl', 'pgdsctbl',
  'filetbl', 'mmathPr', 'expandedcolortbl', 'listtext', 'pntext', 'bkmkstart', 'bkmkend', 'field-inst', 'userprops', 'docvar',
])

const SYMBOLS: Record<string, string> = {
  emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', bullet: '•', emspace: ' ', enspace: ' ', qmspace: ' ',
}

interface CharState {
  b: boolean
  i: boolean
  ul: boolean
  strike: boolean
  /** Characters to skip after a \uN (its ANSI fallback). */
  uc: number
  skip: boolean
}

interface Para {
  align: 'left' | 'center' | 'right' | 'justify'
  /** 1–3 for a heading. */
  heading: number
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** "heading 1" style numbers from a {\stylesheet …} group's raw text. */
export function headingStyles(stylesheet: string): Map<number, number> {
  const out = new Map<number, number>()
  for (const m of stylesheet.matchAll(/\{[^{}]*?\\s(\d+)\b[^{}]*?\s([^\\{};][^{};]*);\s*\}/g)) {
    const level = /^heading\s*([1-3])\b/i.exec(m[2].trim())
    if (level) out.set(Number(m[1]), Number(level[1]))
  }
  return out
}

export function rtfToHtml(rtf: string): string {
  if (!/^\s*\{\\rtf/.test(rtf)) throw new ImportError('corrupt', 'This isn’t a readable RTF file.')
  const sheet = /\{\\stylesheet([\s\S]*?)\}\s*(?:\{\\\*?\\?(?:info|listtable|rsidtbl|generator)|\\(?:paperw|margl|viewkind|pard|sectd))/.exec(rtf)
  const headings = headingStyles(sheet ? sheet[1] : '')

  const stack: CharState[] = []
  let st: CharState = { b: false, i: false, ul: false, strike: false, uc: 1, skip: false }
  let para: Para = { align: 'left', heading: 0 }
  let styleHeading = 0
  let outline = 0
  const paragraphs: string[] = []
  let html = ''
  let pendingSkip = 0
  let open = { b: false, i: false, ul: false, strike: false }

  const closeMarks = () => {
    if (open.strike) html += '</s>'
    if (open.ul) html += '</u>'
    if (open.i) html += '</em>'
    if (open.b) html += '</strong>'
    open = { b: false, i: false, ul: false, strike: false }
  }
  const emit = (text: string) => {
    if (st.skip || !text) return
    if (open.b !== st.b || open.i !== st.i || open.ul !== st.ul || open.strike !== st.strike) {
      closeMarks()
      if (st.b) html += '<strong>'
      if (st.i) html += '<em>'
      if (st.ul) html += '<u>'
      if (st.strike) html += '<s>'
      open = { b: st.b, i: st.i, ul: st.ul, strike: st.strike }
    }
    html += escapeHtml(text)
  }
  const endParagraph = () => {
    closeMarks()
    const level = para.heading || styleHeading || outline
    const tag = level >= 1 && level <= 3 ? `h${level}` : 'p'
    // Chapter and part headings are centred in Thunder Writer anyway.
    const defaultAlign = level === 1 || level === 2 ? 'center' : 'left'
    const style = para.align !== 'left' && para.align !== defaultAlign ? ` style="text-align:${para.align}"` : ''
    if (html.replace(/<[^>]+>/g, '').trim()) paragraphs.push(`<${tag}${style}>${html}</${tag}>`)
    html = ''
  }

  let i = 0
  const n = rtf.length
  let groupStart = false
  while (i < n) {
    const c = rtf[i]
    if (c === '{') {
      stack.push({ ...st })
      groupStart = true
      i++
      continue
    }
    if (c === '}') {
      const prev = stack.pop()
      if (prev) st = prev
      groupStart = false
      i++
      continue
    }
    if (c === '\\') {
      const next = rtf[i + 1]
      // Control symbols.
      if (next === '\\' || next === '{' || next === '}') {
        if (pendingSkip > 0) pendingSkip--
        else emit(next)
        i += 2
        groupStart = false
        continue
      }
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4)
        if (pendingSkip > 0) pendingSkip--
        else emit(decodeCp1252([parseInt(hex, 16) || 0x3f]))
        i += 4
        groupStart = false
        continue
      }
      if (next === '*') {
        // An optional destination: skip the group unless we know it (we don't need any).
        st.skip = true
        i += 2
        continue
      }
      if (next === '~') {
        emit(' ')
        i += 2
        continue
      }
      if (next === '_') {
        emit('-')
        i += 2
        continue
      }
      if (next === '-' || next === ':' || next === '|') {
        i += 2
        continue
      }
      if (next === '\n' || next === '\r') {
        if (!st.skip) endParagraph()
        i += 2
        continue
      }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i + 1, i + 40))
      if (!m) {
        i += 2
        continue
      }
      i += 1 + m[0].length
      const word = m[1]
      const arg = m[2] === undefined ? null : Number(m[2])
      const atGroupStart = groupStart
      groupStart = false
      if (atGroupStart && SKIP.has(word)) {
        st.skip = true
        continue
      }
      if (st.skip) continue
      switch (word) {
        case 'par':
        case 'sect':
        case 'page':
          endParagraph()
          break
        case 'pard':
          para = { align: 'left', heading: 0 }
          styleHeading = 0
          outline = 0
          break
        case 'plain':
          st = { ...st, b: false, i: false, ul: false, strike: false }
          break
        case 'line':
          emit('\n')
          break
        case 'tab':
          emit('\t')
          break
        case 'qc':
          para.align = 'center'
          break
        case 'qr':
          para.align = 'right'
          break
        case 'qj':
          para.align = 'justify'
          break
        case 'ql':
          para.align = 'left'
          break
        case 's':
          styleHeading = arg !== null ? (headings.get(arg) ?? 0) : 0
          break
        case 'outlinelevel':
          outline = arg !== null && arg >= 0 && arg <= 2 ? arg + 1 : 0
          break
        case 'b':
          st.b = arg !== 0
          break
        case 'i':
          st.i = arg !== 0
          break
        case 'ul':
          st.ul = arg !== 0
          break
        case 'ulnone':
          st.ul = false
          break
        case 'strike':
          st.strike = arg !== 0
          break
        case 'uc':
          st.uc = arg ?? 1
          break
        case 'u': {
          if (arg !== null) emit(String.fromCharCode(arg < 0 ? arg + 65536 : arg))
          pendingSkip = st.uc
          break
        }
        default:
          if (word in SYMBOLS) emit(SYMBOLS[word])
      }
      continue
    }
    if (c === '\r' || c === '\n') {
      i++
      continue
    }
    groupStart = false
    if (pendingSkip > 0) {
      pendingSkip--
      i++
      continue
    }
    // Plain text up to the next control character.
    let j = i
    while (j < n && rtf[j] !== '\\' && rtf[j] !== '{' && rtf[j] !== '}' && rtf[j] !== '\r' && rtf[j] !== '\n') j++
    emit(rtf.slice(i, j))
    i = j
  }
  endParagraph()
  return `<html><body>${paragraphs.join('\n').replace(/\n(?!<)/g, '<br>')}</body></html>`
}
