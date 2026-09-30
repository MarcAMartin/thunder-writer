// Web-searched trivia state that must outlive the suggestion engine: the engine
// is remounted whenever the writer leaves /write (Settings, Home) or reloads, and
// neither the trivia cooldown nor a "search unavailable" answer may reset then.
//
// - The last searched-trivia time lives in localStorage, so the cooldown (and
//   therefore the search bill) holds across reloads, navigation and tabs.
// - The "search unavailable" marker lives in sessionStorage for this tab (an admin
//   may enable search later; a new tab tries again). It stores provider + model +
//   a short non-reversible fingerprint of the key, never the key itself.
//
// Storage can be missing or throw (private windows, blocked site data), so every
// access is guarded and an in-memory copy keeps working for this page load.

const LAST_TRIVIA_KEY = 'thunder-writer:trivia-last-search-at'
const UNAVAILABLE_KEY = 'thunder-writer:trivia-search-unavailable'

let memLastTriviaAt: number | null = null
let memUnavailable: string | null = null

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

function readItem(kind: 'local' | 'session', key: string): string | null {
  try {
    return storage(kind)?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeItem(kind: 'local' | 'session', key: string, value: string | null): void {
  try {
    const s = storage(kind)
    if (!s) return
    if (value === null) s.removeItem(key)
    else s.setItem(key, value)
  } catch {
    // Storage full or blocked: the in-memory copy still applies for this page load.
  }
}

/** When the last web-searched trivia attempt started (epoch ms), from any tab, or null. */
export function loadLastTriviaAt(): number | null {
  const raw = readItem('local', LAST_TRIVIA_KEY)
  const stored = raw === null ? null : Number(raw)
  const persisted = stored !== null && Number.isFinite(stored) && stored > 0 ? stored : null
  if (persisted === null) return memLastTriviaAt
  if (memLastTriviaAt === null) return persisted
  return Math.max(persisted, memLastTriviaAt)
}

export function saveLastTriviaAt(at: number): void {
  if (!Number.isFinite(at)) return
  memLastTriviaAt = at
  writeItem('local', LAST_TRIVIA_KEY, String(Math.round(at)))
}

/** 32-bit FNV-1a of the key, hex. Enough to tell keys apart; cannot recover the key. */
export function keyFingerprint(apiKey: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < apiKey.length; i++) {
    h ^= apiKey.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Identifies the provider + model + key a "web search unavailable" answer applies to. */
export function searchId(provider: string, model: string, apiKey: string): string {
  return `${provider}|${model}|${keyFingerprint(apiKey.trim())}`
}

export function loadSearchUnavailable(): string | null {
  return readItem('session', UNAVAILABLE_KEY) ?? memUnavailable
}

export function saveSearchUnavailable(id: string | null): void {
  memUnavailable = id
  writeItem('session', UNAVAILABLE_KEY, id)
}

/** Forget everything (tests). */
export function resetTriviaMemory(): void {
  memLastTriviaAt = null
  memUnavailable = null
  writeItem('local', LAST_TRIVIA_KEY, null)
  writeItem('session', UNAVAILABLE_KEY, null)
}
