import { describe, expect, it } from 'vitest'
import { pdfPagesToHtml, piecesToLines, type PdfLine, type PdfPage } from './pdf'

/** A line of body text at `y` (points from the bottom), 11 pt, spanning most of the measure unless short. */
const line = (text: string, y: number, o: Partial<PdfLine> = {}): PdfLine => ({ text, x: 72, y, size: 11, right: o.right ?? 520, ...o })
const page = (lines: PdfLine[]): PdfPage => ({ width: 612, height: 792, lines })

describe('piecesToLines', () => {
  it('joins the pieces of a line, adding spaces the PDF only showed as gaps', () => {
    const t = (str: string, x: number, y: number, width: number) => ({ str, transform: [11, 0, 0, 11, x, y], width, height: 11 })
    const lines = piecesToLines([t('Elias', 72, 700, 26), t('Crane', 101, 700, 28), t('kept', 132, 700, 20), t('The light.', 72, 686, 50)])
    expect(lines.map((l) => l.text)).toEqual(['Elias Crane kept', 'The light.'])
    expect(lines[0].size).toBe(11)
  })
})

describe('pdfPagesToHtml', () => {
  it('rebuilds paragraphs from indents and short last lines, and headings from larger type', () => {
    const html = pdfPagesToHtml([
      page([
        line('Chapter One', 640, { size: 20, x: 240, right: 372 }),
        line('Elias Crane had kept the Harrow Point light for thirty-one years, and in all', 600),
        line('that time the sea had never surprised him.', 586, { right: 300 }),
        line('He climbed the hundred and twelve steps every evening at a quarter to six,', 572, { x: 90 }),
        line('counting them under his breath.', 558, { right: 250 }),
        line('1', 40, { x: 300, right: 306 }),
      ]),
    ])
    expect(html).toContain('<h1>Chapter One</h1>')
    expect(html).toContain('<p>Elias Crane had kept the Harrow Point light for thirty-one years, and in all that time the sea had never surprised him.</p>')
    expect(html).toContain('<p>He climbed the hundred and twelve steps every evening at a quarter to six, counting them under his breath.</p>')
    // The page number is left out.
    expect(html).not.toMatch(/<p>1<\/p>/)
  })

  it('leaves out running heads that repeat across pages, joins hyphenated words and two-line headings', () => {
    const head = (n: number) => line(n % 2 ? 'THE KEEPER’S LAMP' : 'Marc Martin', 760, { x: 250, right: 360, size: 9 })
    const pages = [1, 2, 3, 4].map((n) =>
      page([
        head(n),
        ...(n === 1
          ? [line('The Light on', 650, { size: 18, x: 230, right: 380 }), line('the Water', 628, { size: 18, x: 250, right: 360 })]
          : []),
        line(`Page ${n} begins with a long line of prose that keeps on going until the meas-`, 600),
        line('ure ends and the next line picks it up.', 586, { right: 280 }),
        line(String(n), 40, { x: 300, right: 306 }),
      ]),
    )
    const html = pdfPagesToHtml(pages)
    expect(html).not.toContain('KEEPER’S LAMP')
    expect(html).not.toContain('Marc Martin')
    expect(html).toContain('<h1>The Light on the Water</h1>')
    expect(html).toContain('until the measure ends')
    expect(html.match(/<p>/g)?.length).toBe(4)
  })

  it('carries a paragraph over a page break', () => {
    const html = pdfPagesToHtml([
      page([line('The keeper climbed the stairs one more time before the storm came in, and', 600)]),
      page([line('the lamp was already burning.', 700, { right: 260 })]),
    ])
    expect(html).toContain('<p>The keeper climbed the stairs one more time before the storm came in, and the lamp was already burning.</p>')
  })
})
