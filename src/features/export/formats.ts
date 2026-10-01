import type { ThunderDoc } from '../../types'

/** Every file format the writer can export to their computer (PDF is printed from Book Preview instead: preview/pdfRequest). */
export type ExportKind = 'docx' | 'md' | 'txt' | 'html' | 'thunder'

/** Formats that can be kept continuously updated on disk (HTML is a one-off print file). */
export type CopyKind = Exclude<ExportKind, 'html'>

export interface ExportFormatInfo {
  kind: ExportKind
  /** Menu label, e.g. "Word document (.docx)". */
  label: string
  /** Short name for status lines, e.g. "Word". */
  short: string
  /** One-line help under the menu label. */
  hint: string
  /** File extension including the dot. */
  ext: string
  mime: string
  /** Extensions the native Save dialog accepts for this type. */
  pickerExt: string[]
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const EXPORT_FORMATS: Record<ExportKind, ExportFormatInfo> = {
  docx: {
    kind: 'docx',
    label: 'Word document (.docx)',
    short: 'Word',
    hint: 'Opens in Word, Pages and Google Docs, with your book’s page size and chapters.',
    ext: '.docx',
    mime: DOCX_MIME,
    pickerExt: ['.docx'],
  },
  md: {
    kind: 'md',
    label: 'Markdown (.md)',
    short: 'Markdown',
    hint: 'Plain text with light formatting marks.',
    ext: '.md',
    mime: 'text/markdown',
    pickerExt: ['.md'],
  },
  txt: {
    kind: 'txt',
    label: 'Plain text (.txt)',
    short: 'Plain text',
    hint: 'Just the words. Opens anywhere.',
    ext: '.txt',
    mime: 'text/plain',
    pickerExt: ['.txt'],
  },
  html: {
    kind: 'html',
    label: 'Print-ready web page (.html)',
    short: 'Web page',
    hint: 'A web page laid out for printing, which opens in any browser.',
    ext: '.html',
    mime: 'text/html',
    pickerExt: ['.html'],
  },
  thunder: {
    kind: 'thunder',
    label: 'Thunder Writer backup (.thunder.json)',
    short: 'Backup',
    hint: 'Everything, exactly as it is here. Re-open it with File › Open from computer…',
    ext: '.thunder.json',
    mime: 'application/json',
    // Native pickers validate single extensions; the suggested name keeps ".thunder.json".
    pickerExt: ['.json'],
  },
}

export const MENU_ORDER: ExportKind[] = ['docx', 'md', 'txt', 'html', 'thunder']
export const COPY_KINDS: CopyKind[] = ['docx', 'md', 'txt', 'thunder']

export const isExportKind = (v: unknown): v is ExportKind =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(EXPORT_FORMATS, v)

/** Builds the file for `kind`. Word support (the `docx` library) loads on first use. */
export async function buildExport(doc: ThunderDoc, kind: ExportKind): Promise<Blob> {
  const { mime } = EXPORT_FORMATS[kind]
  switch (kind) {
    case 'docx': {
      const { toDocx } = await import('./toDocx')
      return toDocx(doc)
    }
    case 'md': {
      const { toMarkdown } = await import('./toMarkdown')
      return new Blob([toMarkdown(doc)], { type: `${mime};charset=utf-8` })
    }
    case 'txt': {
      const { toPlainText } = await import('./toPlainText')
      return new Blob([toPlainText(doc)], { type: `${mime};charset=utf-8` })
    }
    case 'html': {
      const { toHtml } = await import('./toHtml')
      return new Blob([toHtml(doc)], { type: `${mime};charset=utf-8` })
    }
    case 'thunder': {
      const { toBackupJson } = await import('./backup')
      return new Blob([toBackupJson(doc)], { type: mime })
    }
  }
}
