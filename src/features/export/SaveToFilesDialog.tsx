import { useEffect, useId, useState } from 'react'
import { useDocuments } from '../../store/documents'
import { flushPendingEdits } from '../../store/pendingEdits'
import { requestPdfExport } from '../preview/pdfRequest'
import { Modal } from '../storage/Modal'
import { useExportUi } from './exportUi'
import { buildExport, EXPORT_FORMATS, type ExportKind } from './formats'
import { downloadBlob, withExtension } from './saveToComputer'
import './export.css'

type PhoneKind = ExportKind | 'pdf'

/** The formats offered on phones, Word first. PDF is printed from Book Preview. */
export const PHONE_SAVE_KINDS: PhoneKind[] = ['docx', 'pdf', 'doc', 'thunder', 'txt']

const PHONE_LABELS: Partial<Record<PhoneKind, string>> = { pdf: 'PDF (.pdf)' }

const PHONE_HINTS: Partial<Record<PhoneKind, string>> = {
  docx: 'Opens in Word, Pages and Google Docs, and back here with Open from Files.',
  pdf: 'Your book’s pages. In the print screen, tap Share, then Save to Files.',
  doc: 'For older versions of Word.',
  thunder: 'Everything exactly as it is here. Open it again with Open from Files.',
  txt: 'Just the words.',
}

type ShareNavigator = Navigator & {
  canShare?: (data: { files?: File[] }) => boolean
  share?: (data: { files?: File[]; title?: string }) => Promise<void>
}

/**
 * Hands a finished file to the phone: the share sheet where the browser has
 * one for files (iPhone: Save to Files, AirDrop, Mail…), else a download.
 * Call it straight from a tap; it starts the share synchronously, before any
 * await, because browsers only open the share sheet from a tap.
 */
export function shareOrDownload(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const nav = navigator as ShareNavigator
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    return nav.share({ files: [file], title: file.name }).then(
      () => 'shared' as const,
      (e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return 'cancelled' as const
        downloadBlob(file, file.name)
        return 'downloaded' as const
      },
    )
  }
  downloadBlob(file, file.name)
  return Promise.resolve('downloaded' as const)
}

/**
 * Phones: File › Save to Files…. Saves a copy of the open manuscript to the
 * phone (on iPhone, the Files app: iCloud Drive or On My iPhone). The file is
 * built while the dialog is open, so the Save tap can open the share sheet at
 * once. A copy doesn't update itself; Google Drive keeps one up to date.
 */
export function SaveToFilesDialog({ onClose }: { onClose: () => void }) {
  const docId = useDocuments((s) => s.currentId)
  const [kind, setKind] = useState<PhoneKind>('docx')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = useId()

  useEffect(() => {
    let live = true
    setFile(null)
    setError(null)
    flushPendingEdits()
    const doc = docId ? useDocuments.getState().docs[docId] : undefined
    if (!doc) {
      setError('Open a manuscript first.')
      return
    }
    if (kind === 'pdf') return
    buildExport(doc, kind)
      .then((blob) => {
        if (!live) return
        const fileName = withExtension(doc.title || 'Untitled Manuscript', kind)
        setFile(new File([blob], fileName, { type: EXPORT_FORMATS[kind].mime }))
      })
      .catch((e: unknown) => live && setError(`Couldn’t make the file: ${e instanceof Error ? e.message : String(e)}`))
    return () => {
      live = false
    }
  }, [docId, kind])

  const save = () => {
    if (kind === 'pdf') {
      onClose()
      requestPdfExport()
      return
    }
    if (!file) return
    void shareOrDownload(file).then((outcome) => {
      const toast = useExportUi.getState().showToast
      if (outcome === 'shared') toast(`“${file.name}” is saved where you chose.`)
      else if (outcome === 'downloaded') toast(`“${file.name}” is in your Downloads (on iPhone: Files › Downloads).`, 'info')
      if (outcome !== 'cancelled') onClose()
    })
  }

  return (
    <Modal
      title="Save to Files"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="tw-btn tw-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="tw-btn tw-btn-primary" onClick={save} disabled={kind === 'pdf' ? !!error : !file} data-autofocus>
            {kind === 'pdf' ? 'Print…' : file ? 'Save…' : error ? 'Save…' : 'Preparing…'}
          </button>
        </>
      }
    >
      <p className="ex-files-lead">
        Saves a copy of this manuscript on your phone. Choose <strong>Save to Files</strong> on the next screen, then a
        folder such as iCloud Drive or On My iPhone.
      </p>
      <fieldset className="ex-formats ex-files-formats">
        <legend>Format</legend>
        {PHONE_SAVE_KINDS.map((k) => (
          <label key={k} className="ex-files-choice">
            <input type="radio" name={name} value={k} checked={kind === k} onChange={() => setKind(k)} />
            <span>
              <strong>{k === 'pdf' ? PHONE_LABELS.pdf : EXPORT_FORMATS[k].label}</strong>
              <span className="ex-files-hint">{PHONE_HINTS[k]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p className="ex-copy-error" role="alert">
          {error}
        </p>
      )}
      <p className="ex-files-note">
        A copy doesn’t update itself: save again after you write more. To keep a copy up to date automatically, use{' '}
        <strong>Save to Google Drive</strong>.
      </p>
    </Modal>
  )
}
