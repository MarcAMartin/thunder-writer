import { describe, expect, it } from 'vitest'
import { CONFIG_KEYS, makeConfigEnvelope, makeEnvelope, parseConfig, parseDoc, parseEnvelope, pickConfig } from './schema'
import { makeDoc } from './testDocs'

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

describe('config sync', () => {
  const settings = {
    theme: 'dark' as const,
    provider: 'openai' as const,
    claudeApiKey: 'sk-ant-SECRET',
    openaiApiKey: 'sk-SECRET',
    googleClientId: 'client.apps.googleusercontent.com',
    claudeModel: 'claude-haiku-4-5',
    maxOpenSuggestions: 2,
    suggestionsCollapsed: true,
  }

  it('never includes API keys or the client id', () => {
    const cfg = pickConfig(settings)
    const json = JSON.stringify(makeConfigEnvelope(settings))
    expect(cfg).toEqual({ theme: 'dark', provider: 'openai', claudeModel: 'claude-haiku-4-5', maxOpenSuggestions: 2 })
    expect(json).not.toContain('SECRET')
    expect(json).not.toContain('googleusercontent')
  })

  it('drops secrets and invalid values when loading', () => {
    const cfg = parseConfig({
      app: 'thunder-writer',
      kind: 'config',
      version: 1,
      settings: { theme: 'purple', provider: 'claude', claudeApiKey: 'sneaky', maxOpenSuggestions: 3, suggestionIdleSec: -5 },
    })
    expect(cfg).toEqual({ provider: 'claude', maxOpenSuggestions: 3 })
  })

  it('rejects cooldown/idle values below the Settings UI floors', () => {
    const cfg = parseConfig({
      app: 'thunder-writer',
      kind: 'config',
      version: 1,
      settings: { suggestionCooldownSec: 0, suggestionIdleSec: 0, driveAutosaveSec: 0, maxOpenSuggestions: 9 },
    })
    expect(cfg).toEqual({ driveAutosaveSec: 0 })
    const ok = parseConfig({
      app: 'thunder-writer',
      kind: 'config',
      version: 1,
      settings: { suggestionCooldownSec: 5, suggestionIdleSec: 1 },
    })
    expect(ok).toEqual({ suggestionCooldownSec: 5, suggestionIdleSec: 1 })
  })

  it('syncs the web-searched trivia settings within their bounds', () => {
    expect(pickConfig({ triviaWebSearch: false, triviaCooldownSec: 900 })).toEqual({ triviaWebSearch: false, triviaCooldownSec: 900 })
    const env = (settings: Record<string, unknown>) => ({ app: 'thunder-writer', kind: 'config', version: 1, settings })
    expect(parseConfig(env({ triviaWebSearch: true, triviaCooldownSec: 600 }))).toEqual({ triviaWebSearch: true, triviaCooldownSec: 600 })
    // Below the floor (searches are billed) or the wrong type: dropped individually.
    expect(parseConfig(env({ triviaWebSearch: 'yes', triviaCooldownSec: 10, theme: 'dark' }))).toEqual({ theme: 'dark' })
    expect(parseConfig(env({ triviaCooldownSec: 999_999 }))).toEqual({})
  })

  it('never syncs the Google Picker API key or project number', () => {
    expect(CONFIG_KEYS).not.toContain('googleApiKey' as never)
    expect(CONFIG_KEYS).not.toContain('googleProjectNumber' as never)
    const settings = {
      theme: 'dark' as const,
      googleApiKey: 'AIzaSECRETKEY',
      googleProjectNumber: '698829428298',
      googleClientId: '698829428298-x.apps.googleusercontent.com',
    }
    const json = JSON.stringify(makeConfigEnvelope(settings))
    expect(json).not.toContain('AIzaSECRETKEY')
    expect(json).not.toContain('698829428298')
    expect(
      parseConfig({ app: 'thunder-writer', kind: 'config', version: 1, settings: { theme: 'light', googleApiKey: 'AIza-evil' } }),
    ).toEqual({ theme: 'light' })
  })

  it('returns null for non-config files', () => {
    expect(parseConfig(makeEnvelope(makeDoc()))).toBeNull()
  })
})
