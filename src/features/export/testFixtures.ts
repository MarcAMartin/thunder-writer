import type { ThunderDoc } from '../../types'
import type { PMMark, PMNode } from './pm'

/** Test helpers (not used by app code). */
export const t = (text: string, ...marks: string[]): PMNode => ({
  type: 'text',
  text,
  ...(marks.length ? { marks: marks.map((m): PMMark => ({ type: m })) } : {}),
})
export const p = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content })
export const pa = (textAlign: string, ...content: PMNode[]): PMNode => ({ type: 'paragraph', attrs: { textAlign }, content })
export const h = (level: 1 | 2 | 3, text: string): PMNode => ({ type: 'heading', attrs: { level }, content: [t(text)] })
export const hr = (): PMNode => ({ type: 'horizontalRule' })
export const br = (): PMNode => ({ type: 'hardBreak' })
export const quote = (...content: PMNode[]): PMNode => ({ type: 'blockquote', content })
export const li = (...content: PMNode[]): PMNode => ({ type: 'listItem', content })
export const ul = (...items: PMNode[]): PMNode => ({ type: 'bulletList', content: items })
export const ol = (items: PMNode[], start?: number): PMNode => ({
  type: 'orderedList',
  ...(start !== undefined ? { attrs: { start } } : {}),
  content: items,
})

export function makeExportDoc(blocks: PMNode[], over: Partial<ThunderDoc> = {}): ThunderDoc {
  return {
    id: 'doc-x',
    title: 'My Novel',
    content: { type: 'doc', content: blocks },
    format: { presetId: 'trade-6x9', chapterStartsNewPage: true },
    createdAt: 1_000,
    updatedAt: 2_000,
    ...over,
  }
}

/** A novel of about `words` words across `chapters` chapters, with scene breaks and some emphasis. */
export function makeBigDoc(words = 120_000, chapters = 40): ThunderDoc {
  const vocab = 'the storm rolled over hills and she ran toward light while thunder spoke of old promises kept'.split(' ')
  const perChapter = Math.ceil(words / chapters)
  const perPara = 60
  const blocks: PMNode[] = []
  let w = 0
  for (let c = 1; c <= chapters; c++) {
    blocks.push(h(1, `Chapter ${c}`))
    let inChapter = 0
    let para = 0
    while (inChapter < perChapter && w < words) {
      const n = Math.min(perPara, perChapter - inChapter, words - w)
      const text: string[] = []
      for (let i = 0; i < n; i++) text.push(vocab[(w + i) % vocab.length])
      w += n
      inChapter += n
      para++
      const s = text.join(' ') + '.'
      blocks.push(para % 7 === 0 ? p(t(s.slice(0, 20)), t(s.slice(20), 'italic')) : p(t(s)))
      if (para % 25 === 0) blocks.push(hr())
    }
  }
  return makeExportDoc(blocks, { title: 'The Big One' })
}
