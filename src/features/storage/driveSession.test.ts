import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocuments } from '../../store/documents'
import { DriveError } from './drive'
import { autosaveDocs, driveClient, keepBothVersions, openDownloadedDoc, useStorageStatus } from './driveSession'
import { makeDoc } from './testDocs'

beforeEach(() => {
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

  it('"use the Drive version" replaces the local copy and clears the conflict', () => {
    useDocuments.getState().hydrate([local], 'a')
    useStorageStatus.setState({ driveConflicts: { a: true } })
    openDownloadedDoc(remote)
    expect(useDocuments.getState().docs.a).toMatchObject({ content: remote.content, driveRevisionId: 'R9', driveSyncedAt: 1500 })
    expect(useStorageStatus.getState().driveConflicts).toEqual({})
  })
})
