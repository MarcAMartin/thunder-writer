import { describe, expect, it } from 'vitest'
import type { RawSuggestion } from './schema'
import { safeHttpUrl, sanitizeItems, sanitizeSources } from './sanitize'

const doc = 'It was a dark and stormy nite. The captain looked away.'
const base = {
  existing: [],
  hasQuote: (q: string) => doc.includes(q),
  provider: 'claude' as const,
  model: 'claude-haiku-4-5',
  now: 42,
}
let n = 0
const makeId = () => `id-${++n}`

const raw = (p: Partial<RawSuggestion>): RawSuggestion => ({
  kind: 'spelling',
  title: 'Typo',
  detail: 'Detail.',
  quote: null,
  replacement: null,
  ...p,
})

describe('sanitizeItems', () => {
  it('keeps valid items and shapes them as open suggestions', () => {
    const out = sanitizeItems([raw({ title: '  "nite" → "night" ', quote: 'stormy nite', replacement: 'stormy night' })], {
      ...base,
      maxItems: 2,
      makeId,
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      title: '"nite" → "night"',
      quote: 'stormy nite',
      replacement: 'stormy night',
      status: 'open',
      createdAt: 42,
      provider: 'claude',
      model: 'claude-haiku-4-5',
    })
  })

  it('drops items whose quote is not in the document', () => {
    const out = sanitizeItems([raw({ quote: 'stormy knight' })], { ...base, maxItems: 2, makeId })
    expect(out).toEqual([])
  })

  it('keeps passage-free suggestions and strips replacement without quote', () => {
    const out = sanitizeItems([raw({ kind: 'general', title: 'Idea', replacement: 'x' })], { ...base, maxItems: 2, makeId })
    expect(out[0].quote).toBeUndefined()
    expect(out[0].replacement).toBeUndefined()
  })

  it('removes no-op replacements', () => {
    const out = sanitizeItems([raw({ quote: 'dark', replacement: 'dark' })], { ...base, maxItems: 2, makeId })
    expect(out[0].replacement).toBeUndefined()
  })

  it('caps to maxItems and drops duplicates of existing suggestions', () => {
    const out = sanitizeItems(
      [raw({ title: 'Repeat me' }), raw({ title: 'New one' }), raw({ title: 'Another' }), raw({ title: 'Third' })],
      { ...base, existing: [{ title: 'repeat  ME' }], maxItems: 2, makeId },
    )
    expect(out.map((s) => s.title)).toEqual(['New one', 'Another'])
  })

  it('drops a second suggestion on the same quote', () => {
    const out = sanitizeItems([raw({ title: 'A', quote: 'dark' }), raw({ title: 'B', quote: 'dark' })], { ...base, maxItems: 2, makeId })
    expect(out.map((s) => s.title)).toEqual(['A'])
  })

  it('returns nothing when there is no room', () => {
    expect(sanitizeItems([raw({})], { ...base, maxItems: 0, makeId })).toEqual([])
  })
})

describe('sources (web-searched trivia)', () => {
  it('safeHttpUrl allows only absolute http(s) URLs', () => {
    expect(safeHttpUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeHttpUrl(' http://example.org ')).toBe('http://example.org/')
    for (const bad of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example/x',
      '/relative/path',
      'https://user:pass@example.com/',
      'not a url',
      '',
      42,
      null,
      `https://example.com/${'a'.repeat(3000)}`,
    ]) {
      expect(safeHttpUrl(bad)).toBeNull()
    }
  })

  it('sanitizeSources dedupes, caps count and title length, strips control characters, falls back to host', () => {
    const out = sanitizeSources([
      { url: 'https://a.example/1', title: 'First\u0000 ‮Title\n' },
      { url: 'https://a.example/1', title: 'Duplicate' },
      { url: 'javascript:alert(1)', title: 'Evil' },
      { url: 'https://b.example/2', title: '' },
      { url: 'https://c.example/3', title: 'x'.repeat(500) },
      { url: 'https://d.example/4', title: 'Over the cap' },
    ])
    expect(out.map((s) => s.url)).toEqual(['https://a.example/1', 'https://b.example/2', 'https://c.example/3'])
    expect(out[0].title).toBe('First Title')
    expect(out[1].title).toBe('b.example')
    expect(out[2].title.length).toBeLessThanOrEqual(120)
  })

  it('attaches sanitised sources, and drops a sourced item whose every source is unsafe', () => {
    const trivia = raw({ kind: 'trivia', title: 'Harbour bells', quote: null, replacement: null })
    const ok = sanitizeItems([{ ...trivia, sources: [{ url: 'https://news.example/x', title: '<b>News</b>' }] }], { ...base, maxItems: 1, makeId })
    expect(ok[0].sources).toEqual([{ url: 'https://news.example/x', title: '<b>News</b>' }])
    const bad = sanitizeItems([{ ...trivia, sources: [{ url: 'data:text/html,hi', title: 'x' }] }], { ...base, maxItems: 1, makeId })
    expect(bad).toEqual([])
    const plain = sanitizeItems([trivia], { ...base, maxItems: 1, makeId })
    expect(plain[0]).not.toHaveProperty('sources')
  })
})
