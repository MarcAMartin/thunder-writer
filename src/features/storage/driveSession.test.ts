import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocuments } from '../../store/documents'
import type { ThunderDoc } from '../../types'
import type { BackupReason } from '../backups/retention'
import { DriveError } from './drive'
import { makeDoc } from './testDocs'

const kept = vi.hoisted(() => ({ backups: [] as { doc: ThunderDoc; reason: BackupReason }[] }))
vi.mock('../backups/backups', () => ({
  safetyBackup: vi.fn(async (doc: ThunderDoc | undefined, reason: BackupReason) => {
    if (doc) kept.backups.push({ doc, reason })
  }),
}))

const { autosaveDocs, driveClient, keepBothVersions, keepThisBrowsersVersion, openDownloadedDoc, saveDocToDrive, useStorageStatus } =
  await import('./driveSession')

let fileNo = 0
/** A Drive file id no earlier test has saved, so its first save in this "session" backs it up. */
const freshFile = () => `F${++fileNo}`

beforeEach(() => {
  kept.backups.length = 0
  // Every save keeps Drive's copy as a .bak first (tested below); stub it for the other tests.
  vi.spyOn(driveClient, 'backupDocFile').mockResolvedValue(undefined)
  useDocuments.setState({ docs: {}, currentId: null, hydrated: true, dirtyForDrive: {} })
  useStorageStatus.setState({
    drive: 'idle',
    driveError: null,
    driveConnected: true,
    driveNeedsReconnect: false,
    driveConflicts: {},
    driveSavedAt: {},
  })
})
afterEach(() => vi.restoreAllMocks())

describe('autosaveDocs', () => {
  it('records the new Drive revision so the next save can detect changes made elsewhere', async () => {
    useDocuments.getState().hydrate([makeDoc({ id: 'a', driveFileId: 'F', updatedAt: 5 })], 'a')
    vi.spyOn(driveClient, 'saveDoc').mockResolvedValue({ id: 'F', revisionId: 'R2' })
    await autosaveDocs(['a'])
    expect(useDocuments.getState().docs.a).toMatchObject({ driveFileId: 'F', driveSyncedAt: 5, driveRevisionId: 'R2' })
    expect(useStorageStatus.getState().drive).toBe('saved')
  })

  it('pauses only the conflicted doc, keeps saving the others, and skips it next time', async () => {
    useDocuments.getState().hydrate(
      [makeDoc({ id: 'a', driveFileId: 'FA', driveRevisionId: 'R1' }), makeDoc({ id: 'b', driveFileId: 'FB' })],
      'a',
    )
    const save = vi.spyOn(driveClient, 'saveDoc').mockImplementation(async (d) => {
      if (d.id === 'a') throw new DriveError('conflict', 'changed elsewhere')
      return { id: 'FB', revisionId: 'RB' }
    })
    const err = await autosaveDocs(['a', 'b']).catch((e: unknown) => e)
    expect((err as DriveError).code).toBe('conflict')
    expect(useStorageStatus.getState().driveConflicts).toEqual({ a: true })
    expect(useStorageStatus.getState().drive).not.toBe('error')
    expect(useDocuments.getState().docs.b.driveRevisionId).toBe('RB')

    save.mockClear()
    await autosaveDocs(['a', 'b'])
    expect(save.mock.calls.map(([d]) => d.id)).toEqual(['b'])
  })

  it('flags an expired background token as "reconnect"', async () => {
    useDocuments.getState().hydrate([makeDoc({ id: 'a', driveFileId: 'F' })], 'a')
    vi.spyOn(driveClient, 'saveDoc').mockRejectedValue(new DriveError('auth', 'Reconnect Drive to keep autosaving.'))
    await autosaveDocs(['a']).catch(() => undefined)
    expect(useStorageStatus.getState()).toMatchObject({ drive: 'error', driveNeedsReconnect: true })
  })
})

