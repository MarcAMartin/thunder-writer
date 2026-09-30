import { describe, expect, it } from 'vitest'
import { checkContent, editorSchema, sanitizeContent } from './contentCheck'

const t = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({
  type: 'text',
  text,
  ...(marks ? { marks } : {}),
})

const WITH_LINK = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('Chapter One')] },
    { type: 'paragraph', content: [t('See '), t('the map', [{ type: 'link', attrs: { href: 'x' } }, { type: 'bold' }]), t(' now.')] },
    { type: 'codeBlock', content: [t('let x = 1')] },
    { type: 'mysteryWidget', content: [{ type: 'paragraph', content: [t('Inside widget.')] }] },
  ],
}

describe('checkContent', () => {
  it('accepts empty and valid content', () => {
    expect(checkContent(null)).toEqual({ ok: true })
    expect(checkContent(undefined)).toEqual({ ok: true })
    expect(checkContent({ type: 'doc', content: [{ type: 'paragraph', content: [t('Hi', [{ type: 'italic' }])] }] })).toEqual({
      ok: true,
    })
  })

  it('rejects unknown marks/nodes and non-documents instead of letting TipTap load an empty doc', () => {
    const r = checkContent(WITH_LINK)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/formatting/)
    expect(checkContent({ type: 'paragraph' }).ok).toBe(false)
    expect(checkContent('just a string').ok).toBe(false)
  })
})

describe('sanitizeContent', () => {
  it('drops unknown marks, unwraps unknown nodes, and keeps every word', () => {
    const out = sanitizeContent(WITH_LINK)
    expect(checkContent(out)).toEqual({ ok: true })
    const text = editorSchema().nodeFromJSON(out).textBetween(0, editorSchema().nodeFromJSON(out).content.size, '\n')
    expect(text).toBe('Chapter One\nSee the map now.\nlet x = 1\nInside widget.')
    const para = out.content![1]
    expect(para.content![1]).toEqual({ type: 'text', text: 'the map', marks: [{ type: 'bold' }] })
  })

  it('always returns a loadable doc', () => {
    expect(checkContent(sanitizeContent('garbage'))).toEqual({ ok: true })
    expect(checkContent(sanitizeContent({ type: 'doc', content: [t('loose text')] }))).toEqual({ ok: true })
  })
})
