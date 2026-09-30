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
 * Everything here is pure; the preview, the settings panel's diagram and (later)
 * the exporters all call resolveHeaderFooter so they agree page by page.
 */

export type HeadContent = 'none' | 'title' | 'author' | 'chapter' | 'custom'
export type FooterContent = 'none' | 'title' | 'author' | 'custom'
export type PageNumberPosition = 'footer-center' | 'footer-outside' | 'header-outside' | 'none'
export type PageSide = 'recto' | 'verso'

export interface HeaderFooterSettings {
  /** Used in running heads. Empty falls back to the book title. */
  authorName: string
  /** Running head on left-hand (even) pages. */
  versoHead: HeadContent
  /** Running head on right-hand (odd) pages. */
  rectoHead: HeadContent
  /** Text used when a head is 'custom'. */
  versoCustom: string
  rectoCustom: string
  /** Small line centred in the footer of every text page (e.g. "Advance reader copy"). */
  footer: FooterContent
  footerCustom: string
  pageNumbers: PageNumberPosition
  /** Number printed on the first page. Odd numbers fall on right-hand pages. */
  firstPageNumber: number
  /** No running head on a chapter's first page (standard). */
  suppressOnChapterOpeners: boolean
  /**
   * The page number on a chapter's first page: 'drop' moves it to the foot of
   * the page (a "drop folio", the usual practice), 'none' hides it.
   */
  openerFolio: 'drop' | 'none'
  /** Blank pages carry no running head, footer or number. */
  suppressOnBlankPages: boolean
  /** Running head / folio size relative to body text. */
  fontScale: number
  smallCapsRunningHeads: boolean
}

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

/** Book layout choices that change where pages break (unlike heads and folios). */
export interface BookLayoutOptions {
  /** Chapters open on a right-hand page, with a blank left page inserted when needed. */
  chaptersStartRecto: boolean
  /** Justified body text, as in most printed books. Line breaks are the same either way. */
  justify: boolean
  /** Where a chapter opener's heading sits, as a fraction of the text-block height ("sink"). */
  chapterSink: number
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
  const inside: 'left' | 'right' = verso ? 'right' : 'left'

  const headFor = (c: HeadContent, custom: string): string => {
    switch (c) {
      case 'title':
        return title
      case 'author':
        return author || title
      case 'chapter':
        return chapter || title
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
  if (footerText) {
    // The note takes the centre unless the number is there; then it moves to the gutter side.
    if (!footer.center) footer.center = footerText
    else footer[inside] = footerText
  }

  return { headerText, footerText, numberText, numberIn, align, header, footer, smallCaps: s.smallCapsRunningHeads }
}
