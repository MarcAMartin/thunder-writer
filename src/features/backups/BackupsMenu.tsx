import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { currentDoc, useDocuments } from '../../store/documents'
import type { ThunderDoc } from '../../types'
import { AllBackupsModal } from './AllBackupsModal'
import { backUpCurrentNow, formatBackupTime, openBackupAsCopy, refreshBackups, undoOpenCopy, useBackups } from './backups'
import { describeReason, describeSize, type BackupMeta } from './retention'
// The menu and dialog build on these; load them first so backups.css can refine them.
import '../export/export.css'
import '../storage/storage.css'
import './backups.css'

/** How many of the open manuscript's backups the menu lists; the rest are under All backups…. */
export const MENU_LIMIT = 12

const n = (v: number) => v.toLocaleString()

/**
 * "Backups ▾" in the writer header: the open manuscript's backups, newest
 * first. Choosing one opens it as a new manuscript (nothing is overwritten).
 * "All backups…" lists every manuscript's, including deleted ones.
 */
export function BackupsMenu() {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'error'; undo?: () => void } | null>(null)
  const menuId = useId()
  const hintId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const doc = useDocuments(currentDoc)
  const list = useBackups((s) => s.list)
  const loaded = useBackups((s) => s.loaded)
  const error = useBackups((s) => s.error)
  const writeError = useBackups((s) => s.writeError)
  const mine = doc ? list.filter((m) => m.docId === doc.id) : []
  const title = doc?.title || 'Untitled Manuscript'

  const flash = (text: string, tone: 'ok' | 'error' = 'ok', undo?: () => void) => {
    if (noteTimer.current) clearTimeout(noteTimer.current)
    setNote({ text, tone, undo })
    noteTimer.current = setTimeout(() => setNote(null), tone === 'error' || undo ? 8000 : 4000)
  }

  /** After a backup opened as a copy: say so, with Undo (removes the copy while it's untouched). */
  const announceCopy = (copy: ThunderDoc, previousId: string | null, when: string) =>
    flash(`Opened the backup from ${when} as “${copy.title}”.`, 'ok', () => {
      flash(undoOpenCopy(copy.id, previousId) ? 'Closed the copy.' : 'The copy has been edited, so it was kept.')
    })
  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current)
  }, [])

  useEffect(() => {
    if (open) void refreshBackups()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // First item, which may be a note ("No backups yet…"): a screen reader then hears it too.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open, loaded])

  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (k: number) => {
      e.preventDefault()
      items[(k + items.length) % items.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') close(false)
  }

  const restore = async (meta: BackupMeta) => {
    const previousId = doc?.id ?? null
    close()
    try {
      announceCopy(await openBackupAsCopy(meta), previousId, formatBackupTime(meta.savedAt))
    } catch (e) {
      flash(e instanceof Error ? e.message : 'This backup can’t be opened.', 'error')
    }
  }

  const backUpNow = async () => {
    close()
    try {
      const meta = await backUpCurrentNow()
      flash(meta ? `Backed up “${meta.title}”.` : 'Nothing to back up yet.')
    } catch {
      flash(error ?? 'This browser couldn’t store the backup (it may be full).', 'error')
    }
  }

  return (
    <div className="bk-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="tw-btn bk-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={!doc}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        Backups <span className="tw-caret" aria-hidden="true">▾</span>
      </button>

      {open && doc && (
        <div id={menuId} ref={menuRef} className="ex-menu bk-menu" role="menu" aria-label={`Backups of ${title}`} onKeyDown={onMenuKey}>
          <div className="ex-group-label" aria-hidden="true">
            Backups of “{title}”
          </div>
          {writeError && !error && <MenuNote>{writeError}</MenuNote>}
          {error ? (
            <MenuNote>{error}</MenuNote>
          ) : !loaded ? (
            <MenuNote>Loading backups…</MenuNote>
          ) : mine.length === 0 ? (
            <MenuNote>No backups of this manuscript yet. One is kept automatically as you write.</MenuNote>
          ) : (
            <>
              <p id={hintId} className="bk-menu-hint">
                Choosing a backup opens it as a new manuscript; this one isn’t changed.
              </p>
              {mine.slice(0, MENU_LIMIT).map((m) => (
                <BackupItem key={m.id} meta={m} sharedHintId={hintId} onSelect={() => void restore(m)} />
              ))}
            </>
          )}
          <div className="bk-menu-foot" role="none">
            <div className="ex-sep" role="separator" />
            <MenuAction label="Back up now" onSelect={() => void backUpNow()} />
            <MenuAction
              label="All backups…"
              hint={
                mine.length > MENU_LIMIT
                  ? `${n(mine.length - MENU_LIMIT)} older ${mine.length - MENU_LIMIT === 1 ? 'backup' : 'backups'} of this manuscript, and every other manuscript’s, including ones you deleted.`
                  : 'Every manuscript’s, including ones you deleted.'
              }
              onSelect={() => {
                close(false)
                setAll(true)
              }}
            />
          </div>
        </div>
      )}

      <div className="bk-note-slot" aria-live="polite">
        {note && (
          <span className={`fm-note fm-note-${note.tone}`}>
            {note.text}
            {note.undo && (
              <button type="button" className="bk-undo" onClick={note.undo}>
                Undo
              </button>
            )}
          </span>
        )}
      </div>

      {all && (
        <AllBackupsModal
          onClose={() => {
            setAll(false)
            triggerRef.current?.focus()
          }}
          onOpened={(copy, meta) => announceCopy(copy, doc?.id ?? null, formatBackupTime(meta.savedAt))}
        />
      )}
    </div>
  )
}

/** A message in the menu (loading, none yet, can't be kept): announced with the items, never chosen. */
function MenuNote({ children }: { children: string }) {
  return (
    <div role="menuitem" aria-disabled="true" tabIndex={-1} className="ex-item bk-menu-note">
      {children}
    </div>
  )
}

function MenuAction({ label, hint, onSelect }: { label: string; hint?: string; onSelect: () => void }) {
  const labelId = useId()
  const hintId = useId()
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className="ex-item"
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
      onClick={onSelect}
    >
      <span id={labelId} className="ex-item-label">
        {label}
      </span>
      {hint && (
        <span id={hintId} className="ex-item-hint">
          {hint}
        </span>
      )}
    </button>
  )
}

function BackupItem({ meta, sharedHintId, onSelect }: { meta: BackupMeta; sharedHintId: string; onSelect: () => void }) {
  const labelId = useId()
  const hintId = useId()
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className="ex-item"
      aria-labelledby={labelId}
      aria-describedby={`${hintId} ${sharedHintId}`}
      onClick={onSelect}
    >
      <span id={labelId} className="ex-item-label">
        {formatBackupTime(meta.savedAt)}
      </span>
      <span id={hintId} className="ex-item-hint">
        {describeSize(meta)} · {describeReason(meta)}
      </span>
    </button>
  )
}
