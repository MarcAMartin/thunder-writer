import { useEffect, useState } from 'react'
import { useDocuments } from '../../store/documents'
import { flushPendingEdits } from '../../store/pendingEdits'
import type { ThunderDoc } from '../../types'
import { ConflictChoices } from './ConflictChoices'
import { driveErrorMessage } from './drive'
import { downloadDriveDoc } from './driveSession'
import { Modal } from './Modal'

type View = { kind: 'loading' } | { kind: 'ready'; remote: ThunderDoc } | { kind: 'error'; message: string }

/** Autosave found this doc's Drive file changed elsewhere: fetch Drive's version and let the writer choose. */
export function ResolveConflictModal({ docId, onClose }: { docId: string; onClose: () => void }) {
  const local = useDocuments((s) => s.docs[docId])
  const fileId = local?.driveFileId
  const [view, setView] = useState<View>({ kind: 'loading' })

  useEffect(() => {
    if (!fileId) return
    let alive = true
    flushPendingEdits()
    downloadDriveDoc(fileId).then(
      (remote) => alive && setView({ kind: 'ready', remote: { ...remote, id: docId } }),
      (e: unknown) => alive && setView({ kind: 'error', message: driveErrorMessage(e) }),
    )
    return () => {
      alive = false
    }
  }, [fileId, docId])

  let body
  if (!local || !fileId) body = <p className="fm-empty">This manuscript is no longer linked to a Drive file.</p>
  else if (view.kind === 'loading')
    body = (
      <p className="fm-empty" role="status">
        Fetching the Drive version…
      </p>
    )
  else if (view.kind === 'error')
    body = (
      <p className="fm-inline-error" role="alert">
        {view.message}
      </p>
    )
  else body = <ConflictChoices mode="resolve" local={local} remote={view.remote} onDone={onClose} onCancel={onClose} />

  return (
    <Modal title="Two versions of this manuscript" onClose={onClose}>
      {body}
    </Modal>
  )
}
