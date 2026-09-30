import { describe, expect, it, vi } from 'vitest'
import {
  CONFIG_FILE_NAME,
  DRIVE_API,
  DRIVE_UPLOAD_API,
  DriveClient,
  DriveError,
  buildMultipart,
  docFileName,
  mapHttpError,
  titleFromFileName,
} from './drive'
import { makeEnvelope } from './schema'
import { makeDoc } from './testDocs'

type Call = { url: string; init: RequestInit }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Fake Drive: routes by method + URL prefix, records calls. */
function setup(routes: ((c: Call) => Response | undefined)[]) {
  const calls: Call[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const c = { url, init }
    calls.push(c)
    for (const r of routes) {
      const res = r(c)
      if (res) return res
    }
    throw new Error(`Unrouted ${init.method ?? 'GET'} ${url}`)
  })
  const getToken = vi.fn(async ({ forceRefresh }: { forceRefresh: boolean }) => (forceRefresh ? 'fresh' : 'stale'))
  const client = new DriveClient({ fetch, getToken, boundary: () => 'BOUNDARY' })
  return { client, calls, fetch, getToken }
}

const method = (c: Call) => c.init.method ?? 'GET'
const query = (c: Call) => new URL(c.url).searchParams.get('q') ?? ''
const auth = (c: Call) => new Headers(c.init.headers).get('Authorization')

const folderFound = (c: Call) =>
  method(c) === 'GET' && query(c).includes("mimeType='application/vnd.google-apps.folder'")
    ? json({ files: [{ id: 'FOLDER', name: 'Thunder Writer' }] })
    : undefined

describe('helpers', () => {
  it('builds a multipart/related body with metadata then content', () => {
    const { body, contentType } = buildMultipart({ name: 'a.json' }, { x: 1 }, 'B')
    expect(contentType).toBe('multipart/related; boundary=B')
    expect(body).toBe(
      '--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.json"}\r\n' +
        '--B\r\nContent-Type: application/json\r\n\r\n{"x":1}\r\n--B--',
    )
  })

  it('makes safe file names', () => {
    expect(docFileName('Book: One / Draft?')).toBe('Book One Draft.thunder.json')
    expect(docFileName('   ')).toBe('Untitled Manuscript.thunder.json')
    expect(titleFromFileName('Book.thunder.json')).toBe('Book')
  })

  it('maps HTTP errors', async () => {
    expect((await mapHttpError(json({}, 401))).code).toBe('auth')
    expect((await mapHttpError(json({}, 404))).code).toBe('not_found')
    expect((await mapHttpError(json({}, 503))).code).toBe('unavailable')
    expect((await mapHttpError(json({}, 429))).code).toBe('rate_limited')
    expect(
      (await mapHttpError(json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 403))).code,
    ).toBe('rate_limited')
    const quota = await mapHttpError(json({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, 403))
    expect(quota.code).toBe('forbidden')
    expect(quota.message).toMatch(/full/)
    expect((await mapHttpError(new Response('nope', { status: 400 }))).message).toMatch(/400/)
  })
})

