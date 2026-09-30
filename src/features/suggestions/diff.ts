export type DiffSegment = { type: 'same' | 'del' | 'ins'; text: string }

const tokenize = (s: string) => s.split(/(\s+)/).filter((t) => t.length > 0)

/**
 * Minimal word-level before/after diff: keeps the common leading and trailing
 * words and marks the middle as removed/inserted. Suggestions usually change a
 * single contiguous span, so this reads well without a diff library.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  const a = tokenize(before)
  const b = tokenize(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const segs: DiffSegment[] = []
  const push = (type: DiffSegment['type'], tokens: string[]) => {
    const text = tokens.join('')
    if (text) segs.push({ type, text })
  }
  push('same', a.slice(0, start))
  push('del', a.slice(start, endA))
  push('ins', b.slice(start, endB))
  push('same', a.slice(endA))
  return segs
}
