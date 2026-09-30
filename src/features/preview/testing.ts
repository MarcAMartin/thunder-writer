/**
 * Test helpers: synthetic line boxes and a layout-free measurer (jsdom has no
 * layout engine). Not imported by production code.
 */
import type { BlockMeasurer, MeasurerFactory } from './measure'
import type { BookBlockKind, LineBox, MeasuredBookBlock } from './paginateBook'

export const LINE = 20

/** A block of `lines` uniform lines (plus optional padding) — `leaves` splits it into paragraphs. */
export function synth(
  kind: BookBlockKind,
  lines: number,
  opts: { pad?: number; padBottom?: number; leaves?: number[]; title?: string; line?: number } = {},
): MeasuredBookBlock {
  const L = opts.line ?? LINE
  const pad = opts.pad ?? 0
  const padBottom = opts.padBottom ?? 0
  const leaves = opts.leaves ?? [lines]
  const boxes: LineBox[] = []
  let y = pad
  leaves.forEach((n, leaf) => {
    for (let i = 0; i < n; i++) {
      boxes.push({ top: y, bottom: y + L, leaf })
      y += L
    }
  })
  const height = y + padBottom
  const b: MeasuredBookBlock = { kind, height, lines: () => boxes }
  if (opts.title) b.title = opts.title
  if (kind === 'chapter' || kind === 'heading') b.padTop = pad
  return b
}

export const text = (lines: number) => synth('text', lines)
export const chapter = (title: string, height = 3 * LINE) => ({ ...synth('chapter', 1, { pad: height - LINE }), title, padTop: height - LINE })
export const heading = () => synth('heading', 1, { pad: LINE })
export const sceneBreak = () => synth('break', 2)

/**
 * Measures by character count: ~`charsPerLine` characters per line at LINE px.
 * Chapter headings are 3 lines tall, headings 2, scene breaks 2.
 */
export function fakeMeasurer(charsPerLine = 60, calls?: { chunks: number[] }): MeasurerFactory {
  return (): BlockMeasurer => ({
    measure(blocks, start, end) {
      calls?.chunks.push(end - start)
      const out: MeasuredBookBlock[] = []
      for (let i = start; i < end; i++) {
        const b = blocks[i]
        if (b.kind === 'chapter') out.push({ ...chapter(b.title ?? '') })
        else if (b.kind === 'heading') out.push(heading())
        else if (b.kind === 'break') out.push(sceneBreak())
        else {
          const leaves: number[] = []
          b.node.descendants((n) => {
            if (n.isTextblock) {
              leaves.push(Math.max(1, Math.ceil(n.textContent.length / charsPerLine)))
              return false
            }
            return true
          })
          if (b.node.isTextblock) leaves.push(Math.max(1, Math.ceil(b.node.textContent.length / charsPerLine)))
          const total = leaves.reduce((a, n) => a + n, 0)
          out.push(synth(b.kind, total, { leaves }))
        }
      }
      return out
    },
    dispose() {},
  })
}

/** A TipTap JSON manuscript: `chapters` chapters of `paras` paragraphs of `lines` lines (at 60 chars/line). */
export function manuscript(chapters: number, paras: number, lines = 5, opts: { sceneBreakAt?: number } = {}) {
  const para = (c: number, p: number) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: `C${c}P${p} `.padEnd(60 * lines - 1, 'x') }],
  })
  const content: unknown[] = []
  for (let c = 1; c <= chapters; c++) {
    content.push({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: `Chapter ${c}` }] })
    for (let p = 0; p < paras; p++) {
      if (opts.sceneBreakAt !== undefined && p === opts.sceneBreakAt) content.push({ type: 'horizontalRule' })
      content.push(para(c, p))
    }
  }
  return { type: 'doc', content }
}
