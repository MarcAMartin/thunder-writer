import { useEffect, useMemo, useState } from 'react'
import { useDocuments } from '../../store/documents'
import type { ThunderDoc } from '../../types'
import { Modal } from '../storage/Modal'
import { downloadBackup, formatBackupTime, openBackupAsCopy, refreshBackups, useBackups } from './backups'
import { describeReason, describeSize, type BackupMeta } from './retention'

/** Every backup in this browser, grouped by manuscript (deleted manuscripts included). */
export function AllBackupsModal({ onClose, onOpened }: { onClose: () => void; onOpened?: (copy: ThunderDoc, meta: BackupMeta) => void }) {
  const list = useBackups((s) => s.list)
  const loaded = useBackups((s) => s.loaded)
  const error = useBackups((s) => s.error)
  const writeError = useBackups((s) => s.writeError)
  const docs = useDocuments((s) => s.docs)
  const [busy, setBusy] = useState<string | null>(null)
  /** Shown in the row it happened in, so it's seen even far down the list. */
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null)

  useEffect(() => {
    void refreshBackups()
  }, [])

  const groups = useMemo(() => {
    const byDoc = new Map<string, BackupMeta[]>()
    for (const m of list) byDoc.set(m.docId, [...(byDoc.get(m.docId) ?? []), m])
    // Newest backup first, so the manuscript being worked on leads.
    return [...byDoc.entries()].map(([docId, items]) => ({ docId, items, title: docs[docId]?.title || items[0].title, deleted: !docs[docId] }))
  }, [list, docs])

  const act = async <T,>(meta: BackupMeta, fn: (m: BackupMeta) => Promise<T>, done?: (r: T) => void) => {
    if (busy) return
    setBusy(meta.id)
    setRowError(null)
    try {
      const r = await fn(meta)
      setBusy(null)
      done?.(r)
    } catch (e) {
      setBusy(null)
      setRowError({ id: meta.id, text: e instanceof Error ? e.message : 'This backup can’t be read.' })
    }
  }

  let body
  if (error) {
    body = (
      <p className="fm-inline-error" role="alert">
        {error}
      </p>
    )
  } else if (!loaded) {
    body = (
      <p className="fm-empty" role="status">
        Loading backups…
      </p>
    )
  } else if (groups.length === 0) {
    body = <p className="fm-empty">No backups yet. Thunder Writer keeps one automatically as you write.</p>
  } else {
    body = (
      <>
        {writeError && (
          <p className="fm-inline-error" role="status">
            {writeError}
          </p>
        )}
        <p className="bk-lead">
          Backups are kept in this browser. Opening one makes it a new manuscript; nothing is overwritten. Download keeps a
          copy you can open again with File › Open from computer….
        </p>
        {groups.map((g) => (
          <section key={g.docId} className="bk-group" aria-label={`Backups of ${g.title}`}>
            <h3 className="bk-group-title">
              {g.title}
              {g.deleted && <span className="bk-deleted"> (deleted)</span>}
            </h3>
            <ul className="fm-list">
              {g.items.map((m) => (
                <li key={m.id} className="fm-row bk-row">
                  <span className="bk-row-main">
                    <span className="fm-row-title">{formatBackupTime(m.savedAt)}</span>
                    <span className="fm-row-meta">
                      {describeSize(m)} · {describeReason(m)}
                    </span>
                  </span>
                  {/* aria-disabled, not disabled, while another row works: keyboard focus stays put. */}
                  <button
                    type="button"
                    className="tw-btn"
                    aria-disabled={busy !== null || undefined}
                    aria-label={`Open copy of the backup from ${formatBackupTime(m.savedAt)} of ${g.title}`}
                    onClick={() =>
                      void act(m, openBackupAsCopy, (copy) => {
                        onClose()
                        onOpened?.(copy, m)
                      })
                    }
                  >
                    {busy === m.id ? 'Opening…' : 'Open copy'}
                  </button>
                  <button
                    type="button"
                    className="tw-btn tw-btn-ghost"
                    aria-disabled={busy !== null || undefined}
                    aria-label={`Download the backup from ${formatBackupTime(m.savedAt)} of ${g.title}`}
                    onClick={() => void act(m, downloadBackup)}
                  >
                    Download
                  </button>
                  {rowError?.id === m.id && (
                    <p className="fm-inline-error bk-row-error" role="alert">
                      {rowError.text}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </>
    )
  }

  return (
    <Modal title="All backups" onClose={onClose} className="bk-dialog">
      {body}
    </Modal>
  )
}
