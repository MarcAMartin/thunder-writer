import { describe, expect, it } from 'vitest'
import { resolveFormat } from '../editor/presets'
import { checkFit, shortHeadCandidates, type TextMeasurer } from './fitText'
import { DEFAULT_HEADER_FOOTER, type HeaderFooterSettings } from './headerFooter'
import { bookGeometry } from './layout'

const geometry = bookGeometry(resolveFormat({ presetId: 'trade-6x9', chapterStartsNewPage: true }))
/** 7 px a character: the centre of a 6×9 head line holds about 50. */
const measure: TextMeasurer = (texts) => texts.map((t) => t.length * 7)
const S = (p: Partial<HeaderFooterSettings> = {}): HeaderFooterSettings => ({ ...DEFAULT_HEADER_FOOTER, authorName: 'Mara Vance', ...p })
const LONG = 'A Very Long Chapter Title That Surely Will Not Fit In A Running Head'
const info = { title: 'The Frozen River', chapterTitles: ['One', LONG], geometry, fontFamily: 'serif' }

describe('checkFit', () => {
  it('passes the usual author / title heads', () => {
    expect(checkFit(S(), info, measure)).toEqual({ verso: false, recto: false, footer: false, chapters: [] })
  })

  it('flags chapter titles too long for a chapter head, until they get a short head', () => {
    expect(checkFit(S({ rectoHead: 'chapter' }), info, measure).chapters).toEqual([LONG])
    expect(checkFit(S({ rectoHead: 'chapter', shortHeads: { [LONG]: 'A Long Title' } }), info, measure).chapters).toEqual([])
  })

  it('flags a long custom head and a footer line too long for its row', () => {
    const r = checkFit(S({ versoHead: 'custom', versoCustom: 'x'.repeat(80), footer: 'custom', footerCustom: 'y'.repeat(90) }), info, measure)
    expect(r.verso).toBe(true)
    expect(r.recto).toBe(false)
    expect(r.footer).toBe(true)
  })

  it('reports nothing where the DOM cannot measure (tests, SSR)', () => {
    expect(checkFit(S({ rectoHead: 'chapter' }), info, () => null).chapters).toEqual([])
  })
})

describe('shortHeadCandidates', () => {
  it('offers chapters that are too long or already have a short head', () => {
    expect(shortHeadCandidates(S({ shortHeads: { One: '1' } }), ['One', 'Two', LONG], [LONG])).toEqual(['One', LONG])
  })
})
