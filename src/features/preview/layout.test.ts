import { afterEach, describe, expect, it } from 'vitest'
import { resolveFormat } from '../editor/presets'
import { DEFAULT_BOOK_LAYOUT, type BookLayoutOptions } from './headerFooter'
import { bookGeometry, clearLayoutCache, runBookLayout, sideMargins, type BookLayout, type LayoutEnv } from './layout'
import { fakeMeasurer, manuscript } from './testing'

const format = resolveFormat({ presetId: 'trade-6x9', chapterStartsNewPage: true })

/** Runs the scheduler synchronously, with a virtual clock advancing 1 ms per call. */
function syncEnv(extra: Partial<LayoutEnv> = {}) {
  const queue: (() => void)[] = []
  let t = 0
  const env: Partial<LayoutEnv> = {
    createMeasurer: fakeMeasurer(),
    schedule: (fn) => {
      queue.push(fn)
      return () => {
        const i = queue.indexOf(fn)
        if (i >= 0) queue.splice(i, 1)
      }
    },
    now: () => t++,
    sliceMs: () => 5,
    chunkSize: 4,
    ...extra,
  }
  const drain = () => {
    while (queue.length) queue.shift()!()
  }
  return { env, drain, queue }
}

const request = (content: unknown, options: Partial<BookLayoutOptions> = {}, docKey = 'doc@1') => ({
  docKey,
  content,
  format,
  options: { ...DEFAULT_BOOK_LAYOUT, ...options },
  firstPageNumber: 1,
})

afterEach(() => clearLayoutCache())

describe('bookGeometry', () => {
  it('uses the trim size at 96 px/in and mirrors margins', () => {
    const g = bookGeometry(format)
    expect(g.pageWidth).toBe(576)
    expect(g.pageHeight).toBe(864)
    expect(sideMargins(g, 'recto')).toEqual({ left: g.inside, right: g.outside })
    expect(sideMargins(g, 'verso')).toEqual({ left: g.outside, right: g.inside })
    expect(g.inside).toBeGreaterThan(g.outside) // 6×9 preset: 0.85 in gutter, 0.65 in outside
  })
})

describe('runBookLayout', () => {
  it('publishes the first spread before the rest, then completes', () => {
    const { env, drain } = syncEnv()
    const updates: BookLayout[] = []
    runBookLayout(request(manuscript(6, 20)), (l) => updates.push(l), env)
    // The first slice runs synchronously and stops as soon as 3 pages exist.
    expect(updates).toHaveLength(1)
    expect(updates[0].done).toBe(false)
    expect(updates[0].pages.length).toBeGreaterThanOrEqual(3)
    expect(updates[0].timings.firstSpreadMs).not.toBeNull()
    drain()
    const last = updates[updates.length - 1]
    expect(last.done).toBe(true)
    expect(last.progress).toBe(1)
    expect(updates.length).toBeGreaterThan(2)
    // Pages only accumulate.
    for (let i = 1; i < updates.length; i++) expect(updates[i].pages.length).toBeGreaterThanOrEqual(updates[i - 1].pages.length)
    expect(last.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Chapter 5', 'Chapter 6'])
  })

  it('opens every chapter on a right-hand page, with blank versos where needed', () => {
    const { env, drain } = syncEnv()
    let final: BookLayout | null = null
    runBookLayout(request(manuscript(5, 7)), (l) => (final = l), env)
    drain()
    const l = final!
    for (const c of l.chapters) {
      expect(c.page % 2).toBe(0) // index 0, 2, 4… = folios 1, 3, 5…
      expect(l.pages[c.page].isChapterOpener).toBe(true)
    }
    const blanks = l.pages.filter((p) => p.isBlank)
    for (const b of blanks) expect(b.index % 2).toBe(1)
    expect(blanks.every((b) => b.fragments.length === 0)).toBe(true)
  })

  it('without recto starts there are no blank pages', () => {
    const { env, drain } = syncEnv()
    let final: BookLayout | null = null
    runBookLayout(request(manuscript(5, 7), { chaptersStartRecto: false }), (l) => (final = l), env)
    drain()
    expect(final!.pages.some((p) => p.isBlank)).toBe(false)
  })

  it('serves a finished layout from cache', () => {
    const a = syncEnv()
    let first: BookLayout | null = null
    runBookLayout(request(manuscript(2, 5)), (l) => (first = l), a.env)
    a.drain()
    const calls = { chunks: [] as number[] }
    const b = syncEnv({ createMeasurer: fakeMeasurer(60, calls) })
    let second: BookLayout | null = null
    runBookLayout(request(manuscript(2, 5)), (l) => (second = l), b.env)
    expect(second).toBe(first)
    expect(calls.chunks).toEqual([])
    // A new updatedAt is a new layout.
    runBookLayout(request(manuscript(2, 5), {}, 'doc@2'), () => {}, b.env)
    expect(calls.chunks.length).toBeGreaterThan(0)
  })

  it('measures in chunks and can be cancelled', () => {
    const calls = { chunks: [] as number[] }
    const { env, queue } = syncEnv({ createMeasurer: fakeMeasurer(60, calls) })
    const updates: BookLayout[] = []
    const cancel = runBookLayout(request(manuscript(10, 20)), (l) => updates.push(l), env)
    expect(calls.chunks.every((n) => n <= 4)).toBe(true)
    cancel()
    expect(queue).toHaveLength(0)
    expect(updates.every((u) => !u.done)).toBe(true)
  })

  it('lays out an empty or unreadable document as one page', () => {
    for (const content of [null, { type: 'doc', content: [] }, { type: 'nonsense' }, 'garbage']) {
      const { env, drain } = syncEnv()
      let final: BookLayout | null = null
      runBookLayout(request(content, {}, `k${JSON.stringify(content)}`), (l) => (final = l), env)
      drain()
      expect(final!.done).toBe(true)
      expect(final!.pages).toHaveLength(1)
    }
  })

  it('handles a novel-sized manuscript', () => {
    const { env, drain } = syncEnv({ chunkSize: 48, sliceMs: () => 30 })
    let final: BookLayout | null = null
    // 40 chapters × 60 paragraphs × 5 lines ≈ 12k lines.
    runBookLayout(request(manuscript(40, 60, 5)), (l) => (final = l), env)
    drain()
    expect(final!.done).toBe(true)
    expect(final!.chapters).toHaveLength(40)
    expect(final!.pages.length).toBeGreaterThan(300)
  })
})
