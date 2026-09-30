import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createEditorBridge } from './bridge'
import { createExtensions } from './editorExtensions'
import { getSuggestionHighlight } from './extensions'
import { buildIndex, cachedIndex, findQuote, matchQuoteStyle, normalize, plainTextOf } from './textIndex'

let editors: Editor[] = []

function makeEditor(content: object) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: createExtensions(), content })
  editors.push(editor)
  return editor
}

afterEach(() => {
  editors.forEach((e) => e.destroy())
  editors = []
  document.body.innerHTML = ''
})

const t = (text: string, marks?: { type: string }[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) })
// JSON (not HTML) so runs of spaces survive parsing, like text typed by a writer.
const SAMPLE = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('One')] },
    {
      type: 'paragraph',
      content: [
        t('He said, “Hello '),
        t('there', [{ type: 'bold' }]),
        t(', '),
        t('my', [{ type: 'italic' }]),
        t(' friend.” It’s late.'),
      ],
    },
    {
      type: 'paragraph',
      content: [t('Second   paragraph'), { type: 'hardBreak' }, t('with a break… and more.')],
    },
  ],
}

describe('textIndex', () => {
  it('indexes a novel-length manuscript in linear time and reuses the index per doc version', () => {
    // ~120,000 words in 2,500 paragraphs. The old builder flattened a growing string on every
    // character (quadratic): about 3 s per quote check in a browser.
    const para = 'The rain came down across the harbour and Mara watched the “lights” go out — one by one. '.repeat(3)
    const content = Array.from({ length: 2500 }, (_, i) =>
      i % 60 === 0 ? { type: 'heading', attrs: { level: 1 }, content: [t(`Chapter ${i / 60 + 1}`)] } : { type: 'paragraph', content: [t(para)] },
    )
    const editor = makeEditor({ type: 'doc', content })
    const doc = editor.state.doc
    const started = performance.now()
    const index = cachedIndex(doc)
    expect(performance.now() - started).toBeLessThan(1500)
    expect(index.text.length).toBeGreaterThan(600_000)
    expect(index.from).toHaveLength(index.text.length)
    expect(cachedIndex(doc)).toBe(index)
    const bridge = createEditorBridge(editor)
    const t0 = performance.now()
    for (let i = 0; i < 5; i++) expect(bridge.hasQuote('MARA WATCHED THE "LIGHTS" GO OUT')).toBe(true)
    expect(bridge.hasQuote('a line nobody wrote')).toBe(false)
    expect(performance.now() - t0).toBeLessThan(500)
    // A new doc version gets a fresh index.
    editor.commands.insertContentAt(1, 'X')
    expect(cachedIndex(editor.state.doc)).not.toBe(index)
    expect(cachedIndex(editor.state.doc).text.startsWith('XChapter 1')).toBe(true)
  })

  it('normalizes whitespace, curly quotes, dashes and ellipses', () => {
    expect(normalize('  “It’s  — fine…”  ')).toBe('"It\'s - fine..."')
    expect(normalize('a​b')).toBe('ab')
  })

  it('maps quotes across marks back to exact document positions', () => {
    const editor = makeEditor(SAMPLE)
    const { doc } = editor.state
    const range = findQuote(doc, 'Hello there, my friend.')
    expect(range).not.toBeNull()
    expect(doc.textBetween(range!.from, range!.to)).toBe('Hello there, my friend.')
  })

  it('tolerates straight vs curly quotes and whitespace differences', () => {
    const editor = makeEditor(SAMPLE)
    const { doc } = editor.state
    const r1 = findQuote(doc, '"Hello there,  my friend." It\'s late.')
    expect(doc.textBetween(r1!.from, r1!.to)).toBe('“Hello there, my friend.” It’s late.')
    const r2 = findQuote(doc, 'Second paragraph with a break... and')
    expect(r2).not.toBeNull()
    expect(doc.textBetween(r2!.from, r2!.to, ' ', ' ')).toBe('Second   paragraph with a break… and')
  })

  it('falls back to case-insensitive matching and returns null when absent', () => {
    const editor = makeEditor(SAMPLE)
    const { doc } = editor.state
    expect(findQuote(doc, 'HELLO THERE')).not.toBeNull()
    expect(findQuote(doc, 'not in the text')).toBeNull()
    expect(findQuote(doc, '   ')).toBeNull()
  })

  it('can match across block boundaries', () => {
    const editor = makeEditor(SAMPLE)
    const { doc } = editor.state
    const r = findQuote(doc, 'late. Second')
    expect(r).not.toBeNull()
    expect(doc.textBetween(r!.from, r!.to, '|')).toBe('late.|Second')
  })

  it('keeps index arrays aligned with the normalized text', () => {
    const editor = makeEditor(SAMPLE)
    const idx = buildIndex(editor.state.doc)
    expect(idx.from.length).toBe(idx.text.length)
    expect(idx.to.length).toBe(idx.text.length)
    for (let i = 1; i < idx.from.length; i++) expect(idx.from[i]).toBeGreaterThanOrEqual(idx.from[i - 1])
  })

  it('matches replacement quote style to the original', () => {
    expect(matchQuoteStyle('“It’s”', '"It\'s fine," she said')).toBe('“It’s fine,” she said')
    expect(matchQuoteStyle('plain "text"', '"x"')).toBe('"x"')
  })
})

