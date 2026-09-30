import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mem = vi.hoisted(() => new Map<IDBValidKey, unknown>())
vi.mock('idb-keyval', () => ({
  createStore: () => 'store',
  get: async (k: IDBValidKey) => mem.get(k),
  set: async (k: IDBValidKey, v: unknown) => void mem.set(k, v),
  del: async (k: IDBValidKey) => void mem.delete(k),
}))

import { registerPendingFlush } from '../../store/pendingEdits'
import { useDocuments } from '../../store/documents'
import { __resetDesktopCopyForTests, getDesktopCopyStatus, restoreDesktopCopy, setUpDesktopCopy, startDesktopCopyService } from './desktopCopy'
import { useExportUi } from './exportUi'
import { ExportHost } from './ExportHost'
import { makeExportDoc, p, t } from './testFixtures'
import { isSaveShortcut, useSaveShortcut } from './useSaveShortcut'

type Win = { showSaveFilePicker?: unknown }

function Harness() {
  useSaveShortcut()
  return <textarea aria-label="editor" />
}

function fakeFile(name = 'My Novel.txt') {
  const written: string[] = []
  let permission: PermissionState = 'granted'
  const raw = {
    kind: 'file',
    name,
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => (permission = 'granted')),
    createWritable: vi.fn(async () => {
      let buf = ''
      return { write: async (b: Blob) => void (buf = await b.text()), close: async () => void written.push(buf), abort: async () => undefined }
    }),
  }
  return { handle: raw as unknown as FileSystemFileHandle, raw, written, setPermission: (s: PermissionState) => (permission = s) }
}

const press = (target: Element | Window, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key: 's', code: 'KeyS', metaKey: true, ...init })

let stopService: () => void
beforeEach(() => {
  mem.clear()
  __resetDesktopCopyForTests()
  stopService = startDesktopCopyService()
  useExportUi.setState({ toast: null, chooserOpen: false, chooserNote: null, chooserDismissed: false })
  const doc = makeExportDoc([p(t('It began.'))], { id: 'd1' })
  useDocuments.getState().hydrate([doc], doc.id)
})
afterEach(() => {
  stopService()
  __resetDesktopCopyForTests()
  delete (window as Win).showSaveFilePicker
})

describe('isSaveShortcut', () => {
  it('matches Cmd+S and Ctrl+S (any layout), not Alt combos', () => {
    const k = (o: Partial<KeyboardEvent>) => ({ key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, ...o })
    expect(isSaveShortcut(k({ key: 's', metaKey: true }))).toBe(true)
    expect(isSaveShortcut(k({ key: 'S', ctrlKey: true }))).toBe(true)
    expect(isSaveShortcut(k({ key: 'ы', code: 'KeyS', ctrlKey: true }))).toBe(true)
    expect(isSaveShortcut(k({ key: 's' }))).toBe(false)
    expect(isSaveShortcut(k({ key: 's', ctrlKey: true, altKey: true }))).toBe(false)
    expect(isSaveShortcut(k({ key: 'd', metaKey: true }))).toBe(false)
  })
})

describe('useSaveShortcut', () => {
  it('prevents the browser’s “Save page” dialog, even from inside the editor', () => {
    render(<Harness />)
    expect(press(screen.getByLabelText('editor'))).toBe(false) // false = defaultPrevented
    expect(press(window, { metaKey: false, ctrlKey: true })).toBe(false)
    expect(fireEvent.keyDown(window, { key: 'd', metaKey: true })).toBe(true)
  })

  it('opens “Save to computer” when there is no desktop copy, then just reassures once dismissed', async () => {
    render(<Harness />)
    press(window)
    await waitFor(() => expect(useExportUi.getState().chooserOpen).toBe(true))
    act(() => useExportUi.getState().closeChooser())
    press(window)
    await waitFor(() => expect(useExportUi.getState().toast?.text).toMatch(/^Saved in your browser\. Press (⌘|Ctrl\+)⇧S/))
    expect(useExportUi.getState().chooserOpen).toBe(false)
    press(window, { shiftKey: true })
    await waitFor(() => expect(useExportUi.getState().chooserOpen).toBe(true))
  })

  it('pushes the editor’s pending keystrokes into the store first', async () => {
    const flush = vi.fn()
    const unregister = registerPendingFlush(flush)
    render(<Harness />)
    press(window)
    expect(flush).toHaveBeenCalled()
    unregister()
  })

  it('writes the desktop copy now and confirms it', async () => {
    const f = fakeFile()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    await setUpDesktopCopy('d1', 'txt')
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('Just typed.'))] })
    render(<Harness />)
    press(window)
    await waitFor(() => expect(useExportUi.getState().toast?.text).toBe('Saved in your browser · copy written to My Novel.txt'))
    expect(f.written.at(-1)).toBe('Just typed.\n')
    press(window)
    await waitFor(() => expect(useExportUi.getState().toast?.text).toBe('Saved in your browser · My Novel.txt is up to date'))
    expect(useExportUi.getState().chooserOpen).toBe(false)
  })

  it('ignores key repeat', async () => {
    const f = fakeFile()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    await setUpDesktopCopy('d1', 'txt')
    useDocuments.getState().updateContent('d1', { type: 'doc', content: [p(t('Again.'))] })
    render(<Harness />)
    expect(press(window, { repeat: true })).toBe(false)
    await new Promise((r) => setTimeout(r, 10))
    expect(f.written).toHaveLength(1)
  })

  it('asks for permission again after a reload, from the key press', async () => {
    const f = fakeFile()
    ;(window as Win).showSaveFilePicker = vi.fn(async () => f.handle)
    await setUpDesktopCopy('d1', 'txt')
    __resetDesktopCopyForTests()
    f.setPermission('prompt')
    await restoreDesktopCopy('d1')
    expect(getDesktopCopyStatus('d1')?.phase).toBe('needs-permission')
    render(<Harness />)
    press(window)
    expect(f.raw.requestPermission).toHaveBeenCalledTimes(1) // synchronously, inside the key press
    await waitFor(() => expect(useExportUi.getState().toast?.text).toBe('Saved in your browser · copy written to My Novel.txt'))
  })
})

describe('ExportHost', () => {
  it('Cmd+S opens the dialog; Escape closes it and restores focus', async () => {
    render(
      <>
        <button type="button">before</button>
        <ExportHost />
      </>,
    )
    const before = screen.getByRole('button', { name: 'before' })
    before.focus()
    press(window)
    const dialog = await screen.findByRole('dialog', { name: 'Save to your computer' })
    // No File System Access API in jsdom: the explanation and a manual download are offered.
    expect(dialog).toHaveTextContent('Chrome and Microsoft Edge can')
    expect(screen.getByRole('button', { name: 'Download a Word copy now' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Word document \(\.docx\)/ })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.activeElement).toBe(before)
  })

  it('offers the desktop copy set-up where supported, with Word as the default format', async () => {
    ;(window as Win).showSaveFilePicker = vi.fn()
    render(<ExportHost />)
    press(window)
    await screen.findByRole('dialog')
    expect(screen.getByRole('radio', { name: /Word/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Choose where to save…' })).toHaveFocus()
  })

  it('shows the toast in a live region', async () => {
    render(<ExportHost />)
    act(() => void useExportUi.getState().showToast('Saved in your browser · copy written to My Novel.docx'))
    expect(await screen.findByRole('status')).toHaveTextContent('copy written to My Novel.docx')
  })
})
