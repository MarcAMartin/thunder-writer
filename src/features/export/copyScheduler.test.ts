import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCopyScheduler, type CopySchedulerOptions } from './copyScheduler'

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(over: Partial<CopySchedulerOptions> = {}) {
  const write = vi.fn(async () => undefined)
  const s = createCopyScheduler({ write, debounceMs: 15_000, maxIntervalMs: 30_000, retryDelayMs: 60_000, ...over })
  return { s, write: (over.write as ReturnType<typeof vi.fn>) ?? write }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => vi.useRealTimers())

describe('desktop copy scheduler', () => {
  it('writes 15 s after the last change', async () => {
    const { s, write } = setup()
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(10_000)
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(14_999)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect(s.getState()).toMatchObject({ dirty: false, writing: false, lastWrittenAt: Date.now() })
  })

  it('still writes every 30 s during non-stop typing', async () => {
    const { s, write } = setup()
    for (let i = 0; i < 60; i++) {
      s.notifyChange()
      await vi.advanceTimersByTimeAsync(1_000)
    }
    // 60 s of typing, a change every second: writes at 30 s and 60 s.
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('starts automatic writes at most once every 30 s', async () => {
    const { s, write } = setup()
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(write).toHaveBeenCalledTimes(1)
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(15_000) // debounce passed, but only 15 s since the last write
    expect(write).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('never overlaps writes; edits during a write stay pending and are written after it', async () => {
    const first = deferred()
    const write = vi.fn().mockImplementationOnce(() => first.promise).mockImplementation(async () => undefined)
    const { s } = setup({ write })
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(write).toHaveBeenCalledTimes(1)
    expect(s.getState().writing).toBe(true)

    s.notifyChange() // typed while the file is being written
    const flushed = s.flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(write).toHaveBeenCalledTimes(1) // single-flight: still waiting for the first write
    expect(s.getState().dirty).toBe(true)

    first.resolve()
    await expect(flushed).resolves.toBe('written')
    expect(write).toHaveBeenCalledTimes(2)
    expect(s.getState().dirty).toBe(false)
  })

  it('reschedules pending edits after a slow write finishes', async () => {
    const first = deferred()
    const write = vi.fn().mockImplementationOnce(() => first.promise).mockImplementation(async () => undefined)
    const { s } = setup({ write })
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(15_000)
    s.notifyChange()
    first.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.getState()).toMatchObject({ dirty: true, writing: false })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(write).toHaveBeenCalledTimes(2)
    expect(s.getState().dirty).toBe(false)
  })

  it('flush writes immediately, and reports clean when nothing changed', async () => {
    const { s, write } = setup()
    await expect(s.flush()).resolves.toBe('clean')
    expect(write).not.toHaveBeenCalled()
    s.notifyChange()
    await expect(s.flush()).resolves.toBe('written')
    expect(write).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(write).toHaveBeenCalledTimes(1) // the pending timer was cancelled
    await expect(s.flush({ force: true })).resolves.toBe('written')
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('retries a failed write after the retry delay', async () => {
    const write = vi.fn().mockRejectedValueOnce(new DOMException('busy', 'NoModificationAllowedError')).mockResolvedValue(undefined)
    const onState = vi.fn()
    const { s } = setup({ write, onState, shouldPause: () => false })
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(s.getState()).toMatchObject({ dirty: true, paused: false })
    expect((s.getState().lastError as DOMException).name).toBe('NoModificationAllowedError')
    await vi.advanceTimersByTimeAsync(59_999)
    expect(write).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(write).toHaveBeenCalledTimes(2)
    expect(s.getState()).toMatchObject({ dirty: false, lastError: null })
    expect(onState).toHaveBeenCalled()
  })

  it('pauses when permission is lost, and resumes', async () => {
    const lost = new DOMException('no', 'NotAllowedError')
    const write = vi.fn().mockRejectedValueOnce(lost).mockResolvedValue(undefined)
    const { s } = setup({ write, shouldPause: (e) => (e as DOMException).name === 'NotAllowedError' })
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(s.getState()).toMatchObject({ paused: true, dirty: true, lastError: lost })
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(write).toHaveBeenCalledTimes(1) // no automatic writes while paused
    await expect(s.flush()).resolves.toBe('paused')

    s.resume()
    await expect(s.flush()).resolves.toBe('written')
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('pauses when the file was moved or deleted (NotFoundError)', async () => {
    const gone = new DOMException('gone', 'NotFoundError')
    const write = vi.fn().mockRejectedValue(gone)
    const { s } = setup({ write, shouldPause: (e) => (e as DOMException).name === 'NotFoundError' })
    s.notifyChange()
    await expect(s.flush()).resolves.toBe('paused')
    expect(s.getState().lastError).toBe(gone)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('reports failed flushes and stops after dispose', async () => {
    const write = vi.fn().mockRejectedValue(new Error('nope'))
    const { s } = setup({ write, shouldPause: () => false })
    s.notifyChange()
    await expect(s.flush()).resolves.toBe('failed')
    s.dispose()
    s.notifyChange()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(write).toHaveBeenCalledTimes(1)
    await expect(s.flush()).resolves.toBe('disposed')
  })
})
