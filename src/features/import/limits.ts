/** Size limits for imported files. A novel is a few MB at most; these are generous. */

/** Largest file accepted, as bytes (or UTF-16 characters for text passed as a string). */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024

/**
 * Largest total decompressed size of the parts inside a .docx that are
 * inflated (everything except pictures and other media). A 200,000-word novel
 * is about 20 MB of WordprocessingML; anything far larger is almost certainly
 * a "zip bomb" (a tiny file that expands to gigabytes), and mammoth would have
 * to parse all of it into memory, which would freeze or crash the tab.
 */
export const MAX_DOCX_XML_BYTES = 100 * 1024 * 1024

/** A .docx has a few dozen parts; thousands means something is wrong. */
export const MAX_DOCX_ENTRIES = 5000

const MB = 1024 * 1024

/**
 * "25 MB", "25.3 MB", "0.4 MB". Rounded UP to one decimal place, so a file
 * just over a limit never reads as the limit itself ("25 MB is larger than 25 MB").
 */
export function formatMB(bytes: number): string {
  const tenths = Math.ceil((bytes / MB) * 10 - 1e-9) / 10
  return `${Number.isInteger(tenths) ? tenths : tenths.toFixed(1)} MB`
}

/** Writer-facing message for a file over MAX_IMPORT_BYTES (the same wherever it came from). */
export function tooLargeMessage(name: string, bytes?: number): string {
  const size = bytes === undefined ? `larger than ${formatMB(MAX_IMPORT_BYTES)}` : formatMB(bytes)
  return `“${name}” is ${size}; the largest file Thunder Writer can import is ${formatMB(MAX_IMPORT_BYTES)}. If it contains pictures, save a copy without them and try again.`
}
