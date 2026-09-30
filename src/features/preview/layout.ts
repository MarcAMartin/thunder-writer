import { pageGeometry, type ResolvedFormat } from '../editor/presets'
import { sideOfFolio, type BookLayoutOptions } from './headerFooter'
import { createDomMeasurer, type MeasurerFactory } from './measure'
import { BookPaginator, type BookPageModel, type ChapterEntry } from './paginateBook'
import { buildRenderModel, type RenderModel } from './renderModel'

/**
 * Book layout engine: stored TipTap JSON → typeset pages, computed
 * incrementally so the first spread shows quickly and a 400-page novel never
 * blocks the main thread for long.
 *
 * 1. buildRenderModel: parse + validate against the editor schema (one pass).
 * 2. Chunks of blocks are serialized into the offscreen measurer and
 *    measured, and each chunk is fed to the streaming BookPaginator.
 * 3. Work runs in short slices (setTimeout 0; shorter while a page turn is
 *    animating). Each slice publishes the completed pages so far.
 *
 * Page furniture (running heads, folios) is drawn at render time from
 * HeaderFooterSettings and does not affect where pages break, so editing it
 * never triggers a re-layout. The layout depends on the content, the format,
 * BookLayoutOptions and whether the first page is a recto.
 */

/** Page geometry for a two-sided book. Preset left/right margins are inside (gutter) / outside. */
export interface BookGeometry {
  pageWidth: number
  pageHeight: number
  contentWidth: number
  contentHeight: number
  /** Gutter margin (next to the spine). */
  inside: number
  outside: number
  top: number
  bottom: number
  fontSizePx: number
  lineHeightPx: number
}

export function bookGeometry(format: ResolvedFormat): BookGeometry {
  const g = pageGeometry(format)
  return {
    pageWidth: g.pageWidth,
    pageHeight: g.pageHeight,
    contentWidth: g.contentWidth,
    contentHeight: g.contentHeight,
    inside: g.margin.left,
    outside: g.margin.right,
    top: g.margin.top,
    bottom: g.margin.bottom,
    fontSizePx: g.fontSizePx,
    lineHeightPx: g.lineHeightPx,
  }
}

/** Left/right margins of a page: mirrored so the gutter is always next to the spine. */
export function sideMargins(geo: BookGeometry, side: 'recto' | 'verso'): { left: number; right: number } {
  return side === 'recto' ? { left: geo.inside, right: geo.outside } : { left: geo.outside, right: geo.inside }
}

export interface BookLayout {
  key: string
  model: RenderModel
  format: ResolvedFormat
  options: BookLayoutOptions
  geometry: BookGeometry
  /** Completed pages so far (all of them once `done`). */
  pages: BookPageModel[]
  chapters: ChapterEntry[]
  /** Page index 0 is a right-hand page (odd first page number). */
  firstIsRecto: boolean
  done: boolean
  /** Fraction of blocks laid out, 0..1. */
  progress: number
  timings: { modelMs: number; firstSpreadMs: number | null; totalMs: number | null }
}

export interface LayoutRequest {
  /** Cache identity: doc id + updatedAt. */
  docKey: string
  content: unknown
  format: ResolvedFormat
  options: BookLayoutOptions
  firstPageNumber: number
}

export interface LayoutEnv {
  createMeasurer: MeasurerFactory
  /** Runs `fn` later; returns a cancel function. */
  schedule: (fn: () => void) => () => void
  now: () => number
  /** Time budget for one slice of work, in ms. */
  sliceMs: () => number
  /** Blocks per measurement chunk. */
  chunkSize: number
}

let animating = false
/** The viewer flags page-turn animations so layout work yields more often. */
export function setLayoutAnimating(v: boolean) {
  animating = v
}

export const defaultLayoutEnv: LayoutEnv = {
  createMeasurer: createDomMeasurer,
  schedule: (fn) => {
    const t = setTimeout(fn, 0)
    return () => clearTimeout(t)
  },
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  sliceMs: () => (animating ? 6 : 28),
  chunkSize: 48,
}

