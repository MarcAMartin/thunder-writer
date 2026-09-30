import { useCallback } from 'react'
import type { EditorBridge } from '../../contracts'
import { useSession } from '../../store/session'
import type { Suggestion, SuggestionStatus } from '../../types'

export type ActionResult = { ok: true } | { ok: false; message: string }

const NOT_FOUND = "That passage has changed since this suggestion was made, so it can't be found in your manuscript."

/** Accept / decline / done / hide / select, keeping the editor highlight in sync. */
export function useSuggestionActions(bridge: EditorBridge | null) {
  const setStatus = useSession((s) => s.setSuggestionStatus)
  const setActive = useSession((s) => s.setActiveSuggestion)

  const resolve = useCallback(
    (s: Suggestion, status: SuggestionStatus): ActionResult => {
      if (useSession.getState().activeSuggestionId === s.id) bridge?.clearHighlight()
      setStatus(s.id, status)
      return { ok: true }
    },
    [bridge, setStatus],
  )

  const accept = useCallback(
    (s: Suggestion): ActionResult => {
      if (s.quote && s.replacement !== undefined) {
        if (!bridge) return { ok: false, message: 'The editor is not ready yet.' }
        if (useSession.getState().activeSuggestionId === s.id) bridge.clearHighlight()
        if (!bridge.replaceQuote(s.quote, s.replacement)) return { ok: false, message: NOT_FOUND }
      }
      return resolve(s, 'accepted')
    },
    [bridge, resolve],
  )

  /** Toggle selection: highlight the quoted passage in the document. */
  const select = useCallback(
    (s: Suggestion): ActionResult => {
      const activeId = useSession.getState().activeSuggestionId
      if (activeId === s.id) {
        bridge?.clearHighlight()
        setActive(null)
        return { ok: true }
      }
      bridge?.clearHighlight()
      setActive(s.id)
      if (s.quote && bridge && !bridge.highlightQuote(s.quote)) return { ok: false, message: NOT_FOUND }
      return { ok: true }
    },
    [bridge, setActive],
  )

  return {
    accept,
    select,
    decline: useCallback((s: Suggestion) => resolve(s, 'declined'), [resolve]),
    done: useCallback((s: Suggestion) => resolve(s, 'done'), [resolve]),
    hide: useCallback((s: Suggestion) => resolve(s, 'hidden'), [resolve]),
  }
}

export type SuggestionActions = ReturnType<typeof useSuggestionActions>
