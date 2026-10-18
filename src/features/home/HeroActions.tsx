import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDocuments, type DocumentsState } from '../../store/documents'
import type { ThunderDoc } from '../../types'
import { discardUntouchedCurrentDoc, isUntouchedDoc } from '../import/importFlow'
import { driveErrorMessage } from '../storage/drive'
import { connectDrive, isDriveConfigured } from '../storage/driveSession'
import { loadGis } from '../storage/googleAuth'
import { countWords } from '../backups/store'
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

/** "5 minutes ago", "yesterday", or a date for anything older than a week. */
export function editedWhen(t: number, now = Date.now()): string {
  const s = Math.round((now - t) / 1000)
  if (s < 45) return 'just now'
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), 'minute')
  if (s < 86_400) return rtf.format(-Math.round(s / 3600), 'hour')
  if (s < 7 * 86_400) return rtf.format(-Math.round(s / 86_400), 'day')
  return `on ${formatWhen(t)}`
}

type Node = { type?: string; text?: string; attrs?: { level?: number }; content?: Node[] }

/** Chapters (Heading 1) and the manuscript's latest lines (the end of its last paragraph with words, up to ~150 characters). */
export function manuscriptGlance(content: unknown): { chapters: number; latest: string } {
  let chapters = 0
  let latest = ''
  const text = (n: Node): string => (n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? ' ' : (n.content ?? []).map(text).join(''))
  const walk = (n: Node | null | undefined) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'heading' && n.attrs?.level === 1) chapters++
    if (n.type === 'paragraph') {
      const t = text(n).replace(/\s+/g, ' ').trim()
      if (t) latest = t
      return
    }
    n.content?.forEach(walk)
  }
  walk(content as Node)
  if (latest.length > 150) {
    const cut = latest.slice(-150)
    latest = `…${cut.slice(cut.indexOf(' ') + 1)}`
  }
  return { chapters, latest }
}

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`

/**
 * Home page calls to action. When this browser has a manuscript, it leads:
 * a "Continue writing" card names it (title, when it was edited, words,
 * chapters, its latest lines) and reopens it, with "Start a new manuscript"
 * beside it. Otherwise "Start Writing" opens a fresh manuscript and
 * "Continue Writing" connects Google Drive, right from the click so the
 * consent popup isn't blocked, and lists the manuscripts saved there.
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

  if (last) return <ContinueCard doc={last} />

  let cont = null
  let note = null
  if (fromDrive) {
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

/** The manuscript last open in this browser, leading the hero: open it again, or start another. */
function ContinueCard({ doc }: { doc: ThunderDoc }) {
  const title = doc.title?.trim() || 'Untitled Manuscript'
  const words = countWords(doc.content)
  const { chapters, latest } = manuscriptGlance(doc.content)
  const meta = [`Edited ${editedWhen(doc.updatedAt)}`, plural(words, 'word'), ...(chapters ? [plural(chapters, 'chapter')] : [])]
  const open = () => {
    if (useDocuments.getState().currentId === doc.id) return
    discardUntouchedCurrentDoc()
    useDocuments.getState().openDoc(doc.id)
  }
  return (
    <section className="hm-resume" aria-labelledby="hm-resume-title">
      <p className="hm-resume-kicker">
        <span className="hm-resume-dot" aria-hidden="true" />
        Continue writing
      </p>
      <h2 id="hm-resume-title" className="hm-resume-title">
        <Link to={WRITE_PATH} onClick={open} tabIndex={-1}>
          {title}
        </Link>
      </h2>
      <p id="hm-continue-note" className="hm-resume-meta">
        <span className="hm-sr">Last open in this browser: “{title}”. </span>
        {meta.join(' · ')}
      </p>
      {latest && (
        <blockquote className="hm-resume-latest" aria-label="Latest lines">
          <p>{latest}</p>
        </blockquote>
      )}
      <div className="hm-ctas hm-resume-ctas">
        <Link to={WRITE_PATH} className={`${CTA} tw-btn-primary hm-cta-primary`} aria-describedby="hm-continue-note" onClick={open}>
          Continue Writing
          <span aria-hidden="true" className="hm-cta-arrow">
            →
          </span>
        </Link>
        <Link to={NEW_MANUSCRIPT_PATH} className={`${CTA} hm-cta-quiet`}>
          Start a new manuscript
        </Link>
      </div>
    </section>
  )
}
