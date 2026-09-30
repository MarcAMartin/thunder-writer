// Cross-feature contracts. Implementations live in the owning feature; consumers
// import only these interfaces so modules can be built independently.

import type { Editor } from '@tiptap/react'

/**
 * Bridge the suggestions feature uses to talk to the editor without reaching
 * into TipTap internals. Implemented by features/editor (createEditorBridge).
 */
export interface EditorBridge {
  /** Plain text of the whole document, paragraphs separated by "\n\n". */
  getPlainText(): string
  /**
   * Plain text around the writer's cursor (roughly the last N characters before
   * it and a little after), used as the "focus" for suggestions.
   */
  getTextNearCursor(maxChars: number): string
  /** Locate `quote` in the doc; returns false if it no longer exists. */
  hasQuote(quote: string): boolean
  /** Scroll to and visually mark `quote` as the active suggestion. Returns false if not found. */
  highlightQuote(quote: string): boolean
  /** Remove any suggestion highlight. */
  clearHighlight(): void
  /** Replace the first occurrence of `quote` with `replacement` as one undoable step. Returns false if not found. */
  replaceQuote(quote: string, replacement: string): boolean
}

/** React context value exposing the live editor to sibling panes (toolbar, stats, suggestions). */
export interface EditorContextValue {
  editor: Editor | null
  bridge: EditorBridge | null
}
