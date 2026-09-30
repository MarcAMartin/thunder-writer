import type { ThunderDoc } from '../../types'

/** Test fixture helper (not used by app code). */
export function makeDoc(over: Partial<ThunderDoc> = {}): ThunderDoc {
  return {
    id: 'doc-1',
    title: 'The Long Storm',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It began.' }] }] },
    format: { presetId: 'trade-6x9', chapterStartsNewPage: true },
    createdAt: 1_000,
    updatedAt: 2_000,
    ...over,
  }
}
