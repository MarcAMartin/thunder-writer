import type { ThunderDoc } from '../../types'
import { children, docBlocks, headingLevel, plainText, type PMNode } from './pm'

/**
 * Plain UTF-8 text. Paragraphs are separated by a blank line; a chapter title
 * gets two blank lines before it and one after; scene breaks are "* * *".
 * The writer's words are written exactly as typed.
 */
export function toPlainText(doc: Pick<ThunderDoc, 'content'>): string {
  const body = renderBlocks(docBlocks(doc.content), true)
  return body ? `${body}\n` : ''
}

const isList = (n: PMNode) => n.type === 'bulletList' || n.type === 'orderedList'

function renderBlocks(blocks: PMNode[], topLevel = false, inItem = false): string {
  let out = ''
  let first = true
  for (const b of blocks) {
    const s = renderBlock(b)
    if (s === null) continue
    if (!first) {
      out += topLevel && b.type === 'heading' && headingLevel(b) === 1 ? '\n\n\n' : inItem && isList(b) ? '\n' : '\n\n'
    }
    out += s
    first = false
  }
  return out
}

function renderBlock(n: PMNode): string | null {
  switch (n.type) {
    case 'paragraph':
      return plainText(n)
    case 'heading': {
      const t = plainText(n, ' ').trim()
      return t || null
    }
    case 'horizontalRule':
      return '* * *'
    case 'blockquote':
      return indent(renderBlocks(children(n)), '    ')
    case 'bulletList':
      return list(n, () => '• ')
    case 'orderedList': {
      const start = Number.isInteger(n.attrs?.start) ? (n.attrs!.start as number) : 1
      return list(n, (i) => `${start + i}. `)
    }
    default: {
      const kids = children(n)
      if (kids.some((c) => c.type === 'text' || c.type === 'hardBreak')) return plainText(n)
      return kids.length ? renderBlocks(kids) : null
    }
  }
}

function list(n: PMNode, marker: (i: number) => string): string | null {
  const items = children(n).map((li, i) => {
    const m = marker(i)
    const body = renderBlocks(li.type === 'listItem' ? children(li) : [li], false, true)
    const [head = '', ...rest] = body.split('\n')
    return [m + head, ...rest.map((l) => (l ? ' '.repeat(m.length) + l : ''))].join('\n').trimEnd()
  })
  return items.length ? items.join('\n') : null
}

const indent = (s: string, pad: string) =>
  s
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n')
