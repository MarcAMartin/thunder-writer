import type { ThunderDoc } from '../../types'
import type { SettingsState } from '../../store/settings'
import {
  makeConfigEnvelope,
  makeEnvelope,
  parseConfig,
  parseEnvelope,
  type SyncedConfig,
} from './schema'

/**
 * Google Drive REST v3 client. Talks to Google directly from the browser with a
 * short-lived OAuth access token (scope drive.file). The HTTP layer is injected
 * so request construction and error mapping are unit-testable.
 */

export const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'
export const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'
export const FOLDER_NAME = 'Thunder Writer'
export const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const DOC_SUFFIX = '.thunder.json'
export const CONFIG_FILE_NAME = 'thunder-writer.config.json'

export type DriveErrorCode =
  | 'not_configured'
  | 'auth'
  | 'popup_closed'
  | 'popup_blocked'
  | 'access_denied'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'unavailable'
  | 'network'
  | 'invalid_file'
  | 'conflict'
  | 'unknown'

export class DriveError extends Error {
  readonly code: DriveErrorCode
  readonly status?: number
  constructor(code: DriveErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'DriveError'
    this.code = code
    this.status = status
  }
  /** True when the fix is for the writer to (re)connect Google Drive. */
  get needsReconnect() {
    return this.code === 'auth' || this.code === 'popup_closed' || this.code === 'popup_blocked' || this.code === 'access_denied'
  }
}

export const isDriveError = (e: unknown): e is DriveError => e instanceof DriveError

/** Friendly single-line message for any error thrown by Drive code. */
export function driveErrorMessage(e: unknown): string {
  if (isDriveError(e)) return e.message
  if (e instanceof Error && e.message) return e.message
  return 'Something went wrong talking to Google Drive.'
}

interface GoogleErrorBody {
  error?: { message?: string; errors?: { reason?: string }[] }
}

