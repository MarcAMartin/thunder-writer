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
    // A web font arriving changes line breaks without changing the computed font: forget cached line starts.
    const onFontsDone = () => {
      resetLineStartCache()
      schedule(0)
    }
    document.fonts?.ready.then(onFontsDone).catch(() => {})
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

/**
 * The rendered element of each top-level node, in document order, without
 * `view.nodeDOM` (which walks the doc from the start on every call, making a
 * full pass quadratic in the number of paragraphs). Page-break spacer widgets
 * are skipped; each element is checked against ProseMirror's own view
 * descriptor and `null` means "look it up with nodeDOM".
 */
function topLevelElements(view: EditorView): (HTMLElement | null)[] {
  const out: (HTMLElement | null)[] = []
  let el = (view.dom as HTMLElement).firstElementChild as HTMLElement | null
  view.state.doc.forEach((node) => {
    while (el && el.classList.contains(PAGE_SPACER_CLASS)) el = el.nextElementSibling as HTMLElement | null
    const desc = el ? (el as HTMLElement & { pmViewDesc?: { node?: PMNode | null } }).pmViewDesc : undefined
    if (el && desc?.node === node) {
      out.push(el)
      el = el.nextElementSibling as HTMLElement | null
    } else {
      out.push(null)
    }
  })
  return out
}

/**
 * Where line n of a paragraph starts, as an offset inside the paragraph.
 * Finding it takes a posAtCoords hit test, the costliest step of a pass (a
 * novel has hundreds of mid-paragraph page breaks). ProseMirror nodes are
 * immutable and unchanged paragraphs keep their node object across edits, so
 * the answer is cached per node, keyed by what else shapes its lines (column
 * width, first-line indent, font). An edit re-tests only the paragraph it
 * changed.
 */
let lineStartCache: { font: string; byNode: WeakMap<PMNode, Map<string, number>> } = {
  font: '',
  byNode: new WeakMap(),
}

export function resetLineStartCache() {
  lineStartCache = { font: '', byNode: new WeakMap() }
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

  const rootStyle = getComputedStyle(root)
  const font = `${rootStyle.font}|${rootStyle.lineHeight}|${rootStyle.letterSpacing}`
  if (lineStartCache.font !== font) lineStartCache = { font, byNode: new WeakMap() }
  const { byNode } = lineStartCache

  // Line height depends only on the kind of block (paragraph, heading level…); read it once per kind.
  const lineHeights = new Map<string, number>()
  const lineHeightOf = (node: PMNode, el: HTMLElement) => {
    const key = `${node.type.name}:${String(node.attrs.level ?? '')}:${el.parentElement === root ? 0 : 1}`
    let lh = lineHeights.get(key)
    if (lh === undefined) {
      const v = parseFloat(getComputedStyle(el).lineHeight)
      lh = Number.isFinite(v) && v > 0 ? v : input.lineHeightPx
      lineHeights.set(key, lh)
    }
    return lh
  }

  const blocks: Measured[] = []
  const measure = (node: PMNode, pos: number, el: HTMLElement) => {
    const r = rel(el)
    const top = map.toNatural(r.top)
    const bottom = map.toNatural(r.top + r.height)
    blocks.push({
      pos,
      node,
      el,
      top,
      height: Math.max(0, bottom - top),
      lineHeight: lineHeightOf(node, el),
      kind: kindOf(node),
    })
  }
  const visitNested = (node: PMNode, pos: number) => {
    node.descendants((child, rel) => {
      if (!child.isTextblock && !(child.isBlock && child.isAtom)) return true
      const p = pos + 1 + rel
      const el = view.nodeDOM(p)
      if (el instanceof HTMLElement) measure(child, p, el)
      return false
    })
  }
  const elements = topLevelElements(view)
  view.state.doc.forEach((node, pos, index) => {
    const leaf = node.isTextblock || (node.isBlock && node.isAtom)
    if (!leaf) {
      visitNested(node, pos)
      return
    }
    const known = elements[index]
    const el = known ?? view.nodeDOM(pos)
    if (el instanceof HTMLElement) measure(node, pos, el)
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
      const key = `${br.lineIndex}:${b.el.clientWidth}:${getComputedStyle(b.el).textIndent}`
      let lines = byNode.get(b.node)
      let offset = lines?.get(key)
      if (offset === undefined) {
        offset = -1
        const y = map.toRendered(br.y + br.linePitch / 2)
        const elRect = b.el.getBoundingClientRect()
        const hit = view.posAtCoords({ left: elRect.left + 2, top: rootRect.top + y * scale })
        const start = b.pos + 1
        const end = b.pos + b.node.nodeSize - 1
        if (hit && hit.pos > start && hit.pos < end) offset = hit.pos - b.pos
        if (!lines) byNode.set(b.node, (lines = new Map()))
        lines.set(key, offset)
      }
      if (offset > 0) {
        pos = b.pos + offset
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
