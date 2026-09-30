import { create } from 'zustand'
import type { DocFormat, ThunderDoc } from '../types'

/**
 * In-memory document state. Persistence (browser IndexedDB + Google Drive) is
 * owned by features/storage, which hydrates this store and subscribes to it.
 */
export interface DocumentsState {
  /** All docs known locally, keyed by id (metadata + content). */
  docs: Record<string, ThunderDoc>
  currentId: string | null
  /** True once storage has loaded local docs into the store. */
  hydrated: boolean
  /** Doc ids with edits not yet written to Drive. */
  dirtyForDrive: Record<string, true>

  hydrate: (docs: ThunderDoc[], currentId: string | null) => void
  upsertDoc: (doc: ThunderDoc) => void
  createDoc: (partial?: Partial<Pick<ThunderDoc, 'title' | 'content' | 'format'>>) => ThunderDoc
  openDoc: (id: string) => void
  updateContent: (id: string, content: unknown) => void
  updateTitle: (id: string, title: string) => void
  updateFormat: (id: string, patch: Partial<DocFormat>) => void
  /** Records a successful Drive sync of the snapshot taken at `at` (revisionId: Drive's headRevisionId after it). */
  markDriveSynced: (id: string, driveFileId: string, at: number, revisionId?: string) => void
  deleteDoc: (id: string) => void
}

export const DEFAULT_FORMAT: DocFormat = { presetId: 'trade-6x9', chapterStartsNewPage: true }

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export const useDocuments = create<DocumentsState>()((set, get) => ({
  docs: {},
  currentId: null,
  hydrated: false,
  dirtyForDrive: {},

  hydrate: (docs, currentId) =>
    set({ docs: Object.fromEntries(docs.map((d) => [d.id, d])), currentId, hydrated: true }),
  upsertDoc: (doc) => set((s) => ({ docs: { ...s.docs, [doc.id]: doc } })),
  createDoc: (partial) => {
    const now = Date.now()
    const doc: ThunderDoc = {
      id: newId(),
      title: partial?.title ?? 'Untitled Manuscript',
      content: partial?.content ?? null,
      format: partial?.format ?? DEFAULT_FORMAT,
      createdAt: now,
      updatedAt: now,
    }
    set((s) => ({ docs: { ...s.docs, [doc.id]: doc }, currentId: doc.id }))
    return doc
  },
  openDoc: (id) => {
    if (get().docs[id]) set({ currentId: id })
  },
  updateContent: (id, content) => touch(set, id, { content }),
  updateTitle: (id, title) => touch(set, id, { title }),
  updateFormat: (id, patch) =>
    set((s) => {
      const d = s.docs[id]
      if (!d) return s
      return {
        docs: { ...s.docs, [id]: { ...d, format: { ...d.format, ...patch }, updatedAt: Date.now() } },
        dirtyForDrive: { ...s.dirtyForDrive, [id]: true },
      }
    }),
  markDriveSynced: (id, driveFileId, at, revisionId) =>
    set((s) => {
      const d = s.docs[id]
      if (!d) return s
      const dirty = { ...s.dirtyForDrive }
      // Only clear dirty if nothing changed after the snapshot that was synced.
      if (d.updatedAt <= at) delete dirty[id]
      const next: ThunderDoc = { ...d, driveFileId, driveSyncedAt: at }
      if (revisionId) next.driveRevisionId = revisionId
      else delete next.driveRevisionId
      return { docs: { ...s.docs, [id]: next }, dirtyForDrive: dirty }
    }),
  deleteDoc: (id) =>
    set((s) => {
      const docs = { ...s.docs }
      delete docs[id]
      const dirty = { ...s.dirtyForDrive }
      delete dirty[id]
      return { docs, dirtyForDrive: dirty, currentId: s.currentId === id ? null : s.currentId }
    }),
}))

function touch(
  set: (fn: (s: DocumentsState) => Partial<DocumentsState> | DocumentsState) => void,
  id: string,
  patch: Partial<ThunderDoc>,
) {
  set((s) => {
    const d = s.docs[id]
    if (!d) return s
    return {
      docs: { ...s.docs, [id]: { ...d, ...patch, updatedAt: Date.now() } },
      dirtyForDrive: { ...s.dirtyForDrive, [id]: true },
    }
  })
}

export const currentDoc = (s: Pick<DocumentsState, 'docs' | 'currentId'>) =>
  (s.currentId ? s.docs[s.currentId] : undefined) ?? null
