import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clampSetting,
  DEFAULT_TRIVIA_COOLDOWN_SEC,
  googleApiKey,
  googleProjectNumber,
  migrateSettings,
  projectNumberFromClientId,
  SETTING_BOUNDS,
  SETTINGS_VERSION,
  useSettings,
} from './settings'

const V3_DEFAULTS = { googleApiKey: '', googleProjectNumber: '' }

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
    expect(migrateSettings(v1, 1)).toEqual({ ...v1, triviaWebSearch: true, triviaCooldownSec: 600, ...V3_DEFAULTS })
    expect(migrateSettings({ triviaWebSearch: false, triviaCooldownSec: 5 }, 1)).toEqual({
      triviaWebSearch: false,
      triviaCooldownSec: 120,
      ...V3_DEFAULTS,
    })
    expect(migrateSettings(null, 0)).toEqual({ triviaWebSearch: true, triviaCooldownSec: 600, ...V3_DEFAULTS })
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

describe('Google Picker settings (v3)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubEnv('VITE_GOOGLE_API_KEY', '')
    useSettings.setState(useSettings.getInitialState())
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is settings version 3', () => {
    expect(SETTINGS_VERSION).toBe(3)
    const init = useSettings.getInitialState()
    expect(init.googleApiKey).toBe('')
    expect(init.googleProjectNumber).toBe('')
  })

  it('migrates v2 -> v3 keeping every stored key, including AI keys and the client id', () => {
    const v2 = {
      claudeApiKey: 'sk-ant-keep',
      openaiApiKey: 'sk-keep',
      googleClientId: '698829428298-abc.apps.googleusercontent.com',
      triviaWebSearch: false,
      triviaCooldownSec: 900,
      theme: 'dark',
    }
    expect(migrateSettings(v2, 2)).toEqual({ ...v2, ...V3_DEFAULTS })
    // A value somehow already present survives.
    expect(migrateSettings({ googleApiKey: 'AIza-x' }, 2)).toEqual({ googleApiKey: 'AIza-x', googleProjectNumber: '' })
  })

  it('rehydrates a v2 localStorage entry without losing API keys', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: { claudeApiKey: 'sk-ant-v2', openaiApiKey: 'sk-v2', googleClientId: '123-x.apps.googleusercontent.com', triviaCooldownSec: 900 },
        version: 2,
      }),
    )
    await useSettings.persist.rehydrate()
    const s = useSettings.getState()
    expect(s.claudeApiKey).toBe('sk-ant-v2')
    expect(s.openaiApiKey).toBe('sk-v2')
    expect(s.googleClientId).toBe('123-x.apps.googleusercontent.com')
    expect(s.triviaCooldownSec).toBe(900)
    expect(s.googleApiKey).toBe('')
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').version).toBe(3)
  })

  it('derives the project number from the client id, with an override', () => {
    expect(projectNumberFromClientId('698829428298-xxxx.apps.googleusercontent.com')).toBe('698829428298')
    expect(projectNumberFromClientId(' 42-a.apps.googleusercontent.com ')).toBe('42')
    expect(projectNumberFromClientId('not-a-number.apps.googleusercontent.com')).toBe('')
    expect(projectNumberFromClientId('')).toBe('')
    const base = { googleClientId: '698829428298-xxxx.apps.googleusercontent.com', googleProjectNumber: '' }
    expect(googleProjectNumber(base)).toBe('698829428298')
    expect(googleProjectNumber({ ...base, googleProjectNumber: ' 111 ' })).toBe('111')
  })

  it('uses the Settings API key, falling back to VITE_GOOGLE_API_KEY', () => {
    expect(googleApiKey({ googleApiKey: '' })).toBe('')
    vi.stubEnv('VITE_GOOGLE_API_KEY', 'AIza-env')
    expect(googleApiKey({ googleApiKey: '' })).toBe('AIza-env')
    expect(googleApiKey({ googleApiKey: ' AIza-mine ' })).toBe('AIza-mine')
  })
})
