import type { JSONContent } from '@tiptap/core'
import { checkContent } from '../editor/contentCheck'
import { classStyles, htmlToDoc, sanitizeHtml } from './html'

const marked = (doc: JSONContent) => {
  const out: Array<[string, string]> = []
  const walk = (n: JSONContent) => {
    if (n.type === 'text') out.push([n.text ?? '', (n.marks ?? []).map((m) => m.type).sort().join('+')])
    n.content?.forEach(walk)
  }
  walk(doc)
  return out
}

describe('sanitizeHtml', () => {
  it('removes scripts, event handlers, javascript: links, frames and styles, and never runs anything', () => {
    const w = window as unknown as { __pwned?: number }
    w.__pwned = 0
    const { body } = sanitizeHtml(`
      <p onclick="window.__pwned=1" style="color:red">Hello <a href="javascript:window.__pwned=2">there</a></p>
      <script>window.__pwned = 3</script>
      <img src="x" onerror="window.__pwned=4">
      <iframe src="https://evil.example"></iframe><object data="x"></object><embed src="y">
      <svg onload="window.__pwned=5"><circle/></svg>
      <form action="https://evil.example"><input name="pw"><button>Go</button></form>
      <style>p{color:red}</style><link rel="stylesheet" href="x.css"><meta http-equiv="refresh" content="0">
      <p><span onmouseover="x()">Safe text</span></p>
    `)
    const html = body.innerHTML
    expect(html).not.toMatch(/script|onclick|onerror|onload|onmouseover|javascript:|iframe|object|embed|svg|<img|<input|<button|<style|<link|<meta|href=|color:red/i)
    expect(body.textContent).toContain('Hello there')
    expect(body.textContent).toContain('Safe text')
    expect(document.querySelector('script[data-x]')).toBeNull()
    expect(w.__pwned).toBe(0)
  })

  it('keeps centered and right alignment only', () => {
    const { body } = sanitizeHtml('<p style="text-align:center;color:blue">* * *</p><p style="text-align:justify">Body</p>')
    const [a, b] = [...body.querySelectorAll('p')]
    expect(a.getAttribute('style')).toBe('text-align: center')
    expect(b.hasAttribute('style')).toBe(false)
  })
})

