import { create } from 'zustand'
import { useDocuments } from '../../store/documents'
import { googleClientId, useSettings } from '../../store/settings'
import type { ThunderDoc } from '../../types'
import type { DriveStatus, LocalStatus } from './autosave'
import { DriveClient, DriveError, driveErrorMessage, isDriveError, type DriveFileInfo } from './drive'
import { GoogleAuth } from './googleAuth'
import { withoutDriveLink, type SyncedConfig } from './schema'

/** Save/connection status shown in the header. In-memory only. */
export interface StorageStatusState {
  local: LocalStatus
  localError: string | null
  drive: DriveStatus
  driveError: string | null
  driveConnected: boolean
  /** The last Drive failure needs the writer to reconnect (e.g. the token expired in the background). */
  driveNeedsReconnect: boolean
  /** Docs whose Drive file changed elsewhere since the last sync; autosave skips them until resolved. */
  driveConflicts: Record<string, true>
  /** Wall-clock time each doc was last written to Drive this session. */
  driveSavedAt: Record<string, number>
  patch: (p: Partial<Omit<StorageStatusState, 'patch'>>) => void
}

export const useStorageStatus = create<StorageStatusState>()((set) => ({
  local: 'idle',
  localError: null,
  drive: 'idle',
  driveError: null,
  driveConnected: false,
  driveNeedsReconnect: false,
  driveConflicts: {},
  driveSavedAt: {},
  patch: (p) => set(p),
}))

function setConflict(id: string, on: boolean) {
  const cur = useStorageStatus.getState().driveConflicts
  if (!!cur[id] === on) return
  const next = { ...cur }
  if (on) next[id] = true
  else delete next[id]
  useStorageStatus.getState().patch({ driveConflicts: next })
}

export const hasDriveConflict = (id: string) => useStorageStatus.getState().driveConflicts[id] === true

export const auth = new GoogleAuth(() => googleClientId(useSettings.getState()))

/** When set, token requests may open Google's popup (only right after a click). */
let interactiveDepth = 0

export const driveClient = new DriveClient({
  fetch: (input, init) => fetch(input, init),
  getToken: ({ forceRefresh }) => auth.getToken({ forceRefresh, interactive: interactiveDepth > 0 }),
})

auth.onChange((connected) => {
  if (!connected) driveClient.reset()
  useStorageStatus.getState().patch({ driveConnected: connected })
})

export const isDriveConfigured = () => googleClientId(useSettings.getState()).length > 0

/** Wraps a user-initiated Drive action so it may show the consent popup. */
async function interactive<T>(fn: () => Promise<T>): Promise<T> {
  interactiveDepth++
  try {
    return await fn()
  } finally {
    interactiveDepth--
  }
}

/** Opens Google's consent popup. Call from a click handler. */
export function connectDrive(): Promise<void> {
  return interactive(async () => {
    await auth.getToken({ interactive: true })
    useStorageStatus.getState().patch({ driveError: null, drive: 'idle', driveNeedsReconnect: false })
  })
}

export function disconnectDrive() {
  auth.disconnect()
  useStorageStatus.getState().patch({ drive: 'idle', driveError: null, driveNeedsReconnect: false })
}

/** Serializes every Drive write so uploads never overlap (autosave and manual share this). */
let writeChain: Promise<unknown> = Promise.resolve()
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn)
  writeChain = next.catch(() => undefined)
  return next
}

/** Uploads one doc snapshot and marks it synced. Returns the Drive file id. */
async function uploadDoc(id: string, opts: { force?: boolean } = {}): Promise<string> {
  const snapshot: ThunderDoc | undefined = useDocuments.getState().docs[id]
  if (!snapshot) throw new DriveError('not_found', 'That manuscript no longer exists.')
  const status = useStorageStatus.getState()
  status.patch({ drive: 'saving' })
  try {
    const res = await driveClient.saveDoc(snapshot, opts)
    // Only clears dirty if no edits landed after this snapshot (see markDriveSynced).
    useDocuments.getState().markDriveSynced(id, res.id, snapshot.updatedAt, res.revisionId)
    setConflict(id, false)
    useStorageStatus.getState().patch({
      drive: 'saved',
      driveError: null,
      driveNeedsReconnect: false,
      driveSavedAt: { ...useStorageStatus.getState().driveSavedAt, [id]: Date.now() },
    })
    return res.id
  } catch (e) {
    if (isDriveError(e) && e.code === 'conflict') {
      // Per-doc state, shown on that doc's status; other docs keep autosaving.
      setConflict(id, true)
      useStorageStatus.getState().patch({ drive: 'idle' })
    } else {
      useStorageStatus.getState().patch({
        drive: 'error',
        driveError: driveErrorMessage(e),
        driveNeedsReconnect: isDriveError(e) && e.needsReconnect,
      })
    }
    throw e
  }
}

