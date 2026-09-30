/**
 * Running heads, footers and folios (page numbers) for the printed book.
 *
 * Model: each side of a spread chooses its own running head. Trade fiction
 * uses author on the left (verso) and title on the right (recto); non-fiction
 * often uses title / chapter; some books put the chapter on both sides. A
 * single enum would need a value for every pairing, while two slots cover all of
 * them. The same shape also maps directly onto Word's "different odd and
 * even" headers when the .docx exporter adopts it (see the integration notes).
 * RUNNING_HEAD_PRESETS gives the UI a one-click choice of the common pairings.
 *
 * Everything here is pure; the preview, the settings panel's diagram, the
 * editor's page sheets and the Word / print exporters all call resolveHeaderFooter so they agree page by page.
 */

// The settings types live in the shared domain file (they are stored in DocFormat).
import type { BookLayoutOptions, FooterContent, HeadContent, HeaderFooterSettings, PageNumberPosition } from '../../types'
export type { BookLayoutOptions, FooterContent, HeadContent, HeaderFooterSettings, PageNumberPosition } from '../../types'

export type PageSide = 'recto' | 'verso'

export const DEFAULT_HEADER_FOOTER: HeaderFooterSettings = {
  authorName: '',
  versoHead: 'author',
  rectoHead: 'title',
  versoCustom: '',
  rectoCustom: '',
  footer: 'none',
  footerCustom: '',
  pageNumbers: 'footer-center',
  firstPageNumber: 1,
  suppressOnChapterOpeners: true,
  openerFolio: 'drop',
  suppressOnBlankPages: true,
  fontScale: 0.8,
  smallCapsRunningHeads: true,
  shortHeads: {},
}

export const RUNNING_HEAD_PRESETS: { id: string; label: string; verso: HeadContent; recto: HeadContent }[] = [
  { id: 'author-title', label: 'Author / Title (fiction standard)', verso: 'author', recto: 'title' },
  { id: 'title-chapter', label: 'Title / Chapter', verso: 'title', recto: 'chapter' },
  { id: 'chapter-chapter', label: 'Chapter on both pages', verso: 'chapter', recto: 'chapter' },
  { id: 'title-title', label: 'Title on both pages', verso: 'title', recto: 'title' },
  { id: 'none', label: 'No running heads', verso: 'none', recto: 'none' },
]

export function runningHeadPresetId(s: Pick<HeaderFooterSettings, 'versoHead' | 'rectoHead'>): string {
  return RUNNING_HEAD_PRESETS.find((p) => p.verso === s.versoHead && p.recto === s.rectoHead)?.id ?? 'custom'
}

export const DEFAULT_BOOK_LAYOUT: BookLayoutOptions = {
  chaptersStartRecto: true,
  justify: true,
  chapterSink: 1 / 3,
}

const HEADS: readonly HeadContent[] = ['none', 'title', 'author', 'chapter', 'custom']
const FOOTERS: readonly FooterContent[] = ['none', 'title', 'author', 'custom']
const POSITIONS: readonly PageNumberPosition[] = ['footer-center', 'footer-outside', 'header-outside', 'none']

const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T =>
  typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : d
const str = (v: unknown, d: string, max = 200) => (typeof v === 'string' ? v.slice(0, max) : d)
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
const MAX_SHORT_HEADS = 500

/**
 * Chapter title → short head, as stored: only non-empty string pairs, bounded.
 * Built with Object.fromEntries so a chapter titled "__proto__" is an own key,
 * never the object's prototype.
 */
function shortHeadsOf(v: unknown): Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  const entries: [string, string][] = []
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (entries.length >= MAX_SHORT_HEADS) break
    const key = chapterKey(k)
    if (!key || typeof val !== 'string' || !val.trim()) continue
    entries.push([key, val.slice(0, 200)])
  }
  return Object.fromEntries(entries)
}

/** The key a chapter's short head is stored under: its title, whitespace collapsed. */
export const chapterKey = (title: string) => title.replace(/\s+/g, ' ').trim().slice(0, 300)

/**
 * The short head stored for a chapter title ('' = none). Own keys only: a
 * chapter titled "constructor", "toString" or "__proto__" must not pick up
 * what a plain object inherits from Object.prototype.
 */
export function shortHeadOf(shortHeads: Readonly<Record<string, string>>, chapterTitle: string): string {
  const k = chapterKey(chapterTitle)
  if (!k || !Object.hasOwn(shortHeads, k)) return ''
  const v: unknown = shortHeads[k]
  return typeof v === 'string' ? v : ''
}

/** A copy of the short heads with one chapter's set (or removed when text is blank). */
export function withShortHead(shortHeads: Readonly<Record<string, string>>, chapterTitle: string, text: string): Record<string, string> {
  const k = chapterKey(chapterTitle)
  const entries = Object.entries(shortHeads).filter(([key]) => key !== k)
  if (k && text.trim()) entries.push([k, text])
  return Object.fromEntries(entries)
}

