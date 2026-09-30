import { describe, expect, it } from 'vitest'
import { finishTrivia, hedgeDetail, parseTriviaReply, triviaSources } from './trivia'

const ITEM = {
  kind: 'trivia',
  title: 'Nantucket whale count hits a record',
  detail: 'Possibly relevant: surveyors counted a record number of right whales this spring.',
  quote: null,
  replacement: null,
  source_urls: ['https://news.example/whales'],
}

describe('parseTriviaReply', () => {
  it('reads a bare JSON object and forces kind trivia with no edit', () => {
    const r = parseTriviaReply(JSON.stringify({ ...ITEM, kind: 'general', replacement: 'x' }))
    expect(r).toMatchObject({ kind: 'item', item: { kind: 'trivia', replacement: null, title: ITEM.title }, sourceUrls: ITEM.source_urls })
  })

  it('finds the JSON inside prose or code fences', () => {
    expect(parseTriviaReply(`I'll search for that. Here it is:\n${JSON.stringify(ITEM)}\nHope it helps.`).kind).toBe('item')
    expect(parseTriviaReply('```json\n' + JSON.stringify(ITEM) + '\n```').kind).toBe('item')
    // Braces inside strings do not confuse the scanner.
    const tricky = { ...ITEM, detail: 'Possibly relevant: a {curly} detail } here.' }
    expect(parseTriviaReply(`Note {not json}. ${JSON.stringify(tricky)}`)).toMatchObject({ kind: 'item', item: { detail: tricky.detail } })
  })

  it('always frames the detail as "Possibly relevant", even when the model leaves it out', () => {
    const bare = parseTriviaReply(JSON.stringify({ ...ITEM, detail: 'The river was declared a national monument last week.' }))
    expect(bare).toMatchObject({
      kind: 'item',
      item: { detail: 'Possibly relevant: The river was declared a national monument last week.' },
    })
    // Already hedged (any case, any punctuation after it): left alone, never doubled.
    expect(hedgeDetail(ITEM.detail)).toBe(ITEM.detail)
    expect(hedgeDetail('  possibly relevant — a record count.')).toBe('possibly relevant — a record count.')
    expect(hedgeDetail('')).toBe('Possibly relevant:')
    // "Possibly relevantly" is not the hedge.
    expect(hedgeDetail('Possibly relevantly odd.')).toBe('Possibly relevant: Possibly relevantly odd.')
  })

  it('recognises NONE in its common shapes', () => {
    for (const t of ['NONE', ' none. ', '"NONE"', '**NONE**', 'I searched but found nothing relevant.\nNONE', '{"none": true}', ''])
      expect(parseTriviaReply(t).kind).toBe('none')
  })

  it('reports unreadable output', () => {
    expect(parseTriviaReply('Here is some trivia about whales.').kind).toBe('unreadable')
    expect(parseTriviaReply('{"title": 42}').kind).toBe('unreadable')
  })
})

describe('triviaSources / finishTrivia', () => {
  const ev = {
    citations: [{ url: 'https://news.example/whales', title: 'Record whale count' }],
    results: [
      { url: 'https://news.example/whales', title: 'Record whale count' },
      { url: 'https://science.example/right-whales', title: 'Right whales rebound' },
    ],
  }

  it('uses citations, plus model-listed URLs only when the search really returned them', () => {
    const s = triviaSources(['https://science.example/right-whales', 'https://made-up.example/fake'], ev)
    expect(s.map((x) => x.url)).toEqual(['https://news.example/whales', 'https://science.example/right-whales'])
    expect(s[1].title).toBe('Right whales rebound')
  })

  it('an item nothing backs up is dropped', () => {
    const noEvidence = finishTrivia(JSON.stringify({ ...ITEM, source_urls: ['https://made-up.example/'] }), { citations: [], results: [] })
    expect(noEvidence).toEqual({ item: null, outcome: 'no_sources' })
    const ok = finishTrivia(JSON.stringify(ITEM), ev)
    expect(ok.outcome).toBe('ok')
    expect(ok.item?.sources?.[0]).toEqual({ url: 'https://news.example/whales', title: 'Record whale count' })
    expect(finishTrivia('NONE', ev)).toEqual({ item: null, outcome: 'none' })
  })
})
