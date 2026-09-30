import { beforeEach, describe, expect, it } from 'vitest'
import {
  clampSetting,
  DEFAULT_TRIVIA_COOLDOWN_SEC,
  migrateSettings,
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
