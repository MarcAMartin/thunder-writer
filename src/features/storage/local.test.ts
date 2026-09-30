import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeDoc } from './testDocs'

// In-memory stand-in for idb-keyval (fake-indexeddb is not installed).
const mem = vi.hoisted(() => new Map<string, Map<IDBValidKey, unknown>>())
vi.mock('idb-keyval', () => {
  const bucket = (s: unknown) => {
    const name = s as string
    if (!mem.has(name)) mem.set(name, new Map())
    return mem.get(name)!
  }
  return {
    createStore: (db: string, store: string) => `${db}/${store}`,
    get: async (k: IDBValidKey, s: unknown) => structuredClone(bucket(s).get(k)),
    set: async (k: IDBValidKey, v: unknown, s: unknown) => void bucket(s).set(k, structuredClone(v)),
    del: async (k: IDBValidKey, s: unknown) => void bucket(s).delete(k),
    entries: async (s: unknown) => [...bucket(s).entries()].map(([k, v]) => [k, structuredClone(v)]),
    clear: async (s: unknown) => bucket(s).clear(),
  }
})

import * as local from './local'

describe('local persistence', () => {
  beforeEach(() => mem.clear())

  it('round-trips docs in the thunder-writer/docs store, newest first', async () => {
    const older = makeDoc({ id: 'old', updatedAt: 10 })
    const newer = makeDoc({ id: 'new', updatedAt: 20, driveFileId: 'F' })
    await local.saveDoc(older)
    await local.saveDoc(newer)
    expect([...mem.keys()]).toEqual(['thunder-writer/docs'])
    expect(await local.loadAllDocs()).toEqual([newer, older])
  })

  it('deletes docs and ignores metadata and corrupt records', async () => {
    await local.saveDoc(makeDoc({ id: 'a' }))
    await local.saveDoc(makeDoc({ id: 'b' }))
    await local.setLastOpenedId('b')
    mem.get('thunder-writer/docs')!.set('doc:bad', { nope: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await local.deleteDoc('a')
    expect((await local.loadAllDocs()).map((d) => d.id)).toEqual(['b'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('stores the last opened id', async () => {
    expect(await local.getLastOpenedId()).toBeNull()
    await local.setLastOpenedId('x')
    expect(await local.getLastOpenedId()).toBe('x')
    await local.setLastOpenedId(null)
    expect(await local.getLastOpenedId()).toBeNull()
  })

  it('clears everything and can suspend writes', async () => {
    await local.saveDoc(makeDoc())
    await local.clearLocalStore()
    expect(await local.loadAllDocs()).toEqual([])
    local.suspendWrites()
    await local.saveDoc(makeDoc())
    expect(await local.loadAllDocs()).toEqual([])
  })
})
