import type { AIProvider, Suggestion, SuggestionSource } from '../../types'
import {
  DETAIL_MAX_CHARS,
  QUOTE_MAX_CHARS,
  SOURCE_TITLE_MAX_CHARS,
  SOURCE_URL_MAX_CHARS,
  SOURCES_MAX,
  TITLE_MAX_CHARS,
} from './constants'
import type { RawSuggestion } from './schema'

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

const normalizeForCompare = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

// Control and zero-width/bidi characters have no place in a link label.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g

/**
 * Returns the URL normalised by the URL parser when it is an absolute http(s)
 * URL without embedded credentials; null otherwise (javascript:, data:, file:,
 * relative, malformed, over-long).
 */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > SOURCE_URL_MAX_CHARS) return null
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username || u.password || !u.hostname) return null
  const href = u.href
  return href.length > SOURCE_URL_MAX_CHARS ? null : href
}

/** Host name shown on a source link ("www." dropped). Expects an already-sanitized http(s) URL. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return url
  }
}

/**
 * Sources for a card: http(s) only, de-duplicated by URL, plain-text titles
 * (falling back to the host name), capped in count and length.
 */
export function sanitizeSources(raw: readonly { url?: unknown; title?: unknown }[] | undefined): SuggestionSource[] {
  if (!raw) return []
  const out: SuggestionSource[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    if (out.length >= SOURCES_MAX) break
    const url = safeHttpUrl(r?.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const rawTitle = typeof r.title === 'string' ? r.title.replace(UNSAFE_TEXT, '').replace(/\s+/g, ' ').trim() : ''
    const title = clip(rawTitle || new URL(url).hostname, SOURCE_TITLE_MAX_CHARS)
    out.push({ url, title })
  }
  return out
}

/** A raw item plus the sources the provider's search tool cited for it. */
export type RawSuggestionWithSources = RawSuggestion & { sources?: { url?: unknown; title?: unknown }[] }

export interface SanitizeOptions {
  maxItems: number
  existing: Pick<Suggestion, 'title' | 'quote'>[]
  /** Returns true when the quote exists verbatim in the current document. */
  hasQuote: (quote: string) => boolean
  provider: AIProvider
  model: string
  now?: number
  makeId?: () => string
}

const defaultId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/**
 * Turn raw model output into Suggestions the UI can trust:
 * trims and caps lengths, drops items whose quote is not in the document
 * (the model misquoted or the writer has since edited it), drops duplicates of
 * suggestions already shown, drops no-op replacements, and caps the count.
 */
export function sanitizeItems(raw: RawSuggestionWithSources[], opts: SanitizeOptions): Suggestion[] {
  const now = opts.now ?? Date.now()
  const makeId = opts.makeId ?? defaultId
  const seenTitles = new Set(opts.existing.map((s) => normalizeForCompare(s.title)))
  const seenQuotes = new Set(opts.existing.filter((s) => s.quote).map((s) => normalizeForCompare(s.quote ?? '')))
  const out: Suggestion[] = []

  for (const item of raw) {
    if (out.length >= opts.maxItems) break
    const title = clip(item.title.trim(), TITLE_MAX_CHARS)
    const detail = clip(item.detail.trim(), DETAIL_MAX_CHARS)
    if (!title) continue

    let quote: string | undefined = item.quote ?? undefined
    let replacement: string | undefined = item.replacement ?? undefined
    if (quote !== undefined && quote.trim() === '') quote = undefined
    if (quote !== undefined) {
      if (quote.length > QUOTE_MAX_CHARS) continue
      if (!opts.hasQuote(quote)) continue
    }
    if (quote === undefined || replacement === quote) replacement = undefined

    const tKey = normalizeForCompare(title)
    const qKey = quote ? normalizeForCompare(quote) : null
    if (seenTitles.has(tKey)) continue
    if (qKey && seenQuotes.has(qKey)) continue
    const sources = sanitizeSources(item.sources)
    // A web-searched item whose every source was unsafe has nothing to back it up.
    if (item.sources !== undefined && item.sources.length > 0 && sources.length === 0) continue
    seenTitles.add(tKey)
    if (qKey) seenQuotes.add(qKey)

    out.push({
      id: makeId(),
      kind: item.kind,
      title,
      detail,
      ...(quote !== undefined ? { quote } : {}),
      ...(replacement !== undefined ? { replacement } : {}),
      status: 'open',
      createdAt: now,
      provider: opts.provider,
      model: opts.model,
      ...(sources.length > 0 ? { sources } : {}),
    })
  }
  return out
}
