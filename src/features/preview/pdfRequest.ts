import { create } from 'zustand'

/**
 * "Export to computer › PDF": the writer page's Book Preview opens, typesets
 * the book and prints it (the print dialog's "Save as PDF" makes the file), so
 * the PDF is exactly the pages the preview shows. Each request bumps `seq`.
 */
export const usePdfRequest = create<{ seq: number }>(() => ({ seq: 0 }))

export const requestPdfExport = () => usePdfRequest.setState((s) => ({ seq: s.seq + 1 }))

/** Menu label and hint, shared by the Export menu and the Export dialog. */
export const PDF_EXPORT = {
  label: 'PDF (.pdf)',
  hint: 'Your book’s pages as Book Preview lays them out. In the print dialog, choose “Save as PDF”.',
} as const