describe('createEditorBridge', () => {
  it('returns plain text with paragraphs separated by blank lines', () => {
    const editor = makeEditor(SAMPLE)
    const bridge = createEditorBridge(editor)
    const text = bridge.getPlainText()
    expect(text.split('\n\n')).toEqual([
      'One',
      'He said, “Hello there, my friend.” It’s late.',
      'Second   paragraph\nwith a break… and more.',
    ])
    expect(plainTextOf(editor.state.doc)).toBe(text)
  })

  it('returns text near the cursor within budget', () => {
    const editor = makeEditor(SAMPLE)
    const bridge = createEditorBridge(editor)
    editor.commands.setTextSelection(findQuote(editor.state.doc, 'friend')!.from)
    const near = bridge.getTextNearCursor(40)
    expect(near.length).toBeLessThanOrEqual(40)
    expect(near).toContain('my')
    expect(near).toContain('friend')
    expect(bridge.getTextNearCursor(0)).toBe('')
  })

  it('builds the excerpt near the cursor with the same separators as getPlainText (empty paragraphs skipped)', () => {
    const p = (text?: string) => ({ type: 'paragraph', ...(text ? { content: [t(text)] } : {}) })
    const editor = makeEditor({
      type: 'doc',
      content: [p('Alpha one two three.'), p(), p('   '), p('Beta four five six.'), p('Gamma seven.')],
    })
    const bridge = createEditorBridge(editor)
    const full = bridge.getPlainText()
    expect(full).toBe('Alpha one two three.\n\nBeta four five six.\n\nGamma seven.')
    // Caret in the middle of "Beta": the whole doc fits the budget, so the excerpt equals the plain text.
    editor.commands.setTextSelection(findQuote(editor.state.doc, 'four')!.from)
    expect(bridge.getTextNearCursor(500)).toBe(full)
    // Caret at the very start of a block: the halves still join with a blank line.
    editor.commands.setTextSelection(findQuote(editor.state.doc, 'Gamma')!.from)
    expect(bridge.getTextNearCursor(500)).toBe(full)
  })

  it('keeps a boundary when the caret sits on an empty line, so the AI sees the passage being written', async () => {
    const { buildManuscriptView } = await import('../suggestions/prompt')
    const filler = Array.from({ length: 400 }, (_, i) => ({ type: 'paragraph', content: [t(`Filler paragraph number ${i} goes here.`)] }))
    const editor = makeEditor({
      type: 'doc',
      content: [
        ...filler,
        { type: 'paragraph', content: [t('The lighthouse keeper finally spoke.')] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [t('She did not answer him.')] },
        ...filler,
      ],
    })
    const bridge = createEditorBridge(editor)
    // Caret on the empty paragraph between the two sentences.
    const pos = findQuote(editor.state.doc, 'The lighthouse keeper finally spoke.')!.to + 2
    editor.commands.setTextSelection(pos)
    expect(editor.state.selection.$from.parent.content.size).toBe(0)
    const focus = bridge.getTextNearCursor(1500)
    expect(focus).toContain('finally spoke.')
    expect(focus).toContain('She did not')
    expect(focus).not.toContain('spoke.She')
    const view = buildManuscriptView(bridge.getPlainText(), focus)
    expect(view.truncated).toBe(true)
    expect(view.text).toContain('The lighthouse keeper finally spoke.\n\nShe did not answer him.')
  })

  it('finds, highlights and clears quotes without touching the document', () => {
    const editor = makeEditor(SAMPLE)
    const bridge = createEditorBridge(editor)
    const before = JSON.stringify(editor.getJSON())
    expect(bridge.hasQuote('my friend')).toBe(true)
    expect(bridge.hasQuote('nope nope')).toBe(false)
    expect(bridge.highlightQuote('my friend')).toBe(true)
    const hl = getSuggestionHighlight(editor.state)
    expect(editor.state.doc.textBetween(hl!.from, hl!.to)).toBe('my friend')
    expect(editor.view.dom.querySelector('.ed-suggest-hl')).not.toBeNull()
    expect(JSON.stringify(editor.getJSON())).toBe(before)
    bridge.clearHighlight()
    expect(getSuggestionHighlight(editor.state)).toBeNull()
    expect(editor.view.dom.querySelector('.ed-suggest-hl')).toBeNull()
    expect(bridge.highlightQuote('absent text')).toBe(false)
  })

  it('replaces a quote as a single undoable step and keeps marks', () => {
    const editor = makeEditor(SAMPLE)
    const bridge = createEditorBridge(editor)
    const original = editor.getHTML()
    expect(bridge.replaceQuote('It\'s late.', 'It\'s very late.')).toBe(true)
    expect(bridge.getPlainText()).toContain('It’s very late.')
    expect(bridge.replaceQuote('there', 'over there')).toBe(true)
    expect(editor.getHTML()).toContain('<strong>over there</strong>')
    editor.commands.undo()
    expect(editor.getHTML()).not.toContain('over there')
    expect(bridge.getPlainText()).toContain('very late')
    editor.commands.undo()
    expect(editor.getHTML()).toBe(original)
    expect(bridge.replaceQuote('missing words', 'x')).toBe(false)
  })

  it('deletes the quote when the replacement is empty and clears the highlight', () => {
    const editor = makeEditor(SAMPLE)
    const bridge = createEditorBridge(editor)
    bridge.highlightQuote(' It’s late.')
    expect(bridge.replaceQuote('It’s late.', '')).toBe(true)
    expect(bridge.getPlainText()).not.toContain('late')
    expect(getSuggestionHighlight(editor.state)).toBeNull()
  })

  it('is inert after the editor is destroyed', () => {
    const editor = makeEditor(SAMPLE)
    const bridge = createEditorBridge(editor)
    editor.destroy()
    expect(bridge.getPlainText()).toBe('')
    expect(bridge.hasQuote('friend')).toBe(false)
    expect(bridge.replaceQuote('friend', 'x')).toBe(false)
    expect(() => bridge.clearHighlight()).not.toThrow()
  })
})
