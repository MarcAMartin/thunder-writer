import { describe, expect, it, vi } from 'vitest'
import {
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
    // With more than one "Thunder Writer" folder, the oldest is always the one saved into.
    expect(new URL(calls[0].url).searchParams.get('orderBy')).toBe('createdTime')
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      name: 'Thunder Writer',
      mimeType: 'application/vnd.google-apps.folder',
    })
    expect(auth(calls[0])).toBe('Bearer stale')
  })

  it('lists manuscripts in every Thunder Writer folder (and only there) with the right query and fields', async () => {
    const { client, calls } = setup([
      (c) =>
        method(c) === 'GET' && query(c).includes("mimeType='application/vnd.google-apps.folder'")
          ? json({ files: [{ id: 'OLDEST', name: 'Thunder Writer' }, { id: 'SECOND', name: 'Thunder Writer' }] })
          : undefined,
      (c) =>
        query(c).includes("name contains '.thunder.json'")
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
    // Not anywhere in Drive: a .thunder.json picked elsewhere to import (a co-author's) must not be listed and linked.
    expect(params.get('q')).toBe(
      "('OLDEST' in parents or 'SECOND' in parents) and mimeType='application/json' and name contains '.thunder.json' and trashed=false",
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

  describe('backupDocFile (.bak before an overwrite)', () => {
    const SAVED = '{"app":"thunder-writer","version":1,"doc":{"title":"Storm"}}'
    const original = (c: Call) => {
      if (method(c) !== 'GET') return undefined
      if (c.url === `${DRIVE_API}/F1?fields=id,name`) return json({ id: 'F1', name: 'Storm.thunder.json' })
      if (c.url === `${DRIVE_API}/F1?alt=media`) return new Response(SAVED, { status: 200 })
      return undefined
    }
    const bakQuery = "appProperties has { key='thunderBackupOf' and value='F1' } and trashed=false"
    const multipartParts = (c: Call) => String(c.init.body).split('--BOUNDARY')

    it('creates "<name>.bak" in the Thunder Writer folder, holding Drive’s copy byte for byte', async () => {
      const { client, calls } = setup([
        folderFound,
        original,
        (c) => (query(c) === bakQuery ? json({ files: [] }) : undefined),
        (c) => (method(c) === 'POST' && c.url.startsWith(DRIVE_UPLOAD_API) ? json({ id: 'BAK' }) : undefined),
      ])
      await client.backupDocFile('F1')
      const post = calls.find((c) => method(c) === 'POST')!
      const [, meta, content] = multipartParts(post)
      expect(JSON.parse(meta.split('\r\n\r\n')[1])).toEqual({
        name: 'Storm.thunder.json.bak',
        mimeType: 'application/json',
        appProperties: { thunderBackupOf: 'F1' },
        // Even if the writer moved the manuscript elsewhere: drive.file can only add files to the app's own folder.
        parents: ['FOLDER'],
      })
      expect(content.split('\r\n\r\n')[1].replace(/\r\n$/, '')).toBe(SAVED)
      // Only reads of the original: it is never written here.
      expect(calls.filter((c) => c.url.includes('/F1') && method(c) !== 'GET')).toEqual([])
    })

    it('replaces the existing .bak (found by its link to the manuscript, so a rename can’t orphan it)', async () => {
      const { client, calls } = setup([
        original,
        (c) => (query(c) === bakQuery ? json({ files: [{ id: 'BAK' }] }) : undefined),
        (c) => (method(c) === 'PATCH' && c.url.startsWith(`${DRIVE_UPLOAD_API}/BAK?`) ? json({ id: 'BAK' }) : undefined),
      ])
      await client.backupDocFile('F1')
      const patch = calls.find((c) => method(c) === 'PATCH')!
      expect(JSON.parse(multipartParts(patch)[1].split('\r\n\r\n')[1])).toMatchObject({ name: 'Storm.thunder.json.bak' })
      expect(calls.some((c) => method(c) === 'POST')).toBe(false)
    })

    it('does nothing when the manuscript’s Drive file is gone (the save creates a new one)', async () => {
      const { client, calls } = setup([(c) => (c.url.includes('/F1') ? json({ error: {} }, 404) : undefined)])
      await expect(client.backupDocFile('F1')).resolves.toBeUndefined()
      expect(calls.every((c) => method(c) === 'GET')).toBe(true)
    })

    it('rejects on other failures, so nothing is overwritten without a backup', async () => {
      const { client } = setup([
        folderFound,
        original,
        (c) => (query(c) === bakQuery ? json({ files: [] }) : undefined),
        (c) => (method(c) === 'POST' ? json({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, 403) : undefined),
      ])
      await expect(client.backupDocFile('F1')).rejects.toMatchObject({ code: 'forbidden' })
    })
  })

  it('rejects downloads that are not Thunder Writer files', async () => {
    const { client } = setup([() => json({ random: true })])
    const err = await client.downloadDoc('F9').catch((e: unknown) => e)
    expect((err as DriveError).code).toBe('invalid_file')
  })
})
