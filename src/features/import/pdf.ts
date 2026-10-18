import { ImportError } from './types'

/**
 * PDF to simple HTML. A PDF keeps where each piece of text sits, not its
 * paragraphs, so they are rebuilt from the layout: lines are grouped from the
 * text pieces, a paragraph ends at a wider gap, an indented line or a short
 * last line, and clearly larger lines become headings. Running heads, footers
 * and page numbers (short lines in the top or bottom margin that repeat or are
 * just numbers) are left out. PDF.js loads only when a PDF is imported.
 */

export interface PdfLine {
  text: string
  /** Left edge and baseline, in PDF points, y up from the bottom of the page. */
  x: number
  y: number
  /** Font size in points. */
  size: number
  /** Right edge. */
  right: number
}

export interface PdfPage {
  width: number
  height: number
  lines: PdfLine[]
}

interface TextPiece {
  str: string
  transform: number[]
  width: number
  height: number
  hasEOL?: boolean
}

/** Text pieces of one page grouped into lines, top to bottom. */
export function piecesToLines(pieces: readonly TextPiece[]): PdfLine[] {
  const items = pieces
    .filter((p) => p.str.length > 0)
    .map((p) => ({ str: p.str, x: p.transform[4], y: p.transform[5], size: Math.hypot(p.transform[2], p.transform[3]) || p.height || 10, width: p.width }))
    .sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: PdfLine[] = []
  let current: (PdfLine & { parts: typeof items }) | null = null
  for (const it of items) {
    if (current && Math.abs(it.y - current.y) <= Math.max(current.size, it.size) * 0.35) {
      current.parts.push(it)
      continue
    }
    if (current) lines.push(finishLine(current.parts))
    current = { text: '', x: it.x, y: it.y, size: it.size, right: it.x + it.width, parts: [it] }
  }
  if (current) lines.push(finishLine(current.parts))
  return lines.filter((l) => l.text.trim().length > 0)
}

function finishLine(parts: { str: string; x: number; y: number; size: number; width: number }[]): PdfLine {
  parts.sort((a, b) => a.x - b.x)
  let text = ''
  let end = Number.NEGATIVE_INFINITY
  for (const p of parts) {
    // A visible gap between pieces is a space the PDF didn't spell out.
    if (text && !/\s$/.test(text) && !/^\s/.test(p.str) && p.x - end > p.size * 0.15) text += ' '
    text += p.str
    end = p.x + p.width
  }
  const sizes = parts.map((p) => p.size).sort((a, b) => a - b)
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    x: parts[0].x,
    y: Math.min(...parts.map((p) => p.y)),
    size: sizes[Math.floor(sizes.length / 2)],
    right: end,
  }
}

