import { useEffect, type ReactNode } from 'react'
import { useDocuments, type DocumentsState } from '../../store/documents'
import { flushPendingEdits, registerBrowserPersister } from '../../store/pendingEdits'
import { useSettings } from '../../store/settings'
import { createAutoBackup, isUntouchedCopy } from '../backups/backups'
import { createAutosaveScheduler, pendingDriveDocs } from './autosave'
import { applyRemoteDocs, openCrossTab, remoteOwned, type CrossTab } from './crossTab'
import { autosaveDocs, useStorageStatus } from './driveSession'
import * as local from './local'
import { createLocalSync, mergeHydration } from './localSync'

/**
 * Owns persistence: hydrates documents from IndexedDB, writes changes back
 * (debounced, flushed when the tab is hidden), keeps other open tabs in sync,
 * takes automatic backups (features/backups), and runs the Drive autosave loop.
 * Children render immediately; the writer view waits for `hydrated`.
 */
export function StorageProvider({ children }: { children: ReactNode }) {
  useLocalPersistence()
  useDriveAutosave()
  return <>{children}</>
}

function useLocalPersistence() {
  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | null = null
    let tabs: CrossTab | null = null
    /** True while applying another tab's docs, which that tab already wrote to IndexedDB. */
    let applyingRemote = false
    const status = () => useStorageStatus.getState()
    const autoBackup = createAutoBackup()

    const sync = createLocalSync({
      saveDoc: local.saveDoc,
      deleteDoc: local.deleteDoc,
      setLastOpenedId: local.setLastOpenedId,
      onState: (state, err) =>
        status().patch({
          local: state,
          localError: state === 'error' ? (err instanceof Error ? err.message : 'Could not save in this browser.') : null,
        }),
      onWritten: (saved, deleted) => tabs?.post(saved, deleted),
    })

    // Cmd/Ctrl+S ("Saved in your browser") writes the queue now and reports whether it worked.
    const unregisterPersister = registerBrowserPersister(async () => {
      await sync.flush()
      const st = status()
      return st.local === 'error' ? (st.localError ?? 'Could not save in this browser.') : null
    })

    const flushNow = () => {
      // The editor debounces keystrokes; push them into the store first so this write includes them.
      flushPendingEdits()
      void sync.flush()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow()
    }

    ;(async () => {
      let loaded: Awaited<ReturnType<typeof local.loadAllDocs>> = []
      let lastId: string | null = null
      try {
        ;[loaded, lastId] = await Promise.all([local.loadAllDocs(), local.getLastOpenedId()])
      } catch (e) {
        console.error('[thunder-writer] Browser storage unavailable', e)
        status().patch({
          local: 'error',
          localError: 'This browser blocked local storage (private window?). Save to Google Drive to keep your work.',
        })
      }
      if (cancelled) return
      const before = useDocuments.getState()
      const { docs, memoryOnly } = mergeHydration(loaded, before.docs)
      const current = before.currentId ?? (lastId && docs.some((d) => d.id === lastId) ? lastId : docs[0]?.id ?? null)
      useDocuments.getState().hydrate(docs, current)
      if (memoryOnly.length) sync.queue({ saved: memoryOnly, deleted: [], currentChanged: true }, current)

      unsubscribe = useDocuments.subscribe((next, prev) => {
        if (applyingRemote) return
        // Edited here again: this tab owns the doc's next Drive upload.
        for (const id of remoteOwned) if (next.dirtyForDrive[id] && next.docs[id] !== prev.docs[id]) remoteOwned.delete(id)
        sync.observe(prev, next)
        // Edits made in this tab; another tab backs up its own.
        autoBackup.observe(prev, next)
      })
      tabs = openCrossTab((msg) => {
        const applied = applyRemoteDocs(useDocuments.getState(), msg)
        if (!applied) return
        applyingRemote = true
        try {
          useDocuments.setState(applied.patch satisfies Partial<DocumentsState>)
        } finally {
          applyingRemote = false
        }
        for (const id of applied.taken) remoteOwned.add(id)
      })
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('pagehide', flushNow)
    })()

    return () => {
      cancelled = true
      unregisterPersister()
      unsubscribe?.()
      tabs?.dispose()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flushNow)
      void sync.flush()
      sync.dispose()
    }
  }, [])
}

function useDriveAutosave() {
  useEffect(() => {
    const pending = (s: DocumentsState) =>
      pendingDriveDocs(s, {
        includeUnlinked: true,
        currentId: s.currentId,
        // A backup opened as a copy reaches Drive once it's edited, not just for being looked at.
        skip: (id) => useStorageStatus.getState().driveConflicts[id] === true || remoteOwned.has(id) || isUntouchedCopy(id),
      })
    const pendingIds = () => pending(useDocuments.getState()).map((d) => d.id)
    const scheduler = createAutosaveScheduler({
      debounceMs: 5000,
      intervalMs: useSettings.getState().driveAutosaveSec * 1000,
      isDirty: () => useStorageStatus.getState().driveConnected && pendingIds().length > 0,
      save: () => autosaveDocs(pendingIds()),
    })

    const unsubDocs = useDocuments.subscribe((next, prev) => {
      if (next.docs !== prev.docs && useStorageStatus.getState().driveConnected && pending(next).length > 0) {
        scheduler.notifyChange()
      }
    })
    const unsubStatus = useStorageStatus.subscribe((next, prev) => {
      // Connecting (or reconnecting after an expired token, or resolving a conflict)
      // catches up on anything edited meanwhile.
      const reconnected = prev.driveNeedsReconnect && !next.driveNeedsReconnect
      const resolved = Object.keys(prev.driveConflicts).some((id) => !next.driveConflicts[id])
      if (next.driveConnected && (!prev.driveConnected || reconnected || resolved)) scheduler.notifyChange()
    })
    const unsubSettings = useSettings.subscribe((next, prev) => {
      if (next.driveAutosaveSec !== prev.driveAutosaveSec) scheduler.setIntervalMs(next.driveAutosaveSec * 1000)
    })

    return () => {
      unsubDocs()
      unsubStatus()
      unsubSettings()
      scheduler.dispose()
    }
  }, [])
}
