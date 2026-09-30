import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThunderDoc } from '../../types'
import { createLocalSync, diffDocs, mergeHydration } from './localSync'
import { makeDoc } from './testDocs'

describe('diffDocs', () => {
  it('finds changed, added and deleted docs by identity', () => {
    const a = makeDoc({ id: 'a' })
    const b = makeDoc({ id: 'b' })
    const b2 = { ...b, title: 'changed' }
    const c = makeDoc({ id: 'c' })
    const d = diffDocs({ docs: { a, b }, currentId: 'a' }, { docs: { b: b2, c }, currentId: 'c' })
    expect(d.saved.map((x) => x.id).sort()).toEqual(['b', 'c'])
    expect(d.deleted).toEqual(['a'])
    expect(d.currentChanged).toBe(true)
  })

  it('is empty when docs are the same object', () => {
    const docs = { a: makeDoc({ id: 'a' }) }
    expect(diffDocs({ docs, currentId: null }, { docs, currentId: null })).toEqual({
      saved: [],
      deleted: [],
      currentChanged: false,
    })
  })
})

describe('createLocalSync', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const deps = () => ({
    saveDoc: vi.fn(async (_d: ThunderDoc) => undefined),
    deleteDoc: vi.fn(async (_id: string) => undefined),
    setLastOpenedId: vi.fn(async (_id: string | null) => undefined),
    onState: vi.fn(),
    debounceMs: 500,
  })

  it('debounces and writes only the latest version', async () => {
    const d = deps()
    const sync = createLocalSync(d)
    const v1 = makeDoc({ title: 'v1' })
    const v2 = { ...v1, title: 'v2' }
    sync.observe({ docs: {}, currentId: null }, { docs: { [v1.id]: v1 }, currentId: v1.id })
    await vi.advanceTimersByTimeAsync(300)
    sync.observe({ docs: { [v1.id]: v1 }, currentId: v1.id }, { docs: { [v1.id]: v2 }, currentId: v1.id })
    await vi.advanceTimersByTimeAsync(499)
    expect(d.saveDoc).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(d.saveDoc).toHaveBeenCalledTimes(1)
    expect(d.saveDoc).toHaveBeenCalledWith(v2)
    expect(d.setLastOpenedId).toHaveBeenCalledWith(v1.id)
    expect(d.onState).toHaveBeenLastCalledWith('saved')
  })

  it('flush writes immediately, including deletes', async () => {
    const d = deps()
    const sync = createLocalSync(d)
    const a = makeDoc({ id: 'a' })
    sync.observe({ docs: { a }, currentId: null }, { docs: {}, currentId: null })
    await sync.flush()
    expect(d.deleteDoc).toHaveBeenCalledWith('a')
    expect(sync.hasPending()).toBe(false)
  })

  it('re-queues failed writes', async () => {
    const d = deps()
    d.saveDoc.mockRejectedValueOnce(new Error('QuotaExceeded'))
    const sync = createLocalSync(d)
    const a = makeDoc({ id: 'a' })
    sync.queue({ saved: [a], deleted: [], currentChanged: false }, null)
    await sync.flush()
    expect(d.onState).toHaveBeenLastCalledWith('error', expect.any(Error))
    expect(sync.hasPending()).toBe(true)
    await sync.flush()
    expect(d.saveDoc).toHaveBeenCalledTimes(2)
    expect(d.onState).toHaveBeenLastCalledWith('saved')
  })
})

describe('mergeHydration', () => {
  it('keeps newer in-memory docs and reports them for writing', () => {
    const disk = [makeDoc({ id: 'a', updatedAt: 5 }), makeDoc({ id: 'b', updatedAt: 5 })]
    const mem = { b: makeDoc({ id: 'b', updatedAt: 9 }), c: makeDoc({ id: 'c' }), a: makeDoc({ id: 'a', updatedAt: 1 }) }
    const { docs, memoryOnly } = mergeHydration(disk, mem)
    expect(docs.find((d) => d.id === 'a')?.updatedAt).toBe(5)
    expect(docs.find((d) => d.id === 'b')?.updatedAt).toBe(9)
    expect(memoryOnly.map((d) => d.id).sort()).toEqual(['b', 'c'])
  })
})
