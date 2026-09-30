import { getSchema, type JSONContent } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { createExtensions } from './editorExtensions'

/**
 * Stored manuscripts come from IndexedDB, Google Drive or imported files, and
 * may have been written by another build or edited by hand. TipTap silently
 * replaces content it can't parse (an unknown node or mark, e.g. a `link` mark)
 * with an EMPTY document; the next keystroke would then overwrite the real
 * manuscript. So content is checked against the editor schema before the
 * editor ever sees it, and bad content is never loaded or overwritten.
 */

let cachedSchema: Schema | null = null

/** The editor's schema (same extensions as the live editor). */
export function editorSchema(): Schema {
  if (!cachedSchema) cachedSchema = getSchema(createExtensions())
  return cachedSchema
}

export type ContentCheck = { ok: true } | { ok: false; reason: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Would TipTap load this content faithfully? `null`/`undefined` means "new, empty doc" and is fine. */
export function checkContent(content: unknown, schema: Schema = editorSchema()): ContentCheck {
  if (content === null || content === undefined) return { ok: true }
  if (!isRecord(content) || content.type !== 'doc') {
    return { ok: false, reason: 'The saved content is not a document Thunder Writer can read.' }
  }
  try {
    schema.nodeFromJSON(content)
    return { ok: true }
  } catch (e) {
    const detail = e instanceof Error && e.message ? ` (${e.message})` : ''
    return {
      ok: false,
      reason: `This manuscript uses formatting this version of Thunder Writer doesn't support${detail}.`,
    }
  }
}

/**
 * A copy of `content` the editor can load: unknown marks are dropped, unknown
 * nodes are unwrapped (their text is kept), loose inline content is wrapped in
 * paragraphs. Falls back to plain paragraphs of text if that still fails.
 */
export function sanitizeContent(content: unknown, schema: Schema = editorSchema()): JSONContent {
  const cleaned = cleanNode(content, schema)
  const root: JSONContent =
    cleaned.length === 1 && cleaned[0].type === 'doc'
      ? { ...cleaned[0], content: wrapInline(cleaned[0].content ?? [], schema) }
      : { type: 'doc', content: wrapInline(cleaned, schema) }
  if (!root.content || root.content.length === 0) root.content = [{ type: 'paragraph' }]
  try {
    schema.nodeFromJSON(root)
    return root
  } catch {
    return plainTextDoc(content)
  }
}

function cleanMarks(marks: unknown, schema: Schema): JSONContent['marks'] {
  if (!Array.isArray(marks)) return undefined
  const kept = marks.filter((m): m is { type: string; attrs?: Record<string, unknown> } => {
    return isRecord(m) && typeof m.type === 'string' && m.type in schema.marks
  })
  return kept.length ? kept : undefined
}

function cleanNode(node: unknown, schema: Schema): JSONContent[] {
  if (!isRecord(node) || typeof node.type !== 'string') return []
  if (node.type === 'text') {
    if (typeof node.text !== 'string' || node.text.length === 0) return []
    const marks = cleanMarks(node.marks, schema)
    return [{ type: 'text', text: node.text, ...(marks ? { marks } : {}) }]
  }
  const children = Array.isArray(node.content) ? node.content.flatMap((c) => cleanNode(c, schema)) : []
  if (node.type in schema.nodes) {
    const out: JSONContent = { type: node.type }
    if (isRecord(node.attrs)) out.attrs = node.attrs
    const marks = cleanMarks(node.marks, schema)
    if (marks) out.marks = marks
    if (children.length) out.content = children
    return [out]
  }
  // Unknown node (e.g. a codeBlock): keep what it contains.
  if (children.length && children.every((c) => isInlineType(c.type, schema))) {
    return [{ type: 'paragraph', content: children }]
  }
  return children
}

function isInlineType(type: string | undefined, schema: Schema): boolean {
  if (!type) return false
  return schema.nodes[type]?.isInline ?? false
}

/** Wrap runs of inline nodes sitting at block level in paragraphs. */
function wrapInline(nodes: JSONContent[], schema: Schema): JSONContent[] {
  const out: JSONContent[] = []
  let run: JSONContent[] = []
  const end = () => {
    if (run.length) out.push({ type: 'paragraph', content: run })
    run = []
  }
  for (const n of nodes) {
    if (isInlineType(n.type, schema)) run.push(n)
    else {
      end()
      out.push(n)
    }
  }
  end()
  return out
}

/** Last resort: every text-bearing block becomes a plain paragraph. */
function plainTextDoc(content: unknown): JSONContent {
  const paras: string[] = []
  const textOf = (k: unknown) => (isRecord(k) && typeof k.text === 'string' ? k.text : '')
  const walk = (n: unknown): void => {
    if (!isRecord(n)) return
    const kids: unknown[] = Array.isArray(n.content) ? n.content : []
    if (kids.some((k) => textOf(k) !== '')) {
      const t = kids.map(textOf).join('')
      if (t.trim()) paras.push(t)
    } else kids.forEach(walk)
  }
  walk(content)
  return {
    type: 'doc',
    content: paras.length ? paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) : [{ type: 'paragraph' }],
  }
}
