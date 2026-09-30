import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocuments } from '../../store/documents'
import type { ThunderDoc } from '../../types'
import { makeDoc } from './testDocs'

const disk = vi.hoisted(() => ({ docs: new Map<string, unknown>(), last: null as string | null, fail: false }))

vi.mock('./local', () => ({
  loadAllDocs: vi.fn(async () => {
    if (disk.fail) throw new Error('blocked')
    return [...disk.docs.values()]
  }),
  getLastOpenedId: vi.fn(async () => disk.last),
  saveDoc: vi.fn(async (d: ThunderDoc) => void disk.docs.set(d.id, d)),
  deleteDoc: vi.fn(async (id: string) => void disk.docs.delete(id)),
  setLastOpenedId: vi.fn(async (id: string | null) => void (disk.last = id)),
}))

import { StorageProvider } from './StorageProvider'
import { registerPendingFlush, saveInBrowserNow } from '../../store/pendingEdits'
import { CHANNEL_NAME } from './crossTab'
import { useStorageStatus } from './driveSession'

describe('StorageProvider', () => {
  beforeEach(() => {
    disk.docs.clear()
    disk.last = null
    disk.fail = false
    useDocuments.setState({ docs: {}, currentId: null, hydrated: false, dirtyForDrive: {} })
    useStorageStatus.setState({ local: 'idle', localError: null })
  })

  it('renders children immediately and hydrates from browser storage', async () => {
    const a = makeDoc({ id: 'a', updatedAt: 1 })
    const b = makeDoc({ id: 'b', updatedAt: 2 })
    disk.docs.set('a', a)
    disk.docs.set('b', b)
    disk.last = 'a'
    render(
      <StorageProvider>
        <p>child</p>
      </StorageProvider>,
    )
    expect(screen.getByText('child')).toBeInTheDocument()
    await waitFor(() => expect(useDocuments.getState().hydrated).toBe(true))
    expect(Object.keys(useDocuments.getState().docs).sort()).toEqual(['a', 'b'])
    expect(useDocuments.getState().currentId).toBe('a')
  })

  it('writes edits back after a short debounce and on pagehide', async () => {
    render(<StorageProvider>{null}</StorageProvider>)
    await waitFor(() => expect(useDocuments.getState().hydrated).toBe(true))

    let id = ''
    act(() => {
      id = useDocuments.getState().createDoc({ title: 'Fresh' }).id
    })
    await waitFor(() => expect(disk.docs.has(id)).toBe(true))
    expect(disk.last).toBe(id)
    expect(useStorageStatus.getState().local).toBe('saved')

    act(() => useDocuments.getState().updateTitle(id, 'Renamed'))
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await waitFor(() => expect((disk.docs.get(id) as ThunderDoc).title).toBe('Renamed'))

    act(() => useDocuments.getState().deleteDoc(id))
    await waitFor(() => expect(disk.docs.has(id)).toBe(false))
  })

  it('saveInBrowserNow (Cmd/Ctrl+S) writes the editor\'s pending typing to IndexedDB before resolving, and reports failures', async () => {
    const local = await import('./local')
    render(<StorageProvider>{null}</StorageProvider>)
    await waitFor(() => expect(useDocuments.getState().hydrated).toBe(true))
    let id = ''
    act(() => {
      id = useDocuments.getState().createDoc({ title: 'Fresh' }).id
    })
    const unregister = registerPendingFlush(() => useDocuments.getState().updateTitle(id, 'Typed just now'))
    let err: string | null = 'unset'
    await act(async () => {
      err = await saveInBrowserNow()
    })
    expect(err).toBeNull()
    expect((disk.docs.get(id) as ThunderDoc).title).toBe('Typed just now')
    unregister()

    vi.mocked(local.saveDoc).mockRejectedValueOnce(new Error('QuotaExceededError'))
    act(() => useDocuments.getState().updateTitle(id, 'Again'))
    await act(async () => {
      err = await saveInBrowserNow()
    })
    expect(err).toBe('QuotaExceededError')
  })

  it('still hydrates (empty) when browser storage is blocked', async () => {
    disk.fail = true
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<StorageProvider>{null}</StorageProvider>)
    await waitFor(() => expect(useDocuments.getState().hydrated).toBe(true))
    expect(useStorageStatus.getState().local).toBe('error')
    err.mockRestore()
  })

  it('on tab hide, pulls in the editor\'s debounced typing and writes it right away', async () => {
    const doc = makeDoc({ id: 'a', updatedAt: 1 })
    disk.docs.set('a', doc)
    render(<StorageProvider>{null}</StorageProvider>)
    await waitFor(() => expect(useDocuments.getState().hydrated).toBe(true))
    // Stand-in for the editor: typing still sitting in its 400 ms debounce.
    const typed = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Last words.' }] }] }
    const unregister = registerPendingFlush(() => useDocuments.getState().updateContent('a', typed))
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    // Well before the 500 ms write debounce: a frozen/discarded tab never runs that timer.
    await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
    expect((disk.docs.get('a') as ThunderDoc).content).toEqual(typed)
    vis.mockRestore()
    unregister()
  })

  it("adopts another tab's newer copy and tells other tabs about its own writes", async () => {
    if (typeof BroadcastChannel !== 'function') return
    disk.docs.set('a', makeDoc({ id: 'a', updatedAt: 1 }))
    const { unmount } = render(<StorageProvider>{null}</StorageProvider>)
    await waitFor(() => expect(useDocuments.getState().hydrated).toBe(true))
    const other = new BroadcastChannel(CHANNEL_NAME)
    const heard: unknown[] = []
    other.onmessage = (ev) => heard.push(ev.data)
    try {
      const newer = makeDoc({ id: 'a', updatedAt: 50, title: 'Edited in the other tab' })
      other.postMessage({ type: 'docs', saved: [newer], deleted: [] })
      await waitFor(() => expect(useDocuments.getState().docs.a.title).toBe('Edited in the other tab'))
      // Not written back (the other tab already did) and not re-broadcast.
      await new Promise((r) => setTimeout(r, 600))
      expect((disk.docs.get('a') as ThunderDoc).title).toBe('The Long Storm')
      expect(heard).toHaveLength(0)

      act(() => useDocuments.getState().updateTitle('a', 'Edited here'))
      await waitFor(() => expect(heard).toHaveLength(1))
      expect(heard[0]).toMatchObject({ type: 'docs', saved: [{ id: 'a', title: 'Edited here' }], deleted: [] })
    } finally {
      other.close()
      unmount()
    }
  })
})
