import { describe, expect, it } from 'vitest'
import { BOOK_PRESETS, DEFAULT_PRESET_ID, getPreset, pageGeometry, resolveFormat } from './presets'
import { DEFAULT_FORMAT } from '../../store/documents'

describe('book presets', () => {
  it('has unique ids and includes the default trade 6x9', () => {
    const ids = BOOK_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('trade-6x9')
    expect(DEFAULT_FORMAT.presetId).toBe(DEFAULT_PRESET_ID)
  })

  it('covers the standard trims', () => {
    const trims = BOOK_PRESETS.map((p) => `${p.widthIn}x${p.heightIn}`)
    expect(trims).toEqual(['4.25x6.87', '5x8', '5.25x8', '5.5x8.5', '6x9', '6.14x9.21', '8.5x11'])
  })

  it('leaves a sensible text block on every trim', () => {
    for (const p of BOOK_PRESETS) {
      const g = pageGeometry(resolveFormat({ presetId: p.id, chapterStartsNewPage: true }))
      expect(g.contentWidth).toBeGreaterThan(g.pageWidth * 0.6)
      expect(g.contentHeight).toBeGreaterThan(g.pageHeight * 0.7)
      expect(p.fontSizePt).toBeGreaterThanOrEqual(9)
      expect(p.lineHeight).toBeGreaterThanOrEqual(1.15)
      // Between ~20 and ~45 lines per page, like real books.
      const lines = g.contentHeight / g.lineHeightPx
      expect(lines).toBeGreaterThan(20)
      expect(lines).toBeLessThan(45)
    }
  })

  it('uses standard manuscript format for letter', () => {
    const m = getPreset('manuscript-letter')
    expect(m.marginIn).toEqual({ top: 1, right: 1, bottom: 1, left: 1 })
    expect(m.fontSizePt).toBe(12)
    expect(m.lineHeight).toBe(2)
    expect(m.fontFamily).toMatch(/Times/)
  })

  it('falls back to the default preset for unknown ids', () => {
    expect(getPreset('nope').id).toBe('trade-6x9')
    expect(getPreset(undefined).id).toBe('trade-6x9')
  })
})

describe('resolveFormat', () => {
  it('uses preset values without overrides', () => {
    const f = resolveFormat({ presetId: 'trade-5x8', chapterStartsNewPage: false })
    expect(f.id).toBe('trade-5x8')
    expect(f.fontSizePt).toBe(getPreset('trade-5x8').fontSizePt)
    expect(f.chapterStartsNewPage).toBe(false)
  })

  it('merges overrides on top of the preset and ignores invalid ones', () => {
    const f = resolveFormat({ presetId: 'trade-6x9', fontSizePt: 12, lineHeight: 1.5, fontFamily: 'Georgia', chapterStartsNewPage: true })
    expect(f).toMatchObject({ fontSizePt: 12, lineHeight: 1.5, fontFamily: 'Georgia', widthIn: 6, heightIn: 9 })
    const bad = resolveFormat({ presetId: 'trade-6x9', fontSizePt: -1, lineHeight: Number.NaN, fontFamily: '  ', chapterStartsNewPage: true })
    expect(bad.fontSizePt).toBe(getPreset('trade-6x9').fontSizePt)
    expect(bad.lineHeight).toBe(getPreset('trade-6x9').lineHeight)
    expect(bad.fontFamily).toBe(getPreset('trade-6x9').fontFamily)
  })

  it('does not share margin objects with the preset table', () => {
    const f = resolveFormat(null)
    f.marginIn.top = 99
    expect(getPreset(DEFAULT_PRESET_ID).marginIn.top).not.toBe(99)
  })

  it('converts inches and points to CSS px', () => {
    const g = pageGeometry(resolveFormat({ presetId: 'trade-6x9', fontSizePt: 12, lineHeight: 1.5, chapterStartsNewPage: true }))
    expect(g.pageWidth).toBe(576)
    expect(g.pageHeight).toBe(864)
    expect(g.fontSizePx).toBe(16)
    expect(g.lineHeightPx).toBe(24)
  })
})
