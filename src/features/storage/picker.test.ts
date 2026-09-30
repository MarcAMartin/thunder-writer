import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DriveError } from './drive'
import {
  DOCX_MIME,
  GDOC_MIME,
  IMPORTABLE_MIME_TYPES,
  loadPickerApi,
  openPicker,
  PICKER_API_SRC,
  resetPickerLoader,
  type PickerNamespace,
  type PickerResponse,
} from './picker'

type W = Window & { gapi?: unknown; google?: { picker?: unknown } }
const w = () => window as W

/** A fake google.picker namespace that records every builder/view call. */
function fakePicker() {
  const calls: [string, ...unknown[]][] = []
  const views: FakeView[] = []
  let callback: ((d: PickerResponse) => void) | undefined
  const picker = { setVisible: vi.fn(), dispose: vi.fn() }

  class FakeView {
    calls: [string, ...unknown[]][] = []
    constructor(public id?: string) {
      views.push(this)
    }
    setMimeTypes(m: string) {
      this.calls.push(['setMimeTypes', m])
      return this
    }
    setIncludeFolders(v: boolean) {
      this.calls.push(['setIncludeFolders', v])
      return this
    }
    setSelectFolderEnabled(v: boolean) {
      this.calls.push(['setSelectFolderEnabled', v])
      return this
    }
    setLabel(v: string) {
      this.calls.push(['setLabel', v])
      return this
    }
    setEnableDrives(v: boolean) {
      this.calls.push(['setEnableDrives', v])
      return this
    }
  }
  class FakeBuilder {
    constructor() {
      const self = this as unknown as Record<string, (...a: unknown[]) => unknown>
      for (const m of ['addView', 'setOAuthToken', 'setDeveloperKey', 'setAppId', 'setOrigin', 'setTitle', 'setMaxItems', 'enableFeature'])
        self[m] = (...a: unknown[]) => {
          calls.push([m, ...a])
          return this
        }
    }
    setCallback(cb: (d: PickerResponse) => void) {
      callback = cb
      return this
    }
    build() {
      return picker
    }
  }
  const ns = {
    PickerBuilder: FakeBuilder,
    DocsView: FakeView,
    ViewId: { DOCS: 'all' },
    Action: { PICKED: 'picked', CANCEL: 'cancel', ERROR: 'error' },
    Feature: { MULTISELECT_ENABLED: 'multiselectEnabled' },
  } as unknown as PickerNamespace
  return { ns, calls, views, picker, respond: (d: PickerResponse) => callback?.(d) }
}

const OPTS = { token: 'TOKEN', developerKey: 'AIzaKEY', appId: '698829428298', origin: 'http://localhost:5173' }

describe('loadPickerApi', () => {
  beforeEach(() => {
    resetPickerLoader()
    delete w().gapi
    delete w().google
    document.head.querySelectorAll(`script[src="${PICKER_API_SRC}"]`).forEach((s) => s.remove())
  })
  afterEach(() => {
    delete w().gapi
    delete w().google
  })

  it('injects api.js once, loads the picker library and resolves google.picker', async () => {
    const { ns } = fakePicker()
    const load = vi.fn((lib: string, cfg: { callback: () => void }) => {
      expect(lib).toBe('picker')
      w().google = { picker: ns }
      cfg.callback()
    })
    const a = loadPickerApi()
    const b = loadPickerApi()
    expect(a).toBe(b)
    const scripts = document.head.querySelectorAll(`script[src="${PICKER_API_SRC}"]`)
    expect(scripts).toHaveLength(1)
    expect(PICKER_API_SRC).toBe('https://apis.google.com/js/api.js')
    w().gapi = { load }
    scripts[0].dispatchEvent(new Event('load'))
    await expect(a).resolves.toBe(ns)
    expect(load).toHaveBeenCalledTimes(1)
    // Already loaded: no new script, resolves straight away.
    await expect(loadPickerApi()).resolves.toBe(ns)
    expect(document.head.querySelectorAll(`script[src="${PICKER_API_SRC}"]`)).toHaveLength(1)
  })

  it('reuses an already-loaded gapi without adding a script', async () => {
    const { ns } = fakePicker()
    w().gapi = {
      load: (_lib: string, cfg: { callback: () => void }) => {
        w().google = { picker: ns }
        cfg.callback()
      },
    }
    await expect(loadPickerApi()).resolves.toBe(ns)
    expect(document.head.querySelector(`script[src="${PICKER_API_SRC}"]`)).toBeNull()
  })

  it('fails with a network error (and can retry) when the script is blocked', async () => {
    const p = loadPickerApi()
    document.head.querySelector(`script[src="${PICKER_API_SRC}"]`)!.dispatchEvent(new Event('error'))
    const err = await p.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DriveError)
    expect((err as DriveError).code).toBe('network')
    // A later call starts over rather than returning the failed promise.
    expect(loadPickerApi()).not.toBe(p)
  })

  it('fails when gapi.load reports an error or times out', async () => {
    w().gapi = { load: (_lib: string, cfg: { onerror: () => void }) => cfg.onerror() }
    expect(((await loadPickerApi().catch((e: unknown) => e)) as DriveError).code).toBe('network')
    w().gapi = { load: (_lib: string, cfg: { ontimeout: () => void; timeout: number }) => cfg.ontimeout() }
    expect(((await loadPickerApi().catch((e: unknown) => e)) as DriveError).code).toBe('network')
  })
})

