import type { BookPreset, DocFormat } from '../../types'

/** CSS pixels per inch (CSS reference pixel). */
export const PX_PER_IN = 96
/** CSS pixels per typographic point. */
export const PX_PER_PT = 96 / 72

export const DEFAULT_PRESET_ID = 'trade-6x9'

/** Serif stacks writers are likely to have installed; the fallbacks keep metrics sane. */
export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Garamond', value: "'EB Garamond', Garamond, 'Adobe Garamond Pro', 'Times New Roman', serif" },
  { label: 'Palatino', value: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif" },
  { label: 'Baskerville', value: "Baskerville, 'Libre Baskerville', 'Baskerville Old Face', Georgia, serif" },
  { label: 'Iowan Old Style', value: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif" },
  { label: 'Charter', value: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif" },
  { label: 'Georgia', value: 'Georgia, Cambria, serif' },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Courier (manuscript)', value: "'Courier New', Courier, monospace" },
]

const font = (label: string) => FONT_OPTIONS.find((f) => f.label === label)!.value

/**
 * Common trade trims with typesetting defaults close to what a small press or
 * KDP/IngramSpark interior would use, so page counts are realistic.
 */
export const BOOK_PRESETS: BookPreset[] = [
  {
    id: 'mass-market',
    label: 'Mass-market paperback (4.25 × 6.87 in)',
    widthIn: 4.25,
    heightIn: 6.87,
    marginIn: { top: 0.5, right: 0.4, bottom: 0.55, left: 0.5 },
    fontFamily: font('Times New Roman'),
    fontSizePt: 10,
    lineHeight: 1.25,
  },
  {
    id: 'trade-5x8',
    label: 'Trade paperback (5 × 8 in)',
    widthIn: 5,
    heightIn: 8,
    marginIn: { top: 0.6, right: 0.5, bottom: 0.65, left: 0.65 },
    fontFamily: font('Garamond'),
    fontSizePt: 11,
    lineHeight: 1.35,
  },
  {
    id: 'trade-5.25x8',
    label: 'Trade paperback (5.25 × 8 in)',
    widthIn: 5.25,
    heightIn: 8,
    marginIn: { top: 0.6, right: 0.55, bottom: 0.65, left: 0.7 },
    fontFamily: font('Garamond'),
    fontSizePt: 11,
    lineHeight: 1.35,
  },
  {
    id: 'trade-5.5x8.5',
    label: 'Trade paperback (5.5 × 8.5 in)',
    widthIn: 5.5,
    heightIn: 8.5,
    marginIn: { top: 0.7, right: 0.6, bottom: 0.75, left: 0.75 },
    fontFamily: font('Palatino'),
    fontSizePt: 11,
    lineHeight: 1.4,
  },
  {
    id: 'trade-6x9',
    label: 'Trade paperback (6 × 9 in)',
    widthIn: 6,
    heightIn: 9,
    marginIn: { top: 0.75, right: 0.65, bottom: 0.8, left: 0.85 },
    fontFamily: font('Palatino'),
    fontSizePt: 11.5,
    lineHeight: 1.4,
  },
  {
    id: 'royal-6.14x9.21',
    label: 'Royal (6.14 × 9.21 in)',
    widthIn: 6.14,
    heightIn: 9.21,
    marginIn: { top: 0.75, right: 0.65, bottom: 0.8, left: 0.875 },
    fontFamily: font('Baskerville'),
    fontSizePt: 11.5,
    lineHeight: 1.4,
  },
  {
    id: 'manuscript-letter',
    label: 'Manuscript (8.5 × 11 in, double-spaced)',
    widthIn: 8.5,
    heightIn: 11,
    marginIn: { top: 1, right: 1, bottom: 1, left: 1 },
    fontFamily: font('Times New Roman'),
    fontSizePt: 12,
    lineHeight: 2,
  },
]

export const FONT_SIZE_OPTIONS = [9, 9.5, 10, 10.5, 11, 11.5, 12, 13, 14, 16]
export const LINE_HEIGHT_OPTIONS = [1.15, 1.25, 1.3, 1.35, 1.4, 1.5, 1.75, 2]

export function getPreset(id: string | undefined | null): BookPreset {
  return (
    BOOK_PRESETS.find((p) => p.id === id) ??
    BOOK_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!
  )
}

/** A preset with the doc's overrides applied — the format the page view actually renders. */
export interface ResolvedFormat extends BookPreset {
  chapterStartsNewPage: boolean
}

const validPositive = (n: number | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0

export function resolveFormat(format: DocFormat | null | undefined): ResolvedFormat {
  const preset = getPreset(format?.presetId)
  return {
    ...preset,
    marginIn: { ...preset.marginIn },
    fontFamily: format?.fontFamily?.trim() ? format.fontFamily : preset.fontFamily,
    fontSizePt: validPositive(format?.fontSizePt) ? format.fontSizePt : preset.fontSizePt,
    lineHeight: validPositive(format?.lineHeight) ? format.lineHeight : preset.lineHeight,
    chapterStartsNewPage: format?.chapterStartsNewPage ?? true,
  }
}

/** Page geometry in unscaled CSS px. */
export interface PageGeometry {
  pageWidth: number
  pageHeight: number
  margin: { top: number; right: number; bottom: number; left: number }
  /** Height of the text block on one page (page height minus top/bottom margins). */
  contentHeight: number
  /** Width of the text block. */
  contentWidth: number
  fontSizePx: number
  lineHeightPx: number
}

export function pageGeometry(f: ResolvedFormat): PageGeometry {
  const m = {
    top: f.marginIn.top * PX_PER_IN,
    right: f.marginIn.right * PX_PER_IN,
    bottom: f.marginIn.bottom * PX_PER_IN,
    left: f.marginIn.left * PX_PER_IN,
  }
  const pageWidth = f.widthIn * PX_PER_IN
  const pageHeight = f.heightIn * PX_PER_IN
  const fontSizePx = f.fontSizePt * PX_PER_PT
  return {
    pageWidth,
    pageHeight,
    margin: m,
    contentHeight: pageHeight - m.top - m.bottom,
    contentWidth: pageWidth - m.left - m.right,
    fontSizePx,
    lineHeightPx: fontSizePx * f.lineHeight,
  }
}

/** Short "6 × 9 in" style label for status/info strips. */
export const trimLabel = (p: Pick<BookPreset, 'widthIn' | 'heightIn'>) => `${p.widthIn} × ${p.heightIn} in`
