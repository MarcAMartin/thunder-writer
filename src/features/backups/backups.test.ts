import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FORMAT, useDocuments } from '../../store/documents'
import type { ThunderDoc } from '../../types'
import { makeDoc } from '../storage/testDocs'

// In-memory stand-in for idb-keyval (fake-indexeddb is not installed).
const mem = vi.hoisted(() => ({ stores: new Map<string, Map<IDBValidKey, unknown>>(), fail: false }))
vi.mock('idb-keyval', () => {
  const bucket = (s: unknown) => {
    if (mem.fail) throw new Error('blocked')
    const name = s as string
    if (!mem.stores.has(name)) mem.stores.set(name, new Map())
    return mem.stores.get(name)!
  }
  return {
    createStore: (db: string, store: string) => `${db}/${store}`,
    get: async (k: IDBValidKey, s: unknown) => structuredClone(bucket(s).get(k)),
    getMany: async (ks: IDBValidKey[], s: unknown) => ks.map((k) => structuredClone(bucket(s).get(k))),
    setMany: async (es: [IDBValidKey, unknown][], s: unknown) => es.forEach(([k, v]) => bucket(s).set(k, structuredClone(v))),
    delMany: async (ks: IDBValidKey[], s: unknown) => ks.forEach((k) => bucket(s).delete(k)),
    keys: async (s: unknown) => [...bucket(s).keys()],
    clear: async (s: unknown) => bucket(s).clear(),
  }
})
const downloads = vi.hoisted(() => [] as { name: string; text: Promise<string> }[])
vi.mock('../export/saveToComputer', () => ({
  downloadBlob: (blob: Blob, name: string) => downloads.push({ name, text: blob.text() }),
}))

const {
  backUpDoc,
  createAutoBackup,
  downloadBackup,
  isUntouchedCopy,
  openBackupAsCopy,
  refreshBackups,
  safetyBackup,
  useBackups,
  AUTO_BACKUP_EVERY_MS,
} = await import('./backups')
const { backupsToPrune, RETENTION } = await import('./retention')
const idb = await import('./store')

const MIN = 60_000
const DAY = 86_400_000
const T0 = Date.UTC(2026, 8, 30, 12)
const words = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const blank = (): ThunderDoc => makeDoc({ id: 'blank', title: 'Untitled Manuscript', content: null, format: DEFAULT_FORMAT })

beforeEach(() => {
  mem.stores.clear()
  mem.fail = false
  downloads.length = 0
  useBackups.setState({ list: [], loaded: false, error: null, writeError: null })
  useDocuments.setState({ docs: {}, currentId: null, hydrated: true, dirtyForDrive: {} })
})

