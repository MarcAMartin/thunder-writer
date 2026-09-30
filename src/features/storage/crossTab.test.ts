import { describe, expect, it, vi } from 'vitest'
import { applyRemoteDocs, isNewerCopy, openCrossTab, type ChannelLike, type DocsMessage } from './crossTab'
import { makeDoc } from './testDocs'

describe('isNewerCopy', () => {
  it('prefers the later edit, then the later Drive sync', () => {
    expect(isNewerCopy(makeDoc({ updatedAt: 5 }), undefined)).toBe(true)
    expect(isNewerCopy(makeDoc({ updatedAt: 5 }), makeDoc({ updatedAt: 4 }))).toBe(true)
    expect(isNewerCopy(makeDoc({ updatedAt: 4 }), makeDoc({ updatedAt: 5 }))).toBe(false)
    expect(isNewerCopy(makeDoc({ updatedAt: 5, driveSyncedAt: 5 }), makeDoc({ updatedAt: 5 }))).toBe(true)
    expect(isNewerCopy(makeDoc({ updatedAt: 5 }), makeDoc({ updatedAt: 5 }))).toBe(false)
  })
})

describe('applyRemoteDocs', () => {
  const state = {
    docs: { a: makeDoc({ id: 'a', updatedAt: 10 }), b: makeDoc({ id: 'b', updatedAt: 10 }) },
    dirtyForDrive: { a: true, b: true } as Record<string, true>,
    currentId: 'b',
  }

  it("adopts another tab's newer copy and leaves its Drive upload to that tab", () => {
    const newer = makeDoc({ id: 'a', updatedAt: 20, title: 'From the other tab' })
    const r = applyRemoteDocs(state, { type: 'docs', saved: [newer, makeDoc({ id: 'b', updatedAt: 5 })], deleted: [] })
    expect(r?.taken).toEqual(['a'])
    expect(r?.patch.docs.a).toBe(newer)
    expect(r?.patch.docs.b).toBe(state.docs.b) // older copy ignored
    expect(r?.patch.dirtyForDrive).toEqual({ b: true })
    expect(state.docs.a.title).toBe('The Long Storm') // input not mutated
  })

  it('removes docs deleted elsewhere (closing the current one) and ignores stale news', () => {
    const r = applyRemoteDocs(state, { type: 'docs', saved: [], deleted: ['b', 'zzz'] })
    expect(Object.keys(r!.patch.docs)).toEqual(['a'])
    expect(r!.patch.currentId).toBeNull()
    expect(applyRemoteDocs(state, { type: 'docs', saved: [makeDoc({ id: 'a', updatedAt: 1 })], deleted: [] })).toBeNull()
  })
})

describe('openCrossTab', () => {
  function fakeChannel() {
    const ch: ChannelLike & { sent: unknown[] } = {
      sent: [],
      onmessage: null,
      postMessage(m) {
        this.sent.push(m)
      },
      close: vi.fn(),
    }
    return ch
  }

  it('posts written docs and delivers valid messages only', () => {
    const ch = fakeChannel()
    const got: DocsMessage[] = []
    const tabs = openCrossTab((m) => got.push(m), () => ch)
    const d = makeDoc()
    tabs.post([d], [])
    tabs.post([], [])
    expect(ch.sent).toEqual([{ type: 'docs', saved: [d], deleted: [] }])
    ch.onmessage?.({ data: { type: 'docs', saved: [d], deleted: ['x'] } } as MessageEvent)
    ch.onmessage?.({ data: { type: 'nope' } } as MessageEvent)
    expect(got).toHaveLength(1)
    tabs.dispose()
    expect(ch.close).toHaveBeenCalled()
    tabs.post([d], []) // after dispose: no-op
    expect(ch.sent).toHaveLength(1)
  })

  it('works (as a no-op) where BroadcastChannel is unavailable', () => {
    const tabs = openCrossTab(() => undefined, () => null)
    expect(() => tabs.post([makeDoc()], [])).not.toThrow()
    tabs.dispose()
  })
})
