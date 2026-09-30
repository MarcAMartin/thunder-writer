import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { BookPage } from './BookPage'
import type { HeaderFooterSettings } from './headerFooter'
import type { BookLayout } from './layout'

const num = (n: number, d: number) => (Number.isFinite(n) && n > 0 && n < 100 ? Math.round(n * 1000) / 1000 : d)

/**
 * Every laid-out page at exact trim size, mounted only while printing (a
 * novel's worth of page DOM is too heavy to keep around). `@page` has zero
 * margins because each page already carries its own margins, heads and
 * folios. Choosing "Save as PDF" in the print dialog gives a print-ready interior.
 */
export function PrintBook({ layout, settings, title, onDone }: { layout: BookLayout; settings: HeaderFooterSettings; title: string; onDone: () => void }) {
  useEffect(() => {
    const html = document.documentElement
    html.classList.add('bp-printing')
    let done = false
    const finish = () => {
      if (done) return
      done = true
      html.classList.remove('bp-printing')
      onDone()
    }
    window.addEventListener('afterprint', finish)
    // Two frames so the pages are laid out before the print snapshot.
    const r1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print()
        // afterprint (all current browsers) unmounts the pages.
      })
    })
    return () => {
      cancelAnimationFrame(r1)
      window.removeEventListener('afterprint', finish)
      html.classList.remove('bp-printing')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const w = num(layout.format.widthIn, 6)
  const h = num(layout.format.heightIn, 9)
  return createPortal(
    <div className="bp-print-root" aria-hidden="true">
      <style>{`@page { size: ${w}in ${h}in; margin: 0; }`}</style>
      {layout.pages.map((p) => (
        <div className="bp-print-page" key={p.index} style={{ width: `${w}in`, height: `${h}in` }}>
          <BookPage layout={layout} index={p.index} settings={settings} title={title} />
        </div>
      ))}
    </div>,
    document.body,
  )
}
