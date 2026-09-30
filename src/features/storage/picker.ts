import { DriveError } from './drive'

/**
 * Google Picker: the only way to open a writer's EXISTING Drive files under the
 * least-privilege drive.file scope. Files the writer picks here become readable
 * by this app (and only those). The Picker needs the OAuth access token, a
 * browser API key (developer key) and the Cloud project number as appId; the
 * appId must be the project the OAuth client belongs to, or the picked files
 * are not granted to the token.
 *
 * Docs: https://developers.google.com/drive/picker/guides/overview
 */

export const PICKER_API_SRC = 'https://apis.google.com/js/api.js'

export const GDOC_MIME = 'application/vnd.google-apps.document'
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const THUNDER_JSON_MIME = 'application/json'

/** Types the Picker's import view shows (folders are shown too, for browsing). */
export const IMPORTABLE_MIME_TYPES = [
  GDOC_MIME,
  DOCX_MIME,
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/html',
] as const

// ---------------------------------------------------------------------------
// Minimal hand-written declarations for the globals we use (no @types package).

export interface PickerDocument {
  id: string
  name?: string
  mimeType?: string
  sizeBytes?: number | string
  [key: string]: unknown
}

export interface PickerResponse {
  action: string
  docs?: PickerDocument[]
  [key: string]: unknown
}

export interface PickerDocsView {
  setMimeTypes(mimeTypes: string): PickerDocsView
  setIncludeFolders(included: boolean): PickerDocsView
  setSelectFolderEnabled(enabled: boolean): PickerDocsView
  /** Tab label shown in the Picker. */
  setLabel(label: string): PickerDocsView
  /** Show Shared drives instead of My Drive. */
  setEnableDrives(enabled: boolean): PickerDocsView
  /** Grid of thumbnails or a list with names and dates (google.picker.DocsViewMode). */
  setMode?(mode: string): PickerDocsView
  /** true = only files the writer owns; false = only files shared with them. */
  setOwnedByMe?(me: boolean): PickerDocsView
}

export interface Picker {
  setVisible(visible: boolean): void
  dispose?(): void
}

export interface PickerBuilder {
  addView(view: PickerDocsView | string): PickerBuilder
  setOAuthToken(token: string): PickerBuilder
  setDeveloperKey(key: string): PickerBuilder
  setAppId(appId: string): PickerBuilder
  setOrigin(origin: string): PickerBuilder
  setTitle(title: string): PickerBuilder
  setMaxItems(max: number): PickerBuilder
  setCallback(cb: (data: PickerResponse) => void): PickerBuilder
  enableFeature(feature: string): PickerBuilder
  disableFeature?(feature: string): PickerBuilder
  build(): Picker
}

export interface PickerNamespace {
  PickerBuilder: new () => PickerBuilder
  DocsView: new (viewId?: string) => PickerDocsView
  ViewId: { DOCS: string }
  DocsViewMode?: { GRID: string; LIST: string }
  Action: { PICKED: string; CANCEL: string; ERROR?: string }
  Feature: { MULTISELECT_ENABLED: string; NAV_HIDDEN?: string }
}

interface GapiLoadConfig {
  callback: () => void
  onerror?: () => void
  timeout?: number
  ontimeout?: () => void
}

interface Gapi {
  load(libraries: string, config: GapiLoadConfig | (() => void)): void
}

type PickerWindow = Window & { gapi?: Gapi; google?: { picker?: PickerNamespace } }

const win = () => window as PickerWindow

// ---------------------------------------------------------------------------
// Loader

export const PICKER_LOAD_TIMEOUT_MS = 20_000

let pickerPromise: Promise<PickerNamespace> | null = null

/** Test hook: forget the cached loader. */
export function resetPickerLoader() {
  pickerPromise = null
}

const loadFailed = () =>
  new DriveError('network', 'Could not load the Google Drive file picker. Check your connection or ad blocker.')

