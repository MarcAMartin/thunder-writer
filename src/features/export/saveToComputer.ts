import { sanitizeBaseName } from './filename'
import { EXPORT_FORMATS, type ExportKind } from './formats'
import { errorName, getShowSaveFilePicker, isAbortError } from './fsAccess'

export type BlobSource = Blob | (() => Promise<Blob>)

export type SaveResult =
  /** Written through the native Save dialog, wherever the writer chose (Desktop by default). */
  | { status: 'saved'; fileName: string; handle: FileSystemFileHandle }
  /** Browser download: the file went to the Downloads folder (or wherever the browser asks). */
  | { status: 'downloaded'; fileName: string }
  /** The writer closed the Save dialog. Nothing was written. */
  | { status: 'cancelled' }

/** Remembered folder for one-off saves; the first time the dialog opens on the Desktop. */
export const SAVE_PICKER_ID = 'thunder-writer-save'

/** Keeps the right extension on a suggested name ("My Novel" → "My Novel.docx"). */
export function withExtension(name: string, kind: ExportKind): string {
  const ext = EXPORT_FORMATS[kind].ext
  const base = name.toLowerCase().endsWith(ext) ? name.slice(0, -ext.length) : name
  return sanitizeBaseName(base) + ext
}

export function pickerTypes(kind: ExportKind) {
  const f = EXPORT_FORMATS[kind]
  return [{ description: f.label, accept: { [f.mime]: f.pickerExt } }]
}

/**
 * Opens the native Save dialog (Chrome/Edge), starting on the Desktop.
 * Resolves null if the writer cancels; throws if the dialog can't open.
 * Must be called straight from a click or key press, before any await.
 */
export function pickSaveFile(
  suggestedName: string,
  kind: ExportKind,
  opts: { id?: string; startIn?: FileSystemHandle } = {},
): Promise<FileSystemFileHandle | null> {
  const show = getShowSaveFilePicker()
  if (!show) return Promise.reject(new Error('The native Save dialog is not available in this browser.'))
  return show({
    suggestedName: withExtension(suggestedName, kind),
    startIn: opts.startIn ?? 'desktop',
    id: opts.id ?? SAVE_PICKER_ID,
    types: pickerTypes(kind),
  }).catch((e: unknown) => {
    if (isAbortError(e)) return null
    throw e
  })
}

/** Writes the whole file, replacing what was there (the browser swaps it in atomically on close). */
export async function writeToHandle(handle: FileSystemFileHandle, blob: Blob): Promise<void> {
  const w = await handle.createWritable()
  try {
    await w.write(blob)
    await w.close()
  } catch (e) {
    await w.abort().catch(() => undefined)
    throw e
  }
}

const resolveBlob = (src: BlobSource) => (typeof src === 'function' ? src() : Promise.resolve(src))

/**
 * Saves a file to the writer's computer.
 *
 * Chrome/Edge: the native Save dialog opens on the Desktop so the writer picks
 * the folder and name. The dialog opens first and the file is built after, so
 * a slow export never costs the click its permission to open the dialog.
 * Other browsers: a normal download to the Downloads folder.
 *
 * Call it directly from a click or key press.
 */
export async function saveToComputer(source: BlobSource, suggestedName: string, kind: ExportKind): Promise<SaveResult> {
  const fileName = withExtension(suggestedName, kind)
  if (getShowSaveFilePicker()) {
    let handle: FileSystemFileHandle | null = null
    let fallback = false
    try {
      handle = await pickSaveFile(fileName, kind)
    } catch (e) {
      // Blocked (e.g. no user gesture, sandboxed frame, bad type list): fall back to a download.
      if (['SecurityError', 'NotAllowedError', 'TypeError'].includes(errorName(e)) || e instanceof TypeError) fallback = true
      else throw e
    }
    if (!fallback) {
      if (!handle) return { status: 'cancelled' }
      await writeToHandle(handle, await resolveBlob(source))
      return { status: 'saved', fileName: handle.name || fileName, handle }
    }
  }
  downloadBlob(await resolveBlob(source), fileName)
  return { status: 'downloaded', fileName }
}

/** Triggers a browser download of `blob` as `fileName`. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    // Revoke after the browser has started reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

/** Writer-facing sentence for a finished save. */
export function describeSaveResult(r: SaveResult): string {
  switch (r.status) {
    case 'saved':
      return `Saved “${r.fileName}” to your computer.`
    case 'downloaded':
      return `“${r.fileName}” is in your Downloads folder. To pick the Desktop instead, turn on “Ask where to save each file” in your browser’s download settings.`
    case 'cancelled':
      return 'Not saved.'
  }
}
