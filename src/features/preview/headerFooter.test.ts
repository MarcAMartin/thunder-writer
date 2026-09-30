import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_HEADER_FOOTER,
  normalizeBookLayout,
  normalizeHeaderFooter,
  resolveHeaderFooter,
  runningHeadPresetId,
  shortHeadOf,
  sideOfFolio,
  withShortHead,
  type HeaderFooterSettings,
  type PageInfo,
} from './headerFooter'

const doc = { title: 'The Frozen River' }
const S = (p: Partial<HeaderFooterSettings> = {}): HeaderFooterSettings => ({ ...DEFAULT_HEADER_FOOTER, authorName: 'Mara Vance', ...p })
const P = (p: Partial<PageInfo> = {}): PageInfo => ({
  index: 4,
  side: 'recto',
  chapterTitle: 'Chapter 2: Ice',
  isChapterOpener: false,
  isBlank: false,
  ...p,
})

describe('sideOfFolio', () => {
  it('puts odd numbers on the right', () => {
    expect(sideOfFolio(1)).toBe('recto')
    expect(sideOfFolio(2)).toBe('verso')
    expect(sideOfFolio(389)).toBe('recto')
  })
})

describe('resolveHeaderFooter: defaults (author / title, folio bottom centre)', () => {
  it('verso shows the author, recto the title', () => {
    const v = resolveHeaderFooter(S(), doc, P({ index: 1, side: 'verso' }))
    const r = resolveHeaderFooter(S(), doc, P({ index: 2, side: 'recto' }))
    expect(v.headerText).toBe('Mara Vance')
    expect(r.headerText).toBe('The Frozen River')
    expect(v.header.center).toBe('Mara Vance')
  })

  it('numbers from firstPageNumber and centres the folio in the footer', () => {
    const f = resolveHeaderFooter(S(), doc, P({ index: 0 }))
    expect(f.numberText).toBe('1')
    expect(f.numberIn).toBe('footer')
    expect(f.align).toBe('center')
    expect(f.footer).toEqual({ left: '', center: '1', right: '' })
    expect(resolveHeaderFooter(S({ firstPageNumber: 11 }), doc, P({ index: 4 })).numberText).toBe('15')
  })

  it('uses small caps by default', () => {
    expect(resolveHeaderFooter(S(), doc, P()).smallCaps).toBe(true)
    expect(resolveHeaderFooter(S({ smallCapsRunningHeads: false }), doc, P()).smallCaps).toBe(false)
  })
})

describe('resolveHeaderFooter: number positions', () => {
  it('footer-outside: left on verso, right on recto', () => {
    const s = S({ pageNumbers: 'footer-outside' })
    const v = resolveHeaderFooter(s, doc, P({ index: 1, side: 'verso' }))
    const r = resolveHeaderFooter(s, doc, P({ index: 2, side: 'recto' }))
    expect(v.align).toBe('left')
    expect(v.footer.left).toBe('2')
    expect(r.align).toBe('right')
    expect(r.footer.right).toBe('3')
  })

  it('header-outside: folio shares the header line with the running head', () => {
    const s = S({ pageNumbers: 'header-outside' })
    const v = resolveHeaderFooter(s, doc, P({ index: 1, side: 'verso' }))
    expect(v.numberIn).toBe('header')
    expect(v.header).toEqual({ left: '2', center: 'Mara Vance', right: '' })
    const r = resolveHeaderFooter(s, doc, P({ index: 2, side: 'recto' }))
    expect(r.header).toEqual({ left: '', center: 'The Frozen River', right: '3' })
    expect(r.footer).toEqual({ left: '', center: '', right: '' })
  })

  it('none: no number anywhere', () => {
    const f = resolveHeaderFooter(S({ pageNumbers: 'none' }), doc, P())
    expect(f.numberText).toBe('')
    expect(f.numberIn).toBeNull()
    expect(f.footer).toEqual({ left: '', center: '', right: '' })
  })
})