describe('resolving two versions', () => {
  const local = makeDoc({ id: 'a', title: 'Storm', driveFileId: 'F', driveSyncedAt: 1, driveRevisionId: 'R1', updatedAt: 1000 })
  const remote = makeDoc({ id: 'a', title: 'Storm', driveFileId: 'F', driveRevisionId: 'R9', updatedAt: 1500, content: { type: 'doc', content: [] } })

  it('"keep both" keeps the local edits as their own unlinked manuscript and links the Drive copy', () => {
    useDocuments.getState().hydrate([local], 'a')
    useStorageStatus.setState({ driveConflicts: { a: true } })
    const opened = keepBothVersions('a', remote)
    const s = useDocuments.getState()
    expect(opened).not.toBe('a')
    expect(s.currentId).toBe(opened)
    expect(s.docs.a.title).toBe('Storm (this browser)')
    expect(s.docs.a.content).toEqual(local.content)
    expect(s.docs.a.driveFileId).toBeUndefined()
    expect(s.dirtyForDrive.a).toBe(true)
    expect(s.docs[opened]).toMatchObject({ driveFileId: 'F', driveRevisionId: 'R9', content: remote.content })
    expect(useStorageStatus.getState().driveConflicts).toEqual({})
  })

  it('"use the Drive version" keeps this browser’s copy as a backup, then replaces it and clears the conflict', async () => {
    useDocuments.getState().hydrate([local], 'a')
    useStorageStatus.setState({ driveConflicts: { a: true } })
    await openDownloadedDoc(remote)
    expect(kept.backups).toEqual([{ doc: local, reason: 'before-drive-version' }])
    expect(useDocuments.getState().docs.a).toMatchObject({ content: remote.content, driveRevisionId: 'R9', driveSyncedAt: 1500 })
    expect(useStorageStatus.getState().driveConflicts).toEqual({})
  })

  it('opening a Drive copy identical to this browser’s takes no backup', async () => {
    useDocuments.getState().hydrate([{ ...local, updatedAt: 1500 }], 'a')
    await openDownloadedDoc(remote)
    expect(kept.backups).toEqual([])
  })

  it('"keep this browser’s version" keeps the Drive version as a backup here and a .bak in Drive before overwriting it', async () => {
    const fileId = freshFile()
    useDocuments.getState().hydrate([{ ...local, driveFileId: fileId }], 'a')
    const order: string[] = []
    vi.mocked(driveClient.backupDocFile).mockImplementation(async () => void order.push('bak'))
    vi.spyOn(driveClient, 'saveDoc').mockImplementation(async (_d, opts) => {
      order.push(opts?.force ? 'force-save' : 'save')
      return { id: fileId, revisionId: 'R10' }
    })
    await keepThisBrowsersVersion('a', { ...remote, driveFileId: fileId })
    expect(order).toEqual(['bak', 'force-save'])
    expect(kept.backups.map((b) => [b.reason, b.doc.id, b.doc.content])).toEqual([['drive-version-replaced', 'a', remote.content]])
  })
})

describe('Drive .bak files', () => {
  it('keeps Drive’s copy as a .bak before the first overwrite of each manuscript this session, not on every save', async () => {
    const fileId = freshFile()
    useDocuments.getState().hydrate([makeDoc({ id: 'a', driveFileId: fileId })], 'a')
    vi.spyOn(driveClient, 'saveDoc').mockResolvedValue({ id: fileId, revisionId: 'R2' })
    await autosaveDocs(['a'])
    await autosaveDocs(['a'])
    expect(vi.mocked(driveClient.backupDocFile).mock.calls).toEqual([[fileId]])
  })

  it('always keeps a .bak before a forced overwrite (a version saved elsewhere)', async () => {
    const fileId = freshFile()
    useDocuments.getState().hydrate([makeDoc({ id: 'a', driveFileId: fileId })], 'a')
    vi.spyOn(driveClient, 'saveDoc').mockResolvedValue({ id: fileId })
    await autosaveDocs(['a'])
    await saveDocToDrive('a', { force: true })
    expect(vi.mocked(driveClient.backupDocFile)).toHaveBeenCalledTimes(2)
  })

  it('never overwrites without the .bak: if keeping it fails, the save fails and is retried later', async () => {
    const fileId = freshFile()
    useDocuments.getState().hydrate([makeDoc({ id: 'a', driveFileId: fileId })], 'a')
    vi.mocked(driveClient.backupDocFile).mockRejectedValueOnce(new DriveError('network', 'Could not reach Google Drive.'))
    const save = vi.spyOn(driveClient, 'saveDoc').mockResolvedValue({ id: fileId })
    await expect(autosaveDocs(['a'])).rejects.toMatchObject({ code: 'network' })
    expect(save).not.toHaveBeenCalled()
    expect(useStorageStatus.getState().drive).toBe('error')
    // Next attempt backs up (it didn't count) and then saves.
    await autosaveDocs(['a'])
    expect(vi.mocked(driveClient.backupDocFile)).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('a manuscript not yet in Drive has nothing to back up', async () => {
    useDocuments.getState().hydrate([makeDoc({ id: 'a' })], 'a')
    vi.spyOn(driveClient, 'saveDoc').mockResolvedValue({ id: 'NEW' })
    await autosaveDocs(['a'])
    expect(driveClient.backupDocFile).not.toHaveBeenCalled()
  })
})
