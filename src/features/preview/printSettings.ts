import type { PrintInk, PrintPaper, PrintSettings } from '../../types'

export type { PrintInk, PrintPaper, PrintSettings } from '../../types'

/** Cream and black-and-white: the standard for novels. */
export const DEFAULT_PRINT: PrintSettings = { paper: 'cream', ink: 'bw' }

export interface PrintChoice<T extends string> {
  value: T
  label: string
  /** Short form for the preview's title line. */
  short: string
  hint: string
}

export const PAPER_CHOICES: PrintChoice<PrintPaper>[] = [
  {
    value: 'white',
    label: 'White',
    short: 'White paper',
    hint: 'A bright white stock (50–61 lb, 74–90 GSM) with high contrast. Best for non-fiction, textbooks, workbooks and illustrated children’s books.',
  },
  {
    value: 'cream',
    label: 'Cream',
    short: 'Cream paper',
    hint: 'An off-white, slightly thicker stock (50–61 lb, 74–90 GSM) that is softer on the eyes. The standard for novels, memoirs and fiction. It makes the spine about 10% wider than white, so the cover needs adjusting.',
  },
  {
    value: 'groundwood',
    label: 'Groundwood',
    short: 'Groundwood paper',
    hint: 'A lightweight, textured, off-white budget stock that feels like a mass-market paperback, old-book smell included. About 5% cheaper per page than cream or white; not for heavy ink coverage, which can bleed through.',
  },
]

export const INK_CHOICES: PrintChoice<PrintInk>[] = [
  {
    value: 'bw',
    label: 'Black and white',
    short: 'Black ink',
    hint: 'Standard black ink, on white, cream or groundwood paper.',
  },
  {
    value: 'standard-color',
    label: 'Standard color',
    short: 'Standard color',
    hint: 'Lower-cost color for books with occasional color. Paperbacks only, not hardcovers.',
  },
  {
    value: 'premium-color',
    label: 'Premium color',
    short: 'Premium color',
    hint: 'More vibrant color on thicker paper (104 GSM), for image-heavy interiors: cookbooks, photography and children’s books.',
  },
]

const oneOf = <T extends string>(v: unknown, choices: PrintChoice<T>[], d: T): T =>
  typeof v === 'string' && choices.some((c) => c.value === v) ? (v as T) : d

/** Color is printed on white paper, so a color ink rules out cream and groundwood. */
export const paperAllowed = (paper: PrintPaper, ink: PrintInk) => ink === 'bw' || paper === 'white'

/** Reads stored or hand-edited settings, filling defaults; a color ink always gets white paper. */
export function normalizePrint(raw: unknown): PrintSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const ink = oneOf(r.ink, INK_CHOICES, DEFAULT_PRINT.ink)
  const paper = oneOf(r.paper, PAPER_CHOICES, DEFAULT_PRINT.paper)
  return { ink, paper: paperAllowed(paper, ink) ? paper : 'white' }
}

/** "Cream paper · Black ink", for the preview's title line. */
export function describePrint(p: PrintSettings): string {
  const paper = PAPER_CHOICES.find((c) => c.value === p.paper)!.short
  const ink = INK_CHOICES.find((c) => c.value === p.ink)!.short
  return `${paper} · ${ink}`
}
