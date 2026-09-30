import { describe, expect, it } from 'vitest'
import { buildRenderModel, leafElements, renderBlockElement } from './renderModel'

const doc = (...content: unknown[]) => ({ type: 'doc', content })
const p = (text: string, attrs?: Record<string, unknown>) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text }] })
const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })

describe('buildRenderModel', () => {
  it('classifies blocks and titles chapters', () => {
    const m = buildRenderModel(doc(h(1, '  Chapter   One '), p('a'), h(2, 'Part'), { type: 'horizontalRule' }, { type: 'blockquote', content: [p('q')] }))
    expect(m.blocks.map((b) => b.kind)).toEqual(['chapter', 'text', 'heading', 'break', 'container'])
    expect(m.blocks[0].title).toBe('Chapter One')
  })

  it('mirrors the editor’s first-line indent rules', () => {
    const m = buildRenderModel(
      doc(
        p('first in book'),
        p('indented'),
        h(1, 'C'),
        p('after chapter'),
        p('indented'),
        { type: 'horizontalRule' },
        p('after scene break'),
        { type: 'bulletList', content: [{ type: 'listItem', content: [p('li')] }] },
        p('after list'),
        p('centred', { textAlign: 'center' }),
        p('right', { textAlign: 'right' }),
        p('indented'),
      ),
    )
    expect(m.blocks.filter((b) => b.kind === 'text').map((b) => b.noIndent)).toEqual([true, false, true, false, true, true, true, true, false])
  })

  it('counts words', () => {
    expect(buildRenderModel(doc(p('one two  three'), p('four'))).wordCount).toBe(4)
  })

  it('drops what the schema does not know instead of rendering it', () => {
    const m = buildRenderModel(
      doc(
        { type: 'paragraph', content: [{ type: 'text', text: 'safe', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
        { type: 'iframe', attrs: { src: 'https://evil.example' }, content: [{ type: 'text', text: 'kept text' }] },
        { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
      ),
    )
    const html = m.blocks.map((b) => renderBlockElement(b, m.schema).outerHTML).join('')
    expect(html).not.toMatch(/<a|<iframe|<script|javascript:/i)
    expect(html).toContain('safe')
    expect(html).toContain('kept text')
  })

  it('treats text that looks like HTML as text', () => {
    const m = buildRenderModel(doc(p('<img src=x onerror=alert(1)>')))
    const el = renderBlockElement(m.blocks[0], m.schema)
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('renderBlockElement', () => {
  it('marks blocks and gives empty paragraphs a line', () => {
    const m = buildRenderModel(doc(p('x'), { type: 'paragraph' }))
    const a = renderBlockElement(m.blocks[0], m.schema)
    expect(a.tagName).toBe('P')
    expect(a.className).toContain('bp-block')
    expect(a.className).toContain('bp-noindent')
    const empty = renderBlockElement(m.blocks[1], m.schema)
    expect(empty.innerHTML).toBe('<br>')
  })

  it('finds the paragraphs inside a container', () => {
    const m = buildRenderModel(doc({ type: 'orderedList', content: [{ type: 'listItem', content: [p('a')] }, { type: 'listItem', content: [p('b')] }] }))
    const el = renderBlockElement(m.blocks[0], m.schema)
    expect(el.tagName).toBe('OL')
    expect(leafElements(el).map((l) => l.textContent)).toEqual(['a', 'b'])
  })
})
