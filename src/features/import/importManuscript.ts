import type { JSONContent } from '@tiptap/core'
import { checkContent, sanitizeContent } from '../editor/contentCheck'
import { isBareChapterNumber, isChapterHeading, isSceneBreak } from './chapters'
import { decodeText, encodingWarning, type DecodedText } from './decode'
import { docxToHtml } from './docx'
import { htmlToDoc, type HtmlStats } from './html'
import { MAX_IMPORT_BYTES, tooLargeMessage } from './limits'
import { markdownToDoc } from './markdown'
import { sniffFormat, stripKnownExtension } from './sniff'
import { blockText, shapeManuscript } from './structure'
import { readPlainText } from './text'
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

/**
 * A book title at the top of a Markdown or plain-text manuscript: the first
 * block is a lone H1 (Markdown) or a short standalone line (text), and a
 * chapter heading follows within the next few blocks (after a byline, say).
 * It then names the manuscript and isn't counted as a chapter.
 */
function leadingTitle(doc: JSONContent, format: 'markdown' | 'text'): string | undefined {
  const blocks = (doc.content ?? []).filter((b) => !(b.type === 'paragraph' && !blockText(b).trim()))
  const first = blocks[0]
  if (!first) return undefined
  const text = blockText(first).trim()
  // A text file's title block may carry a byline on the next line ("THE ORCHARD" / "by Jane Doe").
  const lines = text.split('\n')
  if (lines.length > (format === 'text' ? 3 : 1)) return undefined
  const t = lines[0].trim()
  if (!t || isChapterHeading(t) || isSceneBreak(t) || isBareChapterNumber(t)) return undefined
  if (format === 'markdown') {
    if (first.type !== 'heading' || Number(first.attrs?.level) !== 1) return undefined
  } else if (first.type !== 'paragraph' || t.length > 80 || t.split(/\s+/).length > 12 || /[.,;:]$/.test(t)) {
    return undefined
  }
  const isChapter = (b: JSONContent) => {
    const s = blockText(b).trim()
    if (format === 'markdown' && b.type === 'heading' && Number(b.attrs?.level) === 1) return true
    return isChapterHeading(s) || isBareChapterNumber(s)
  }
  return blocks.slice(1, 5).some(isChapter) ? t : undefined
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

  const noteEncoding = (d: DecodedText) => {
    const w = encodingWarning(d)
    if (w) warnings.push(w)
  }
  /** Notes from the format readers (numbering, front matter, wrapped lines). */
  const formatNotes: string[] = []

  switch (format) {
    case 'docx': {
      if (!bytes) throw new ImportError('corrupt', 'A Word document must be read as a file, not as text.')
      const d = await docxToHtml(bytes)
      const h = htmlToDoc(d.html)
      doc = h.doc
      metaTitle = d.metaTitle
      titleText = h.titleText
      stats = { ...h.stats, comments: h.stats.comments + d.comments }
      if (d.numberedHeadings > 0) {
        formatNotes.push(
          `${plural(d.numberedHeadings, 'heading')} used Word’s automatic numbering (like “Chapter 1”); the ${d.numberedHeadings === 1 ? 'number is' : 'numbers are'} now part of the heading text and won’t renumber themselves.`,
        )
      }
      break
    }
    case 'html':
    case 'gdoc-html': {
      const decoded = decodeText(source.data, { html: true })
      noteEncoding(decoded)
      const h = htmlToDoc(decoded.text)
      doc = h.doc
      metaTitle = h.metaTitle
      titleText = h.titleText
      stats = h.stats
      break
    }
    case 'markdown': {
      const decoded = decodeText(source.data)
      noteEncoding(decoded)
      const m = markdownToDoc(decoded.text)
      doc = m.doc
      metaTitle = m.title
      titleText = leadingTitle(doc, 'markdown')
      images = m.images
      if (m.frontMatter) formatNotes.push('The metadata block at the top of the file (between the --- lines) was read for the title and left out of the text.')
      break
    }
    case 'text': {
      const decoded = decodeText(source.data)
      noteEncoding(decoded)
      const t = readPlainText(decoded.text)
      doc = t.doc
      titleText = leadingTitle(doc, 'text')
      if (t.wrapWidth) {
        formatNotes.push(
          `The lines of this file were wrapped at about ${t.wrapWidth} characters, so they were joined back into paragraphs. If two paragraphs ran together, put the cursor between them and press Enter.`,
        )
      }
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

  // The visible title wins over document properties, which Word carries over from whatever
  // file or template a new book was started from. Markdown front matter is written on purpose.
  const [firstChoice, secondChoice] = format === 'markdown' ? [metaTitle, titleText] : [titleText, metaTitle]
  const title =
    usableTitle(firstChoice) ?? usableTitle(secondChoice) ?? (stripKnownExtension(source.name).slice(0, MAX_TITLE) || 'Imported manuscript')

  return {
    title,
    content,
    wordCount: shaped.wordCount,
    chapterCount: shaped.chapterCount,
    warnings: [...notes, ...formatNotes, ...warnings],
  }
}