/**
 * Manual "Save to Drive" for a doc. Links the doc to Drive so autosave takes
 * over. `force` overwrites the Drive file even if it changed elsewhere (the
 * writer chose to keep this browser's version).
 */
export function saveDocToDrive(id: string, opts: { force?: boolean } = {}): Promise<string> {
  return interactive(() => serialized(() => uploadDoc(id, opts)))
}

/**
 * Background autosave of every pending doc; never opens a popup. Docs in
 * conflict are skipped; one failing doc doesn't stop the others. Rejects with
 * the first error once all were tried.
 */
export function autosaveDocs(ids: string[]): Promise<void> {
  return serialized(async () => {
    let first: unknown = null
    for (const id of ids) {
      if (hasDriveConflict(id)) continue
      try {
        await uploadDoc(id)
      } catch (e) {
        first ??= e
        // Without a token nothing else can succeed either.
        if (isDriveError(e) && e.needsReconnect) break
      }
    }
    if (first) throw first
  })
}

export function listDriveDocs(): Promise<DriveFileInfo[]> {
  return interactive(() => driveClient.listDocs())
}

/** Downloads and validates a manuscript (does not open it). */
export function downloadDriveDoc(fileId: string): Promise<ThunderDoc> {
  return interactive(() => driveClient.downloadDoc(fileId))
}

/** Puts a downloaded doc into the store (replacing the local copy) and opens it; clears its dirty flag. */
export function openDownloadedDoc(doc: ThunderDoc) {
  const docs = useDocuments.getState()
  docs.upsertDoc({ ...doc, driveSyncedAt: doc.updatedAt })
  if (doc.driveFileId) docs.markDriveSynced(doc.id, doc.driveFileId, doc.updatedAt, doc.driveRevisionId)
  setConflict(doc.id, false)
  docs.openDoc(doc.id)
}

const newDocId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/**
 * "Keep both": the Drive version becomes its own manuscript (still linked to
 * the Drive file), and this browser's copy is unlinked and renamed so its
 * unsynced edits survive; it is saved to Drive as a separate file. Returns the
 * id of the doc to open.
 */
export function keepBothVersions(localId: string, remote: ThunderDoc, open: 'local' | 'remote' = 'remote'): string {
  const docs = useDocuments.getState()
  const local = docs.docs[localId]
  const remoteId = newDocId()
  if (local) {
    docs.upsertDoc({ ...withoutDriveLink(local), title: `${local.title} (this browser)`, updatedAt: Date.now() })
    // Unsynced edits: autosave uploads this copy as a new Drive file.
    useDocuments.setState((s) => ({ dirtyForDrive: { ...s.dirtyForDrive, [localId]: true } }))
  }
  docs.upsertDoc({ ...remote, id: remoteId, driveSyncedAt: remote.updatedAt })
  if (remote.driveFileId) docs.markDriveSynced(remoteId, remote.driveFileId, remote.updatedAt, remote.driveRevisionId)
  setConflict(localId, false)
  const target = open === 'remote' || !local ? remoteId : localId
  docs.openDoc(target)
  return target
}

export function saveConfigToDrive(): Promise<string> {
  return interactive(() => serialized(() => driveClient.saveConfig(useSettings.getState())))
}

/** Loads non-secret preferences from Drive and applies them. Returns null if none saved. */
export function loadConfigFromDrive(): Promise<SyncedConfig | null> {
  return interactive(async () => {
    const cfg = await driveClient.loadConfig()
    if (cfg && Object.keys(cfg).length > 0) useSettings.getState().set(cfg)
    return cfg
  })
}

export { isDriveError }