describe('DriveClient', () => {
  it('creates the app folder when missing, then caches it', async () => {
    const { client, calls } = setup([
      (c) => (method(c) === 'GET' && c.url.startsWith(DRIVE_API) ? json({ files: [] }) : undefined),
      (c) => (method(c) === 'POST' && c.url === `${DRIVE_API}?fields=id` ? json({ id: 'NEWFOLDER' }) : undefined),
    ])
    expect(await client.ensureFolder()).toBe('NEWFOLDER')
    expect(await client.ensureFolder()).toBe('NEWFOLDER')
    expect(calls).toHaveLength(2)
    expect(query(calls[0])).toBe("mimeType='application/vnd.google-apps.folder' and name='Thunder Writer' and trashed=false")
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      name: 'Thunder Writer',
      mimeType: 'application/vnd.google-apps.folder',
    })
    expect(auth(calls[0])).toBe('Bearer stale')
  })

  it('lists manuscripts in the folder with the right query and fields', async () => {
    const { client, calls } = setup([
      folderFound,
      (c) =>
        query(c).includes("'FOLDER' in parents")
          ? json({
              files: [
                { id: '1', name: 'A.thunder.json', modifiedTime: '2026-09-01T10:00:00Z' },
                { id: '2', name: 'notes.thunder.json.bak' },
              ],
            })
          : undefined,
    ])
    const files = await client.listDocs()
    expect(files.map((f) => f.id)).toEqual(['1'])
    const params = new URL(calls[1].url).searchParams
    expect(params.get('q')).toBe(
      "'FOLDER' in parents and mimeType='application/json' and name contains '.thunder.json' and trashed=false",
    )
    expect(params.get('fields')).toBe('nextPageToken,files(id,name,modifiedTime)')
    expect(params.get('orderBy')).toBe('modifiedTime desc')
  })

  it('creates a new file with a multipart POST inside the folder', async () => {
    const { client, calls } = setup([
      folderFound,
      (c) => (method(c) === 'POST' && c.url.startsWith(DRIVE_UPLOAD_API) ? json({ id: 'FILE' }) : undefined),
    ])
    const doc = makeDoc()
    expect(await client.saveDoc(doc)).toEqual({ id: 'FILE' })
    const post = calls[1]
    expect(post.url).toBe(`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,headRevisionId`)
    expect(new Headers(post.init.headers).get('Content-Type')).toBe('multipart/related; boundary=BOUNDARY')
    const body = String(post.init.body)
    expect(body).toContain(JSON.stringify({ name: 'The Long Storm.thunder.json', mimeType: 'application/json', parents: ['FOLDER'] }))
    expect(body).toContain('"app":"thunder-writer"')
    expect(body).toContain('"version":1')
    expect(body).toContain('"id":"doc-1"')
  })

  it('PATCHes the existing file when the doc has a driveFileId', async () => {
    const { client, calls } = setup([
      (c) => (method(c) === 'PATCH' ? json({ id: 'EXISTING', headRevisionId: 'R2' }) : undefined),
    ])
    expect(await client.saveDoc(makeDoc({ driveFileId: 'EXISTING', title: 'Renamed' }))).toEqual({
      id: 'EXISTING',
      revisionId: 'R2',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${DRIVE_UPLOAD_API}/EXISTING?uploadType=multipart&fields=id,headRevisionId`)
    const body = String(calls[0].init.body)
    expect(body).toContain('"name":"Renamed.thunder.json"')
    expect(body).not.toContain('parents')
  })

  it('recreates the file when the linked Drive file was deleted', async () => {
    const { client, calls } = setup([
      (c) => (method(c) === 'PATCH' ? json({ error: { message: 'File not found' } }, 404) : undefined),
      folderFound,
      (c) => (method(c) === 'POST' ? json({ id: 'RECREATED' }) : undefined),
    ])
    expect(await client.saveDoc(makeDoc({ driveFileId: 'GONE' }))).toEqual({ id: 'RECREATED' })
    expect(calls.map(method)).toEqual(['PATCH', 'GET', 'POST'])
  })

  it('retries once with a fresh token after a 401', async () => {
    const { client, calls, getToken } = setup([
      (c) => (auth(c) === 'Bearer stale' ? json({}, 401) : undefined),
      folderFound,
    ])
    expect(await client.ensureFolder()).toBe('FOLDER')
    expect(getToken).toHaveBeenLastCalledWith({ forceRefresh: true })
    expect(calls.map(auth)).toEqual(['Bearer stale', 'Bearer fresh'])
  })

  it('maps a second 401 to an auth error that asks to reconnect', async () => {
    const { client } = setup([() => json({}, 401)])
    const err = await client.ensureFolder().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DriveError)
    expect((err as DriveError).code).toBe('auth')
    expect((err as DriveError).needsReconnect).toBe(true)
  })

  it('maps fetch failures to network errors and allows retrying the folder lookup', async () => {
    const { client, fetch } = setup([folderFound])
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const err = await client.ensureFolder().catch((e: unknown) => e)
    expect((err as DriveError).code).toBe('network')
    expect(await client.ensureFolder()).toBe('FOLDER')
  })

  it('downloads and validates a manuscript, stamping the Drive id', async () => {
    const doc = makeDoc({ driveFileId: 'old' })
    const { client, calls } = setup([
      (c) => (c.url.endsWith('?fields=id,headRevisionId') ? json({ id: 'F9', headRevisionId: 'R7' }) : undefined),
      (c) => (c.url.endsWith('?alt=media') ? json(makeEnvelope(doc)) : undefined),
    ])
    const got = await client.downloadDoc('F9')
    // Revision first: an edit landing in between surfaces later as a conflict, never as a silent overwrite.
    expect(calls.map((c) => c.url)).toEqual([`${DRIVE_API}/F9?fields=id,headRevisionId`, `${DRIVE_API}/F9?alt=media`])
    expect(got).toEqual({ ...doc, driveFileId: 'F9', driveRevisionId: 'R7' })
  })

  it('refuses to overwrite a Drive file that changed since this browser last synced it', async () => {
    const { client, calls } = setup([
      (c) => (method(c) === 'GET' && c.url.includes('fields=id,headRevisionId') ? json({ id: 'F', headRevisionId: 'R-OTHER' }) : undefined),
      (c) => (method(c) === 'PATCH' ? json({ id: 'F', headRevisionId: 'R3' }) : undefined),
    ])
    const doc = makeDoc({ driveFileId: 'F', driveRevisionId: 'R1' })
    const err = await client.saveDoc(doc).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DriveError)
    expect((err as DriveError).code).toBe('conflict')
    expect(calls.map(method)).toEqual(['GET'])
    // Unchanged since the last sync: writes, returning the new revision.
    expect(await client.saveDoc({ ...doc, driveRevisionId: 'R-OTHER' })).toEqual({ id: 'F', revisionId: 'R3' })
    // "Keep this browser's version": force skips the check.
    calls.length = 0
    expect(await client.saveDoc(doc, { force: true })).toEqual({ id: 'F', revisionId: 'R3' })
    expect(calls.map(method)).toEqual(['PATCH'])
  })

  it('rejects downloads that are not Thunder Writer files', async () => {
    const { client } = setup([() => json({ random: true })])
    const err = await client.downloadDoc('F9').catch((e: unknown) => e)
    expect((err as DriveError).code).toBe('invalid_file')
  })

  it('saves config without secrets, updating the existing config file', async () => {
    const { client, calls } = setup([
      folderFound,
      (c) => (query(c).includes(`name='${CONFIG_FILE_NAME}'`) ? json({ files: [{ id: 'CFG', name: CONFIG_FILE_NAME }] }) : undefined),
      (c) => (method(c) === 'PATCH' ? json({ id: 'CFG' }) : undefined),
    ])
    await client.saveConfig({ theme: 'dark', claudeApiKey: 'sk-ant-SECRET', openaiApiKey: 'sk-SECRET' })
    const patch = calls.find((c) => method(c) === 'PATCH')!
    expect(patch.url).toContain('/CFG?uploadType=multipart')
    expect(String(patch.init.body)).toContain('"theme":"dark"')
    expect(String(patch.init.body)).not.toContain('SECRET')
  })

  it('loads config, returning null when none exists', async () => {
    const empty = setup([folderFound, (c) => (query(c).includes(CONFIG_FILE_NAME) ? json({ files: [] }) : undefined)])
    expect(await empty.client.loadConfig()).toBeNull()

    const full = setup([
      folderFound,
      (c) => (query(c).includes(CONFIG_FILE_NAME) ? json({ files: [{ id: 'CFG', name: CONFIG_FILE_NAME }] }) : undefined),
      (c) =>
        c.url.endsWith('/CFG?alt=media')
          ? json({ app: 'thunder-writer', kind: 'config', version: 1, settings: { theme: 'light', claudeApiKey: 'x' } })
          : undefined,
    ])
    expect(await full.client.loadConfig()).toEqual({ theme: 'light' })
  })
})
