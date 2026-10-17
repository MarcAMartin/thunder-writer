import { useEffect } from 'react'
import type { Editor } from '@tiptap/react'

/**
 * Where the writer was in each manuscript (the cursor), so a manuscript opens
 * where they left it: after switching apps on a phone (Safari may reload the
 * tab), a reload, or coming back from Settings. Kept in this browser only, as
 * a small map of the most recent manuscripts.
 */

const KEY = 'thunder-writer:places'
const MAX_PLACES = 50

type Places = Record<string, { pos: number; at: number }>

function readPlaces(): Places {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return v && typeof v === 'object' ? (v as Places) : {}
  } catch {
    return {}
  }
}

export function rememberPlace(docId: string, pos: number, now = Date.now()): void {
  try {
    const places = readPlaces()
    places[docId] = { pos, at: now }
    const kept = Object.entries(places)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_PLACES)
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    // Storage full or blocked: the place is a convenience, the words are saved elsewhere.
  }
}

export function placeOf(docId: string): number | null {
  const p = readPlaces()[docId]
  return p && Number.isInteger(p.pos) && p.pos >= 0 ? p.pos : null
}

/** How long pagination gets to lay out the pages before the view scrolls to the place. */
const RESTORE_AFTER_MS = 450

/**
 * Remembers the cursor as the writer moves it (and when they leave), and puts
 * it back when the manuscript opens, scrolling the pages so that line is in
 * view. The editor isn't focused, so a phone's keyboard doesn't pop up.
 */
export function useRememberPlace(editor: Editor | null, docId: string | null): void {
  useEffect(() => {
    if (!editor || !docId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const save = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      if (!editor.isDestroyed) rememberPlace(docId, editor.state.selection.head)
    }
    const onSelection = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(save, 600)
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') save()
    }

    const pos = placeOf(docId)
    const restore = setTimeout(() => {
      if (pos === null || editor.isDestroyed) return
      const max = editor.state.doc.content.size
      if (pos <= 1 || pos > max) return
      try {
        editor.commands.setTextSelection(Math.min(pos, max))
        const caret = editor.view.coordsAtPos(editor.state.selection.head)
        const scroll = (editor.view.dom as HTMLElement).closest<HTMLElement>('.ed-scroll')
        if (scroll) {
          const frame = scroll.getBoundingClientRect()
          scroll.scrollTop += caret.top - frame.top - frame.height / 3
        }
      } catch {
        // A position the content no longer has: start at the top.
      }
    }, RESTORE_AFTER_MS)

    editor.on('selectionUpdate', onSelection)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', save)
    return () => {
      clearTimeout(restore)
      if (timer !== undefined) save()
      editor.off('selectionUpdate', onSelection)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', save)
    }
  }, [editor, docId])
}
