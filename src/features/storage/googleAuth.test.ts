import { describe, expect, it, vi } from 'vitest'
import { DriveError } from './drive'
import { DRIVE_SCOPE, GoogleAuth } from './googleAuth'

type Resp = { access_token?: string; expires_in?: number; error?: string }
type ErrT = { type?: string; message?: string }

function fakeGis() {
  let cb: ((r: Resp) => void) | undefined
  let errCb: ((e: ErrT) => void) | undefined
  const requestAccessToken = vi.fn()
  const initTokenClient = vi.fn((cfg: { client_id: string; scope: string; callback: (r: Resp) => void; error_callback?: (e: ErrT) => void }) => {
    cb = cfg.callback
    errCb = cfg.error_callback
    return { requestAccessToken }
  })
  const oauth2 = { initTokenClient, hasGrantedAllScopes: () => true }
  return {
    oauth2,
    initTokenClient,
    requestAccessToken,
    respond: (r: Resp) => cb?.(r),
    fail: (e: ErrT) => errCb?.(e),
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('GoogleAuth', () => {
  it('requires a client id', async () => {
    const g = fakeGis()
    const auth = new GoogleAuth(() => '', async () => g.oauth2)
    const err = await auth.getToken({ interactive: true }).catch((e: unknown) => e)
    expect((err as DriveError).code).toBe('not_configured')
  })

  it('refuses silent token requests before the writer has connected', async () => {
    const g = fakeGis()
    const auth = new GoogleAuth(() => 'cid', async () => g.oauth2)
    const err = await auth.getToken().catch((e: unknown) => e)
    expect((err as DriveError).code).toBe('auth')
    expect(g.requestAccessToken).not.toHaveBeenCalled()
  })

  it('gets, caches and silently refreshes an expired token', async () => {
    let now = 0
    const g = fakeGis()
    const auth = new GoogleAuth(() => 'cid', async () => g.oauth2, () => now)
    const changes: boolean[] = []
    auth.onChange((c) => changes.push(c))

    const p = auth.getToken({ interactive: true })
    await flush()
    expect(g.initTokenClient).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'cid', scope: DRIVE_SCOPE }))
    expect(g.requestAccessToken).toHaveBeenLastCalledWith({})
    g.respond({ access_token: 'T1', expires_in: 3600 })
    expect(await p).toBe('T1')
    expect(auth.connected).toBe(true)
    expect(changes).toEqual([true])

    now = 30 * 60_000
    expect(await auth.getToken()).toBe('T1')
    expect(g.requestAccessToken).toHaveBeenCalledTimes(1)

    now = 3600_000 - 30_000 // inside the refresh margin
    // In the background (autosave timer) a refresh would need a popup the browser blocks: ask to reconnect instead.
    const bg = await auth.getToken().catch((e: unknown) => e)
    expect((bg as DriveError).code).toBe('auth')
    expect((bg as DriveError).message).toMatch(/Reconnect Drive/)
    expect(g.requestAccessToken).toHaveBeenCalledTimes(1)
    const forced = await auth.getToken({ forceRefresh: true }).catch((e: unknown) => e)
    expect((forced as DriveError).code).toBe('auth')
    expect(g.requestAccessToken).toHaveBeenCalledTimes(1)
    expect(auth.connected).toBe(true)

    // From a click it re-issues the token without the consent screen.
    const p2 = auth.getToken({ interactive: true })
    await flush()
    expect(g.requestAccessToken).toHaveBeenLastCalledWith({ prompt: '' })
    g.respond({ access_token: 'T2', expires_in: 3600 })
    expect(await p2).toBe('T2')
  })

  it('times out a Google window that never finishes, so queued Drive writes are not stuck', async () => {
    const g = fakeGis()
    const auth = new GoogleAuth(() => 'cid', async () => g.oauth2, Date.now, 20)
    const err = await auth.getToken({ interactive: true }).catch((e: unknown) => e)
    expect((err as DriveError).code).toBe('popup_closed')
    // A later attempt starts a fresh request instead of joining the dead one.
    const p = auth.getToken({ interactive: true })
    await flush()
    expect(g.requestAccessToken).toHaveBeenCalledTimes(2)
    g.respond({ access_token: 'T', expires_in: 3600 })
    expect(await p).toBe('T')
  })

  it('shares one in-flight request between callers', async () => {
    const g = fakeGis()
    const auth = new GoogleAuth(() => 'cid', async () => g.oauth2)
    const a = auth.getToken({ interactive: true })
    const b = auth.getToken({ interactive: true })
    await flush()
    g.respond({ access_token: 'T', expires_in: 3600 })
    expect(await Promise.all([a, b])).toEqual(['T', 'T'])
    expect(g.requestAccessToken).toHaveBeenCalledTimes(1)
  })

  it('maps access_denied and popup errors', async () => {
    const g = fakeGis()
    const auth = new GoogleAuth(() => 'cid', async () => g.oauth2)
    const denied = auth.getToken({ interactive: true }).catch((e: unknown) => e)
    await flush()
    g.respond({ error: 'access_denied' })
    expect(((await denied) as DriveError).code).toBe('access_denied')

    const closed = auth.getToken({ interactive: true }).catch((e: unknown) => e)
    await flush()
    g.fail({ type: 'popup_closed' })
    expect(((await closed) as DriveError).code).toBe('popup_closed')

    const blocked = auth.getToken({ interactive: true }).catch((e: unknown) => e)
    await flush()
    g.fail({ type: 'popup_failed_to_open' })
    expect(((await blocked) as DriveError).code).toBe('popup_blocked')
    expect(auth.connected).toBe(false)
  })

  it('disconnect forgets the token', async () => {
    const g = fakeGis()
    const auth = new GoogleAuth(() => 'cid', async () => g.oauth2)
    const p = auth.getToken({ interactive: true })
    await flush()
    g.respond({ access_token: 'T', expires_in: 3600 })
    await p
    auth.disconnect()
    expect(auth.connected).toBe(false)
    expect(auth.hasValidToken).toBe(false)
  })
})
