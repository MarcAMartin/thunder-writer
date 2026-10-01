import { describe, expect, it } from 'vitest'
import { DEFAULT_PRINT, describePrint, INK_CHOICES, normalizePrint, PAPER_CHOICES, paperAllowed } from './printSettings'

describe('print settings (Paper & ink)', () => {
  it('defaults to cream paper and black ink, the standard for novels', () => {
    expect(DEFAULT_PRINT).toEqual({ paper: 'cream', ink: 'bw' })
    expect(normalizePrint(undefined)).toEqual(DEFAULT_PRINT)
    expect(normalizePrint({ paper: 'vellum', ink: 7 })).toEqual(DEFAULT_PRINT)
  })

  it('prints color on white paper only', () => {
    expect(paperAllowed('cream', 'bw')).toBe(true)
    expect(paperAllowed('groundwood', 'bw')).toBe(true)
    expect(paperAllowed('cream', 'standard-color')).toBe(false)
    expect(paperAllowed('white', 'premium-color')).toBe(true)
    expect(normalizePrint({ paper: 'groundwood', ink: 'premium-color' })).toEqual({ paper: 'white', ink: 'premium-color' })
    expect(normalizePrint({ paper: 'cream', ink: 'standard-color' })).toEqual({ paper: 'white', ink: 'standard-color' })
  })

  it('describes each choice, including the notes a writer needs before ordering', () => {
    expect(PAPER_CHOICES.map((c) => c.value)).toEqual(['white', 'cream', 'groundwood'])
    expect(INK_CHOICES.map((c) => c.value)).toEqual(['bw', 'standard-color', 'premium-color'])
    expect(PAPER_CHOICES[1].hint).toMatch(/spine about 10% wider/)
    expect(PAPER_CHOICES[2].hint).toMatch(/not for heavy ink coverage/)
    expect(INK_CHOICES[1].hint).toMatch(/Paperbacks only/)
    expect(INK_CHOICES[2].hint).toMatch(/104 GSM/)
    expect(describePrint({ paper: 'cream', ink: 'bw' })).toBe('Cream paper · Black ink')
  })
})
