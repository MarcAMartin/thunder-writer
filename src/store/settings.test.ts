import { beforeEach, describe, expect, it } from 'vitest'
import {
  activeApiKey,
  activeModel,
  clampSetting,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_TRIVIA_COOLDOWN_SEC,
  hasApiKey,
  migrateSettings,
  RETIRED_GOOGLE_KEYS,
  SETTING_BOUNDS,
  SETTINGS_VERSION,
  useSettings,
} from './settings'

const KEY = 'thunder-writer:settings'

describe('trivia settings', () => {
  it('defaults: web-searched trivia on, at most every 10 minutes', () => {
    const init = useSettings.getInitialState()
    expect(init.triviaWebSearch).toBe(true)
    expect(init.triviaCooldownSec).toBe(600)
    expect(DEFAULT_TRIVIA_COOLDOWN_SEC).toBe(600)
  })

  it('clamps the trivia cooldown into 120–86400 s', () => {
    expect(SETTING_BOUNDS.triviaCooldownSec).toEqual({ min: 120, max: 86_400 })
    expect(clampSetting('triviaCooldownSec', 0)).toBe(120)
    expect(clampSetting('triviaCooldownSec', 10 ** 9)).toBe(86_400)
    expect(clampSetting('triviaCooldownSec', Number.NaN)).toBe(120)
    expect(clampSetting('triviaCooldownSec', 900)).toBe(900)
  })

  it('migrateSettings fills v1 state with the new defaults and keeps everything else', () => {
    const v1 = { claudeApiKey: 'sk-ant-keep', suggestionCooldownSec: 30 }
    expect(migrateSettings(v1, 1)).toEqual({ ...v1, triviaWebSearch: true, triviaCooldownSec: 600 })
    expect(migrateSettings({ triviaWebSearch: false, triviaCooldownSec: 5 }, 1)).toEqual({
      triviaWebSearch: false,
      triviaCooldownSec: 120,
    })
    expect(migrateSettings(null, 0)).toEqual({ triviaWebSearch: true, triviaCooldownSec: 600 })
  })
})

describe('settings persistence across the version bump', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.setState(useSettings.getInitialState())
  })

  it('rehydrates a v1 localStorage entry without losing the API key', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { claudeApiKey: 'sk-ant-v1', theme: 'dark' }, version: 1 }))
    await useSettings.persist.rehydrate()
    const s = useSettings.getState()
    expect(s.claudeApiKey).toBe('sk-ant-v1')
    expect(s.theme).toBe('dark')
    expect(s.triviaWebSearch).toBe(true)
    expect(s.triviaCooldownSec).toBe(600)
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').version).toBe(SETTINGS_VERSION)
  })

  it('keeps an explicit off switch from the current version', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { triviaWebSearch: false }, version: SETTINGS_VERSION }))
    await useSettings.persist.rehydrate()
    expect(useSettings.getState().triviaWebSearch).toBe(false)
    expect(useSettings.getState().triviaCooldownSec).toBe(600)
  })
})

describe('Google Cloud values are no longer settings (v4)', () => {
  const GOOGLE = {
    googleClientId: '698829428298-abc.apps.googleusercontent.com',
    googleApiKey: 'AIza-old',
    googleProjectNumber: '698829428298',
  }

  beforeEach(() => {
    localStorage.clear()
    useSettings.setState(useSettings.getInitialState(), true)
  })

  it('is settings version 4, with nothing Google-related in the state', () => {
    expect(SETTINGS_VERSION).toBe(4)
    const init = useSettings.getInitialState() as unknown as Record<string, unknown>
    for (const k of RETIRED_GOOGLE_KEYS) expect(init).not.toHaveProperty(k)
  })

  it('drops the old client id, API key and project number, keeping everything else', () => {
    const keep = { claudeApiKey: 'sk-ant-keep', openaiApiKey: 'sk-keep', triviaWebSearch: false, triviaCooldownSec: 900, theme: 'dark' }
    expect(migrateSettings({ ...keep, ...GOOGLE }, 3)).toEqual(keep)
    expect(migrateSettings({ ...keep, googleClientId: GOOGLE.googleClientId }, 2)).toEqual(keep)
    expect(migrateSettings({ claudeApiKey: 'sk-ant-v1', googleClientId: GOOGLE.googleClientId }, 1)).toEqual({
      claudeApiKey: 'sk-ant-v1',
      triviaWebSearch: true,
      triviaCooldownSec: 600,
    })
  })

  it('rehydrates a v3 localStorage entry without the Google values and without losing AI keys', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { claudeApiKey: 'sk-ant-v3', openaiApiKey: 'sk-v3', triviaCooldownSec: 900, ...GOOGLE }, version: 3 }),
    )
    await useSettings.persist.rehydrate()
    const s = useSettings.getState() as unknown as Record<string, unknown>
    expect(s.claudeApiKey).toBe('sk-ant-v3')
    expect(s.openaiApiKey).toBe('sk-v3')
    expect(s.triviaCooldownSec).toBe(900)
    for (const k of RETIRED_GOOGLE_KEYS) expect(s).not.toHaveProperty(k)
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    expect(stored.version).toBe(4)
    expect(JSON.stringify(stored)).not.toMatch(/googleusercontent|AIza-old/)
  })
})

describe('OpenRouter settings', () => {
  it('uses the OpenRouter key and model when OpenRouter is the provider', () => {
    const s = {
      provider: 'openrouter' as const,
      claudeApiKey: 'sk-ant',
      openaiApiKey: 'sk-oa',
      openrouterApiKey: ' sk-or ',
      claudeModel: 'claude-haiku-4-5',
      openaiModel: 'gpt-6-luna',
      openrouterModel: 'google/gemini-3.8-flash',
    }
    expect(activeApiKey(s)).toBe(' sk-or ')
    expect(hasApiKey(s)).toBe(true)
    expect(hasApiKey({ ...s, openrouterApiKey: '  ' })).toBe(false)
    expect(activeModel(s)).toBe('google/gemini-3.8-flash')
    expect(activeModel({ ...s, openrouterModel: ' ' })).toBe(DEFAULT_OPENROUTER_MODEL)
    expect(activeModel({ ...s, provider: 'claude' })).toBe('claude-haiku-4-5')
  })

  it('a browser that saved settings before OpenRouter gets its defaults', () => {
    const fresh = useSettings.getInitialState()
    expect(fresh.openrouterApiKey).toBe('')
    expect(fresh.openrouterModel).toBe(DEFAULT_OPENROUTER_MODEL)
  })
})