describe('htmlToDoc — Google Docs export', () => {
  const gdoc = `<html><head><meta content="text/html; charset=UTF-8" http-equiv="content-type">
    <style type="text/css">.c1{font-weight:700}.c2{font-style:italic}.c3{text-decoration:underline}.c4{font-weight:400}.c5{text-decoration:line-through}.c6{text-align:center}
    .title{padding-top:0pt;font-size:26pt}.subtitle{font-size:15pt}</style><title>The Storm Novel</title></head>
    <body class="c9 doc-content">
      <p class="c0 title" id="h.x"><span class="c4">The Storm</span></p>
      <p class="subtitle"><span>A novel</span></p>
      <hr style="page-break-before:always;display:none;">
      <h1 class="c8" id="h.y"><span class="c4">Chapter One</span></h1>
      <p class="c0"><span class="c4">She was </span><span class="c1">very</span><span class="c4"> </span><span class="c2">tired</span><span class="c4">, </span><span class="c3">truly</span><span class="c4"> and </span><span class="c5">not</span><span style="font-weight:700;font-style:italic"> both</span><sup><a href="#cmnt1" id="cmnt_ref1">[a]</a></sup><sup><a href="#ftnt1" id="ftnt_ref1">[1]</a></sup></p>
      <p class="c0 c6"><span class="c4">* * *</span></p>
      <p class="c0"><span class="c4"></span></p>
      <p class="c0"><span class="c4">Chapter 2</span></p>
      <h4><span>Deep heading</span></h4>
      <p><img src="https://lh3.googleusercontent.com/x.png"></p>
      <hr class="c7"><div><p class="c0"><a href="#ftnt_ref1" id="ftnt1">[1]</a><span class="c4">&nbsp;A footnote.</span></p></div>
      <div><p class="c0"><a href="#cmnt_ref1" id="cmnt1">[a]</a><span class="c4">Reviewer comment</span></p></div>
    </body></html>`

  it('maps class-based bold/italic/underline/strike to marks and the Title style to H1', () => {
    const r = htmlToDoc(gdoc)
    expect(checkContent(r.doc).ok).toBe(true)
    expect(r.metaTitle).toBe('The Storm Novel')
    expect(r.titleText).toBe('The Storm')
    expect(r.stats).toMatchObject({ comments: 1, footnotes: 1, images: 1 })
    const first = r.doc.content?.[0]
    expect(first?.type).toBe('heading')
    expect(first?.attrs?.level).toBe(1)
    const texts = marked(r.doc)
    expect(texts).toContainEqual(['very', 'bold'])
    expect(texts).toContainEqual(['tired', 'italic'])
    expect(texts).toContainEqual(['truly', 'underline'])
    expect(texts).toContainEqual(['not', 'strike'])
    expect(texts).toContainEqual([' both', 'bold+italic'])
    expect(texts.map((t) => t[0]).join('')).not.toContain('Reviewer comment')
    expect(texts.map((t) => t[0]).join('')).toContain('A footnote.')
    // Page break <hr> is not a scene break; h4 becomes h3; subtitle stays a paragraph.
    expect(r.doc.content?.filter((b) => b.type === 'horizontalRule').length).toBe(1)
    expect(r.doc.content?.some((b) => b.type === 'heading' && b.attrs?.level === 3)).toBe(true)
    expect(r.doc.content?.[1].type).toBe('paragraph')
  })

  it('does not treat Google Docs’ <b style="font-weight:normal"> clipboard wrapper as bold', () => {
    const r = htmlToDoc('<b style="font-weight:normal" id="docs-internal-guid-1"><p><span style="font-weight:400">Plain</span> <span style="font-weight:700">Bold</span></p></b>')
    expect(marked(r.doc)).toEqual([
      ['Plain ', ''],
      ['Bold', 'bold'],
    ])
  })

  it('reads Word “Save as Web Page” HTML: MsoTitle and typed-out list bullets', () => {
    const r = htmlToDoc(`<p class=MsoTitle>Winter<o:p></o:p></p>
      <p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>·<span>&nbsp;&nbsp; </span></span><![endif]>Item</p>`)
    expect(r.titleText).toBe('Winter')
    expect(r.doc.content?.map((b) => b.type)).toEqual(['heading', 'paragraph'])
    expect(marked(r.doc).map((t) => t[0]).join('|')).toBe('Winter|Item')
  })

  it('flattens tables into paragraphs', () => {
    const r = htmlToDoc('<table><tr><td>One</td><td><p>Two</p></td></tr></table>')
    expect(r.stats.tables).toBe(1)
    expect(r.doc.content?.map((b) => b.type)).toEqual(['paragraph', 'paragraph'])
  })
})

describe('htmlToDoc — spacing', () => {
  const text = (html: string) => marked(htmlToDoc(html).doc).map(([t]) => t).join('|')

  it('keeps typed double spaces and tabs (as the .txt reader does)', () => {
    expect(text('<p>She said &lt;hi&gt; &amp; left.  Two spaces.\tafter tab</p>')).toBe('She said <hi> & left.  Two spaces.\tafter tab')
  })

  it('reads line breaks and indentation in the HTML source as a single space', () => {
    expect(text('<body>\n  <p>\n    She ran\n    and ran.\n  </p>\n  <p>Next.</p>\n</body>')).toBe(' She ran and ran. |Next.')
  })
})

describe('classStyles', () => {
  it('reads class rules, including inside @media blocks', () => {
    const d = new DOMParser().parseFromString(
      '<style>/* x */ .c1{font-weight:700} p.c2, .c3 { font-style: italic } @media print { .c4{text-decoration:underline} }</style>',
      'text/html',
    )
    const m = classStyles(d)
    expect(m.get('c1')).toEqual({ 'font-weight': '700' })
    expect(m.get('c2')).toEqual({ 'font-style': 'italic' })
    expect(m.get('c3')).toEqual({ 'font-style': 'italic' })
    expect(m.get('c4')).toEqual({ 'text-decoration': 'underline' })
  })

  it('stays linear on a huge <style> with no braces (a crafted or damaged file)', () => {
    const d = new DOMParser().parseFromString(`<style>${'a'.repeat(1_000_000)}</style><p>Hi</p>`, 'text/html')
    const t0 = performance.now()
    classStyles(d)
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})
