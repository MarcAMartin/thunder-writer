import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { currentSpacers, pageBreaksKey, PAGE_SPACER_CLASS, type PageSpacer } from './extensions'
import { createGapMap, sameBreaks, paginate, type BlockKind, type MeasuredBlock } from './pagination'

export interface PaginationInput {
  contentHeight: number
  pagePitch: number
  chapterStartsNewPage: boolean
  /** Fallback line pitch when computed style can't be read. */
  lineHeightPx: number
  /** CSS transform scale applied to the page stack (fit-to-width). Default 1. */
  scale?: number
}

/**
 * Measures the rendered manuscript, computes page breaks with the pure
 * `paginate`, and renders them as invisible spacer widgets so each page's text
 * lands on its own sheet. Returns the page count.
 *
 * Re-runs (debounced) on document changes, on resize (fonts, width, spacer
 * changes) and when the format changes. A no-op result dispatches nothing, so
 * the ResizeObserver feedback loop settles after one pass.
 */
export function usePagination(editor: Editor | null, input: PaginationInput): number {
  const [pageCount, setPageCount] = useState(1)
  const inputRef = useRef(input)
  const scheduleRef = useRef<(delay: number) => void>(() => {})

  useEffect(() => {
    inputRef.current = input
    scheduleRef.current(0)
  }, [input.contentHeight, input.pagePitch, input.chapterStartsNewPage, input.lineHeightPx, input.scale])

  useEffect(() => {
    if (!editor) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let frame: number | undefined
    let observed: HTMLElement | null = null
    let disposed = false
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule(40)) : null

    const run = () => {
      frame = undefined
      if (disposed || editor.isDestroyed) return
      const view = editor.view
      const root = view.dom as HTMLElement
      if (ro && observed !== root) {
        if (observed) ro.unobserve(observed)
        ro.observe(root)
        observed = root
      }
      if (view.composing) return schedule(250)
      const count = repaginate(view, inputRef.current)
      if (count !== null) setPageCount(count)
    }

    function schedule(delay: number) {
      if (disposed) return
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        if (frame === undefined) frame = requestAnimationFrame(run)
      }, delay)
    }
    scheduleRef.current = schedule

    const onUpdate = () => schedule(150)
    const onMount = () => schedule(0)
    editor.on('update', onUpdate)
    editor.on('mount', onMount)
    editor.on('create', onMount)
    document.fonts?.ready.then(() => schedule(0)).catch(() => {})
    const onFontsDone = () => schedule(0)
    document.fonts?.addEventListener?.('loadingdone', onFontsDone)
    schedule(0)

    return () => {
      disposed = true
      scheduleRef.current = () => {}
      if (timer !== undefined) clearTimeout(timer)
      if (frame !== undefined) cancelAnimationFrame(frame)
      ro?.disconnect()
      editor.off('update', onUpdate)
      editor.off('mount', onMount)
      editor.off('create', onMount)
      document.fonts?.removeEventListener?.('loadingdone', onFontsDone)
    }
  }, [editor])

  return pageCount
}

interface Measured extends MeasuredBlock {
  pos: number
  node: PMNode
  el: HTMLElement
}

function kindOf(node: PMNode): BlockKind {
  if (node.type.name === 'heading') return node.attrs.level === 1 ? 'chapter' : 'heading'
  if (node.isTextblock) return 'text'
  return 'atom'
}

/** One measurement + pagination pass. Returns null when layout isn't measurable (hidden, jsdom). */
export function repaginate(view: EditorView, input: PaginationInput): number | null {
  const root = view.dom as HTMLElement
  if (!root.isConnected || root.offsetHeight === 0) return null

  // Fractional client rects (offsetTop rounds to whole px, which makes the
  // measure/render loop flap). Divide by the fit-to-width scale to get layout px.
  const rootRect = root.getBoundingClientRect()
  const scale = input.scale && input.scale > 0 ? input.scale : 1
  const rel = (el: Element) => {
    const r = el.getBoundingClientRect()
    return { top: (r.top - rootRect.top) / scale, height: r.height / scale }
  }

  const gaps = Array.from(root.querySelectorAll<HTMLElement>(`.${PAGE_SPACER_CLASS}`)).map(rel)
  const map = createGapMap(gaps)

  const blocks: Measured[] = []
  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock && !(node.isBlock && node.isAtom)) return true
    const el = view.nodeDOM(pos)
    if (el instanceof HTMLElement) {
      const r = rel(el)
      const top = map.toNatural(r.top)
      const bottom = map.toNatural(r.top + r.height)
      const lh = parseFloat(getComputedStyle(el).lineHeight)
      blocks.push({
        pos,
        node,
        el,
        top,
        height: Math.max(0, bottom - top),
        lineHeight: Number.isFinite(lh) && lh > 0 ? lh : input.lineHeightPx,
        kind: kindOf(node),
      })
    }
    return false
  })

  const { breaks, pageCount } = paginate(blocks, {
    contentHeight: input.contentHeight,
    pagePitch: input.pagePitch,
    chapterStartsNewPage: input.chapterStartsNewPage,
  })

  const spacers: PageSpacer[] = []
  for (const br of breaks) {
    const b = blocks[br.blockIndex]
    let pos = b.pos
    let inline = false
    if (br.lineIndex > 0) {
      const y = map.toRendered(br.y + br.linePitch / 2)
      const elRect = b.el.getBoundingClientRect()
      const hit = view.posAtCoords({ left: elRect.left + 2, top: rootRect.top + y * scale })
      const start = b.pos + 1
      const end = b.pos + b.node.nodeSize - 1
      if (hit && hit.pos > start && hit.pos < end) {
        pos = hit.pos
        inline = true
      }
    }
    spacers.push({ pos, inline, height: br.spacer, pageNumber: br.pageNumber })
  }

  if (!sameBreaks(spacers, currentSpacers(view.state))) {
    view.dispatch(view.state.tr.setMeta(pageBreaksKey, spacers).setMeta('addToHistory', false))
  }
  return pageCount
}