export function layoutKey(req: Pick<LayoutRequest, 'docKey' | 'format' | 'options' | 'firstPageNumber'>): string {
  const f = req.format
  return JSON.stringify([
    req.docKey,
    f.widthIn,
    f.heightIn,
    f.marginIn,
    f.fontFamily,
    f.fontSizePt,
    f.lineHeight,
    f.chapterStartsNewPage,
    req.options,
    sideOfFolio(req.firstPageNumber),
  ])
}

const CACHE_MAX = 4
const cache = new Map<string, BookLayout>()

export function cachedLayout(key: string): BookLayout | undefined {
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}

function remember(l: BookLayout) {
  cache.set(l.key, l)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
}

export function clearLayoutCache() {
  cache.clear()
}

/** Pages needed before the first spread can be shown (page 1, plus the next spread for the first turn). */
const FIRST_SPREAD_PAGES = 3

/**
 * Starts (or serves from cache) a layout. `onUpdate` receives a fresh object
 * after each slice; the last one has `done: true`. Returns a cancel function.
 */
export function runBookLayout(req: LayoutRequest, onUpdate: (l: BookLayout) => void, envIn: Partial<LayoutEnv> = {}): () => void {
  const env: LayoutEnv = { ...defaultLayoutEnv, ...envIn }
  const key = layoutKey(req)
  const hit = cachedLayout(key)
  if (hit) {
    onUpdate(hit)
    return () => {}
  }

  let cancelled = false
  let cancelTimer: (() => void) | null = null
  const t0 = env.now()
  const model = buildRenderModel(req.content)
  const modelMs = env.now() - t0
  const geometry = bookGeometry(req.format)
  const firstIsRecto = sideOfFolio(req.firstPageNumber) === 'recto'
  const measurer = env.createMeasurer({
    schema: model.schema,
    contentWidth: geometry.contentWidth,
    fontFamily: req.format.fontFamily,
    fontSizePx: geometry.fontSizePx,
    lineHeight: req.format.lineHeight,
    justify: req.options.justify,
  })
  const paginator = new BookPaginator({
    contentHeight: geometry.contentHeight,
    chapterStartsNewPage: req.format.chapterStartsNewPage,
    chaptersStartRecto: req.options.chaptersStartRecto,
    isRecto: (i) => (i % 2 === 0) === firstIsRecto,
    chapterSink: req.options.chapterSink,
  })
  const blocks = model.blocks
  const n = blocks.length
  let next = 0
  let firstSpreadMs: number | null = null

  const snapshot = (done: boolean): BookLayout => ({
    key,
    model,
    format: req.format,
    options: req.options,
    geometry,
    pages: done ? paginator.pages : paginator.pages.slice(),
    chapters: paginator.chapters.filter((c) => c.page < paginator.pages.length || done).map((c) => ({ ...c })),
    firstIsRecto,
    done,
    progress: n === 0 ? 1 : next / n,
    timings: { modelMs, firstSpreadMs, totalMs: done ? env.now() - t0 : null },
  })

  const slice = () => {
    cancelTimer = null
    if (cancelled) return
    const start = env.now()
    const budget = env.sliceMs()
    const needFirst = firstSpreadMs === null
    while (next < n) {
      const end = Math.min(n, next + env.chunkSize)
      const measured = measurer.measure(blocks, next, end)
      for (const m of measured) paginator.push(m)
      next = end
      const enoughForFirst = paginator.pages.length >= FIRST_SPREAD_PAGES
      if (needFirst ? enoughForFirst : env.now() - start >= budget) break
    }
    if (next >= n) {
      paginator.finish()
      measurer.dispose()
      if (firstSpreadMs === null) firstSpreadMs = env.now() - t0
      const final = snapshot(true)
      remember(final)
      onUpdate(final)
      return
    }
    if (firstSpreadMs === null && paginator.pages.length >= FIRST_SPREAD_PAGES) firstSpreadMs = env.now() - t0
    onUpdate(snapshot(false))
    cancelTimer = env.schedule(slice)
  }

  slice()
  return () => {
    cancelled = true
    cancelTimer?.()
    if (next < n) measurer.dispose()
  }
}
