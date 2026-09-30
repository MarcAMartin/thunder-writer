import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../../store/session'
import { addContextFile, loadContextFiles, saveContextFiles } from './contextFiles'

/** Load persisted context files into the session once, on mount. */
export function useLoadContextFiles(): void {
  useEffect(() => {
    let cancelled = false
    void loadContextFiles().then((files) => {
      // Don't clobber files the writer added while the load was pending.
      if (!cancelled && useSession.getState().contextFiles.length === 0) useSession.getState().setContextFiles(files)
    })
    return () => {
      cancelled = true
    }
  }, [])
}

/** Add/remove context files, persisting to IndexedDB. */
export function useContextFileActions() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const add = useCallback(async (files: FileList | File[]) => {
    setBusy(true)
    setError(null)
    const errors: string[] = []
    let list = useSession.getState().contextFiles
    for (const file of Array.from(files)) {
      const r = await addContextFile(list, file)
      if (r.ok) list = r.files
      else errors.push(r.error)
    }
    useSession.getState().setContextFiles(list)
    try {
      await saveContextFiles(list)
    } catch {
      errors.push('Your context files are in use for this session but could not be saved in this browser.')
    }
    setError(errors.length ? errors.join(' ') : null)
    setBusy(false)
  }, [])

  const remove = useCallback(async (id: string) => {
    const list = useSession.getState().contextFiles.filter((f) => f.id !== id)
    useSession.getState().setContextFiles(list)
    try {
      await saveContextFiles(list)
    } catch {
      setError('Removed for this session, but the change could not be saved in this browser.')
    }
  }, [])

  return { add, remove, error, clearError: () => setError(null), busy }
}
