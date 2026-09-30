import type { Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextAlign } from '@tiptap/extension-text-align'
import { Highlight } from '@tiptap/extension-highlight'
import { Placeholder } from '@tiptap/extension-placeholder'
import { CharacterCount } from '@tiptap/extension-character-count'
import { FontFamily, TextStyle } from '@tiptap/extension-text-style'
import { PageBreaks, SuggestionHighlight } from './extensions'

/** Friendly names for heading levels in a novel. */
export const HEADING_LABELS: Record<1 | 2 | 3, string> = { 1: 'Chapter', 2: 'Section', 3: 'Scene heading' }

/**
 * The editor's extension set. StarterKit v3 already bundles Underline (and
 * Link, which a manuscript doesn't need), so Underline is configured through it.
 */
export function createExtensions(opts: { placeholder?: string } = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      code: false,
      codeBlock: false,
    }),
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    Highlight.configure({ multicolor: false }),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === 'heading'
          ? HEADING_LABELS[(node.attrs.level as 1 | 2 | 3) ?? 1] ?? 'Heading'
          : opts.placeholder ?? 'Start with an idea…',
    }),
    CharacterCount,
    TextStyle,
    FontFamily,
    SuggestionHighlight,
    PageBreaks,
  ]
}
