/**
 * The parts of the File System Access API (Chrome/Edge) this module uses.
 * They are not in TypeScript's DOM lib, so they are typed and feature-detected here.
 */
export interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string[]>
}

export interface SaveFilePickerOptions {
  suggestedName?: string
  /** A well-known folder ('desktop', 'documents', 'downloads'…) or a handle to start next to. */
  startIn?: 'desktop' | 'documents' | 'downloads' | FileSystemHandle
  /** Lets the browser remember the last folder used for this purpose. */
  id?: string
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
}

export type ShowSaveFilePicker = (opts?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>

type PermissionMode = { mode: 'read' | 'readwrite' }

/** FileSystemFileHandle with the permission methods Chromium adds. */
export interface PermissionedFileHandle extends FileSystemFileHandle {
  queryPermission?: (d: PermissionMode) => Promise<PermissionState>
  requestPermission?: (d: PermissionMode) => Promise<PermissionState>
}

/** window.showSaveFilePicker, or null where the browser doesn't have it (Firefox, Safari, iframes that block it). */
export function getShowSaveFilePicker(): ShowSaveFilePicker | null {
  if (typeof window === 'undefined') return null
  const fn = (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
  return typeof fn === 'function' ? (fn.bind(window) as ShowSaveFilePicker) : null
}

export const hasNativeSaveDialog = () => getShowSaveFilePicker() !== null

export async function queryWritePermission(handle: FileSystemFileHandle): Promise<PermissionState> {
  const h = handle as PermissionedFileHandle
  if (typeof h.queryPermission !== 'function') return 'granted'
  return h.queryPermission({ mode: 'readwrite' })
}

/** Must be called from a click or key press: the browser shows a permission prompt. */
export function requestWritePermission(handle: FileSystemFileHandle): Promise<PermissionState> {
  const h = handle as PermissionedFileHandle
  if (typeof h.requestPermission !== 'function') return Promise.resolve('granted')
  return h.requestPermission({ mode: 'readwrite' })
}

export const errorName = (e: unknown): string =>
  typeof e === 'object' && e !== null && typeof (e as { name?: unknown }).name === 'string' ? (e as { name: string }).name : ''

export const isAbortError = (e: unknown) => errorName(e) === 'AbortError'
