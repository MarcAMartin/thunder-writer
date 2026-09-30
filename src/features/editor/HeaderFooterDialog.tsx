import { useId, useMemo } from 'react'
import { useDocuments } from '../../store/documents'
import type { BookLayoutOptions, HeaderFooterSettings } from '../../types'
import { checkFit, NO_FIT_ISSUES } from '../preview/fitText'
import { normalizeBookLayout, normalizeHeaderFooter } from '../preview/headerFooter'
import { HeaderFooterPanel } from '../preview/HeaderFooterPanel'
import { bookGeometry } from '../preview/layout'
import { Modal } from '../storage/Modal'
import { chapterTitlesOf } from './bookChapters'
import { resolveFormat } from './presets'
import '../storage/storage.css'

const SINKS: [number, string][] = [
  [0, 'Top of the page'],
  [0.2, 'A fifth of the way down'],
  [1 / 3, 'A third of the way down'],
]

/**
 * Headers & footers for the current manuscript (the same panel as in the Book
 * preview), plus the book layout choices. Every change is saved to the doc's
 * format at once (IndexedDB, and Drive via the dirty flag).
 */
export function HeaderFooterDialog({ onClose }: { onClose: () => void }) {
  const doc = useDocuments((s) => (s.currentId ? s.docs[s.currentId] : undefined))
  const updateFormat = useDocuments((s) => s.updateFormat)
  const docId = doc?.id
  const onHeaderFooterChange = (next: HeaderFooterSettings) => docId && updateFormat(docId, { headerFooter: next })
  const onBookLayoutChange = (next: BookLayoutOptions) => docId && updateFormat(docId, { bookLayout: next })
  const id = useId()
  const hf = useMemo(() => normalizeHeaderFooter(doc?.format.headerFooter), [doc?.format.headerFooter])
  const book = useMemo(() => normalizeBookLayout(doc?.format.bookLayout), [doc?.format.bookLayout])
  const resolved = useMemo(() => resolveFormat(doc?.format), [doc?.format])
  const title = doc?.title?.trim() || 'Untitled Manuscript'
  const content = doc?.content
  const chapterTitles = useMemo(() => chapterTitlesOf(content), [content])
  const fit = useMemo(() => {
    try {
      return checkFit(hf, { title, chapterTitles, geometry: bookGeometry(resolved), fontFamily: resolved.fontFamily })
    } catch {
      return NO_FIT_ISSUES
    }
  }, [hf, title, chapterTitles, resolved])
  if (!doc) return null
  const setBook = (p: Partial<BookLayoutOptions>) => onBookLayoutChange({ ...book, ...p })

  return (
    <Modal
      title="Headers & footers"
      onClose={onClose}
      className="ed-hf-dialog"
      footer={
        <button type="button" className="tw-btn tw-btn-primary" onClick={onClose} data-autofocus>
          Done
        </button>
      }
    >
      <p className="ed-hf-intro">
        What prints at the top and bottom of each page of “{title}”, in the Book preview and when you save to Word or
        print. Changes are saved as you make them.
      </p>
      <HeaderFooterPanel
        value={hf}
        onChange={onHeaderFooterChange}
        title={title}
        sampleChapter={chapterTitles[0] || 'Chapter One'}
        chapterTitles={chapterTitles}
        fit={fit}
        chaptersShareFlow={!resolved.chapterStartsNewPage}
      />
      <fieldset className="bp-hf ed-hf-layout">
        <legend className="bp-hf-legend">Book layout</legend>
        <div className="bp-hf-checks">
          <label className="bp-check">
            <input
              type="checkbox"
              checked={book.chaptersStartRecto}
              disabled={!resolved.chapterStartsNewPage}
              onChange={(e) => setBook({ chaptersStartRecto: e.target.checked })}
            />
            Chapters start on a right-hand page
          </label>
          {!resolved.chapterStartsNewPage && (
            <p className="bp-hf-hint">Turn on “Chapters start new page” in the toolbar to use this.</p>
          )}
          <label className="bp-check">
            <input type="checkbox" checked={book.justify} onChange={(e) => setBook({ justify: e.target.checked })} />
            Justify text
          </label>
        </div>
        <div className="bp-hf-row">
          <label htmlFor={`${id}-sink`}>Chapter heading position</label>
          <select id={`${id}-sink`} value={String(book.chapterSink)} onChange={(e) => setBook({ chapterSink: Number(e.target.value) })}>
            {SINKS.map(([v, l]) => (
              <option key={String(v)} value={String(v)}>
                {l}
              </option>
            ))}
            {!SINKS.some(([v]) => v === book.chapterSink) && <option value={String(book.chapterSink)}>Custom</option>}
          </select>
        </div>
      </fieldset>
    </Modal>
  )
}