/** Injects Google's api.js once, then gapi.load('picker'). Resolves with google.picker. */
export function loadPickerApi(timeoutMs = PICKER_LOAD_TIMEOUT_MS): Promise<PickerNamespace> {
  const ready = win().google?.picker
  if (ready) return Promise.resolve(ready)
  if (pickerPromise) return pickerPromise
  pickerPromise = new Promise<PickerNamespace>((resolve, reject) => {
    const fail = () => {
      pickerPromise = null
      reject(loadFailed())
    }
    const loadPicker = () => {
      const gapi = win().gapi
      if (!gapi?.load) {
        fail()
        return
      }
      gapi.load('picker', {
        callback: () => {
          const ns = win().google?.picker
          if (ns) resolve(ns)
          else fail()
        },
        onerror: fail,
        timeout: timeoutMs,
        ontimeout: fail,
      })
    }
    if (win().gapi?.load) {
      loadPicker()
      return
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${PICKER_API_SRC}"]`)
    if (!script) {
      script = document.createElement('script')
      script.src = PICKER_API_SRC
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
    script.addEventListener('load', loadPicker, { once: true })
    script.addEventListener('error', fail, { once: true })
  })
  return pickerPromise
}

// ---------------------------------------------------------------------------
// Opening the Picker

export interface PickedFile {
  id: string
  name: string
  mimeType: string
  sizeBytes?: number
}

export interface OpenPickerOptions {
  token: string
  developerKey: string
  /** Cloud project number (numeric prefix of the OAuth client id). */
  appId: string
  origin: string
  /** Also offer a view of existing Thunder Writer (.thunder.json) files. */
  includeThunderFiles?: boolean
}

function toPicked(d: PickerDocument | undefined): PickedFile | null {
  if (!d || typeof d.id !== 'string' || !d.id) return null
  const size = Number(d.sizeBytes)
  const out: PickedFile = {
    id: d.id,
    name: typeof d.name === 'string' && d.name ? d.name : 'Untitled',
    mimeType: typeof d.mimeType === 'string' ? d.mimeType : '',
  }
  if (Number.isFinite(size) && size > 0) out.sizeBytes = size
  return out
}

/**
 * Shows the Picker (single select). Resolves with the picked file, or null
 * when the writer cancels. Call only after a user gesture.
 */
export function openPicker(ns: PickerNamespace, opts: OpenPickerOptions): Promise<PickedFile | null> {
  return new Promise<PickedFile | null>((resolve, reject) => {
    const view = (label: string, mimeTypes: readonly string[], { folders }: { folders: boolean }) => {
      const v = new ns.DocsView(ns.ViewId.DOCS)
        .setMimeTypes(mimeTypes.join(','))
        .setIncludeFolders(folders)
        .setSelectFolderEnabled(false)
        .setLabel(label)
      // A list shows each file's name and last-modified date, easier to scan than thumbnails.
      if (!folders && ns.DocsViewMode) v.setMode?.(ns.DocsViewMode.LIST)
      return v
    }
    // Every Google Doc and Word file, wherever it sits: no folders to click through first.
    const docs = view('Google Docs & Word', IMPORTABLE_MIME_TYPES, { folders: false })
    // Drafts that live in someone else's Drive (an editor's, a co-author's) and are shared with the writer.
    const sharedWithMe = view('Shared with me', IMPORTABLE_MIME_TYPES, { folders: false })
    sharedWithMe.setOwnedByMe?.(false)
    const browse = view('Browse folders', IMPORTABLE_MIME_TYPES, { folders: true })
    // Books kept with co-authors, an agent or a publisher often live in a Shared drive.
    const shared = view('Shared drives', IMPORTABLE_MIME_TYPES, { folders: true }).setEnableDrives(true)

    let picker: Picker | null = null
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      try {
        picker?.dispose?.()
      } catch {
        // Already gone.
      }
      fn()
    }

    const builder = new ns.PickerBuilder()
      .addView(docs)
      .addView(sharedWithMe)
      .addView(browse)
      .addView(shared)
      .setOAuthToken(opts.token)
      .setDeveloperKey(opts.developerKey)
      .setAppId(opts.appId)
      .setOrigin(opts.origin)
      .setTitle('Import a manuscript from Google Drive')
      .setMaxItems(1)
      .setCallback((data) => {
        if (data.action === ns.Action.PICKED) {
          const file = toPicked(data.docs?.[0])
          finish(() => resolve(file))
        } else if (data.action === ns.Action.CANCEL) {
          finish(() => resolve(null))
        } else if (ns.Action.ERROR && data.action === ns.Action.ERROR) {
          // A deployment problem, not the writer's: tell whoever runs this copy what to check.
          console.error(
            '[thunder-writer] The Google Picker reported an error. Check VITE_GOOGLE_API_KEY: the Google Picker API must be enabled for it, and its website restrictions must include this origin and https://docs.google.com/*.',
          )
          finish(() => reject(new DriveError('unknown', 'The Google Drive file picker couldn’t open. Try again in a moment.')))
        }
        // Other actions (e.g. "loaded") are progress notifications.
      })

    if (opts.includeThunderFiles) {
      // Thunder Writer's own saves anywhere in Drive (JSON; the importer keeps only .thunder.json ones).
      builder.addView(view('Thunder Writer saves', [THUNDER_JSON_MIME], { folders: true }))
    }

    try {
      picker = builder.build()
      picker.setVisible(true)
    } catch {
      finish(() => reject(new DriveError('unknown', 'The Google Drive file picker failed to open.')))
    }
  })
}
