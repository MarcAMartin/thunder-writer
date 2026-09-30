import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDocuments, type DocumentsState } from '../../store/documents'
import type { ThunderDoc } from '../../types'
import { discardUntouchedCurrentDoc, isUntouchedDoc } from '../import/importFlow'
import { driveErrorMessage } from '../storage/drive'
import { connectDrive, isDriveConfigured } from '../storage/driveSession'
import { loadGis } from '../storage/googleAuth'
import { formatWhen } from '../storage/OpenLocalModal'
import { NEW_MANUSCRIPT_PATH, OPEN_FROM_DRIVE_PATH, WRITE_PATH } from './routes'

/**
 * The manuscript "Continue Writing" reopens: the one last open in this
 * browser, else the most recently edited. A blank manuscript nobody wrote in
 * doesn't count, so a writer who only ever clicked Start Writing here is sent
 * to Google Drive instead of to an empty page.
 */
export function lastManuscript(s: Pick<DocumentsState, 'docs' | 'currentId'>): ThunderDoc | null {
  const current = s.currentId ? s.docs[s.currentId] : undefined
  if (current && !isUntouchedDoc(current)) return current
  let latest: ThunderDoc | null = null
  for (const d of Object.values(s.docs)) if (!isUntouchedDoc(d) && (!latest || d.updatedAt > latest.updatedAt)) latest = d
  return latest
}

const CTA = 'tw-btn hm-cta'

/**
 * Home page calls to action. "Start Writing" opens a fresh manuscript.
 * "Continue Writing" reopens the last manuscript kept in this browser; when
 * there is none (a new computer, cleared data) it connects Google Drive, right
 * from the click so the consent popup isn't blocked, and lists the
 * manuscripts saved there.
 */
export function HeroActions() {
  const navigate = useNavigate()
  const hydrated = useDocuments((s) => s.hydrated)
  const last = useDocuments(lastManuscript)
  const drive = isDriveConfigured()
  const fromDrive = hydrated && !last && drive
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Load Google sign-in ahead of the click, so its popup opens straight from it.
  useEffect(() => {
    if (fromDrive) loadGis().catch(() => undefined)
  }, [fromDrive])

  const continueFromDrive = () => {
    if (busy) return
    setBusy(true)
    setError(null)
    connectDrive().then(
      () => {
        if (mounted.current) navigate(OPEN_FROM_DRIVE_PATH)
      },
      (e: unknown) => {
        if (!mounted.current) return
        setBusy(false)
        setError(driveErrorMessage(e))
      },
    )
  }

  let cont = null
  let note = null
  if (last) {
    cont = (
      <Link
        to={WRITE_PATH}
        className={CTA}
        aria-describedby="hm-continue-note"
        onClick={() => {
          if (useDocuments.getState().currentId === last.id) return
          discardUntouchedCurrentDoc()
          useDocuments.getState().openDoc(last.id)
        }}
      >
        Continue Writing
      </Link>
    )
    note = (
      <>
        Last open in this browser: <span className="hm-continue-title">“{last.title || 'Untitled Manuscript'}”</span>, edited{' '}
        {formatWhen(last.updatedAt)}.
      </>
    )
  } else if (fromDrive) {
    cont = (
      <button type="button" className={CTA} onClick={continueFromDrive} aria-busy={busy || undefined} aria-describedby="hm-continue-note">
        {busy ? 'Opening Google Drive…' : 'Continue Writing'}
      </button>
    )
    note = 'Pick up a manuscript you saved to Google Drive.'
  } else if (!hydrated) {
    // Storage is still loading (a moment); the writer page opens whatever it finds.
    cont = (
      <Link to={WRITE_PATH} className={CTA}>
        Continue Writing
      </Link>
    )
  }

  return (
    <>
      <div className="hm-ctas">
        <Link to={NEW_MANUSCRIPT_PATH} className="tw-btn tw-btn-primary hm-cta hm-cta-primary">
          Start Writing
          <span aria-hidden="true" className="hm-cta-arrow">
            →
          </span>
        </Link>
        {cont}
      </div>
      {note && (
        <p id="hm-continue-note" className="hm-continue-note">
          {note}
        </p>
      )}
      {error && (
        <p className="hm-continue-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
