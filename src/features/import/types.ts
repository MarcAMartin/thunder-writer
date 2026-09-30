// Contract for importing existing manuscripts (Word, Google Docs, text, Markdown, HTML)
// into Thunder Writer. Owned by features/import; the Drive Picker in features/storage
// hands downloaded bytes to importManuscript() and never parses formats itself.

export type ImportFormat = 'docx' | 'gdoc-html' | 'html' | 'markdown' | 'text'

export interface ImportSource {
  /** Original file name, e.g. "My Novel draft 3.docx". Used for the title and format sniffing. */
  name: string
  /** MIME type if known (from the browser File or Drive metadata). */
  mimeType?: string
  /** Raw bytes for binary formats (docx); text formats may pass a string. */
  data: ArrayBuffer | string
  /** Force a format instead of sniffing from name/mimeType (e.g. Google Docs exported as HTML). */
  format?: ImportFormat
}

export interface ImportResult {
  title: string
  /** TipTap/ProseMirror JSON valid against the editor schema. */
  content: unknown
  wordCount: number
  chapterCount: number
  /** Writer-facing notes about anything dropped or guessed (images skipped, chapters detected, etc.). */
  warnings: string[]
}

export class ImportError extends Error {
  constructor(
    public readonly code: 'unsupported' | 'too_large' | 'corrupt' | 'empty',
    message: string,
  ) {
    super(message)
    this.name = 'ImportError'
  }
}
