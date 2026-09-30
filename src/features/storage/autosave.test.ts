import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosaveScheduler, describeSaveStatus, pendingDriveDocs, type StatusInput } from './autosave'
import { makeDoc } from './testDocs'

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createAutosaveScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => vi.useRealTimers())

  const setup = (intervalMs = 60_000) => {
    let dirty = true
    const save = vi.fn(async () => {
      dirty = false
    })
    const s = createAutosaveScheduler({
      save,
      isDirty: () => dirty,
      debounceMs: 5000,
      intervalMs,
      retryDelayMs: 30_000,
      now: () => Date.now(),
    })
    return { s, save, setDirty: (v: boolean) => (dirty = v) }
  }

  it('saves 5s after the last change', async () => {
    const { s, save } = setup()
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(3000)
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(4999)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    s.dispose()
  })

  it('never saves more often than the interval', async () => {
    const { s, save, setDirty } = setup(60_000)
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(5000) // t=5s: first save
    expect(save).toHaveBeenCalledTimes(1)
    setDirty(true)
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(5000) // t=10s: debounced, but gated until t=65s
    expect(save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(54_999)
    expect(save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(2)
    s.dispose()
  })

  it('saves on the interval while dirty even without a typing pause', async () => {
    const { s, save } = setup(60_000)
    // Writer types continuously: debounce never fires.
    for (let i = 0; i < 70; i++) {
      s.notifyChange()
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(save).toHaveBeenCalledTimes(1)
    s.dispose()
  })

  it('does nothing when clean', async () => {
    const { s, save, setDirty } = setup()
    setDirty(false)
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(save).not.toHaveBeenCalled()
    s.dispose()
  })

  it('is single-flight and re-runs once after a slow upload', async () => {
    let dirty = true
    const d = deferred()
    let calls = 0
    const save = vi.fn(() => {
      calls++
      return calls === 1 ? d.promise : Promise.resolve().then(() => void (dirty = false))
    })
    const s = createAutosaveScheduler({ save, isDirty: () => dirty, debounceMs: 5000, intervalMs: 0 })
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(s.inFlight).toBe(true)
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(5000)
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1)
    d.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(2)
    s.dispose()
  })

  it('backs off after a failure, but saveNow retries immediately', async () => {
    const save = vi.fn(() => Promise.reject(new Error('offline')))
    const s = createAutosaveScheduler({ save, isDirty: () => true, debounceMs: 5000, intervalMs: 0, retryDelayMs: 30_000 })
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1)
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1) // backing off
    await vi.advanceTimersByTimeAsync(25_000)
    expect(save).toHaveBeenCalledTimes(2)
    await expect(s.saveNow()).rejects.toThrow('offline')
    expect(save).toHaveBeenCalledTimes(3)
    s.dispose()
  })

  it('stops after dispose', async () => {
    const { s, save } = setup()
    s.notifyChange()
    s.dispose()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(save).not.toHaveBeenCalled()
  })

  it('applies a shorter interval immediately to a gated save', async () => {
    const { s, save, setDirty } = setup(600_000)
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(5000)
    setDirty(true)
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1)
    s.setIntervalMs(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(2)
    s.dispose()
  })
})

describe('pendingDriveDocs', () => {
  it('includes only Drive-linked docs changed since their last sync', () => {
    const docs = {
      a: makeDoc({ id: 'a', driveFileId: 'fa', driveSyncedAt: 2000, updatedAt: 2000 }),
      b: makeDoc({ id: 'b', driveFileId: 'fb', driveSyncedAt: 1000, updatedAt: 2000 }),
      c: makeDoc({ id: 'c' }),
      d: makeDoc({ id: 'd', driveFileId: 'fd', driveSyncedAt: 5000, updatedAt: 5000 }),
    }
    const ids = pendingDriveDocs({ docs, dirtyForDrive: { c: true, d: true } }).map((d) => d.id)
    expect(ids.sort()).toEqual(['b', 'd'])
  })

  it('while Drive is connected, also autosaves new docs that have words (edited this session, or open)', () => {
    const words = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Chapter one.' }] }] }
    const blank = { type: 'doc', content: [{ type: 'paragraph' }] }
    const docs = {
      edited: makeDoc({ id: 'edited', content: words }),
      open: makeDoc({ id: 'open', content: words }),
      old: makeDoc({ id: 'old', content: words }),
      empty: makeDoc({ id: 'empty', content: blank }),
      linked: makeDoc({ id: 'linked', driveFileId: 'f', driveSyncedAt: 1, updatedAt: 2 }),
    }
    const state = { docs, dirtyForDrive: { edited: true, empty: true } as Record<string, true> }
    expect(pendingDriveDocs(state).map((d) => d.id)).toEqual(['linked'])
    const ids = pendingDriveDocs(state, { includeUnlinked: true, currentId: 'open' }).map((d) => d.id)
    expect(ids.sort()).toEqual(['edited', 'linked', 'open'])
    const skipped = pendingDriveDocs(state, { includeUnlinked: true, currentId: 'open', skip: (id) => id === 'linked' })
    expect(skipped.map((d) => d.id).sort()).toEqual(['edited', 'open'])
  })
})

describe('describeSaveStatus', () => {
  const base: StatusInput = {
    local: 'saved',
    drive: 'idle',
    driveConnected: false,
    doc: makeDoc(),
    docDirtyForDrive: false,
  }
  it('local only', () => expect(describeSaveStatus(base).label).toBe('Saved locally'))
  it('saving to Drive', () => expect(describeSaveStatus({ ...base, drive: 'saving' }).label).toBe('Saving to Drive…'))
  it('error offers retry', () => {
    const v = describeSaveStatus({ ...base, drive: 'error' })
    expect(v).toEqual({ label: 'Drive error — retry', tone: 'error', action: 'retry' })
  })
  it('saved to Drive with time', () => {
    const v = describeSaveStatus({
      ...base,
      driveConnected: true,
      driveSavedAt: new Date(2026, 8, 30, 12, 4).getTime(),
      doc: makeDoc({ driveFileId: 'f' }),
    })
    expect(v.label).toMatch(/^Saved to Drive .*12.*04/)
    expect(v.tone).toBe('ok')
  })
  it('linked doc while disconnected offers connect', () => {
    const v = describeSaveStatus({ ...base, doc: makeDoc({ driveFileId: 'f' }) })
    expect(v.action).toBe('connect')
  })
  it('a new doc waiting for its first Drive upload says so', () => {
    const v = describeSaveStatus({ ...base, driveConnected: true, docDirtyForDrive: true })
    expect(v.label).toBe('Saved locally · Drive pending')
  })
  it('an expired background token asks to reconnect instead of "retry"', () => {
    const v = describeSaveStatus({ ...base, driveConnected: true, drive: 'error', driveNeedsReconnect: true })
    expect(v).toEqual({ label: 'Drive paused — reconnect', tone: 'warn', action: 'connect' })
  })
  it('a Drive conflict on this doc asks the writer to resolve it', () => {
    const v = describeSaveStatus({ ...base, driveConnected: true, docConflict: true, doc: makeDoc({ driveFileId: 'f' }) })
    expect(v).toEqual({ label: 'Changed in Drive — resolve', tone: 'error', action: 'resolve' })
  })
  it('pending Drive save', () => {
    const v = describeSaveStatus({ ...base, driveConnected: true, docDirtyForDrive: true, doc: makeDoc({ driveFileId: 'f' }) })
    expect(v.label).toBe('Saved locally · Drive pending')
  })
})
