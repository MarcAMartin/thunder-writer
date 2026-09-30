/**
 * Development harness for the book preview (not used by the app). Render it
 * from a throwaway Vite entry. Query parameters:
 *   ?doc=big|short   120k-word novel (default) or a short story
 *   &theme=dark      dark theme
 *   &preset=<id>     book preset (default trade-6x9)
 * It exposes window.__bp for browser-automation measurements.
 */
import { useMemo, useState } from 'react'
import { useDocuments } from '../../../store/documents'
import type { ThunderDoc } from '../../../types'
import { BookPreview, type LayoutUpdate } from '../BookPreview'

declare global {
  interface Window {
    __bp?: { t0: number; updates: (LayoutUpdate & { at: number })[]; words: number; genMs: number }
  }
}

let seed = 42
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
const WORDS =
  'the rain came down across the harbour and Mara watched the lights of the fishing boats go out one by one while her brother argued with the ferryman about a debt nobody remembered she thought of their mother’s letters folded in the tin box under the stairs and of the winter the river froze so hard the whole town walked across it to the island church where the bells had not rung since before the war a gull settled on the rail looked at her with its yellow eye and flew off toward the lighthouse'.split(
    ' ',
  )
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]

function sentence() {
  const n = 8 + Math.floor(rnd() * 14)
  const w: string[] = []
  for (let i = 0; i < n; i++) w.push(pick(WORDS))
  w[0] = w[0][0].toUpperCase() + w[0].slice(1)
  return w.join(' ') + pick(['.', '.', '.', '?', '!', '.'])
}
function paragraphText(target: number) {
  const s: string[] = []
  let count = 0
  while (count < target) {
    const x = sentence()
    s.push(x)
    count += x.split(' ').length
  }
  return s.join(' ')
}

const TITLES = ['The Harbour', 'Ice', 'Letters', 'The Ferryman', 'Bells', 'The Island', 'Gulls', 'Winter']

export function generateManuscript(chapters: number, paras: number): { content: unknown; words: number } {
  seed = 42
  const content: unknown[] = []
  let words = 0
  for (let c = 1; c <= chapters; c++) {
    content.push({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: `Chapter ${c}: ${pick(TITLES)}` }] })
    for (let p = 0; p < paras; p++) {
      if (p === Math.floor(paras / 2)) {
        content.push({ type: 'horizontalRule' })
        continue
      }
      const t = paragraphText(34 + Math.floor(rnd() * 16))
      words += t.split(' ').length
      if (rnd() < 0.12) {
        const w = t.split(' ')
        content.push({
          type: 'paragraph',
          content: [
            { type: 'text', text: w.slice(0, 5).join(' ') + ' ' },
            { type: 'text', text: w.slice(5, 9).join(' '), marks: [{ type: 'italic' }] },
            { type: 'text', text: ' ' + w.slice(9).join(' ') },
          ],
        })
      } else content.push({ type: 'paragraph', content: [{ type: 'text', text: t }] })
      if (c === 2 && p === 3) {
        content.push({
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: paragraphText(40) }] },
            { type: 'paragraph', content: [{ type: 'text', text: paragraphText(30) }] },
          ],
        })
      }
    }
  }
  return { content: { type: 'doc', content }, words }
}

export function PreviewHarness() {
  const params = new URLSearchParams(location.search)
  const which = params.get('doc') === 'short' ? 'short' : 'big'
  const preset = params.get('preset') ?? 'trade-6x9'
  const [open, setOpen] = useState(true)
  const docId = useMemo(() => {
    const g0 = performance.now()
    const { content, words } = which === 'big' ? generateManuscript(40, 62) : generateManuscript(3, 14)
    const genMs = performance.now() - g0
    const doc: ThunderDoc = {
      id: `harness-${which}`,
      title: which === 'big' ? 'The Frozen River' : 'Salt and Lanterns',
      content,
      format: { presetId: preset, chapterStartsNewPage: true },
      createdAt: 1,
      updatedAt: 2,
    }
    useDocuments.setState({ docs: { [doc.id]: doc }, currentId: doc.id, hydrated: true })
    window.__bp = { t0: performance.now(), updates: [], words, genMs }
    return doc.id
  }, [which, preset])

  if (!open)
    return (
      <button type="button" className="tw-btn" onClick={() => setOpen(true)} style={{ margin: 24 }}>
        Preview
      </button>
    )
  return (
    <BookPreview
      docId={docId}
      onClose={() => setOpen(false)}
      headerFooter={{ authorName: 'Mara Vance' }}
      onLayoutUpdate={(u) => window.__bp?.updates.push({ ...u, at: performance.now() - (window.__bp?.t0 ?? 0) })}
    />
  )
}
