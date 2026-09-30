import { DriveError } from './drive'

/**
 * Google Identity Services (GIS) token model. The access token lives in memory
 * only — never in localStorage. When it expires it is re-requested with
 * prompt: '' (no consent screen), but GIS still opens a popup for that, which
 * browsers block outside a click. So only interactive calls (from a click)
 * ever request a token; background calls (autosave) get a 'reconnect' error.
 */

export const GIS_SRC = 'https://accounts.google.com/gsi/client'
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  scope?: string
  error?: string
  error_description?: string
}
interface TokenClientError {
  type?: 'popup_failed_to_open' | 'popup_closed' | 'unknown' | string
  message?: string
}
interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void
}
interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string
    scope: string
    callback: (resp: TokenResponse) => void
    error_callback?: (err: TokenClientError) => void
  }) => TokenClient
  hasGrantedAllScopes?: (resp: TokenResponse, ...scopes: string[]) => boolean
  revoke?: (token: string, done?: () => void) => void
}
interface GoogleGlobal {
  accounts?: { oauth2?: GoogleOAuth2 }
}

const googleGlobal = (): GoogleGlobal | undefined => (window as unknown as { google?: GoogleGlobal }).google

let gisPromise: Promise<GoogleOAuth2> | null = null

/** Injects the GIS script once and resolves with google.accounts.oauth2. */
export function loadGis(): Promise<GoogleOAuth2> {
  const ready = googleGlobal()?.accounts?.oauth2
  if (ready) return Promise.resolve(ready)
  if (gisPromise) return gisPromise
  gisPromise = new Promise<GoogleOAuth2>((resolve, reject) => {
    const fail = () => {
      gisPromise = null
      reject(new DriveError('network', 'Could not load Google sign-in. Check your connection or ad blocker.'))
    }
    const done = () => {
      const oauth2 = googleGlobal()?.accounts?.oauth2
      if (oauth2) resolve(oauth2)
      else fail()
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)
    if (!script) {
      script = document.createElement('script')
      script.src = GIS_SRC
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
    script.addEventListener('load', done, { once: true })
    script.addEventListener('error', fail, { once: true })
  })
  return gisPromise
}

/** Refresh a little early so an upload never starts with a token about to die. */
const EXPIRY_MARGIN_MS = 60_000

/** A Google window left open (or never answered) must not hold up every Drive write forever. */
export const TOKEN_REQUEST_TIMEOUT_MS = 120_000

export interface GetTokenOptions {
  /** May show Google's consent popup. Must be called from a user gesture. */
  interactive?: boolean
  forceRefresh?: boolean
}

export class GoogleAuth {
  private token: string | null = null
  private expiresAt = 0
  private granted = false
  private client: TokenClient | null = null
  private clientFor = ''
  private pending: {
    promise: Promise<string>
    resolve: (t: string) => void
    reject: (e: DriveError) => void
  } | null = null
  private listeners = new Set<(connected: boolean) => void>()
  private readonly getClientId: () => string
  private readonly load: () => Promise<GoogleOAuth2>
  private readonly now: () => number
  private readonly timeoutMs: number

  constructor(
    getClientId: () => string,
    load: () => Promise<GoogleOAuth2> = loadGis,
    now: () => number = Date.now,
    timeoutMs: number = TOKEN_REQUEST_TIMEOUT_MS,
  ) {
    this.getClientId = getClientId
    this.load = load
    this.now = now
    this.timeoutMs = timeoutMs
  }

  /** True once the writer granted access this browser session. */
  get connected() {
    return this.granted
  }

  get hasValidToken() {
    return !!this.token && this.now() < this.expiresAt - EXPIRY_MARGIN_MS
  }

  onChange(fn: (connected: boolean) => void) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit() {
    for (const fn of this.listeners) fn(this.granted)
  }

  async getToken(opts: GetTokenOptions = {}): Promise<string> {
    if (!opts.forceRefresh && this.hasValidToken && this.token) return this.token
    if (!opts.interactive) {
      // A token request opens Google's popup; outside a click the browser blocks it.
      throw new DriveError(
        'auth',
        this.granted ? 'Your Google Drive session expired. Reconnect Drive to keep autosaving.' : 'Connect Google Drive to continue.',
      )
    }
    return this.requestToken()
  }

  private async requestToken(): Promise<string> {
    if (this.pending) return this.pending.promise
    const clientId = this.getClientId().trim()
    if (!clientId) {
      throw new DriveError('not_configured', 'Add a Google OAuth client ID in Settings to use Google Drive.')
    }
    let resolve!: (t: string) => void
    let reject!: (e: DriveError) => void
    const promise = new Promise<string>((res, rej) => {
      resolve = res
      reject = rej
    })
    const pending = { promise, resolve, reject }
    this.pending = pending
    const timeout = setTimeout(
      () => reject(new DriveError('popup_closed', 'The Google window did not finish. Try connecting Drive again.')),
      this.timeoutMs,
    )
    const settle = () => {
      clearTimeout(timeout)
      if (this.pending === pending) this.pending = null
    }
    promise.then(settle, settle)

    try {
      const oauth2 = await this.load()
      if (!this.client || this.clientFor !== clientId) {
        this.client = oauth2.initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          callback: (resp) => this.handleResponse(oauth2, resp),
          error_callback: (err) => this.handleClientError(err),
        })
        this.clientFor = clientId
      }
      // After the first grant, prompt '' re-issues a token without showing consent again.
      this.client.requestAccessToken(this.granted ? { prompt: '' } : {})
    } catch (e) {
      pending.reject(e instanceof DriveError ? e : new DriveError('unknown', 'Google sign-in failed to start.'))
    }
    return promise
  }

  private handleResponse(oauth2: GoogleOAuth2, resp: TokenResponse) {
    const p = this.pending
    if (!p) return
    if (resp.error || !resp.access_token) {
      const denied = resp.error === 'access_denied'
      p.reject(
        new DriveError(
          denied ? 'access_denied' : 'auth',
          denied
            ? 'Google Drive access was not granted. Thunder Writer only sees files it creates and files you pick with Import from Google Drive.'
            : `Google sign-in failed${resp.error_description ? `: ${resp.error_description}` : '.'}`,
        ),
      )
      return
    }
    if (oauth2.hasGrantedAllScopes && !oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) {
      p.reject(new DriveError('access_denied', 'Please allow Thunder Writer to see the files it creates in Drive (and the files you pick to import).'))
      return
    }
    const seconds = Number(resp.expires_in ?? 3600)
    this.token = resp.access_token
    this.expiresAt = this.now() + (Number.isFinite(seconds) ? seconds : 3600) * 1000
    const wasGranted = this.granted
    this.granted = true
    p.resolve(resp.access_token)
    if (!wasGranted) this.emit()
  }

  private handleClientError(err: TokenClientError) {
    const p = this.pending
    if (!p) return
    if (err.type === 'popup_closed') p.reject(new DriveError('popup_closed', 'The Google window was closed before finishing.'))
    else if (err.type === 'popup_failed_to_open')
      p.reject(new DriveError('popup_blocked', 'Your browser blocked the Google window. Allow pop-ups and try again.'))
    else p.reject(new DriveError('auth', err.message || 'Google sign-in failed.'))
  }

  /** Drops the in-memory token and revokes it with Google. */
  disconnect() {
    const t = this.token
    this.token = null
    this.expiresAt = 0
    const wasGranted = this.granted
    this.granted = false
    if (t) googleGlobal()?.accounts?.oauth2?.revoke?.(t)
    if (wasGranted) this.emit()
  }
}
