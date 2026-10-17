import { describe, expect, it, vi } from 'vitest'
import { requestPersistentStorage } from './StorageProvider'

const navWith = (userAgent: string, persisted = false) => {
  const persist = vi.fn(async () => true)
  return { nav: { userAgent, storage: { persist, persisted: vi.fn(async () => persisted) } } as unknown as Navigator, persist }
}

describe('requestPersistentStorage', () => {
  it('asks the browser to keep the manuscripts (Safari, Chrome), once', async () => {
    const { nav, persist } = navWith('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1')
    requestPersistentStorage(nav)
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))
    const kept = navWith('Mozilla/5.0 Chrome/154.0.0.0 Safari/537.36', true)
    requestPersistentStorage(kept.nav)
    await new Promise((r) => setTimeout(r, 0))
    expect(kept.persist).not.toHaveBeenCalled()
  })

  it('never in Firefox, which would show the writer a permission prompt', async () => {
    const { nav, persist } = navWith('Mozilla/5.0 (Macintosh; rv:140.0) Gecko/20100101 Firefox/140.0')
    requestPersistentStorage(nav)
    await new Promise((r) => setTimeout(r, 0))
    expect(persist).not.toHaveBeenCalled()
  })
})
