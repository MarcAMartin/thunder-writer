import { useMemo } from 'react'
import { useDocuments } from '../../store/documents'
import { Modal } from './Modal'

export const formatWhen = (t: number) =>
  new Date(t).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Lists manuscripts stored in this browser. */
export function OpenLocalModal({ onClose }: { onClose: () => void }) {
  const docsMap = useDocuments((s) => s.docs)
  const currentId = useDocuments((s) => s.currentId)
  const openDoc = useDocuments((s) => s.openDoc)
  const deleteDoc = useDocuments((s) => s.deleteDoc)
  const docs = useMemo(() => Object.values(docsMap).sort((a, b) => b.updatedAt - a.updatedAt), [docsMap])

  const remove = (id: string, title: string) => {
    const onDrive = docsMap[id]?.driveFileId ? ' The copy in Google Drive is not affected.' : ''
    if (!window.confirm(`Delete "${title}" from this browser? This cannot be undone.${onDrive}`)) return
    const wasCurrent = id === currentId
    deleteDoc(id)
    if (wasCurrent) {
      const next = docs.find((d) => d.id !== id)
      if (next) openDoc(next.id)
    }
  }

  return (
    <Modal title="Open manuscript" onClose={onClose}>
      {docs.length === 0 ? (
        <p className="fm-empty">No manuscripts in this browser yet.</p>
      ) : (
        <ul className="fm-list" aria-label="Manuscripts in this browser">
          {docs.map((d, i) => (
            <li key={d.id} className="fm-row" aria-current={d.id === currentId ? 'true' : undefined}>
              <button
                type="button"
                className="fm-row-main"
                data-autofocus={i === 0 ? '' : undefined}
                onClick={() => {
                  openDoc(d.id)
                  onClose()
                }}
              >
                <span className="fm-row-title">{d.title || 'Untitled Manuscript'}</span>
                <span className="fm-row-meta">
                  Edited {formatWhen(d.updatedAt)}
                  {d.driveFileId ? ' · in Drive' : ''}
                  {d.id === currentId ? ' · open now' : ''}
                </span>
              </button>
              <button
                type="button"
                className="tw-btn tw-btn-ghost fm-icon-btn fm-danger"
                onClick={() => remove(d.id, d.title || 'Untitled Manuscript')}
                aria-label={`Delete ${d.title || 'Untitled Manuscript'} from this browser`}
                title="Delete from this browser"
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
