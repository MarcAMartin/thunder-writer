import type { JSONContent } from '@tiptap/core'
import { checkContent, sanitizeContent } from '../editor/contentCheck'
import { decodeText, ENCODING_WARNING } from './decode'
import { docxToHtml } from './docx'
import { htmlToDoc, type HtmlStats } from './html'
import { MAX_IMPORT_BYTES, tooLargeMessage } from './limits'
import { markdownToDoc } from './markdown'
import { sniffFormat, stripKnownExtension } from './sniff'
import { shapeManuscript } from './structure'
import { textToDoc } from './text'
import { ImportError, type ImportResult, type ImportSource } from './types'

/** File extensions the importer accepts, for <input accept> and Picker filters (MIME types: IMPORT_MIME_TYPES). */
export const IMPORT_ACCEPT = ['.docx', '.txt', '.md', '.markdown', '.html', '.htm']

export { IMPORT_MIME_TYPES } from './sniff'

const MAX_TITLE = 200

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** Word and HTML metadata titles are often leftovers ("Microsoft Word - Doc1", "Untitled"). */
function usableTitle(t: string | undefined): string | undefined {
  const s = (t ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return undefined
  if (/^(microsoft word\s*-|untitled\b|document\s*\d*$|doc\d*$|new document\b)/i.test(s)) return undefined
  return s.slice(0, MAX_TITLE)
}

function byteSize(data: ArrayBuffer | string): number {
  if (typeof data !== 'string') return data.byteLength
  // UTF-8 size without encoding the whole string when it is clearly small or large.
  if (data.length * 3 <= MAX_IMPORT_BYTES) return data.length
  if (data.length > MAX_IMPORT_BYTES) return data.length
  return new TextEncoder().encode(data).byteLength
}

/**
 * Converts an existing manuscript (Word .docx, Google Docs HTML export, HTML,
 * Markdown or plain text) into TipTap JSON for a new Thunder Writer document.
 * Pure: it reads `source.data` and never modifies or uploads anything.
 */
export async function importManuscript(source: ImportSource): Promise<ImportResult> {
  const size = byteSize(source.data)
  if (size > MAX_IMPORT_BYTES) {
    throw new ImportError('too_large', tooLargeMessage(source.name, size))
  }
  if (size === 0) throw new ImportError('empty', `“${source.name}” is empty.`)

  const bytes = typeof source.data === 'string' ? null : new Uint8Array(source.data)
  const format = sniffFormat(source, bytes)
  const warnings: string[] = []
  let doc: JSONContent
  let metaTitle: string | undefined
  let titleText: string | undefined
  let images = 0
  let stats: HtmlStats | null = null

  switch (format) {
    case 'docx': {
      if (!bytes) throw new ImportError('corrupt', 'A Word document must be read as a file, not as text.')
      const d = await docxToHtml(bytes)
      const h = htmlToDoc(d.html)
      doc = h.doc
      metaTitle = d.metaTitle
      titleText = h.titleText
      stats = { ...h.stats, comments: h.stats.comments + d.comments }
      break
    }
    case 'html':
    case 'gdoc-html': {
      const decoded = decodeText(source.data, { html: true })
      if (decoded.guessed) warnings.push(ENCODING_WARNING)
      const h = htmlToDoc(decoded.text)
      doc = h.doc
      metaTitle = h.metaTitle
      titleText = h.titleText
      stats = h.stats
      break
    }
    case 'markdown': {
      const decoded = decodeText(source.data)
      if (decoded.guessed) warnings.push(ENCODING_WARNING)
      const m = markdownToDoc(decoded.text)
      doc = m.doc
      metaTitle = m.title
      images = m.images
      break
    }
    case 'text': {
      const decoded = decodeText(source.data)
      if (decoded.guessed) warnings.push(ENCODING_WARNING)
      doc = textToDoc(decoded.text)
      break
    }
  }

  const shaped = shapeManuscript(doc, { titleText })
  if (shaped.wordCount === 0) {
    throw new ImportError('empty', `No text was found in “${source.name}”.`)
  }

  // Never hand the editor content it would silently replace with an empty doc.
  let content = shaped.doc
  if (!checkContent(content).ok) {
    content = sanitizeContent(content)
    if (!checkContent(content).ok) {
      throw new ImportError('corrupt', `“${source.name}” couldn’t be converted into a manuscript.`)
    }
    warnings.push('Some formatting Thunder Writer doesn’t support was removed; all the text was kept.')
  }

  const notes: string[] = []
  if (shaped.chapterCount > 0) {
    let line = `Detected ${plural(shaped.chapterCount, 'chapter')}.`
    const p = shaped.promotedChapters
    if (p > 0) {
      const subject = p >= shaped.chapterCount ? (p === 1 ? 'It was' : 'They were') : `${p.toLocaleString('en-US')} of them ${p === 1 ? 'was' : 'were'}`
      line +=
        p === 1
          ? ` ${subject} a plain line (like “Chapter 1”) and is now a Chapter heading, so it starts on a new page.`
          : ` ${subject} plain lines (like “Chapter 1”) and are now Chapter headings, so each starts on a new page.`
    }
    notes.push(line)
  } else if (shaped.wordCount >= 2000) {
    notes.push(
      'No chapter headings were found. To start a chapter on a new page, put the cursor in its title and choose Chapter from the paragraph style menu in the toolbar.',
    )
  }
  if (shaped.sceneBreaks > 0) {
    notes.push(`${plural(shaped.sceneBreaks, 'scene break')} (like * * *) became scene-break dividers.`)
  }
  const imageCount = images + (stats?.images ?? 0)
  if (imageCount > 0) notes.push(`${plural(imageCount, 'image was', 'images were')} left out; manuscripts hold text only.`)
  if (stats?.comments) notes.push(`${plural(stats.comments, 'comment was', 'comments were')} left out.`)
  if (stats?.footnotes) {
    notes.push(`${plural(stats.footnotes, 'footnote was', 'footnotes were')} kept as plain text at the end, with the [1]-style markers left in place.`)
  }
  if (stats?.tables) notes.push(`${plural(stats.tables, 'table was', 'tables were')} turned into plain paragraphs.`)

  const title = usableTitle(metaTitle) ?? usableTitle(titleText) ?? (stripKnownExtension(source.name).slice(0, MAX_TITLE) || 'Imported manuscript')

  return {
    title,
    content,
    wordCount: shaped.wordCount,
    chapterCount: shaped.chapterCount,
    warnings: [...notes, ...warnings],
  }
}