describe('backupsToPrune', () => {
  const meta = (id: string, savedAt: number, reason: 'auto' | 'manual' | 'before-delete' = 'auto', docId = 'd', docUpdatedAt = savedAt) => ({
    id,
    docId,
    title: 'Storm',
    savedAt,
    docUpdatedAt,
    words: 1,
    reason,
  })

  it('keeps a backup the writer made (Back up now) for 90 days, not just while it is among the newest', () => {
    const mine = meta('mine', T0 - 3 * 3600_000, 'manual')
    // Three hours of writing since: an automatic backup every 10 minutes.
    const autos = Array.from({ length: 18 }, (_, i) => meta(`a${i}`, T0 - i * 10 * MIN))
    expect(backupsToPrune([mine, ...autos], T0)).not.toContain('mine')
    expect(backupsToPrune([{ ...mine, savedAt: T0 - 91 * DAY, docUpdatedAt: T0 - 91 * DAY }, ...autos], T0)).toContain('mine')
  })

  it('keeps each day’s final text, even though it is saved by the next morning’s first edit', () => {
    const mondayLate = T0 - DAY + 5 * 3600_000 // Monday 17:00, the last words of the day
    const tuesday = Array.from({ length: 12 }, (_, i) => meta(`t${i}`, T0 - i * 10 * MIN))
    const endOfMonday = meta('end-of-monday', T0 - 3 * 3600_000, 'auto', 'd', mondayLate) // saved Tuesday 9:00
    const mondayEarlier = meta('monday-4pm', mondayLate - 3600_000)
    const doomed = backupsToPrune([...tuesday, endOfMonday, mondayEarlier], T0)
    expect(doomed).not.toContain('end-of-monday')
    expect(doomed).toContain('monday-4pm')
  })

  it('keeps the 10 newest, then the newest of each day for 30 days, per manuscript', () => {
    // 15 backups today (every 10 minutes), then one at 9:00 and one at 8:00 on each of the 40 days before.
    const today = Array.from({ length: 15 }, (_, i) => meta(`t${i}`, T0 - i * 10 * MIN))
    const older = Array.from({ length: 40 }, (_, d) => [meta(`d${d}a`, T0 - (d + 1) * DAY - 3 * 3600_000), meta(`d${d}b`, T0 - (d + 1) * DAY - 4 * 3600_000)]).flat()
    const doomed = new Set(backupsToPrune([...today, ...older], T0))
    expect(today.slice(0, RETENTION.keepRecent).every((m) => !doomed.has(m.id))).toBe(true)
    expect(today.slice(RETENTION.keepRecent).every((m) => doomed.has(m.id))).toBe(true)
    for (let d = 0; d < 40; d++) {
      const newestOfDay = older[2 * d]
      expect(doomed.has(`d${d}b`)).toBe(true) // the older one of the day
      expect(doomed.has(newestOfDay.id)).toBe(T0 - newestOfDay.savedAt > RETENTION.dailyForDays * DAY) // kept within 30 days
    }
    expect(doomed.has('d0a')).toBe(false)
    expect(doomed.has('d39a')).toBe(true)
  })

  it('keeps safety copies (before a delete or replace) for 90 days even when newer backups crowd them out', () => {
    const recent = Array.from({ length: 12 }, (_, i) => meta(`r${i}`, T0 - i * MIN))
    const safety = meta('s', T0 - 60 * DAY, 'before-delete')
    const tooOld = meta('old', T0 - 91 * DAY, 'before-delete')
    const doomed = backupsToPrune([...recent, safety, tooOld], T0)
    expect(doomed).not.toContain('s')
    expect(doomed).toContain('old')
  })

  it('treats each manuscript separately', () => {
    const a = Array.from({ length: 12 }, (_, i) => meta(`a${i}`, T0 - i * MIN, 'auto', 'A'))
    const b = [meta('b0', T0 - 1, 'auto', 'B')]
    const doomed = backupsToPrune([...a, ...b], T0)
    expect(doomed).toEqual(['a10', 'a11'])
  })
})

