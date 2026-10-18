import { describe, expect, it } from 'vitest'
import { importManuscript } from '../import/importManuscript'
import { rtfToHtml } from '../import/rtf'
import { buildExport, EXPORT_FORMATS } from './formats'
import { br, h, hr, li, makeExportDoc, ol, p, pa, quote, t, ul } from './testFixtures'
import { escape, toRtf } from './toRtf'

const novel = makeExportDoc([
  h(1, 'Chapter One'),
  p(t('Elias Crane had kept the light for '), t('thirty-one', 'italic'), t(' years.')),
  p(t('He counted the steps — “every one” — at the café.'), br(), t('日本 😀')),
  hr(),
  pa('center', t('A '), t('bold', 'bold'), t(' end.')),
  quote(p(t('A quoted line.'))),
  ul(li(p(t('Bread'))), li(p(t('Salt')))),
  ol([li(p(t('First')))], 3),
  h(1, 'Chapter Two'),
  p(t('Back slash \\ and {braces}.')),
])

describe('toRtf (the .doc export)', () => {
  it('writes the book’s page size, margins, font and line spacing', () => {
    const rtf = toRtf(novel)
    expect(rtf.startsWith('{\\rtf1\\ansi')).toBe(true)
    // Trade 6×9 in twips.
    expect(rtf).toContain('\\paperw8640\\paperh12960')
    expect(rtf).toMatch(/\\margmirror/)
    expect(rtf).toMatch(/\{\\f0\\froman\\fcharset0(\{\\\*\\falt [^}]+\})? [^;]+;\}/)
    expect(rtf).toMatch(/\\sl\d+\\slmult1/)
    // Balanced braces.
    let depth = 0
    for (const [i, c] of [...rtf].entries()) {
      if (c === '{' && rtf[i - 1] !== '\\') depth++
      if (c === '}' && rtf[i - 1] !== '\\') depth--
      expect(depth).toBeGreaterThanOrEqual(0)
    }
    expect(depth).toBe(0)
  })

  it('starts each chapter after the first on a new page, only when set', () => {
    const rtf = toRtf(novel)
    expect(rtf.match(/\\pagebb/g)?.length).toBe(1)
    expect(rtf).toMatch(/\\s1[^\n]*\\pagebb[^\n]* Chapter Two\\par/)
    const flowing = toRtf({ ...novel, format: { ...novel.format, chapterStartsNewPage: false } })
    expect(flowing).not.toContain('\\pagebb')
  })

  it('escapes RTF’s special characters and writes everything else as Unicode', () => {
    expect(escape('a\\b{c}')).toBe('a\\\\b\\{c\\}')
    expect(escape('café — “x”')).toBe('caf\\u233? \\u8212? \\u8220?x\\u8221?')
    // A character beyond the BMP is a surrogate pair of signed \u values.
    expect(escape('😀')).toBe('\\u-10179?\\u-8704?')
  })

  it('reads back in Thunder Writer with its chapters, words and italics', async () => {
    const html = rtfToHtml(toRtf(novel))
    expect(html).toContain('<h1>Chapter One</h1>')
    expect(html).toContain('<em>thirty-one</em>')
    expect(html).toContain('“every one” — at the café.<br>日本 😀')
    expect(html).toContain('<p style="text-align:center">A <strong>bold</strong> end.</p>')
    expect(html).toContain('Back slash \\ and {braces}.')
    expect(html).not.toContain('Exported from Thunder Writer')

    const blob = await buildExport(novel, 'doc')
    expect(blob.type).toBe(EXPORT_FORMATS.doc.mime)
    const r = await importManuscript({ name: 'My Novel.doc', data: await blob.arrayBuffer() })
    expect(r.chapterCount).toBe(2)
  })

  it('writes an empty manuscript as a valid one-paragraph document', () => {
    const rtf = toRtf(makeExportDoc([]))
    expect(rtf).toMatch(/\\pard\\plain\\s0[^\n]*\\par\n\}\n$/)
  })
})
