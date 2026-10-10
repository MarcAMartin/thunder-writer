import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocuments } from '../../store/documents'
import { makeDoc } from '../storage/testDocs'
import { ExportToast } from '../export/ExportHost'
import { useExportUi } from '../export/exportUi'

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
    getMany: async (ks: IDBValidKey[], s: unknown) => ks.map((k) => structuredClone(bucket(s).get(k))),
    setMany: async (es: [IDBValidKey, unknown][], s: unknown) => es.forEach(([k, v]) => bucket(s).set(k, structuredClone(v))),
    delMany: async (ks: IDBValidKey[], s: unknown) => ks.forEach((k) => bucket(s).delete(k)),
    keys: async (s: unknown) => [...bucket(s).keys()],
    clear: async (s: unknown) => bucket(s).clear(),
  }
})

const { BackupsMenu } = await import('./BackupsMenu')
const { backUpDoc, useBackups } = await import('./backups')

const words = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const T0 = Date.UTC(2026, 8, 30, 15, 40)

beforeEach(async () => {
  mem.clear()
  useExportUi.setState({ toast: null })
  useBackups.setState({ list: [], loaded: false, error: null, writeError: null })
  const storm = makeDoc({ id: 'a', title: 'The Long Storm', content: words('Now it rains.'), updatedAt: 50 })
  useDocuments.setState({ docs: { a: storm, b: makeDoc({ id: 'b', title: 'Other Book' }) }, currentId: 'a', hydrated: true, dirtyForDrive: {} })
  await backUpDoc({ ...storm, content: words('It began to rain.'), updatedAt: 10 }, 'auto', T0 - 3600_000)
  await backUpDoc({ ...storm, content: words('Rain.'), updatedAt: 20 }, 'before-drive-version', T0)
  await backUpDoc(makeDoc({ id: 'b', title: 'Other Book' }), 'auto', T0)
  await backUpDoc(makeDoc({ id: 'gone', title: 'Deleted Novella', content: words('Short.') }), 'before-delete', T0)
})

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /^backups/i }))
  return screen.findByRole('menu', { name: /^Backups of / })
}

describe('BackupsMenu', () => {
  it('lists the open manuscript’s backups, newest first, with words and why each was kept', async () => {
    const user = userEvent.setup()
    render(<><BackupsMenu /><ExportToast /></>)
    const menu = await openMenu(user)
    expect(menu).toHaveAccessibleName('Backups of The Long Storm')
    const items = await within(menu).findAllByRole('menuitem', { description: /\bwords?\b/ })
    expect(items).toHaveLength(2)
    // Named by the time alone; words, why it was kept and what choosing it does are the description.
    expect(items[0]).toHaveAccessibleName(/^[A-Z][a-z]{2} \d{1,2}, 2026, \d{1,2}:\d{2}/)
    expect(items[0]).toHaveAccessibleDescription(
      '1 word · Before the Google Drive version replaced it Choosing a backup opens it as a new manuscript; this one isn’t changed.',
    )
    expect(items[1]).toHaveAccessibleDescription(/^4 words · Automatic/)
    expect(menu).not.toHaveTextContent('Other Book')
    expect(items[0]).toHaveFocus()
  })

  it('choosing a backup opens it as a new manuscript and leaves this one as it is', async () => {
    const user = userEvent.setup()
    const before = useDocuments.getState().docs.a
    render(<><BackupsMenu /><ExportToast /></>)
    const menu = await openMenu(user)
    const items = await within(menu).findAllByRole('menuitem', { description: /\bwords?\b/ })
    await user.click(items[1])
    await vi.waitFor(() => expect(useDocuments.getState().currentId).not.toBe('a'))
    const s = useDocuments.getState()
    expect(s.docs[s.currentId!]).toMatchObject({ title: expect.stringMatching(/^The Long Storm \(backup /), content: words('It began to rain.') })
    expect(s.docs.a).toBe(before)
    expect(await screen.findByText(/Opened the backup from .* as “The Long Storm \(backup /)).toBeInTheDocument()
  })

  it('Undo closes an untouched copy and goes back; an edited copy is kept', async () => {
    const user = userEvent.setup()
    render(<><BackupsMenu /><ExportToast /></>)
    let menu = await openMenu(user)
    await user.click((await within(menu).findAllByRole('menuitem', { description: /\bwords?\b/ }))[0])
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Closed the copy.')).toBeInTheDocument()
    expect(useDocuments.getState().currentId).toBe('a')
    expect(Object.keys(useDocuments.getState().docs).sort()).toEqual(['a', 'b'])

    menu = await openMenu(user)
    await user.click((await within(menu).findAllByRole('menuitem', { description: /\bwords?\b/ }))[0])
    const copyId = useDocuments.getState().currentId!
    const { createAutoBackup } = await import('./backups')
    const before = useDocuments.getState()
    useDocuments.getState().updateTitle(copyId, 'Keeping this one')
    createAutoBackup().observe(before, useDocuments.getState()) // what StorageProvider does on every edit
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('The copy has been edited, so it was kept.')).toBeInTheDocument()
    expect(useDocuments.getState().docs[copyId].title).toBe('Keeping this one')
  })

  it('says when the latest backup couldn’t be saved', async () => {
    useBackups.setState({ writeError: 'The latest backup couldn’t be saved in this browser (its storage may be full).' })
    const user = userEvent.setup()
    render(<><BackupsMenu /><ExportToast /></>)
    const menu = await openMenu(user)
    expect(await within(menu).findByRole('menuitem', { name: /latest backup couldn’t be saved/ })).toHaveAttribute('aria-disabled', 'true')
  })

  it('"Back up now" keeps the current version', async () => {
    const user = userEvent.setup()
    render(<><BackupsMenu /><ExportToast /></>)
    const menu = await openMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Back up now' }))
    expect(await screen.findByText('Backed up “The Long Storm”.')).toBeInTheDocument()
    expect(useBackups.getState().list[0]).toMatchObject({ docId: 'a', reason: 'manual', words: 3 })
  })

  it('says so when the manuscript has no backups yet', async () => {
    useDocuments.setState({ currentId: 'fresh', docs: { fresh: makeDoc({ id: 'fresh', title: 'Book Three' }) } })
    const user = userEvent.setup()
    render(<><BackupsMenu /><ExportToast /></>)
    const menu = await openMenu(user)
    // Focused first, so a screen reader hears it too; it can't be chosen.
    const none = await within(menu).findByRole('menuitem', { name: /No backups of this manuscript yet/ })
    expect(none).toHaveAttribute('aria-disabled', 'true')
    await vi.waitFor(() => expect(none).toHaveFocus())
  })

  it('"All backups…" lists every manuscript’s, including deleted ones, and opens a copy', async () => {
    const user = userEvent.setup()
    render(<><BackupsMenu /><ExportToast /></>)
    const menu = await openMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: /All backups/ }))
    const dialog = await screen.findByRole('dialog', { name: 'All backups' })
    const deleted = within(dialog).getByRole('region', { name: 'Backups of Deleted Novella' })
    expect(deleted).toHaveTextContent('(deleted)')
    expect(deleted).toHaveTextContent('Before it was deleted')
    expect(within(dialog).getByRole('region', { name: 'Backups of The Long Storm' })).toBeInTheDocument()
    await user.click(within(deleted).getByRole('button', { name: /^Open copy of the backup from .* of Deleted Novella$/ }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const s = useDocuments.getState()
    expect(s.docs[s.currentId!]).toMatchObject({ title: expect.stringMatching(/^Deleted Novella \(backup /), content: words('Short.') })
  })
})