describe('resolveHeaderFooter: chapter openers', () => {
  it('drops the running head and keeps a footer folio', () => {
    const f = resolveHeaderFooter(S(), doc, P({ isChapterOpener: true }))
    expect(f.headerText).toBe('')
    expect(f.header.center).toBe('')
    expect(f.numberText).toBe('5')
    expect(f.numberIn).toBe('footer')
  })

  it('moves a header folio to the foot (drop folio)', () => {
    const f = resolveHeaderFooter(S({ pageNumbers: 'header-outside' }), doc, P({ isChapterOpener: true }))
    expect(f.numberIn).toBe('footer')
    expect(f.align).toBe('center')
    expect(f.header).toEqual({ left: '', center: '', right: '' })
    expect(f.footer.center).toBe('5')
  })

  it('can hide the opener folio', () => {
    const f = resolveHeaderFooter(S({ openerFolio: 'none' }), doc, P({ isChapterOpener: true }))
    expect(f.numberText).toBe('')
  })

  it('shows heads on openers when suppression is off', () => {
    const f = resolveHeaderFooter(S({ suppressOnChapterOpeners: false, pageNumbers: 'header-outside' }), doc, P({ isChapterOpener: true }))
    expect(f.headerText).toBe('The Frozen River')
    expect(f.numberIn).toBe('header')
  })
})

describe('resolveHeaderFooter: blank pages', () => {
  it('prints nothing on blank pages by default', () => {
    const f = resolveHeaderFooter(S({ footer: 'title' }), doc, P({ isBlank: true, side: 'verso', index: 3 }))
    expect(f.headerText).toBe('')
    expect(f.numberText).toBe('')
    expect(f.footerText).toBe('')
    expect(f.header).toEqual({ left: '', center: '', right: '' })
  })

  it('keeps the folio (but no running head) when blank-page suppression is off', () => {
    const f = resolveHeaderFooter(S({ suppressOnBlankPages: false }), doc, P({ isBlank: true, index: 3, side: 'verso' }))
    expect(f.numberText).toBe('4')
    expect(f.headerText).toBe('')
  })
})

describe('resolveHeaderFooter: content choices and fallbacks', () => {
  it('chapter heads use the chapter in effect, falling back to the title before chapter 1', () => {
    const s = S({ versoHead: 'title', rectoHead: 'chapter' })
    expect(resolveHeaderFooter(s, doc, P()).headerText).toBe('Chapter 2: Ice')
    expect(resolveHeaderFooter(s, doc, P({ chapterTitle: '' })).headerText).toBe('The Frozen River')
  })

  it('an empty author name falls back to the title', () => {
    const f = resolveHeaderFooter(S({ authorName: '  ' }), doc, P({ side: 'verso', index: 1 }))
    expect(f.headerText).toBe('The Frozen River')
  })

  it('an empty title falls back to "Untitled Manuscript"', () => {
    expect(resolveHeaderFooter(S(), { title: '' }, P()).headerText).toBe('Untitled Manuscript')
  })

  it('custom text per side, and none', () => {
    const s = S({ versoHead: 'custom', versoCustom: ' Left ', rectoHead: 'none' })
    expect(resolveHeaderFooter(s, doc, P({ side: 'verso', index: 1 })).headerText).toBe('Left')
    expect(resolveHeaderFooter(s, doc, P()).headerText).toBe('')
  })

  it('footer text takes the centre, or a full-width row of its own when the folio is centred', () => {
    const a = resolveHeaderFooter(S({ footer: 'custom', footerCustom: 'ARC', pageNumbers: 'footer-outside' }), doc, P())
    expect(a.footer).toEqual({ left: '', center: 'ARC', right: '5' })
    expect(a.footerNote).toBe('')
    const b = resolveHeaderFooter(S({ footer: 'custom', footerCustom: 'Advance reader copy, not for sale' }), doc, P())
    expect(b.footer).toEqual({ left: '', center: '5', right: '' })
    expect(b.footerNote).toBe('Advance reader copy, not for sale')
    // A drop folio on a chapter opener with numbers at the top moves to the centre: the line still gets its own row.
    const c = resolveHeaderFooter(S({ footer: 'author', pageNumbers: 'header-outside' }), doc, P({ isChapterOpener: true }))
    expect(c.footer.center).toBe('5')
    expect(c.footerNote).toBe('Mara Vance')
  })

  it('uses a short running head for a long chapter title', () => {
    const title = 'A Very Long Chapter Title That Surely Wraps'
    const s = S({ rectoHead: 'chapter', shortHeads: { [title]: 'A Long Title' } })
    expect(resolveHeaderFooter(s, doc, P({ chapterTitle: title })).headerText).toBe('A Long Title')
    // Whitespace in the stored title doesn't matter; other chapters keep their titles.
    expect(resolveHeaderFooter(s, doc, P({ chapterTitle: `  A Very Long Chapter\nTitle That Surely  Wraps ` })).headerText).toBe('A Long Title')
    expect(resolveHeaderFooter(s, doc, P()).headerText).toBe('Chapter 2: Ice')
  })
})