/** Maps a non-OK Drive response to a DriveError. */
export async function mapHttpError(res: Response): Promise<DriveError> {
  let detail = ''
  let reason = ''
  try {
    const body = (await res.json()) as GoogleErrorBody
    detail = body.error?.message ?? ''
    reason = body.error?.errors?.[0]?.reason ?? ''
  } catch {
    // Non-JSON body; keep the status-based message.
  }
  const s = res.status
  if (s === 401) return new DriveError('auth', 'Your Google Drive session expired. Reconnect Drive to continue.', s)
  if (s === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded')
    return new DriveError('rate_limited', 'Google Drive is rate limiting requests. Trying again shortly.', s)
  if (s === 403)
    return new DriveError(
      'forbidden',
      reason === 'storageQuotaExceeded'
        ? 'Your Google Drive is full.'
        : `Google Drive refused the request${detail ? `: ${detail}` : '.'}`,
      s,
    )
  if (s === 404) return new DriveError('not_found', 'That file no longer exists in Google Drive.', s)
  if (s >= 500) return new DriveError('unavailable', 'Google Drive is temporarily unavailable. Try again in a moment.', s)
  return new DriveError('unknown', `Google Drive error ${s}${detail ? `: ${detail}` : ''}`, s)
}

export interface DriveFileInfo {
  id: string
  name: string
  modifiedTime?: string
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface DriveClientDeps {
  fetch: FetchLike
  /** Returns an access token. forceRefresh=true after a 401. */
  getToken: (opts: { forceRefresh: boolean }) => Promise<string>
  /** Multipart boundary generator (injectable for deterministic tests). */
  boundary?: () => string
}

/** Escapes a value for use inside a single-quoted Drive query string. */
export const escapeQuery = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** Turns a manuscript title into a safe Drive file name. */
export function docFileName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  return `${clean || 'Untitled Manuscript'}${DOC_SUFFIX}`
}

/** Drive display title from a file name. */
export const titleFromFileName = (name: string) =>
  name.endsWith(DOC_SUFFIX) ? name.slice(0, -DOC_SUFFIX.length) : name

export function buildMultipart(
  metadata: Record<string, unknown>,
  content: unknown,
  boundary: string,
): { body: string; contentType: string } {
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    `${JSON.stringify(content)}\r\n` +
    `--${boundary}--`
  return { body, contentType: `multipart/related; boundary=${boundary}` }
}

export interface DriveSaveResult {
  id: string
  /** Drive's headRevisionId after the write, when Drive reports one. */
  revisionId?: string
}

interface UploadResponse {
  id: string
  headRevisionId?: string
}

const UPLOAD_FIELDS = 'id,headRevisionId'

const defaultBoundary = () => `tw-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

export class DriveClient {
  private folderId: string | null = null
  private folderPromise: Promise<string> | null = null
  private readonly deps: DriveClientDeps

  constructor(deps: DriveClientDeps) {
    this.deps = deps
  }

  /** Forget cached ids (e.g. after disconnecting or switching accounts). */
  reset() {
    this.folderId = null
    this.folderPromise = null
  }

  /** Authorized request; retries once with a fresh token on 401. */
  async request(url: string, init: RequestInit = {}): Promise<Response> {
    let res = await this.send(url, init, false)
    if (res.status === 401) res = await this.send(url, init, true)
    if (!res.ok) throw await mapHttpError(res)
    return res
  }

  private async send(url: string, init: RequestInit, forceRefresh: boolean): Promise<Response> {
    const token = await this.deps.getToken({ forceRefresh })
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    try {
      return await this.deps.fetch(url, { ...init, headers })
    } catch {
      throw new DriveError('network', 'Could not reach Google Drive. Check your connection.')
    }
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await this.request(url, init)
    try {
      return (await res.json()) as T
    } catch {
      throw new DriveError('invalid_file', 'Google Drive returned an unreadable response.')
    }
  }

  /** Finds (or creates) the "Thunder Writer" folder and caches its id. */
  ensureFolder(): Promise<string> {
    if (this.folderId) return Promise.resolve(this.folderId)
    if (!this.folderPromise) {
      this.folderPromise = this.findOrCreateFolder().then(
        (id) => {
          this.folderId = id
          return id
        },
        (err: unknown) => {
          this.folderPromise = null
          throw err
        },
      )
    }
    return this.folderPromise
  }

  private async findOrCreateFolder(): Promise<string> {
    const q = `mimeType='${FOLDER_MIME}' and name='${escapeQuery(FOLDER_NAME)}' and trashed=false`
    const params = new URLSearchParams({ q, fields: 'files(id,name)', spaces: 'drive', pageSize: '10' })
    const found = await this.json<{ files?: DriveFileInfo[] }>(`${DRIVE_API}?${params}`)
    const existing = found.files?.[0]
    if (existing) return existing.id
    const created = await this.json<{ id: string }>(`${DRIVE_API}?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    })
    return created.id
  }

  /** Lists manuscripts in the app folder, newest first. */
  async listDocs(): Promise<DriveFileInfo[]> {
    const folder = await this.ensureFolder()
    const q =
      `'${escapeQuery(folder)}' in parents and mimeType='application/json' and ` +
      `name contains '${DOC_SUFFIX}' and trashed=false`
    const out: DriveFileInfo[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        q,
        fields: 'nextPageToken,files(id,name,modifiedTime)',
        orderBy: 'modifiedTime desc',
        spaces: 'drive',
        pageSize: '100',
      })
      if (pageToken) params.set('pageToken', pageToken)
      const page = await this.json<{ files?: DriveFileInfo[]; nextPageToken?: string }>(`${DRIVE_API}?${params}`)
      out.push(...(page.files ?? []).filter((f) => f.name.endsWith(DOC_SUFFIX)))
      pageToken = page.nextPageToken
    } while (pageToken && out.length < 1000)
    return out
  }

  /** Creates or updates a JSON file with multipart upload. Returns the file id and new head revision. */
  private async uploadJson(name: string, content: unknown, existingId?: string): Promise<DriveSaveResult> {
    const boundary = (this.deps.boundary ?? defaultBoundary)()
    let res: UploadResponse
    if (existingId) {
      const { body, contentType } = buildMultipart({ name, mimeType: 'application/json' }, content, boundary)
      res = await this.json<UploadResponse>(
        `${DRIVE_UPLOAD_API}/${encodeURIComponent(existingId)}?uploadType=multipart&fields=${UPLOAD_FIELDS}`,
        { method: 'PATCH', headers: { 'Content-Type': contentType }, body },
      )
    } else {
      const folder = await this.ensureFolder()
      const { body, contentType } = buildMultipart(
        { name, mimeType: 'application/json', parents: [folder] },
        content,
        boundary,
      )
      res = await this.json<UploadResponse>(`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=${UPLOAD_FIELDS}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })
    }
    return res.headRevisionId ? { id: res.id, revisionId: res.headRevisionId } : { id: res.id }
  }

  /** Drive's current head revision of a file (changes whenever its content does). */
  async headRevision(fileId: string): Promise<string | undefined> {
    const meta = await this.json<{ headRevisionId?: string }>(
      `${DRIVE_API}/${encodeURIComponent(fileId)}?fields=id,headRevisionId`,
    )
    return meta.headRevisionId
  }

  /**
   * Saves a manuscript. Updates its existing Drive file when it has one; if that
   * file was deleted from Drive, a new one is created.
   *
   * Conflict check: when the doc remembers the Drive revision it last synced
   * (driveRevisionId) and the file's head revision has moved on (it was saved
   * from another device or tab), this throws DriveError('conflict') instead of
   * overwriting. `force` skips the check (the writer chose "keep mine").
   */
  async saveDoc(doc: ThunderDoc, opts: { force?: boolean } = {}): Promise<DriveSaveResult> {
    const name = docFileName(doc.title)
    const envelope = makeEnvelope(doc)
    if (doc.driveFileId) {
      try {
        if (!opts.force && doc.driveRevisionId) {
          const head = await this.headRevision(doc.driveFileId)
          if (head && head !== doc.driveRevisionId) {
            throw new DriveError(
              'conflict',
              'This manuscript was changed in Google Drive (on another device or tab) since this browser last synced it.',
            )
          }
        }
        return await this.uploadJson(name, envelope, doc.driveFileId)
      } catch (e) {
        if (!(isDriveError(e) && e.code === 'not_found')) throw e
      }
    }
    return this.uploadJson(name, envelope)
  }

  /**
   * Downloads and validates a manuscript. The returned doc carries this file's
   * id and the revision it was read at (read first, so a save landing in
   * between shows up as a conflict later rather than being overwritten).
   */
  async downloadDoc(fileId: string): Promise<ThunderDoc> {
    const revision = await this.headRevision(fileId)
    const data = await this.json<unknown>(`${DRIVE_API}/${encodeURIComponent(fileId)}?alt=media`)
    const parsed = parseEnvelope(data)
    if (!parsed.ok) throw new DriveError('invalid_file', parsed.reason)
    const doc: ThunderDoc = { ...parsed.doc, driveFileId: fileId }
    if (revision) doc.driveRevisionId = revision
    else delete doc.driveRevisionId
    return doc
  }

  private async findConfigFile(): Promise<string | null> {
    const folder = await this.ensureFolder()
    const q = `'${escapeQuery(folder)}' in parents and name='${escapeQuery(CONFIG_FILE_NAME)}' and trashed=false`
    const params = new URLSearchParams({ q, fields: 'files(id,name,modifiedTime)', spaces: 'drive', pageSize: '1' })
    const found = await this.json<{ files?: DriveFileInfo[] }>(`${DRIVE_API}?${params}`)
    return found.files?.[0]?.id ?? null
  }

  /** Saves non-secret preferences (never API keys) next to the manuscripts. */
  async saveConfig(settings: Partial<SettingsState>): Promise<string> {
    const existing = await this.findConfigFile()
    const res = await this.uploadJson(CONFIG_FILE_NAME, makeConfigEnvelope(settings), existing ?? undefined)
    return res.id
  }

  /** Loads preferences from Drive, or null when none have been saved yet. */
  async loadConfig(): Promise<SyncedConfig | null> {
    const id = await this.findConfigFile()
    if (!id) return null
    const data = await this.json<unknown>(`${DRIVE_API}/${encodeURIComponent(id)}?alt=media`)
    const cfg = parseConfig(data)
    if (!cfg) throw new DriveError('invalid_file', 'The settings file in Drive is not a Thunder Writer config.')
    return cfg
  }
}