describe('openPicker', () => {
  it('builds a single-select Picker with the token, key, appId and origin, filtered to importable types', async () => {
    const f = fakePicker()
    const p = openPicker(f.ns, OPTS)
    expect(f.calls).toEqual(
      expect.arrayContaining([
        ['setOAuthToken', 'TOKEN'],
        ['setDeveloperKey', 'AIzaKEY'],
        ['setAppId', '698829428298'],
        ['setOrigin', 'http://localhost:5173'],
        ['setMaxItems', 1],
      ]),
    )
    expect(f.calls.some(([m, a]) => m === 'enableFeature' && a === 'multiselectEnabled')).toBe(false)
    // "Manuscripts" (My Drive) and "Shared drives", each labelled so the tabs can be told apart.
    expect(f.views).toHaveLength(2)
    expect(f.views[0].calls).toContainEqual(['setLabel', 'Manuscripts'])
    expect(f.views[0].calls.some((c) => c[0] === 'setEnableDrives')).toBe(false)
    expect(f.views[1].calls).toEqual(expect.arrayContaining([['setLabel', 'Shared drives'], ['setEnableDrives', true]]))
    expect(f.views[1].calls.find((c) => c[0] === 'setMimeTypes')).toEqual(f.views[0].calls.find((c) => c[0] === 'setMimeTypes'))
    const mimes = String(f.views[0].calls.find((c) => c[0] === 'setMimeTypes')?.[1]).split(',')
    expect(mimes).toEqual([...IMPORTABLE_MIME_TYPES])
    expect(mimes).toEqual(expect.arrayContaining([GDOC_MIME, DOCX_MIME, 'text/plain', 'text/markdown', 'text/html']))
    expect(f.views[0].calls).toEqual(
      expect.arrayContaining([
        ['setIncludeFolders', true],
        ['setSelectFolderEnabled', false],
      ]),
    )
    expect(f.picker.setVisible).toHaveBeenCalledWith(true)

    f.respond({ action: 'loaded' })
    f.respond({
      action: 'picked',
      docs: [{ id: 'F1', name: 'Draft 3.docx', mimeType: DOCX_MIME, sizeBytes: '2048' }],
    })
    await expect(p).resolves.toEqual({ id: 'F1', name: 'Draft 3.docx', mimeType: DOCX_MIME, sizeBytes: 2048 })
    expect(f.picker.dispose).toHaveBeenCalled()
  })

  it('adds a labelled view for Thunder Writer files when asked', () => {
    const f = fakePicker()
    void openPicker(f.ns, { ...OPTS, includeThunderFiles: true })
    expect(f.views).toHaveLength(3)
    expect(f.views[2].calls).toContainEqual(['setMimeTypes', 'application/json'])
    expect(f.views[2].calls).toContainEqual(['setLabel', 'Thunder Writer files'])
    expect(f.calls.filter(([m]) => m === 'addView')).toHaveLength(3)
  })

  it('resolves null on cancel and rejects on a Picker error', async () => {
    const f = fakePicker()
    const p = openPicker(f.ns, OPTS)
    f.respond({ action: 'cancel' })
    await expect(p).resolves.toBeNull()

    const g = fakePicker()
    const q = openPicker(g.ns, OPTS)
    g.respond({ action: 'error' })
    const err = await q.catch((e: unknown) => e)
    expect((err as DriveError).message).toMatch(/API key/)
  })
})
