import { DOMSerializer, type Node as PMNode, type Schema } from '@tiptap/pm/model'
import { checkContent, editorSchema, sanitizeContent } from '../editor/contentCheck'
import type { BookBlockKind } from './paginateBook'

/**
 * The manuscript as a list of top-level blocks, built from the stored TipTap
 * JSON through the editor's own schema. Unknown nodes and marks are dropped
 * (sanitizeContent), so what the preview renders is exactly what the schema's
 * `toDOM` specs produce. It never renders raw imported HTML and never uses innerHTML.
 *
 * This is the same serialization `generateHTML` from @tiptap/core performs
 * (it uses DOMSerializer.fromSchema over getSchema(extensions)), minus the
 * string round trip. Keeping ProseMirror nodes lets the layout serialize one
 * chunk of blocks at a time, and lets each page render only its own blocks.
 */
export interface RenderBlock {
  node: PMNode
  kind: BookBlockKind
  /** Paragraph without first-line indent (first in the book, after a heading/scene break/list/quote, centred/right). */
  noIndent: boolean
  /** Chapter heading text, for kind 'chapter'. */
  title?: string
}

export interface RenderModel {
  schema: Schema
  blocks: RenderBlock[]
  wordCount: number
}

/** Mirrors the editor's `:is(h1, h2, h3, hr, blockquote, ul, ol) + p { text-indent: 0 }`. */
const INDENT_BREAKERS = new Set(['heading', 'horizontalRule', 'blockquote', 'bulletList', 'orderedList'])

function kindOf(node: PMNode): BookBlockKind {
  switch (node.type.name) {
    case 'heading':
      return node.attrs.level === 1 ? 'chapter' : 'heading'
    case 'paragraph':
      return 'text'
    case 'horizontalRule':
      return 'break'
    default:
      return node.isTextblock ? 'text' : node.isAtom ? 'break' : 'container'
  }
}

export function buildRenderModel(content: unknown, schema: Schema = editorSchema()): RenderModel {
  const json = checkContent(content, schema).ok && content ? content : sanitizeContent(content, schema)
  let doc: PMNode
  try {
    doc = schema.nodeFromJSON(json)
  } catch {
    doc = schema.nodeFromJSON(sanitizeContent(content, schema))
  }
  const blocks: RenderBlock[] = []
  let prev: PMNode | null = null
  let words = 0
  doc.forEach((node) => {
    const kind = kindOf(node)
    const align = node.attrs?.textAlign
    const noIndent =
      kind === 'text' && (prev === null || INDENT_BREAKERS.has(prev.type.name) || align === 'center' || align === 'right')
    const b: RenderBlock = { node, kind, noIndent }
    if (kind === 'chapter') b.title = node.textContent.replace(/\s+/g, ' ').trim()
    blocks.push(b)
    prev = node
  })
  doc.descendants((n) => {
    if (n.isText && n.text) words += countWords(n.text)
    return true
  })
  return { schema, blocks, wordCount: words }
}

function countWords(s: string): number {
  let n = 0
  let inWord = false
  for (let i = 0; i < s.length; i++) {
    const ws = s.charCodeAt(i) <= 32
    if (!ws && !inWord) n++
    inWord = !ws
  }
  return n
}

const serializers = new WeakMap<Schema, DOMSerializer>()

function serializerFor(schema: Schema): DOMSerializer {
  let s = serializers.get(schema)
  if (!s) serializers.set(schema, (s = DOMSerializer.fromSchema(schema)))
  return s
}

export const BLOCK_CLASS = 'bp-block'

/** A detached DOM element for one block, styled by `.bp-text` rules in preview.css. */
export function renderBlockElement(block: RenderBlock, schema: Schema, doc: Document = document): HTMLElement {
  const out = serializerFor(schema).serializeNode(block.node, { document: doc })
  let el: HTMLElement
  if (out.nodeType === 1) el = out as HTMLElement
  else {
    el = doc.createElement('div')
    el.appendChild(out)
  }
  el.classList.add(BLOCK_CLASS)
  if (block.noIndent) el.classList.add('bp-noindent')
  // An empty paragraph is one blank line (the editor shows it that way), not zero height.
  const leaves = el.matches('p,h1,h2,h3') ? [el] : Array.from(el.querySelectorAll<HTMLElement>('p,h1,h2,h3'))
  for (const leaf of leaves) if (!leaf.firstChild) leaf.appendChild(doc.createElement('br'))
  return el
}

/** The text-bearing elements of a rendered block, in order (the block itself for a paragraph/heading). */
export function leafElements(el: HTMLElement): HTMLElement[] {
  if (el.matches('p,h1,h2,h3')) return [el]
  const leaves = Array.from(el.querySelectorAll<HTMLElement>('p,h1,h2,h3'))
  return leaves.length ? leaves : [el]
}
