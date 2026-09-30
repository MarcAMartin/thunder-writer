// Pure helpers for the web-searched trivia request, shared by both providers:
// lenient parsing of the model's final text (one JSON object or NONE) and
// choosing which web pages back the item up. No SDKs here.

import type { SuggestionSource } from '../../types'
import { safeHttpUrl, type RawSuggestionWithSources } from './sanitize'
import { parseSuggestionBatch } from './schema'

export type TriviaReply =
  | { kind: 'none' }
  | { kind: 'item'; item: RawSuggestionWithSources; sourceUrls: string[] }
  | { kind: 'unreadable' }

const NONE_ONLY = /^[\s"'`*_.:-]*NONE[\s"'`*_.!:-]*$/i

/** Candidate JSON objects in `text`: the whole text, fenced blocks, then balanced {...} spans (last first). */
function jsonCandidates(text: string): string[] {
  const out: string[] = [text.trim()]
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) out.push(m[1].trim())
  const spans: string[] = []
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = start; i < text.length; i++) {
      const c = text[i]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) {
        spans.push(text.slice(start, i + 1))
        break
      }
    }
  }
  // Prefer the outermost/latest objects: models sometimes think aloud before the answer.
  out.push(...spans.reverse())
  return out
}

export const TRIVIA_HEDGE = 'Possibly relevant: '

/**
 * Web-found trivia is always framed tentatively: the prompt asks for the
 * "Possibly relevant:" lead-in, and this enforces it when the model (or text it
 * read in a search result) leaves it out. Added before sanitizing clips length.
 */
export function hedgeDetail(detail: string): string {
  const d = detail.trim()
  if (/^possibly relevant\b/i.test(d)) return d
  return d ? `${TRIVIA_HEDGE}${d}` : TRIVIA_HEDGE.trim()
}

/**
 * Parse the trivia reply. Accepts a bare JSON object, one wrapped in prose or
 * code fences, or NONE. The item goes through the same lenient zod validation
 * as regular suggestions, is forced to kind "trivia", never carries an edit,
 * and its detail always starts with "Possibly relevant:".
 */
export function parseTriviaReply(text: string): TriviaReply {
  const trimmed = text.trim()
  if (!trimmed || NONE_ONLY.test(trimmed)) return { kind: 'none' }
  for (const cand of jsonCandidates(trimmed)) {
    let json: unknown
    try {
      json = JSON.parse(cand)
    } catch {
      continue
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) continue
    const obj = json as Record<string, unknown>
    if (obj.none === true || (typeof obj.result === 'string' && NONE_ONLY.test(obj.result))) return { kind: 'none' }
    const items = parseSuggestionBatch({ suggestions: [obj] })
    if (!items || items.length === 0) continue
    const urls = Array.isArray(obj.source_urls) ? obj.source_urls.filter((u): u is string => typeof u === 'string') : []
    return {
      kind: 'item',
      item: { ...items[0], kind: 'trivia', replacement: null, detail: hedgeDetail(items[0].detail) },
      sourceUrls: urls,
    }
  }
  // Prose that ends in NONE (e.g. "I searched but found nothing relevant. NONE").
  if (/\bNONE\s*\.?\s*$/.test(trimmed)) return { kind: 'none' }
  return { kind: 'unreadable' }
}

export interface SearchEvidence {
  /** Pages the provider's citations point at (web_search_result_location / url_citation). */
  citations: { url: string; title?: string | null }[]
  /** Pages the search actually returned (Claude web_search_result, OpenAI action.sources). */
  results: { url: string; title?: string | null }[]
}

const key = (u: string) => safeHttpUrl(u) ?? u

/**
 * Sources for a searched trivia item: every cited page first, then any URL the
 * model listed that the search really returned. A URL the model lists but no
 * search result or citation backs is ignored, so a fabricated link never shows.
 */
export function triviaSources(sourceUrls: readonly string[], ev: SearchEvidence): SuggestionSource[] {
  const titles = new Map<string, string>()
  for (const r of [...ev.results, ...ev.citations]) if (r.title) titles.set(key(r.url), r.title)
  const known = new Set([...ev.results, ...ev.citations].map((r) => key(r.url)))
  const picked: SuggestionSource[] = []
  const add = (url: string) => picked.push({ url, title: titles.get(key(url)) ?? '' })
  for (const c of ev.citations) add(c.url)
  for (const u of sourceUrls) if (known.has(key(u))) add(u)
  return picked
}

export type TriviaOutcome = 'ok' | 'none' | 'no_sources' | 'unreadable' | 'search_error'

/** Turn the final text + evidence into an item (with sources) or a reason there is none. */
export function finishTrivia(
  text: string,
  ev: SearchEvidence,
): { item: RawSuggestionWithSources | null; outcome: TriviaOutcome } {
  const reply = parseTriviaReply(text)
  if (reply.kind === 'none') return { item: null, outcome: 'none' }
  if (reply.kind === 'unreadable') return { item: null, outcome: 'unreadable' }
  const sources = triviaSources(reply.sourceUrls, ev)
  // Current-events trivia must be backed by what the search found; otherwise it may be invented.
  if (sources.length === 0) return { item: null, outcome: 'no_sources' }
  return { item: { ...reply.item, sources }, outcome: 'ok' }
}
