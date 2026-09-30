/** Size limits for imported files. A novel is a few MB at most; these are generous. */

/** Largest file accepted, as bytes (or UTF-16 characters for text passed as a string). */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024

/**
 * Largest total decompressed size of the XML parts inside a .docx. A 25 MB docx
 * of text inflates to maybe 150 MB of XML; anything larger is almost certainly a
 * "zip bomb" (a tiny file that expands to gigabytes) and would freeze the tab.
 */
export const MAX_DOCX_XML_BYTES = 200 * 1024 * 1024

/** A .docx has a few dozen parts; thousands means something is wrong. */
export const MAX_DOCX_ENTRIES = 5000

export const formatMB = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`
