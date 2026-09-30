import { useEffect, useMemo, useState } from 'react'
import type { DocFormat } from '../../types'
import { resolveFormat } from '../editor/presets'
import type { BookLayoutOptions } from './headerFooter'
import { cachedLayout, layoutKey, runBookLayout, type BookLayout, type LayoutEnv, type LayoutRequest } from './layout'

export interface UseBookLayoutInput {
  docId: string
  updatedAt: number
  content: unknown
  format: DocFormat | null | undefined
  options: BookLayoutOptions
  firstPageNumber: number
}

export interface BookLayoutState {
  layout: BookLayout | null
  error: string | null
}

/** Waits (briefly) for web fonts so measurements match what the pages will draw. */
function fontsReady(timeoutMs = 1500): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (!fonts || fonts.status === 'loaded') return Promise.resolve()
  return Promise.race([fonts.ready.then(() => undefined), new Promise<void>((r) => setTimeout(r, timeoutMs))])
}

/**
 * Lays the book out incrementally and re-renders as pages arrive. A finished
 * layout is cached by doc id + updatedAt + format + layout options, so
 * reopening the preview, or changing only running heads and page numbers, is instant.
 */
export function useBookLayout(input: UseBookLayoutInput, env?: Partial<LayoutEnv>): BookLayoutState {
  const format = useMemo(() => resolveFormat(input.format), [input.format])
  const optionsKey = JSON.stringify(input.options)
  const parity = Math.abs(input.firstPageNumber) % 2
  const req: LayoutRequest = useMemo(
    () => ({
      docKey: `${input.docId}@${input.updatedAt}`,
      content: input.content,
      format,
      options: JSON.parse(optionsKey) as BookLayoutOptions,
      firstPageNumber: parity === 1 ? 1 : 2,
    }),
    // content changes always come with a new updatedAt
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.docId, input.updatedAt, format, optionsKey, parity],
  )
  const key = layoutKey(req)
  const [state, setState] = useState<BookLayoutState>(() => ({ layout: cachedLayout(key) ?? null, error: null }))

  useEffect(() => {
    let cancel: (() => void) | null = null
    let disposed = false
    const start = () => {
      if (disposed) return
      try {
        cancel = runBookLayout(
          req,
          (l) => {
            if (!disposed) setState({ layout: l, error: null })
          },
          env,
        )
      } catch (e) {
        setState({ layout: null, error: e instanceof Error ? e.message : 'The book could not be laid out.' })
      }
    }
    if (cachedLayout(key)) start()
    else void fontsReady().then(start)
    return () => {
      disposed = true
      cancel?.()
    }
    // env is a test seam; it is not expected to change while mounted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // The previous layout stays on screen until the new one's first pages arrive.
  return state
}
