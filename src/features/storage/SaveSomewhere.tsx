import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useExportUi } from '../export/exportUi'
import { isDesktopCopySupported, setUpDesktopCopy } from '../export/desktopCopy'
import { SaveToFilesDialog } from '../export/SaveToFilesDialog'
import { NARROW_QUERY, useMediaQuery } from '../../shell/useMediaQuery'
import { driveErrorMessage } from './drive'
import { isDriveConfigured, saveDocToDrive } from './driveSession'

const WIDTH = 340

/**
 * The "Not saved to a file" status opens this: the manuscript is only in this
 * browser, so it offers a file that keeps up with the writing (Google Drive,
 * or a file on this computer that updates itself), or a one-off copy where
 * neither is available (phones, Safari, Firefox). Each choice runs straight
 * from its click, as Google's popup and the browser's Save dialog need.
 */
export function SaveSomewherePopover({
  docId,
  title,
  anchor,
  onClose,
}: {
  docId: string
  title: string
  anchor: RefObject<HTMLElement | null>
  onClose: (opts?: { restoreFocus?: boolean }) => void
}) {
  const headingId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [filesDialog, setFilesDialog] = useState(false)
  const narrow = useMediaQuery(NARROW_QUERY)
  const drive = isDriveConfigured()
  const desktopCopy = isDesktopCopySupported()
  const toast = (text: string, tone: 'ok' | 'info' | 'error' = 'ok') => useExportUi.getState().showToast(text, tone)

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (!r) return
      const width = Math.min(WIDTH, window.innerWidth - 24)
      setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left - 8, window.innerWidth - width - 12)) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor])

  // Focus the first choice once the popover is placed (and so rendered).
  const placed = pos !== null
  useEffect(() => {
    if (placed) ref.current?.querySelector<HTMLElement>('button')?.focus()
  }, [placed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose({ restoreFocus: true })
      }
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [anchor, onClose])

  const toDrive = () => {
    onClose()
    saveDocToDrive(docId).then(
      () => toast(`“${title}” is saved to your Google Drive. Changes save there every 10 seconds.`),
      (e: unknown) => toast(driveErrorMessage(e), 'error'),
    )
  }
  const toComputer = () => {
    // The Save dialog opens from this click; the popover closes once it's answered.
    void setUpDesktopCopy(docId, 'docx').then((outcome) => {
      onClose()
      if (outcome === 'ok') toast('Saved to a file on your computer. It updates about 10 seconds after you pause.')
      else if (outcome === 'failed') toast('Couldn’t save the file. Try again, or use Export.', 'error')
    })
  }
  const copyOnce = () => {
    if (narrow) setFilesDialog(true)
    else {
      onClose()
      useExportUi.getState().openChooser()
    }
  }

  if (filesDialog) return <SaveToFilesDialog onClose={() => onClose()} />
  if (!pos) return null
  return createPortal(
    <div
      ref={ref}
      className="fm-pop"
      role="dialog"
      aria-labelledby={headingId}
      style={{ top: pos.top, left: pos.left, width: Math.min(WIDTH, window.innerWidth - 24) }}
    >
      <h2 id={headingId} className="fm-pop-title">
        Only in this browser
      </h2>
      <p className="fm-pop-text">
        “{title}” is saved here as you type, but it isn’t in a file yet. If this browser’s data is cleared, or you switch
        devices, it won’t come with you.
      </p>
      <div className="fm-pop-choices">
        {drive && (
          <button type="button" className="fm-pop-choice fm-pop-primary" onClick={toDrive}>
            <span className="fm-pop-label">Save to Google Drive</span>
            <span className="fm-pop-hint">In your own Drive, then saved there every 10 seconds.</span>
          </button>
        )}
        {desktopCopy && (
          <button type="button" className={`fm-pop-choice${drive ? '' : ' fm-pop-primary'}`} onClick={toComputer}>
            <span className="fm-pop-label">Save to a file on this computer…</span>
            <span className="fm-pop-hint">A Word file you choose once. It updates about 10 seconds after you pause.</span>
          </button>
        )}
        {!desktopCopy && (
          <button type="button" className={`fm-pop-choice${drive ? '' : ' fm-pop-primary'}`} onClick={copyOnce}>
            <span className="fm-pop-label">{narrow ? 'Save to Files…' : 'Export a copy…'}</span>
            <span className="fm-pop-hint">Word, PDF or plain text. Save again after you write more.</span>
          </button>
        )}
      </div>
      <button type="button" className="tw-btn tw-btn-ghost fm-pop-later" onClick={() => onClose({ restoreFocus: true })}>
        Not now
      </button>
    </div>,
    document.body,
  )
}
