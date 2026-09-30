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

export interface DocFormat {
  presetId: string
  /** Overrides applied on top of the preset. */
  fontFamily?: string
  fontSizePt?: number
  lineHeight?: number
  /** When true, every chapter heading (H1) starts on a new page, even after font changes. */
  chapterStartsNewPage: boolean
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
