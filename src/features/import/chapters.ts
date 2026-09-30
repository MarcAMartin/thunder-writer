/**
 * Recognising manuscript structure that was typed as plain lines: chapter
 * headings ("Chapter 1", "CHAPTER ONE", "Chapter Twelve: The Storm", "Prologue")
 * and scene breaks ("* * *", "#", "§"). These only ever look at a whole,
 * standalone paragraph, never at a line inside running prose.
 */

const ONES = 'one|two|three|four|five|six|seven|eight|nine'
const TEENS = 'ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen'
const TENS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety'
const UNDER_100 = `(?:(?:${TENS})(?:[-\\s](?:${ONES}))?|${TEENS}|${ONES})`
const NUMBER_WORD = `(?:(?:(?:one|a)\\s+)?hundred(?:\\s+(?:and\\s+)?${UNDER_100})?|${UNDER_100})`
const ORDINAL = 'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final'
const ROMAN = '(?=[mdclxvi])m{0,3}(?:c[md]|d?c{0,3})(?:x[cl]|l?x{0,3})(?:i[xv]|v?i{0,3})'
const NUMBER = `(?:\\d{1,4}|${ROMAN}|${NUMBER_WORD})`

/**
 * What may follow the number: nothing, a separator and a short title
 * ("Chapter 3: The Storm", "Chapter 3 — The Storm", "Chapter 3. The Storm"),
 * or a capitalised title ("Chapter 3 The Storm"). "Chapter one began badly"
 * continues in lower case, so it is prose, not a heading.
 */
const TAIL = `(?:\\s*[:.\\-–—]\\s*(?<sep>.*)|\\s+(?<cap>\\S.*))?`
/** Checked outside the regex: under the `i` flag, \\p{Lu} would match lower case too. */
const CAPITALISED = /^[\p{Lu}\d"“‘'(\[]/u

const CHAPTER = new RegExp(`^(?:(?:chapter|chap|ch)\\s+|(?:chap|ch)\\.\\s*)${NUMBER}(?![\\p{L}\\d])${TAIL}$`, 'iu')
const PART = new RegExp(`^(?:part|book|volume)\\s+(?:${NUMBER}|the\\s+(?:${ORDINAL}))(?![\\p{L}\\d])${TAIL}$`, 'iu')
const SPECIAL = new RegExp(
  `^(?:prologue|epilogue|interlude|preface|foreword|afterword)(?:\\s+${NUMBER})?(?![\\p{L}\\d])${TAIL}$`,
  'iu',
)
/** Upper-case Roman numerals or a small number standing alone ("IV", "12."). */
const BARE_ROMAN = /^(?=[MDCLXVI])M{0,3}(?:C[MD]|D?C{0,3})(?:X[CL]|L?X{0,3})(?:I[XV]|V?I{0,3})\.?$/
const BARE_NUMBER = /^\d{1,3}\.?$/

const MAX_HEADING_CHARS = 80
const MAX_TITLE_WORDS = 10

function tailLooksLikeTitle(groups: Record<string, string | undefined> | undefined): boolean {
  if (groups?.cap !== undefined && !CAPITALISED.test(groups.cap)) return false
  const tail = (groups?.sep ?? groups?.cap ?? '').trim()
  if (!tail) return true
  if (/[,;:]$/.test(tail)) return false
  const words = tail.split(/\s+/).length
  if (words > MAX_TITLE_WORDS) return false
  // "Chapter 1. It was a dark and stormy night, and the rain fell." is prose.
  if (/[.]$/.test(tail) && words > 6) return false
  return true
}

/** "Chapter 1", "CHAPTER ONE", "Ch. 3", "Chapter Twelve: The Storm", "Part One", "Prologue", "Epilogue", "Interlude". */
export function isChapterHeading(line: string): boolean {
  const t = line.trim()
  if (!t || t.length > MAX_HEADING_CHARS || t.includes('\n')) return false
  for (const re of [CHAPTER, PART, SPECIAL]) {
    const m = re.exec(t)
    if (m) return tailLooksLikeTitle(m.groups)
  }
  return false
}

/**
 * A Roman numeral or number alone on a line. Only promoted when a manuscript
 * has at least two of them counting up (see bareChapterValue), so a stray "I"
 * or "1", or a "XXX" to-do marker, is never mistaken for a chapter.
 */
export function isBareChapterNumber(line: string): boolean {
  return bareChapterValue(line) !== null
}

const ROMAN_VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }

/** The number a bare chapter line stands for ("IV" → 4, "12." → 12), or null if it isn't one. */
export function bareChapterValue(line: string): number | null {
  const t = line.trim()
  if (BARE_NUMBER.test(t)) return parseInt(t, 10)
  if (!BARE_ROMAN.test(t)) return null
  const letters = t.replace(/\.$/, '')
  let total = 0
  for (let i = 0; i < letters.length; i++) {
    const v = ROMAN_VALUES[letters[i]]
    const next = ROMAN_VALUES[letters[i + 1]] ?? 0
    total += v < next ? -v : v
  }
  return total
}

/**
 * Of a manuscript's bare chapter numbers (in order), the indexes of the longest
 * run counting up one at a time (I, II, III or 3, 4, 5), skipping strays in
 * between. Two "XXX" markers, or "MIX" and "DIV", never form a run.
 */
export function bareChapterSequence(values: number[]): number[] {
  let best: number[] = []
  for (let start = 0; start < values.length; start++) {
    if (values.length - start <= best.length) break
    const run = [start]
    let expect = values[start] + 1
    for (let i = start + 1; i < values.length; i++) {
      if (values[i] === expect) {
        run.push(i)
        expect++
      }
    }
    if (run.length > best.length) best = run
  }
  return best.length >= 2 ? best : []
}

/**
 * "***", "* * *", "#", "~~~", "§", "⁂", "—", "- - -", "•••": a line made only
 * of break symbols (at most 12 of them).
 */
const SCENE_BREAK = /^(?:[*#~§•·⁂✱✳✦✧◆◇♦❖○●=+—–\-_]\s*){1,12}$/u

export function isSceneBreak(line: string): boolean {
  const t = line.trim()
  return t.length > 0 && t.length <= 40 && SCENE_BREAK.test(t)
}
