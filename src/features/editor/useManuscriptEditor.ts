import { useEffect, useMemo, useState } from 'react'
import { useEditor, type Editor, type JSONContent } from '@tiptap/react'
import { useDocuments } from '../../store/documents'
import { registerPendingFlush } from '../../store/pendingEdits'
import { checkContent, editorSchema } from './contentCheck'
import { createExtensions } from './editorExtensions'

const SAVE_DEBOUNCE_MS = 400

/** Stored content is `unknown` (it may come from Drive); only hand TipTap a doc node. */
export function toEditorContent(content: unknown): JSONContent | null {
  if (content && typeof content === 'object' && (content as { type?: unknown }).type === 'doc') {
    return content as JSONContent
  }
  return null
}

export interface ManuscriptEditor {
  editor: Editor | null
  /**
   * Set when the stored content can't be loaded faithfully (see contentCheck).
   * The editor is then read-only and empty, and never writes back, so the
   * stored manuscript is left untouched.
   */
  contentError: string | null
}

/**
 * Creates one TipTap editor per open document (recreated when the current doc
 * changes, so undo history never crosses documents) and keeps it in sync with
 * the documents store:
 *  - edits are debounced into `updateContent` (flushed on doc switch, unmount,
 *    tab hide, page hide, and whenever storage asks via flushPendingEdits);
 *  - content replaced from outside (e.g. a Drive load into the same doc) is
 *    pushed into the editor without emitting an update, so it isn't re-dirtied;
 *  - content the schema can't represent is never loaded (TipTap would show an
 *    empty doc and the next keystroke would overwrite the manuscript).
 */
export function useManuscriptEditor(currentId: string | null): ManuscriptEditor {
  const extensions = useMemo(() => createExtensions(), [])

  // Checked once per opened doc; later outside replacements are checked in the sync effect.
  const initial = useMemo(() => {
    const raw = currentId ? useDocuments.getState().docs[currentId]?.content : null
    const check = checkContent(raw, editorSchema())
    return check.ok ? { content: toEditorContent(raw), error: null } : { content: null, error: check.reason }
  }, [currentId])
  // Outcome of the latest outside replacement, tied to the load it happened after.
  const [replaced, setReplaced] = useState<{ load: object; error: string | null } | null>(null)
  const contentError = replaced && replaced.load === initial ? replaced.error : initial.error

  const editor = useEditor(
    {
      extensions,
      content: initial.content,
      editable: Boolean(currentId) && initial.error === null,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: 'ed-prose',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': 'Manuscript',
          spellcheck: 'true',
          autocorrect: 'on',
          autocapitalize: 'sentences',
        },
      },
    },
    [currentId],
  )

  useEffect(() => {
    if (!editor || !currentId) return
    let lastContent: unknown = useDocuments.getState().docs[currentId]?.content
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending = false
    // While the stored content is unreadable, never write the (empty) editor back over it.
    let blocked = initial.error !== null

    const flush = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      if (!pending) return
      pending = false
      if (blocked || editor.isDestroyed) return
      const json = editor.getJSON()
      lastContent = json
      useDocuments.getState().updateContent(currentId, json)
    }
    const onUpdate = () => {
      if (blocked) return
      pending = true
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS)
    }

    const unsubscribe = useDocuments.subscribe((s) => {
      const doc = s.docs[currentId]
      if (!doc || doc.content === lastContent) return
      // Replaced from outside (storage/Drive/another tab). Drop pending local writes and show it.
      lastContent = doc.content
      if (editor.isDestroyed) return
      const check = checkContent(doc.content, editorSchema())
      if (!check.ok) {
        blocked = true
        pending = false
        if (timer !== undefined) clearTimeout(timer)
        editor.setEditable(false, false)
        setReplaced({ load: initial, error: check.reason })
        return
      }
      if (blocked) {
        blocked = false
        editor.setEditable(true, false)
        setReplaced({ load: initial, error: null })
      }
      const next = toEditorContent(doc.content)
      // Same content under a new reference (e.g. storage re-hydrated): keep the caret where it is.
      if (next && JSON.stringify(next) === JSON.stringify(editor.getJSON())) return
      pending = false
      if (timer !== undefined) clearTimeout(timer)
      editor.commands.setContent(next ?? '', { emitUpdate: false })
    })

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    const unregister = registerPendingFlush(flush)
    editor.on('update', onUpdate)
    editor.on('destroy', flush)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)

    return () => {
      flush()
      unregister()
      unsubscribe()
      editor.off('update', onUpdate)
      editor.off('destroy', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
    }
  }, [editor, currentId, initial])

  return { editor, contentError }
}
