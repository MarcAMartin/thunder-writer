import { useEffect, useId, useState } from 'react'
import { useDocuments } from '../../store/documents'
import { describeCopyStatus } from './copyStatus'
import {
  isDesktopCopySupported,
  restoreDesktopCopy,
  resumeDesktopCopy,
  setUpDesktopCopy,
  stopDesktopCopy,
  useDesktopCopy,
  writeDesktopCopyNow,
  type CopyStatus,
} from './desktopCopy'
import { modKey, saveCurrentDocOnce, useExportUi } from './exportUi'
import { COPY_KINDS, EXPORT_FORMATS, type CopyKind } from './formats'
import './export.css'

const useCopyStatus = (docId: string | null) => useDesktopCopy((s) => (docId ? s.byDoc[docId] : undefined))

/**
 * "Keep a copy on my computer": set up, status, resume after reload, retry,
 * change file or format, stop. Chrome/Edge only; other browsers get a short
 * explanation and a one-off Word download.
 */
export function DesktopCopyControl({ docId: explicitId }: { docId?: string }) {
  const currentId = useDocuments((s) => s.currentId)
  const docId = explicitId ?? currentId
  const status = useCopyStatus(docId)
  const supported = isDesktopCopySupported()
  const headingId = useId()
  const [changing, setChanging] = useState(false)
  const [kind, setKind] = useState<CopyKind>(status?.kind ?? 'docx')
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (docId && supported) void restoreDesktopCopy(docId)
  }, [docId, supported])

  useEffect(() => {
    if (status?.kind) setKind(status.kind)
  }, [status?.kind])

  if (!docId) return null

  if (!supported) {
    return (
      <section className="ex-copy" aria-labelledby={headingId}>
        <h3 id={headingId}>Keep a copy on my computer</h3>
        <p>
          This browser can’t keep a file on your computer up to date by itself. Chrome and Microsoft Edge can. Your
          work is always saved in this browser, and you can save a copy to your computer whenever you like.
        </p>
        <div className="ex-actions">
          <button type="button" className="tw-btn" onClick={() => void saveCurrentDocOnce('docx', docId)}>
            Download a Word copy now
          </button>
        </div>
      </section>
    )
  }

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true)
    setMessage(null)
    try {
      const text = await fn()
      if (text) setMessage({ text, tone: 'ok' })
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Something went wrong.', tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  // Each handler calls the browser API before any await (Save dialog / permission prompt need the click).
  const choose = () =>
    run(async () => {
      const outcome = await setUpDesktopCopy(docId, kind)
      if (outcome === 'cancelled') return null
      setChanging(false)
      const s = useDesktopCopy.getState().byDoc[docId]
      if (outcome === 'failed') throw new Error(s?.error ?? 'The copy could not be written.')
      return `Saved ${s?.fileName ?? 'your copy'}. It updates about 15 seconds after you pause, and whenever you press ${modKey()}S.`
    })

  const resume = () =>
    run(async () => {
      const ok = await resumeDesktopCopy(docId)
      if (!ok) {
        const s = useDesktopCopy.getState().byDoc[docId]
        if (s?.phase === 'needs-permission') throw new Error('The browser didn’t allow access. Try again and choose “Allow”.')
        if (s?.error) throw new Error(s.error)
        return null
      }
      return 'Desktop copy resumed.'
    })

  const writeNow = () =>
    run(async () => {
      const outcome = await writeDesktopCopyNow(docId, { force: status?.phase === 'error' })
      const s = useDesktopCopy.getState().byDoc[docId]
      if (outcome === 'written' || outcome === 'clean') return `${s?.fileName ?? 'Your copy'} is up to date.`
      if (s?.phase === 'missing') return null
      throw new Error(s?.error ?? 'The copy could not be written.')
    })

  const stop = () =>
    run(async () => {
      const name = status?.fileName
      await stopDesktopCopy(docId)
      setChanging(false)
      return `Stopped. ${name ?? 'The file'} stays on your computer as it is.`
    })

  const formatPicker = (
    <fieldset className="ex-formats">
      <legend>Format</legend>
      {COPY_KINDS.map((k) => (
        <label key={k}>
          <input type="radio" name={`${headingId}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} />
          {EXPORT_FORMATS[k].short}
          {k === 'docx' && ' (recommended)'}
        </label>
      ))}
    </fieldset>
  )

  const msg = message && (
    <p className={message.tone === 'error' ? 'ex-copy-error' : 'ex-copy-msg'} role={message.tone === 'error' ? 'alert' : 'status'}>
      {message.text}
    </p>
  )

  if (!status) {
    return (
      <section className="ex-copy" aria-labelledby={headingId}>
        <h3 id={headingId}>Keep a copy on my computer</h3>
        <p>
          Choose a file once, on your Desktop or anywhere you like. Thunder Writer rewrites it as you write: about 15
          seconds after you pause, and whenever you press {modKey()}S.
        </p>
        {formatPicker}
        <div className="ex-actions">
          <button type="button" className="tw-btn tw-btn-primary" onClick={() => void choose()} disabled={busy} data-autofocus>
            Choose where to save…
          </button>
        </div>
        {msg}
      </section>
    )
  }

  const view = describeCopyStatus(status)
  return (
    <section className="ex-copy" aria-labelledby={headingId}>
      <h3 id={headingId}>Keep a copy on my computer</h3>
      <p className={`ex-copy-status ex-tone-${view.tone}`} role="status">
        <span className="ex-dot" aria-hidden="true" /> {view.text}
      </p>
      {status.error && status.phase !== 'ready' && status.phase !== 'writing' && <p className="ex-copy-error">{status.error}</p>}
      {status.phase === 'needs-permission' && (
        <p>After a reload the browser asks once more before Thunder Writer may update {status.fileName}.</p>
      )}
      <div className="ex-actions">
        {view.action === 'resume' && (
          <button type="button" className="tw-btn tw-btn-primary" onClick={() => void resume()} disabled={busy} data-autofocus>
            {view.actionLabel}
          </button>
        )}
        {view.action === 'choose' && (
          <button type="button" className="tw-btn tw-btn-primary" onClick={() => void choose()} disabled={busy} data-autofocus>
            {view.actionLabel}…
          </button>
        )}
        {(status.phase === 'ready' || status.phase === 'error' || status.phase === 'writing') && (
          <button type="button" className="tw-btn" onClick={() => void writeNow()} disabled={busy} data-autofocus>
            {status.phase === 'error' ? 'Retry' : 'Save copy now'}
          </button>
        )}
        {view.action !== 'choose' && (
          <button type="button" className="tw-btn" onClick={() => setChanging((c) => !c)} aria-expanded={changing} disabled={busy}>
            Change file or format…
          </button>
        )}
        <button type="button" className="tw-btn tw-btn-ghost" onClick={() => void stop()} disabled={busy}>
          Stop updating
        </button>
      </div>
      {(changing || view.action === 'choose') && (
        <>
          {formatPicker}
          {changing && (
            <div className="ex-actions">
              <button type="button" className="tw-btn tw-btn-primary" onClick={() => void choose()} disabled={busy}>
                Choose new file…
              </button>
            </div>
          )}
        </>
      )}
      {msg}
    </section>
  )
}

/**
 * Compact status for the header: "My Novel.docx · saved 12:04 PM". Clicking
 * resumes after a reload (one click), or opens "Save to your computer".
 * Renders nothing when no desktop copy is set up.
 */
export function DesktopCopyBadge() {
  const docId = useDocuments((s) => s.currentId)
  const status: CopyStatus | undefined = useCopyStatus(docId)
  const openChooser = useExportUi((s) => s.openChooser)
  const supported = isDesktopCopySupported()

  useEffect(() => {
    if (docId && supported) void restoreDesktopCopy(docId)
  }, [docId, supported])

  if (!docId || !status) return null
  const view = describeCopyStatus(status)
  const onClick = () => {
    if (view.action === 'resume') {
      void resumeDesktopCopy(docId).then((ok) => {
        if (ok) useExportUi.getState().showToast(`Desktop copy resumed · ${status.fileName} is up to date`)
      })
    } else openChooser()
  }
  const label = view.action === 'resume' ? `${view.text}. Click to allow access and resume.` : `${view.text}. Manage desktop copy.`
  return (
    <button type="button" className={`ex-chip ex-tone-${view.tone}`} onClick={onClick} title={view.text} aria-label={label}>
      <span className="ex-dot" aria-hidden="true" />
      <span className="ex-chip-text">{view.action === 'resume' ? `Resume copy: ${status.fileName}` : view.short}</span>
    </button>
  )
}
