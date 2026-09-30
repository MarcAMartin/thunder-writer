import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AIProvider, ThemeMode } from '../types'

/**
 * User settings. Persisted to localStorage only; never sent anywhere except the
 * API key to its own provider. Nothing is stored on a backend (there is none).
 */
export interface SettingsState {
  theme: ThemeMode
  provider: AIProvider
  claudeApiKey: string
  openaiApiKey: string
  /** Model ids. Defaults are the cheapest capable models per the design notes. */
  claudeModel: string
  openaiModel: string
  /** Master switch for background suggestions. */
  suggestionsEnabled: boolean
  /** Minimum seconds between automatic suggestion requests (anti-chattiness timeout). */
  suggestionCooldownSec: number
  /** Seconds of typing idle before an automatic request may fire. */
  suggestionIdleSec: number
  /** Max open suggestions shown at once (design: only 1-2 at a time). */
  maxOpenSuggestions: number
  /**
   * Current-events trivia via the provider's built-in web search tool. When off,
   * trivia comes only from the model's training knowledge.
   */
  triviaWebSearch: boolean
  /** Minimum seconds between web-searched trivia requests (each search is billed). */
  triviaCooldownSec: number
  /** Suggestion pane collapsed ("locked in and cruising"). */
  suggestionsCollapsed: boolean
  /** Google OAuth Web Client ID; falls back to VITE_GOOGLE_CLIENT_ID. */
  googleClientId: string
  /**
   * Browser API key for the Google Picker (importing existing Drive files);
   * falls back to VITE_GOOGLE_API_KEY. Never synced to Drive.
   */
  googleApiKey: string
  /**
   * Cloud project number the Picker passes as its appId. Blank = derived from
   * the OAuth client id (its numeric prefix). Never synced to Drive.
   */
  googleProjectNumber: string
  /** Autosave to Drive every N seconds while there are unsynced changes. 0 = only on change debounce. */
  driveAutosaveSec: number
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void
}

/**
 * Allowed ranges for numeric settings. Shared by the Settings UI, config files
 * loaded from Drive, and the suggestion engine, so no path can bypass the
 * anti-chattiness floors.
 */
export const SETTING_BOUNDS = {
  suggestionCooldownSec: { min: 5, max: 3600 },
  suggestionIdleSec: { min: 1, max: 120 },
  maxOpenSuggestions: { min: 1, max: 5 },
  triviaCooldownSec: { min: 120, max: 86_400 },
  driveAutosaveSec: { min: 0, max: 3600 },
} as const

export type BoundedSetting = keyof typeof SETTING_BOUNDS

/** Clamps a numeric setting into its allowed range (non-numbers fall back to the minimum). */
export function clampSetting(key: BoundedSetting, value: number): number {
  const { min, max } = SETTING_BOUNDS[key]
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5'
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna'

export const DEFAULT_TRIVIA_WEB_SEARCH = true
/** At most one web-searched trivia request every 10 minutes by default. */
export const DEFAULT_TRIVIA_COOLDOWN_SEC = 600

export const SETTINGS_VERSION = 3

/**
 * Upgrades settings persisted by an older version. zustand's default merge
 * already fills keys that are missing from storage with the defaults, but a
 * version bump without a migrate function would discard the stored state
 * (including API keys), so this must exist. v1 -> v2 adds the web-searched
 * trivia settings; v2 -> v3 adds the Google Picker API key and project number.
 * Every other stored key (AI keys, client id, …) is kept as it is.
 */
export function migrateSettings(persisted: unknown, fromVersion: number): Partial<SettingsState> {
  const s = (typeof persisted === 'object' && persisted !== null ? { ...persisted } : {}) as Partial<SettingsState>
  if (fromVersion < 2) {
    if (typeof s.triviaWebSearch !== 'boolean') s.triviaWebSearch = DEFAULT_TRIVIA_WEB_SEARCH
    if (typeof s.triviaCooldownSec !== 'number') s.triviaCooldownSec = DEFAULT_TRIVIA_COOLDOWN_SEC
  }
  if (fromVersion < 3) {
    if (typeof s.googleApiKey !== 'string') s.googleApiKey = ''
    if (typeof s.googleProjectNumber !== 'string') s.googleProjectNumber = ''
  }
  if (typeof s.triviaCooldownSec === 'number') s.triviaCooldownSec = clampSetting('triviaCooldownSec', s.triviaCooldownSec)
  return s
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      provider: 'claude',
      claudeApiKey: '',
      openaiApiKey: '',
      claudeModel: DEFAULT_CLAUDE_MODEL,
      openaiModel: DEFAULT_OPENAI_MODEL,
      suggestionsEnabled: true,
      suggestionCooldownSec: 45,
      suggestionIdleSec: 4,
      maxOpenSuggestions: 2,
      triviaWebSearch: DEFAULT_TRIVIA_WEB_SEARCH,
      triviaCooldownSec: DEFAULT_TRIVIA_COOLDOWN_SEC,
      suggestionsCollapsed: false,
      googleClientId: '',
      googleApiKey: '',
      googleProjectNumber: '',
      driveAutosaveSec: 60,
      set: (patch) => set(patch),
    }),
    {
      name: 'thunder-writer:settings',
      version: SETTINGS_VERSION,
      migrate: (persisted, version) => migrateSettings(persisted, version) as SettingsState,
    },
  ),
)

export const activeApiKey = (s: Pick<SettingsState, 'provider' | 'claudeApiKey' | 'openaiApiKey'>) =>
  s.provider === 'claude' ? s.claudeApiKey : s.openaiApiKey

export const hasApiKey = (s: Pick<SettingsState, 'provider' | 'claudeApiKey' | 'openaiApiKey'>) =>
  activeApiKey(s).trim().length > 0

export const googleClientId = (s: Pick<SettingsState, 'googleClientId'>) =>
  s.googleClientId.trim() || (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || ''

/** Browser API key for the Google Picker; the Settings value overrides VITE_GOOGLE_API_KEY. */
export const googleApiKey = (s: Pick<SettingsState, 'googleApiKey'>) =>
  (s.googleApiKey ?? '').trim() || ((import.meta.env.VITE_GOOGLE_API_KEY as string | undefined) ?? '').trim()

/**
 * The Cloud project number is the numeric prefix of an OAuth client id:
 * "698829428298-abc.apps.googleusercontent.com" -> "698829428298".
 */
export function projectNumberFromClientId(clientId: string): string {
  return /^(\d+)-/.exec(clientId.trim())?.[1] ?? ''
}

/** The Picker's appId: the Settings override, else derived from the client id. */
export const googleProjectNumber = (s: Pick<SettingsState, 'googleProjectNumber' | 'googleClientId'>) =>
  (s.googleProjectNumber ?? '').trim() || projectNumberFromClientId(googleClientId(s))
