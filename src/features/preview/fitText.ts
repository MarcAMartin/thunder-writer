import { chapterKey, resolveHeaderFooter, type HeaderFooterSettings } from './headerFooter'
import type { BookGeometry } from './layout'

/**
 * Which running heads and footer lines are too wide for their line at the
 * book's trim size, so the Headers & footers panel can flag them (BookPage
 * shrinks them to fit rather than cutting them off, but a writer should
 * choose a shorter text). Measured in an offscreen span that uses the page
 * bands' type (keep in step with `.bp-band` / `.bp-smallcaps` in preview.css).
 */

export interface FitReport {
  /** The left-page head (non-chapter content) is too long. */
  verso: boolean
  recto: boolean
  /** The footer line is too long. */
  footer: boolean
  /** Chapter titles (as written) too long for a head that shows the chapter, even with their short head if set. */
  chapters: string[]
}

export const NO_FIT_ISSUES: FitReport = { verso: false, recto: false, footer: false, chapters: [] }

/** Folio room on each side of the band, in band ems (see `.bp-band` grid columns). */
const SIDE_EM = 2.6

export type TextMeasurer = (texts: readonly string[], style: { fontFamily: string; fontPx: number; smallCaps: boolean }) => number[] | null

/** Widths in px as the page bands draw the texts, or null where the DOM can't lay out (tests). */
export const measureBandTexts: TextMeasurer = (texts, style) => {
  if (typeof document === 'undefined' || texts.length === 0) return null
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  const st = host.style
  st.position = 'fixed'
  st.left = '-20000px'
  st.top = '0'
  st.visibility = 'hidden'
  st.pointerEvents = 'none'
  st.whiteSpace = 'nowrap'
  st.fontFamily = style.fontFamily
  st.fontSize = `${style.fontPx}px`
  st.fontVariantNumeric = 'oldstyle-nums proportional-nums'
  const spans = texts.map((t) => {
    const s = document.createElement('span')
    s.style.display = 'inline-block'
    s.style.letterSpacing = style.smallCaps ? '0.08em' : '0.03em'
    if (style.smallCaps) s.style.fontVariantCaps = 'small-caps'
    s.textContent = t
    host.appendChild(s)
    return s
  })
  document.body.appendChild(host)
  const widths = spans.map((s) => s.getBoundingClientRect().width)
  host.remove()
  return widths.some((w) => w > 0) ? widths : null
}

export function checkFit(
  settings: HeaderFooterSettings,
  info: { title: string; chapterTitles: readonly string[]; geometry: BookGeometry; fontFamily: string },
  measure: TextMeasurer = measureBandTexts,
): FitReport {
  const g = info.geometry
  const fontPx = g.fontSizePx * settings.fontScale
  const centreWidth = g.contentWidth - 2 * SIDE_EM * fontPx
  const at = (side: 'verso' | 'recto', chapterTitle: string) =>
    resolveHeaderFooter(settings, { title: info.title }, { index: side === 'recto' ? 2 : 1, side, chapterTitle, isChapterOpener: false, isBlank: false })

  const heads: { text: string; tag: 'verso' | 'recto' | { chapter: string } }[] = []
  for (const side of ['verso', 'recto'] as const) {
    const content = side === 'verso' ? settings.versoHead : settings.rectoHead
    if (content === 'none') continue
    if (content === 'chapter') {
      for (const t of info.chapterTitles) heads.push({ text: at(side, t).headerText, tag: { chapter: t } })
    } else heads.push({ text: at(side, info.chapterTitles[0] ?? '').headerText, tag: side })
  }
  const foot = at('recto', '')
  const footText = foot.footerNote || foot.footer.center
  const footIsNote = !!foot.footerNote

  const style = { fontFamily: info.fontFamily, fontPx, smallCaps: settings.smallCapsRunningHeads }
  const widths = heads.length ? measure(heads.map((h) => h.text), style) : []
  // The footer line is set in plain type (no small caps).
  const footW = foot.footerText ? measure([footText], { ...style, smallCaps: false }) : []
  if (!widths || !footW) return NO_FIT_ISSUES
  const out: FitReport = { verso: false, recto: false, footer: false, chapters: [] }
  const tooLong = new Set<string>()
  heads.forEach((h, i) => {
    if (widths[i] <= centreWidth + 0.5) return
    if (typeof h.tag === 'string') out[h.tag] = true
    else tooLong.add(h.tag.chapter)
  })
  out.chapters = info.chapterTitles.filter((t) => tooLong.has(t))
  if (foot.footerText) out.footer = footW[0] > (footIsNote ? g.contentWidth : centreWidth) + 0.5
  return out
}

/** Chapters whose short head is worth offering: too long, or already given one. */
export function shortHeadCandidates(settings: HeaderFooterSettings, chapterTitles: readonly string[], tooLong: readonly string[]): string[] {
  const long = new Set(tooLong)
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of chapterTitles) {
    const k = chapterKey(t)
    if (!k || seen.has(k)) continue
    if (long.has(t) || settings.shortHeads[k]) {
      seen.add(k)
      out.push(t)
    }
  }
  return out
}
