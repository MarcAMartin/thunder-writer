// Shared domain types. Every feature module codes against these; change them
// only in coordination with all consumers.

export type ThemeMode = 'light' | 'dark' | 'system'

export type AIProvider = 'claude' | 'openai'

/** A physical book trim size with typesetting defaults so writers see real page breaks. */
export interface BookPreset {
  id: string
  label: string
  /** Trim size in inches. */
  widthIn: number
  heightIn: number
  /** Page margins in inches. */
  marginIn: { top: number; right: number; bottom: number; left: number }
  fontFamily: string
  fontSizePt: number
  lineHeight: number
}

/* ------------------------- printed-book settings ------------------------- */
// Running heads, footers and page numbers for the printed book, and the book
// layout choices that move page breaks. Stored in DocFormat; always read them
// through normalizeHeaderFooter / normalizeBookLayout (features/preview/headerFooter),
// which fill in defaults for old documents and repair hand-edited values.

export type HeadContent = 'none' | 'title' | 'author' | 'chapter' | 'custom'
export type FooterContent = 'none' | 'title' | 'author' | 'custom'
export type PageNumberPosition = 'footer-center' | 'footer-outside' | 'header-outside' | 'none'

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
  /**
   * Short running heads for chapters whose title is too long for the head line,
   * keyed by the chapter title as written. Used wherever a head shows the chapter.
   */
  shortHeads: Record<string, string>
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

export interface DocFormat {
  presetId: string
  /** Overrides applied on top of the preset. */
  fontFamily?: string
  fontSizePt?: number
  lineHeight?: number
  /** When true, every chapter heading (H1) starts on a new page, even after font changes. */
  chapterStartsNewPage: boolean
  /** Running heads, footer line and page numbers (Book preview, Word and print exports). Missing = defaults. */
  headerFooter?: Partial<HeaderFooterSettings>
  /** Printed-book layout: chapters on right-hand pages, justification, chapter sink. Missing = defaults. */
  bookLayout?: Partial<BookLayoutOptions>
}

export interface ThunderDoc {
  id: string
  title: string
  /** TipTap/ProseMirror JSON document. */
  content: unknown
  format: DocFormat
  createdAt: number
  updatedAt: number
  /** Google Drive file id once the doc has been saved to Drive. */
  driveFileId?: string
  /** Last time this doc was successfully written to Drive. */
  driveSyncedAt?: number
  /**
   * Drive's headRevisionId of the file as of the last sync from this browser.
   * Before overwriting the Drive file, autosave checks it is unchanged, so a
   * newer version saved from another device is never silently replaced.
   */
  driveRevisionId?: string
}

export type SuggestionKind = 'grammar' | 'spelling' | 'style' | 'context' | 'general' | 'trivia'

export type SuggestionStatus = 'open' | 'accepted' | 'declined' | 'done' | 'hidden'

export interface Suggestion {
  id: string
  kind: SuggestionKind
  /** Short one-line headline shown collapsed. */
  title: string
  /** Full explanation shown on hover/expand. */
  detail: string
  /**
   * Exact text span in the document this suggestion refers to. Used to locate and
   * highlight the passage. Absent for suggestions that are not tied to a passage.
   */
  quote?: string
  /** Replacement text for `quote`. When present, "Accept" swaps quote -> replacement. */
  replacement?: string
  status: SuggestionStatus
  createdAt: number
  provider: AIProvider
  model: string
  /**
   * Web pages the provider's search tool cited for this suggestion (web-searched
   * trivia only). Sanitised: http(s) URLs only, plain-text titles, capped count.
   */
  sources?: SuggestionSource[]
}

export interface SuggestionSource {
  url: string
  title: string
}

/** A reference file the writer uploads so suggestions understand their voice/world. */
export interface ContextFile {
  id: string
  name: string
  /** Extracted plain text. */
  text: string
  addedAt: number
}

export interface AIUsage {
  inputTokens: number
  outputTokens: number
  /** Includes any web-search charges. */
  costUsd: number
  /** Provider-run web searches billed for these requests (absent when none). */
  webSearches?: number
}
