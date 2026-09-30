import type { Editor } from '@tiptap/core'
import type { EditorBridge } from '../../contracts'
import { clearSuggestionHighlight, setSuggestionHighlight, SUGGESTION_HIGHLIGHT_CLASS } from './extensions'
import { findQuote, matchQuoteStyle, plainTextOf, textBetween } from './textIndex'

const alive = (editor: Editor) => !editor.isDestroyed

/**
 * EditorBridge implementation over a TipTap editor. Every method is safe to
 * call after the editor is destroyed (it just reports "not found").
 */
export function createEditorBridge(editor: Editor): EditorBridge {
  const find = (quote: string) => (alive(editor) && quote.trim() ? findQuote(editor.state.doc, quote) : null)

  return {
    getPlainText() {
      return alive(editor) ? plainTextOf(editor.state.doc) : ''
    },

    getTextNearCursor(maxChars) {
      if (!alive(editor) || maxChars <= 0) return ''
      const { doc, selection } = editor.state
      const head = selection.from
      const beforeBudget = Math.ceil(maxChars * 0.8)
      const afterBudget = Math.max(0, maxChars - beforeBudget)
      // Walk out from the cursor in growing windows; textBetween is O(range).
      const before = tail(textBetween(doc, Math.max(0, head - beforeBudget * 2), head), beforeBudget)
      const after = textBetween(doc, head, Math.min(doc.content.size, selection.to + afterBudget * 2)).slice(0, afterBudget)
      return trimToWords(before, 'start') + trimToWords(after, 'end')
    },

    hasQuote(quote) {
      return find(quote) !== null
    },

    highlightQuote(quote) {
      const range = find(quote)
      if (!range) return false
      editor.view.dispatch(setSuggestionHighlight(editor.state.tr, range.from, range.to))
      scrollHighlightIntoView(editor, range.from)
      return true
    },

    clearHighlight() {
      if (!alive(editor)) return
      editor.view.dispatch(clearSuggestionHighlight(editor.state.tr))
    },

    replaceQuote(quote, replacement) {
      const range = find(quote)
      if (!range) return false
      const { state } = editor
      const original = state.doc.textBetween(range.from, range.to, ' ', ' ')
      const text = matchQuoteStyle(original, replacement.replace(/\s*\n+\s*/g, ' '))
      const tr = state.tr
      if (text) tr.insertText(text, range.from, range.to)
      else tr.delete(range.from, range.to)
      clearSuggestionHighlight(tr).setMeta('addToHistory', true)
      tr.scrollIntoView()
      editor.view.dispatch(tr)
      return true
    },
  }
}

function tail(s: string, n: number) {
  return s.length > n ? s.slice(s.length - n) : s
}

/** Avoid handing the model half-words at the edges of the window. */
function trimToWords(s: string, edge: 'start' | 'end') {
  if (edge === 'start') {
    const i = s.search(/\s/)
    return i > 0 && i < 24 && s.length > 48 ? s.slice(i + 1) : s
  }
  const m = /\s\S*$/.exec(s)
  return m && s.length - m.index < 24 && s.length > 48 ? s.slice(0, m.index) : s
}

function scrollHighlightIntoView(editor: Editor, pos: number) {
  const run = () => {
    if (!alive(editor)) return
    const root = editor.view.dom as HTMLElement
    let target: Element | null = root.querySelector(`.${SUGGESTION_HIGHLIGHT_CLASS}`)
    if (!target) {
      try {
        const at = editor.view.domAtPos(pos)
        target = at.node instanceof Element ? at.node : at.node.parentElement
      } catch {
        target = null
      }
    }
    if (target && typeof target.scrollIntoView === 'function') {
      const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      // Glide to nearby passages; jump to far ones (smooth-scrolling 40 pages is just slow).
      const far = Math.abs(target.getBoundingClientRect().top - window.innerHeight / 2) > window.innerHeight * 2.5
      target.scrollIntoView({ block: 'center', behavior: reduce || far ? 'auto' : 'smooth' })
    }
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else run()
}