const normalize = (s: string) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
const isPageNumber = (s: string) => /^(?:page\s+)?(?:\d{1,4}|[ivxlcdm]{1,7})(?:\s+of\s+\d{1,4})?$/i.test(s.trim())
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The most common value, weighted (e.g. the body text's font size by characters). */
function mode(values: { v: number; w: number }[]): number {
  const counts = new Map<number, number>()
  for (const { v, w } of values) {
    const k = Math.round(v * 2) / 2
    counts.set(k, (counts.get(k) ?? 0) + w)
  }
  let best = 0
  let bestW = -1
  for (const [k, w] of counts) if (w > bestW) [best, bestW] = [k, w]
  return best
}

/** Rebuilt paragraphs and headings as HTML (pure; see the module comment). */
export function pdfPagesToHtml(pages: readonly PdfPage[]): string {
  const all = pages.flatMap((p) => p.lines)
  if (all.length === 0) return ''
  const body = mode(all.map((l) => ({ v: l.size, w: l.text.length }))) || 10

  // Running heads and footers: short lines near the top or bottom edge that are page numbers or repeat.
  const edge = (p: PdfPage, l: PdfLine) => l.y > p.height * 0.9 || l.y < p.height * 0.1
  const repeats = new Map<string, number>()
  for (const p of pages) {
    const seen = new Set<string>()
    for (const l of p.lines) if (edge(p, l) && l.text.split(' ').length <= 10) seen.add(normalize(l.text))
    for (const k of seen) repeats.set(k, (repeats.get(k) ?? 0) + 1)
  }
  const minRepeats = Math.max(2, Math.ceil(pages.length * 0.3))
  const furniture = (p: PdfPage, l: PdfLine) =>
    edge(p, l) && l.text.split(' ').length <= 10 && (isPageNumber(l.text) || (pages.length > 2 && (repeats.get(normalize(l.text)) ?? 0) >= minRepeats))

  const blocks: string[] = []
  let para = ''
  const flush = () => {
    if (para.trim()) blocks.push(`<p>${escapeHtml(para.trim())}</p>`)
    para = ''
  }
  for (const page of pages) {
    const lines = page.lines.filter((l) => !furniture(page, l))
    if (lines.length === 0) continue
    const left = Math.min(...lines.filter((l) => Math.abs(l.size - body) < 0.6).map((l) => l.x).concat(lines[0].x))
    const width = Math.max(...lines.map((l) => l.right)) - left
    lines.forEach((l, k) => {
      const prev = lines[k - 1]
      // Larger type: a heading (its own block). Chapter-like headings are recognised later.
      if (l.size >= body * 1.25) {
        flush()
        const level = l.size >= body * 1.6 ? 1 : 2
        const last = blocks[blocks.length - 1]
        // A heading set over two lines comes back as one.
        if (last?.startsWith(`<h${level}>`) && prev && prev.size >= body * 1.25 && prev.y - l.y < l.size * 1.8) {
          blocks[blocks.length - 1] = last.replace(`</h${level}>`, ` ${escapeHtml(l.text)}</h${level}>`)
        } else blocks.push(`<h${level}>${escapeHtml(l.text)}</h${level}>`)
        return
      }
      const indented = l.x - left > body * 0.8 && l.x - left < width * 0.3
      const gap = prev ? prev.y - l.y : 0
      const wideGap = prev && prev.size < body * 1.25 && gap > Math.max(prev.size, l.size) * 1.9
      const prevShort = prev && prev.size < body * 1.25 && prev.right < left + width * 0.82 && /[.!?:"”’)\]]$/.test(prev.text)
      const centered = Math.abs((l.x + l.right) / 2 - (left + width / 2)) < body && l.x - left > width * 0.15
      if (!para || indented || wideGap || prevShort || centered) flush()
      if (centered) {
        blocks.push(`<p style="text-align:center">${escapeHtml(l.text)}</p>`)
        return
      }
      // A word broken across lines with a hyphen joins up; otherwise lines join with a space.
      if (para.endsWith('-') && /^[a-z]/.test(l.text)) para = para.slice(0, -1) + l.text
      else para += (para ? ' ' : '') + l.text
    })
    // A paragraph running onto the next page continues there unless this page ended on a short last line
    // (or the next page starts indented, caught above).
    const last = lines[lines.length - 1]
    if (last.right < left + width * 0.82 && /[.!?:"”’)\]]$/.test(last.text)) flush()
  }
  flush()
  return `<html><body>${blocks.join('\n')}</body></html>`
}

/** Reads a PDF's text with PDF.js (loaded on demand) and rebuilds it as HTML. */
export async function pdfToHtml(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  }
  const task = pdfjs.getDocument({ data: bytes.slice() })
  let doc: Awaited<typeof task.promise>
  try {
    doc = await task.promise
  } catch (e) {
    void task.destroy()
    if (e instanceof Error && e.name === 'PasswordException') {
      throw new ImportError('unsupported', 'This PDF is password-protected, so it can’t be read. Save a copy without the password, then import that.')
    }
    throw new ImportError('corrupt', 'This PDF couldn’t be read. It may be damaged.')
  }
  const pages: PdfPage[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const [, , width, height] = page.view
      const content = await page.getTextContent()
      const pieces: TextPiece[] = []
      for (const item of content.items) if ('str' in item) pieces.push(item)
      pages.push({ width, height, lines: piecesToLines(pieces) })
      page.cleanup()
    }
  } finally {
    void task.destroy()
  }
  if (!pages.some((p) => p.lines.length)) {
    throw new ImportError(
      'empty',
      'No text was found in this PDF. It may be scanned pages (pictures of text). Export the manuscript from the app you wrote it in as .docx or plain text instead.',
    )
  }
  return pdfPagesToHtml(pages)
}
