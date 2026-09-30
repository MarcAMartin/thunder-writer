import type { DocumentsState } from '../../store/documents'
import type { ThunderDoc } from '../../types'

/**
 * Keeps several open Thunder Writer tabs in agreement. Each tab holds its own
 * in-memory copy of every doc and writes whole docs to IndexedDB, so without
 * coordination the last tab to save would silently replace the other's words
 * (and upload its stale copy to Drive). After every IndexedDB write a tab
 * broadcasts the docs it wrote; the others adopt any copy newer than theirs,
 * so all tabs converge on the latest version and the open editor shows it.
 */

export const CHANNEL_NAME = 'thunder-writer:docs'

export interface DocsMessage {
  type: 'docs'
  saved: ThunderDoc[]
  deleted: string[]
}

export interface ChannelLike {
  postMessage(msg: unknown): void
  close(): void
  onmessage: ((ev: MessageEvent) => void) | null
}

const isDocsMessage = (v: unknown): v is DocsMessage =>
  typeof v === 'object' &&
  v !== null &&
  (v as DocsMessage).type === 'docs' &&
  Array.isArray((v as DocsMessage).saved) &&
  Array.isArray((v as DocsMessage).deleted)

/** Is `incoming` a newer copy than `current` (content, or Drive sync bookkeeping)? */
export function isNewerCopy(incoming: ThunderDoc, current: ThunderDoc | undefined): boolean {
  if (!current) return true
  if (incoming.updatedAt !== current.updatedAt) return incoming.updatedAt > current.updatedAt
  return (incoming.driveSyncedAt ?? 0) > (current.driveSyncedAt ?? 0)
}

export interface RemoteApply {
  patch: Pick<DocumentsState, 'docs' | 'dirtyForDrive' | 'currentId'>
  /** Doc ids now holding another tab's version (that tab owns their Drive upload). */
  taken: string[]
}

/** Pure: the store update for a message from another tab, or null when nothing is newer. */
export function applyRemoteDocs(
  state: Pick<DocumentsState, 'docs' | 'dirtyForDrive' | 'currentId'>,
  msg: DocsMessage,
): RemoteApply | null {
  let docs = state.docs
  let dirty = state.dirtyForDrive
  let currentId = state.currentId
  const taken: string[] = []
  for (const d of msg.saved) {
    if (!d || typeof d.id !== 'string' || !isNewerCopy(d, docs[d.id])) continue
    if (docs === state.docs) docs = { ...docs }
    docs[d.id] = d
    if (dirty[d.id]) {
      if (dirty === state.dirtyForDrive) dirty = { ...dirty }
      delete dirty[d.id]
    }
    taken.push(d.id)
  }
  for (const id of msg.deleted) {
    if (!(id in docs)) continue
    if (docs === state.docs) docs = { ...docs }
    delete docs[id]
    if (dirty[id]) {
      if (dirty === state.dirtyForDrive) dirty = { ...dirty }
      delete dirty[id]
    }
    if (currentId === id) currentId = null
  }
  if (docs === state.docs && dirty === state.dirtyForDrive) return null
  return { patch: { docs, dirtyForDrive: dirty, currentId }, taken }
}

/**
 * Doc ids whose latest version came from another tab and has not been edited
 * here since. Drive autosave leaves them to the tab that made the change, so
 * two tabs don't race to upload the same edit (and trip the conflict check).
 */
export const remoteOwned = new Set<string>()

export interface CrossTab {
  post(saved: ThunderDoc[], deleted: string[]): void
  dispose(): void
}

const defaultChannel = (): ChannelLike | null =>
  typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null

/** Opens the channel; `onMessage` runs for every valid message from another tab. */
export function openCrossTab(
  onMessage: (msg: DocsMessage) => void,
  createChannel: () => ChannelLike | null = defaultChannel,
): CrossTab {
  let channel: ChannelLike | null = null
  try {
    channel = createChannel()
  } catch {
    channel = null
  }
  if (channel) {
    channel.onmessage = (ev) => {
      if (isDocsMessage(ev.data)) onMessage(ev.data)
    }
  }
  return {
    post(saved, deleted) {
      if (!channel || (saved.length === 0 && deleted.length === 0)) return
      try {
        channel.postMessage({ type: 'docs', saved, deleted } satisfies DocsMessage)
      } catch (e) {
        console.warn('[thunder-writer] Could not notify other tabs', e)
      }
    },
    dispose() {
      if (channel) {
        channel.onmessage = null
        channel.close()
      }
      channel = null
    },
  }
}
