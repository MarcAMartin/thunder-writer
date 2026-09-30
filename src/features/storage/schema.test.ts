import { describe, expect, it } from 'vitest'
import { makeEnvelope, parseDoc, parseEnvelope } from './schema'
import { makeDoc } from './testDocs'
import { useDocuments } from '../../store/documents'
import { normalizeBookLayout, normalizeHeaderFooter, DEFAULT_BOOK_LAYOUT, DEFAULT_HEADER_FOOTER } from '../preview/headerFooter'

describe('doc envelope', () => {
  it('round-trips a document', () => {
    const doc = makeDoc()
    const res = parseEnvelope(JSON.parse(JSON.stringify(makeEnvelope(doc, 5))))
    expect(res).toEqual({ ok: true, doc })
  })

  it('never writes Drive linkage into a file (backups must not point at, or autosave over, a Drive file)', () => {
    const doc = makeDoc({ driveFileId: 'f1', driveSyncedAt: 3, driveRevisionId: 'r1' })
    const env = makeEnvelope(doc, 5)
    expect(env.doc).not.toHaveProperty('driveFileId')
    expect(env.doc).not.toHaveProperty('driveSyncedAt')
    expect(env.doc).not.toHaveProperty('driveRevisionId')
    expect(doc.driveFileId).toBe('f1') // the store's copy is untouched
  })

  it('rejects files from other apps', () => {
    const res = parseEnvelope({ hello: 'world' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/not a Thunder Writer/)
  })

  it('rejects unknown versions with a specific message', () => {
    const res = parseEnvelope({ app: 'thunder-writer', version: 99, doc: makeDoc() })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/newer or unknown version/)
  })

  it('rejects a damaged doc inside a valid envelope', () => {
    const res = parseEnvelope({ app: 'thunder-writer', version: 1, doc: { id: 'x' } })
    expect(res.ok).toBe(false)
  })

  it('fills defaults for missing format and content', () => {
    const doc = parseDoc({ id: 'a', title: 't', createdAt: 1, updatedAt: 2 })
    expect(doc?.content).toBeNull()
    expect(doc?.format.chapterStartsNewPage).toBe(true)
    expect(doc?.format.presetId).toBeTruthy()
  })
})

describe('printed-book settings in the format', () => {
  const headerFooter = {
    authorName: 'Ada Lovelace',
    versoHead: 'author',
    rectoHead: 'chapter',
    pageNumbers: 'footer-outside',
    firstPageNumber: 3,
    shortHeads: { 'A Very Long Chapter Title': 'Long Chapter' },
  } as const
  const bookLayout = { chaptersStartRecto: false, justify: false, chapterSink: 0.2 }

  it('keeps header/footer and book layout settings through a file round trip (reload, Drive, backup)', () => {
    const doc = makeDoc({ format: { presetId: 'trade-6x9', chapterStartsNewPage: true, headerFooter, bookLayout } })
    const res = parseEnvelope(JSON.parse(JSON.stringify(makeEnvelope(doc, 5))))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.doc.format.headerFooter).toEqual(headerFooter)
    expect(res.doc.format.bookLayout).toEqual(bookLayout)
    expect(parseDoc(JSON.parse(JSON.stringify(doc)))?.format).toEqual(doc.format)
  })

  it('gives old documents without the settings the defaults', () => {
    const doc = parseDoc({ id: 'a', title: 't', createdAt: 1, updatedAt: 2, format: { presetId: 'trade-6x9', chapterStartsNewPage: true } })
    expect(doc?.format.headerFooter).toBeUndefined()
    expect(normalizeHeaderFooter(doc?.format.headerFooter)).toEqual(DEFAULT_HEADER_FOOTER)
    expect(normalizeBookLayout(doc?.format.bookLayout)).toEqual(DEFAULT_BOOK_LAYOUT)
  })

  it('drops settings that are not objects (keeping the manuscript), and repairs bad values when read', () => {
    for (const bad of [null, 'oops', 7, ['a']]) {
      const kept = parseDoc({ id: 'a', title: 't', createdAt: 1, updatedAt: 2, format: { presetId: 'x', headerFooter: bad, bookLayout: bad } })
      expect(kept).not.toBeNull()
      expect(kept?.format.presetId).toBe('x')
      expect(kept?.format.headerFooter).toBeUndefined()
      expect(kept?.format.bookLayout).toBeUndefined()
      expect(normalizeHeaderFooter(kept?.format.headerFooter)).toEqual(DEFAULT_HEADER_FOOTER)
    }
    const env = parseEnvelope({ app: 'thunder-writer', version: 1, savedAt: 1, doc: { id: 'a', title: 't', createdAt: 1, updatedAt: 2, format: { presetId: 'x', headerFooter: null } } })
    expect(env.ok).toBe(true)
    const doc = parseDoc({
      id: 'a',
      title: 't',
      createdAt: 1,
      updatedAt: 2,
      format: { presetId: 'trade-6x9', headerFooter: { versoHead: '<script>', firstPageNumber: -4 }, bookLayout: { chapterSink: 9 } },
    })
    expect(normalizeHeaderFooter(doc?.format.headerFooter).versoHead).toBe(DEFAULT_HEADER_FOOTER.versoHead)
    expect(normalizeHeaderFooter(doc?.format.headerFooter).firstPageNumber).toBe(1)
    expect(normalizeBookLayout(doc?.format.bookLayout).chapterSink).toBe(DEFAULT_BOOK_LAYOUT.chapterSink)
  })

  it('updateFormat stores the settings and marks the doc for Drive', () => {
    useDocuments.setState({ docs: {}, currentId: null, dirtyForDrive: {} })
    const d = useDocuments.getState().createDoc({ title: 'Book' })
    useDocuments.setState({ dirtyForDrive: {} })
    useDocuments.getState().updateFormat(d.id, { headerFooter: normalizeHeaderFooter(headerFooter) })
    useDocuments.getState().updateFormat(d.id, { bookLayout })
    const s = useDocuments.getState()
    expect(s.docs[d.id].format.headerFooter?.authorName).toBe('Ada Lovelace')
    expect(s.docs[d.id].format.bookLayout).toEqual(bookLayout)
    expect(s.docs[d.id].format.presetId).toBe('trade-6x9')
    expect(s.dirtyForDrive[d.id]).toBe(true)
  })
})