/** Settings from storage (possibly old, partial or hand-edited) with every field valid. */
export function normalizeHeaderFooter(raw: unknown): HeaderFooterSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_HEADER_FOOTER
  const first = Number(r.firstPageNumber)
  const scale = Number(r.fontScale)
  return {
    authorName: str(r.authorName, d.authorName),
    versoHead: oneOf(r.versoHead, HEADS, d.versoHead),
    rectoHead: oneOf(r.rectoHead, HEADS, d.rectoHead),
    versoCustom: str(r.versoCustom, d.versoCustom),
    rectoCustom: str(r.rectoCustom, d.rectoCustom),
    footer: oneOf(r.footer, FOOTERS, d.footer),
    footerCustom: str(r.footerCustom, d.footerCustom),
    pageNumbers: oneOf(r.pageNumbers, POSITIONS, d.pageNumbers),
    firstPageNumber: Number.isInteger(first) && first >= 1 && first <= 9999 ? first : d.firstPageNumber,
    suppressOnChapterOpeners: bool(r.suppressOnChapterOpeners, d.suppressOnChapterOpeners),
    openerFolio: r.openerFolio === 'none' ? 'none' : 'drop',
    suppressOnBlankPages: bool(r.suppressOnBlankPages, d.suppressOnBlankPages),
    fontScale: Number.isFinite(scale) && scale >= 0.5 && scale <= 1.2 ? scale : d.fontScale,
    smallCapsRunningHeads: bool(r.smallCapsRunningHeads, d.smallCapsRunningHeads),
    shortHeads: shortHeadsOf(r.shortHeads),
  }
}

export function normalizeBookLayout(raw: unknown): BookLayoutOptions {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const sink = Number(r.chapterSink)
  return {
    chaptersStartRecto: bool(r.chaptersStartRecto, DEFAULT_BOOK_LAYOUT.chaptersStartRecto),
    justify: bool(r.justify, DEFAULT_BOOK_LAYOUT.justify),
    chapterSink: Number.isFinite(sink) && sink >= 0 && sink <= 0.6 ? sink : DEFAULT_BOOK_LAYOUT.chapterSink,
  }
}

/** Odd page numbers are right-hand pages, as in every printed book. */
export const sideOfFolio = (folio: number): PageSide => (Math.abs(folio) % 2 === 1 ? 'recto' : 'verso')

export interface PageInfo {
  /** 0-based position in the book. */
  index: number
  side: PageSide
  /** Title of the chapter in effect on this page ('' before the first chapter). */
  chapterTitle: string
  isChapterOpener: boolean
  isBlank: boolean
}

export interface Slots {
  left: string
  center: string
  right: string
}

export interface PageFurniture {
  /** Running head text ('' = none). */
  headerText: string
  /** Footer line text other than the page number ('' = none). */
  footerText: string
  /**
   * The footer line when it can't share the footer's row with a centred page
   * number: printed on its own full-width row below it, never squeezed into a corner.
   */
  footerNote: string
  /** Printed page number ('' = none). */
  numberText: string
  /** Band the page number sits in. */
  numberIn: 'header' | 'footer' | null
  /** Horizontal position of the page number on this page. */
  align: 'left' | 'center' | 'right'
  /** Render model: what goes in each third of the header and footer bands. */
  header: Slots
  footer: Slots
  smallCaps: boolean
}

const EMPTY: Slots = { left: '', center: '', right: '' }

export function folioOf(settings: Pick<HeaderFooterSettings, 'firstPageNumber'>, index: number): number {
  return settings.firstPageNumber + index
}

/** Header, footer and page number for one page. */
export function resolveHeaderFooter(
  settings: HeaderFooterSettings,
  doc: { title?: string | null },
  page: PageInfo,
): PageFurniture {
  const s = settings
  const none: PageFurniture = {
    headerText: '',
    footerText: '',
    footerNote: '',
    numberText: '',
    numberIn: null,
    align: 'center',
    header: { ...EMPTY },
    footer: { ...EMPTY },
    smallCaps: s.smallCapsRunningHeads,
  }
  if (page.isBlank && s.suppressOnBlankPages) return none

  const title = doc.title?.trim() || 'Untitled Manuscript'
  const author = s.authorName.trim()
  const chapter = page.chapterTitle.trim()
  const verso = page.side === 'verso'
  const outside: 'left' | 'right' = verso ? 'left' : 'right'

  const headFor = (c: HeadContent, custom: string): string => {
    switch (c) {
      case 'title':
        return title
      case 'author':
        return author || title
      case 'chapter':
        return (chapter && shortHeadOf(s.shortHeads, chapter).trim()) || chapter || title
      case 'custom':
        return custom.trim()
      default:
        return ''
    }
  }
  const footFor = (c: FooterContent): string =>
    c === 'title' ? title : c === 'author' ? author || title : c === 'custom' ? s.footerCustom.trim() : ''

  const opener = page.isChapterOpener && s.suppressOnChapterOpeners
  const headerText = opener || page.isBlank ? '' : verso ? headFor(s.versoHead, s.versoCustom) : headFor(s.rectoHead, s.rectoCustom)
  const footerText = page.isBlank ? '' : footFor(s.footer)

  let position = s.pageNumbers
  if (opener && position !== 'none') {
    // Drop folio: a number in the header moves to the foot of an opening page.
    if (s.openerFolio === 'none') position = 'none'
    else if (position === 'header-outside') position = 'footer-center'
  }
  const folio = folioOf(s, page.index)
  const numberText = position === 'none' ? '' : String(folio)
  const numberIn = position === 'none' ? null : position === 'header-outside' ? 'header' : 'footer'
  const align: PageFurniture['align'] = position === 'footer-center' || position === 'none' ? 'center' : outside

  const header: Slots = { ...EMPTY, center: headerText }
  const footer: Slots = { ...EMPTY }
  if (numberIn === 'header') header[outside] = numberText
  if (numberIn === 'footer') footer[align] = numberText
  let footerNote = ''
  if (footerText) {
    // The line takes the centre unless the number is there; then it gets a row of its own.
    if (!footer.center) footer.center = footerText
    else footerNote = footerText
  }

  return { headerText, footerText, footerNote, numberText, numberIn, align, header, footer, smallCaps: s.smallCapsRunningHeads }
}
