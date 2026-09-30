import { isOle, isZip, OLE_MESSAGE } from './sniff'
import { ImportError } from './types'
import { vetDocx } from './zip'

/**
 * Word (.docx) → HTML with mammoth, which reads the document's paragraph
 * styles. The HTML then goes through the same sanitiser as any other HTML.
 *
 * - Title → H1 (remembered as the title), Heading 1/2/3 → H1/H2/H3 (Chapter,
 *   Section, Scene heading); Heading 4–6 → H3 (the editor has three levels).
 * - Bold, italic, underline and strikethrough are kept.
 * - Images are not read at all (counted, then dropped); comments are dropped
 *   (counted from word/comments.xml).
 * - Footnotes and endnotes are KEPT as plain text in a numbered list at the
 *   end, with their [1] markers left in the text. A novelist's notes are their
 *   own words, and dropping text on import is worse than having to tidy it.
 */

const headingRules = [1, 2, 3, 4, 5, 6].flatMap((n) => {
  const tag = `h${Math.min(n, 3)}:fresh`
  // Style-name matching is case-insensitive in mammoth ("heading 1" = "Heading 1").
  return [`p.Heading${n} => ${tag}`, `p[style-name='Heading ${n}'] => ${tag}`]
})

export const DOCX_STYLE_MAP = [
  'p.Title => h1.title:fresh',
  "p[style-name='Title'] => h1.title:fresh",
  "p[style-name='Subtitle'] => p:fresh",
  ...headingRules,
  'u => u',
  'strike => s',
  'comment-reference => !',
]

export interface DocxHtml {
  html: string
  /** dc:title from docProps/core.xml, if set. */
  metaTitle?: string
  comments: number
}

const decodeXmlEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

export async function docxToHtml(bytes: Uint8Array): Promise<DocxHtml> {
  if (isOle(bytes)) throw new ImportError('unsupported', OLE_MESSAGE)
  if (!isZip(bytes)) {
    throw new ImportError('corrupt', 'This file isn’t a Word document (.docx), or it is damaged. Try opening it in Word and saving it again.')
  }
  const pkg = await vetDocx(bytes)

  const [core, commentsXml] = await Promise.all([
    pkg.readText('docProps/core.xml').catch(() => null),
    pkg.readText('word/comments.xml').catch(() => null),
  ])
  const titleMatch = core ? /<dc:title>([^<]*)<\/dc:title>/.exec(core) : null
  const metaTitle = titleMatch ? decodeXmlEntities(titleMatch[1]).trim() || undefined : undefined
  const comments = commentsXml ? (commentsXml.match(/<w:comment[\s>]/g) ?? []).length : 0

  const mammoth = (await import('mammoth')).default
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  // The browser build reads `arrayBuffer`; the Node build (used by tests) reads `buffer`.
  const input = { arrayBuffer: buffer, buffer } as unknown as { arrayBuffer: ArrayBuffer }
  try {
    const result = await mammoth.convertToHtml(input, {
      styleMap: DOCX_STYLE_MAP,
      // Leave the image bytes unread; each becomes an empty <img> that the sanitiser counts and drops.
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
      externalFileAccess: false,
    })
    return { html: result.value, metaTitle, comments }
  } catch (e) {
    if (e instanceof ImportError) throw e
    throw new ImportError('corrupt', 'This Word document couldn’t be read; it may be damaged. Try opening it in Word and saving it again.')
  }
}