describe('backups in this browser', () => {
  it('keeps a backup (without its Drive link), lists it newest first and skips an identical one', async () => {
    const doc = makeDoc({ id: 'a', title: 'Storm', content: words('It began to rain hard.'), driveFileId: 'F', driveRevisionId: 'R1' })
    const first = await backUpDoc(doc, 'auto', T0)
    expect(first).toMatchObject({ docId: 'a', title: 'Storm', words: 5, reason: 'auto', savedAt: T0 })
    expect(await backUpDoc(doc, 'auto', T0 + MIN)).toBeNull() // same version
    const edited = { ...doc, updatedAt: doc.updatedAt + 1, content: words('It began.') }
    const second = await backUpDoc(edited, 'auto', T0 + 2 * MIN)
    expect(useBackups.getState().list.map((m) => m.id)).toEqual([second!.id, first!.id])
    // Stored, not just in memory; a reload lists the same.
    useBackups.setState({ list: [], loaded: false })
    await refreshBackups()
    expect(useBackups.getState().list.map((m) => m.id)).toEqual([second!.id, first!.id])
    const stored = await idb.readBackup(first!.id)
    expect(stored?.content).toEqual(doc.content)
    expect(stored?.driveFileId).toBeUndefined()
    expect(stored?.driveRevisionId).toBeUndefined()
  })

  it('a safety copy is kept even when an automatic backup already holds that version', async () => {
    const doc = makeDoc({ id: 'a' })
    await backUpDoc(doc, 'auto', T0)
    expect(await backUpDoc(doc, 'before-delete', T0 + 1)).toMatchObject({ reason: 'before-delete' })
  })

  it('prunes as it goes', async () => {
    const doc = makeDoc({ id: 'a' })
    for (let i = 0; i < 14; i++) await backUpDoc({ ...doc, updatedAt: i }, 'auto', T0 + i * MIN)
    expect(useBackups.getState().list).toHaveLength(RETENTION.keepRecent)
    expect((await idb.listBackups()).length).toBe(RETENTION.keepRecent)
  })

  it('opens a backup as a new manuscript, leaving the original alone', async () => {
    const original = makeDoc({ id: 'a', title: 'Storm', content: words('Now.'), driveFileId: 'F' })
    useDocuments.getState().hydrate([original], 'a')
    const meta = (await backUpDoc({ ...original, content: words('Earlier.') }, 'manual', T0))!
    const copy = await openBackupAsCopy(meta)
    const s = useDocuments.getState()
    expect(copy.id).not.toBe('a')
    expect(s.currentId).toBe(copy.id)
    expect(copy.title).toMatch(/^Storm \(backup .+\)$/)
    expect(copy.content).toEqual(words('Earlier.'))
    expect(copy.driveFileId).toBeUndefined()
    expect(s.docs.a).toBe(original)
  })

  it('downloads a backup as a .thunder.json file that imports again', async () => {
    const meta = (await backUpDoc(makeDoc({ id: 'a', title: 'Storm: Part 1' }), 'manual', T0))!
    await downloadBackup(meta)
    expect(downloads).toHaveLength(1)
    expect(downloads[0].name).toMatch(/^Storm Part 1 \(backup .+\)\.thunder\.json$/)
    expect(JSON.parse(await downloads[0].text)).toMatchObject({ app: 'thunder-writer', version: 1, doc: { id: 'a', title: 'Storm: Part 1' } })
  })

  it('a safety copy says whether it was kept, never throws, and skips a blank manuscript', async () => {
    await expect(safetyBackup(blank(), 'before-delete')).resolves.toBe(true)
    expect(await idb.listBackups()).toEqual([])
    await expect(safetyBackup(makeDoc(), 'before-delete')).resolves.toBe(true)
    mem.fail = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(safetyBackup(makeDoc({ updatedAt: 99 }), 'before-delete')).resolves.toBe(false)
    expect(warn).toHaveBeenCalled()
    expect(useBackups.getState().writeError).toMatch(/couldn’t be saved/)
    warn.mockRestore()
  })

  it('a safety copy that hangs counts as failed, so the action it guards isn’t stuck', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const spy = vi.spyOn(idb, 'writeBackup').mockImplementation(
      (doc, reason, now) =>
        new Promise((resolve) => {
          release = () => resolve({ id: 'late', docId: doc.id, title: doc.title, savedAt: now ?? 0, docUpdatedAt: doc.updatedAt, words: 0, reason })
        }),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    useBackups.setState({ loaded: true })
    const result = safetyBackup(makeDoc(), 'before-delete')
    await vi.advanceTimersByTimeAsync(5000)
    await expect(result).resolves.toBe(false)
    // Meanwhile, a later backup isn't held up for good by the stuck one.
    spy.mockRestore()
    const later = backUpDoc(makeDoc({ id: 'other' }), 'manual', T0)
    await vi.advanceTimersByTimeAsync(16_000)
    await expect(later).resolves.toMatchObject({ docId: 'other' })
    release()
    warn.mockRestore()
    vi.useRealTimers()
  })

  it('a copy opened from a backup counts as untouched (not uploaded to Drive) until it is edited', async () => {
    const meta = (await backUpDoc(makeDoc({ id: 'a' }), 'manual', T0))!
    const copy = await openBackupAsCopy(meta)
    expect(isUntouchedCopy(copy.id)).toBe(true)
    expect(useDocuments.getState().dirtyForDrive[copy.id]).toBeUndefined()
    const before = useDocuments.getState()
    useDocuments.getState().updateContent(copy.id, words('An edit.'))
    createAutoBackup().observe(before, useDocuments.getState())
    expect(isUntouchedCopy(copy.id)).toBe(false)
  })

  it('reports when this browser can’t keep backups', async () => {
    mem.fail = true
    await refreshBackups()
    expect(useBackups.getState().error).toMatch(/private window/)
  })
})

