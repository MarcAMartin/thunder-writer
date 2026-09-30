import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/* ------------------------------------------------------------------------- */
/* Active suggestion highlight — a decoration, never a stored mark, so it     */
/* can't leak into the saved document or the undo history.                   */
/* ------------------------------------------------------------------------- */

type HighlightMeta = { type: 'set'; from: number; to: number } | { type: 'clear' }

export const suggestionHighlightKey = new PluginKey<DecorationSet>('tw-suggestion-highlight')

export const SUGGESTION_HIGHLIGHT_CLASS = 'ed-suggest-hl'

export const SuggestionHighlight = Extension.create({
  name: 'suggestionHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: suggestionHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(suggestionHighlightKey) as HighlightMeta | undefined
            if (meta?.type === 'clear') return DecorationSet.empty
            if (meta?.type === 'set') {
              const size = tr.doc.content.size
              const from = Math.max(0, Math.min(meta.from, size))
              const to = Math.max(from, Math.min(meta.to, size))
              if (from === to) return DecorationSet.empty
              return DecorationSet.create(tr.doc, [
                Decoration.inline(from, to, { class: SUGGESTION_HIGHLIGHT_CLASS, 'data-tw-suggestion': 'active' }),
              ])
            }
            return tr.docChanged ? set.map(tr.mapping, tr.doc) : set
          },
        },
        props: {
          decorations: (state) => suggestionHighlightKey.getState(state),
        },
      }),
    ]
  },
})

export function setSuggestionHighlight(tr: Transaction, from: number, to: number): Transaction {
  return tr.setMeta(suggestionHighlightKey, { type: 'set', from, to } satisfies HighlightMeta).setMeta('addToHistory', false)
}

export function clearSuggestionHighlight(tr: Transaction): Transaction {
  return tr.setMeta(suggestionHighlightKey, { type: 'clear' } satisfies HighlightMeta).setMeta('addToHistory', false)
}

export function getSuggestionHighlight(state: EditorState): { from: number; to: number } | null {
  const set = suggestionHighlightKey.getState(state)
  const first = set?.find()[0]
  return first ? { from: first.from, to: first.to } : null
}

/* ------------------------------------------------------------------------- */
/* Page-break spacers — invisible widgets that push the next line onto the    */
/* next sheet. Computed by the page view (see usePagination).                 */
/* ------------------------------------------------------------------------- */

export interface PageSpacer {
  pos: number
  /** Inline (inside a paragraph, before a line) vs between blocks. */
  inline: boolean
  height: number
  pageNumber: number
}

export const pageBreaksKey = new PluginKey<DecorationSet>('tw-page-breaks')
export const PAGE_SPACER_CLASS = 'ed-pb'

function spacerWidget(s: PageSpacer): Decoration {
  const key = `pb-${s.inline ? 'i' : 'b'}-${s.pageNumber}-${Math.round(s.height * 10)}`
  return Decoration.widget(
    s.pos,
    () => {
      const el = document.createElement(s.inline ? 'span' : 'div')
      el.className = `${PAGE_SPACER_CLASS}${s.inline ? ` ${PAGE_SPACER_CLASS}-inline` : ''}`
      el.style.height = `${s.height}px`
      el.contentEditable = 'false'
      el.setAttribute('aria-hidden', 'true')
      el.dataset.page = String(s.pageNumber)
      return el
    },
    { side: -1, key, ignoreSelection: true, spacer: s },
  )
}

export const PageBreaks = Extension.create({
  name: 'pageBreaks',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: pageBreaksKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(pageBreaksKey) as PageSpacer[] | undefined
            if (meta) {
              const size = tr.doc.content.size
              return DecorationSet.create(
                tr.doc,
                meta.filter((s) => s.pos >= 0 && s.pos <= size).map(spacerWidget),
              )
            }
            return tr.docChanged ? set.map(tr.mapping, tr.doc) : set
          },
        },
        props: {
          decorations: (state) => pageBreaksKey.getState(state),
        },
      }),
    ]
  },
})

export function currentSpacers(state: EditorState): PageSpacer[] {
  const set = pageBreaksKey.getState(state)
  if (!set) return []
  return set
    .find()
    .map((d) => {
      const spec = d.spec as { spacer?: PageSpacer }
      return spec.spacer ? { ...spec.spacer, pos: d.from } : null
    })
    .filter((s): s is PageSpacer => s !== null)
}