describe('normalize', () => {
  it('fills defaults and rejects garbage', () => {
    expect(normalizeHeaderFooter(undefined)).toEqual(DEFAULT_HEADER_FOOTER)
    const n = normalizeHeaderFooter({ versoHead: 'bogus', firstPageNumber: -3, fontScale: 99, pageNumbers: 'header-outside', authorName: 7 })
    expect(n.versoHead).toBe('author')
    expect(n.firstPageNumber).toBe(1)
    expect(n.fontScale).toBe(0.8)
    expect(n.pageNumbers).toBe('header-outside')
    expect(n.authorName).toBe('')
    expect(normalizeBookLayout({ chaptersStartRecto: false, chapterSink: 5 })).toEqual({ ...DEFAULT_BOOK_LAYOUT, chaptersStartRecto: false })
    expect(normalizeHeaderFooter({ shortHeads: { ' Long  title ': 'Short', empty: '  ', bad: 3 } }).shortHeads).toEqual({ 'Long title': 'Short' })
    expect(normalizeHeaderFooter({ shortHeads: ['x'] }).shortHeads).toEqual({})
  })

  it('names the running-head preset', () => {
    expect(runningHeadPresetId(DEFAULT_HEADER_FOOTER)).toBe('author-title')
    expect(runningHeadPresetId({ versoHead: 'custom', rectoHead: 'title' })).toBe('custom')
  })
})

describe('chapter titles that are Object.prototype names', () => {
  const NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']
  it('resolve to the chapter title, not an inherited property', () => {
    const s = S({ versoHead: 'chapter', rectoHead: 'chapter' })
    for (const t of NAMES) {
      expect(resolveHeaderFooter(s, doc, P({ chapterTitle: t })).headerText).toBe(t)
      expect(resolveHeaderFooter(s, doc, P({ chapterTitle: t, side: 'verso' })).headerText).toBe(t)
      expect(shortHeadOf(s.shortHeads, t)).toBe('')
    }
  })
  it('can be given a short head that survives normalizing (as an own key)', () => {
    let heads: Record<string, string> = {}
    for (const t of NAMES) heads = withShortHead(heads, t, `short ${t}`)
    const s = normalizeHeaderFooter(JSON.parse(JSON.stringify({ rectoHead: 'chapter', shortHeads: heads })))
    for (const t of NAMES) {
      expect(Object.hasOwn(s.shortHeads, t)).toBe(true)
      expect(resolveHeaderFooter(s, doc, P({ chapterTitle: t })).headerText).toBe(`short ${t}`)
    }
    expect(Object.getPrototypeOf(s.shortHeads)).toBe(Object.prototype)
    expect(shortHeadOf(withShortHead(s.shortHeads, '__proto__', '  '), '__proto__')).toBe('')
  })
})