describe('original files (File › Open from computer)', () => {
  it('keeps the file byte for byte, downloads it exactly as it was, and opens it as a copy', async () => {
    const { backUpOriginalFile } = await import('./backups')
    const doc = makeDoc({ id: 'a', title: 'Storm', content: words('Old words here.') })
    useDocuments.getState().hydrate([doc], 'a')
    const original = new File(['# Storm\n\nThe file’s own words.'], 'Storm.md', { type: 'text/markdown', lastModified: T0 - DAY })
    await expect(backUpOriginalFile(doc, original, T0)).resolves.toBe(true)
    const [meta] = useBackups.getState().list
    expect(meta).toMatchObject({
      docId: 'a',
      reason: 'original-file',
      file: { name: 'Storm.md', type: 'text/markdown', size: original.size },
      docUpdatedAt: T0 - DAY,
    })

    await downloadBackup(meta)
    expect(downloads[0].name).toBe('Storm.md')
    expect(await downloads[0].text).toBe(await original.text())

    const copy = await openBackupAsCopy(meta)
    expect(JSON.stringify(copy.content)).toContain('The file’s own words.')
    expect(useDocuments.getState().docs.a).toBe(doc)
  })

  it('reports when the file couldn’t be kept', async () => {
    const { backUpOriginalFile } = await import('./backups')
    mem.fail = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(backUpOriginalFile(makeDoc(), new File(['x'], 'x.txt'), T0)).resolves.toBe(false)
    expect(useBackups.getState().writeError).toMatch(/couldn’t be saved/)
    warn.mockRestore()
  })
})

describe('automatic backups while writing', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('backs up the version before the first edit of the session, then at most every 10 minutes', async () => {
    let now = T0
    const auto = createAutoBackup({ now: () => now })
    const v1 = makeDoc({ id: 'a', content: words('One.'), updatedAt: 1 })
    const v2 = { ...v1, content: words('One two.'), updatedAt: 2 }
    const v3 = { ...v1, content: words('One two three.'), updatedAt: 3 }
    const v4 = { ...v1, content: words('One two three four.'), updatedAt: 4 }
    auto.observe({ docs: { a: v1 } }, { docs: { a: v2 } })
    await flush()
    now += 5 * MIN
    auto.observe({ docs: { a: v2 } }, { docs: { a: v3 } })
    await flush()
    now += AUTO_BACKUP_EVERY_MS
    auto.observe({ docs: { a: v3 } }, { docs: { a: v4 } })
    await vi.waitFor(async () => expect(await idb.listBackups()).toHaveLength(2))
    const kept = await idb.listBackups()
    expect(await Promise.all(kept.map(async (m) => (await idb.readBackup(m.id))?.content))).toEqual([v3.content, v1.content])
  })

  it('ignores Drive sync bookkeeping, new manuscripts and blank ones', async () => {
    const auto = createAutoBackup({ now: () => T0 })
    const doc = makeDoc({ id: 'a', updatedAt: 1 })
    auto.observe({ docs: { a: doc } }, { docs: { a: { ...doc, driveFileId: 'F', driveSyncedAt: 1 } } })
    auto.observe({ docs: {} }, { docs: { a: doc } })
    const b = blank()
    auto.observe({ docs: { blank: b } }, { docs: { blank: { ...b, content: words('Hi'), updatedAt: b.updatedAt + 1 } } })
    await flush()
    await flush()
    expect(await idb.listBackups()).toEqual([])
  })
})
