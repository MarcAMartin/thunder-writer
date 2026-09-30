/**
 * Minimal, tolerant view of the TipTap/ProseMirror JSON stored in
 * ThunderDoc.content. Converters walk this shape; unknown nodes degrade to
 * their text so no words are ever dropped from an export.
 */
export interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  marks?: PMMark[]
  text?: string
}

/** Marks every exporter understands, in the nesting order they are opened. */
export const MARK_ORDER = ['bold', 'italic', 'underline', 'strike', 'highlight'] as const
export type KnownMark = (typeof MARK_ORDER)[number]

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function toNode(v: unknown): PMNode | null {
  if (!isObj(v) || typeof v.type !== 'string') return null
  const n: PMNode = { type: v.type }
  if (isObj(v.attrs)) n.attrs = v.attrs
  if (typeof v.text === 'string') n.text = v.text
  if (Array.isArray(v.marks)) {
    n.marks = v.marks.filter((m): m is PMMark => isObj(m) && typeof m.type === 'string')
  }
  if (Array.isArray(v.content)) n.content = v.content.map(toNode).filter((c): c is PMNode => c !== null)
  return n
}

/** Top-level blocks of a stored document (null/garbage → no blocks). */
export function docBlocks(content: unknown): PMNode[] {
  const root = toNode(content)
  if (!root) return []
  if (root.type === 'doc') return root.content ?? []
  return [root]
}

export const children = (n: PMNode): PMNode[] => n.content ?? []

export function markSet(n: PMNode): Set<KnownMark> {
  const s = new Set<KnownMark>()
  for (const m of n.marks ?? []) if ((MARK_ORDER as readonly string[]).includes(m.type)) s.add(m.type as KnownMark)
  return s
}

export function markAttr(n: PMNode, type: string, attr: string): unknown {
  return n.marks?.find((m) => m.type === type)?.attrs?.[attr]
}

export type Align = 'left' | 'center' | 'right' | 'justify'
const ALIGNS: readonly string[] = ['left', 'center', 'right', 'justify']

/** The node's explicit text alignment, if valid. */
export function alignOf(n: PMNode): Align | null {
  const a = n.attrs?.textAlign
  return typeof a === 'string' && ALIGNS.includes(a) ? (a as Align) : null
}

export function headingLevel(n: PMNode): 1 | 2 | 3 {
  const l = Number(n.attrs?.level)
  return l === 2 ? 2 : l === 3 ? 3 : 1
}

/** Concatenated text of a node (hard breaks become `br`). */
export function plainText(n: PMNode, br = '\n'): string {
  if (n.type === 'text') return n.text ?? ''
  if (n.type === 'hardBreak') return br
  return children(n)
    .map((c) => plainText(c, br))
    .join('')
}

/** Characters that are illegal in XML 1.0 (and therefore corrupt a .docx/.html). */
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export const stripIllegalXml = (s: string) => s.replace(XML_ILLEGAL, '')

/** Paragraph-level "no first-line indent" rule, mirroring the editor's CSS. */
export function isIndentBreaker(n: PMNode | undefined): boolean {
  return !n || ['heading', 'horizontalRule', 'blockquote', 'bulletList', 'orderedList'].includes(n.type)
}

