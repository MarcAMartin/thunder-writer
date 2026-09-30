import { z } from 'zod'
import { DEFAULT_FORMAT } from '../../store/documents'
import { SETTING_BOUNDS, type SettingsState } from '../../store/settings'
import type { ThunderDoc } from '../../types'

/** Validation for documents coming from IndexedDB, Drive or an imported file. */
const formatSchema = z.object({
  presetId: z.string().min(1),
  fontFamily: z.string().optional(),
  fontSizePt: z.number().positive().optional(),
  lineHeight: z.number().positive().optional(),
  chapterStartsNewPage: z.boolean().default(true),
})

const docSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  content: z.unknown().optional(),
  format: formatSchema.default(DEFAULT_FORMAT),
  createdAt: z.number(),
  updatedAt: z.number(),
  driveFileId: z.string().optional(),
  driveSyncedAt: z.number().optional(),
  driveRevisionId: z.string().optional(),
})

/** Returns a valid ThunderDoc or null. */
export function parseDoc(value: unknown): ThunderDoc | null {
  const r = docSchema.safeParse(value)
  if (!r.success) return null
  return { ...r.data, content: r.data.content ?? null }
}

export const ENVELOPE_APP = 'thunder-writer'
export const ENVELOPE_VERSION = 1

export interface DocEnvelope {
  app: typeof ENVELOPE_APP
  version: typeof ENVELOPE_VERSION
  savedAt: number
  doc: ThunderDoc
}

/** A copy of the doc with no link to a Drive file (id, sync time, revision). */
export function withoutDriveLink(doc: ThunderDoc): ThunderDoc {
  const out = { ...doc }
  delete out.driveFileId
  delete out.driveSyncedAt
  delete out.driveRevisionId
  return out
}

/**
 * Wraps a doc for a file (Drive upload or backup download). Drive linkage is
 * this browser's bookkeeping, never part of the file: a shared or re-imported
 * file must not point at (and autosave over) someone's Drive file.
 */
export function makeEnvelope(doc: ThunderDoc, savedAt = Date.now()): DocEnvelope {
  return { app: ENVELOPE_APP, version: ENVELOPE_VERSION, savedAt, doc: withoutDriveLink(doc) }
}

const envelopeSchema = z.object({
  app: z.literal(ENVELOPE_APP),
  version: z.literal(ENVELOPE_VERSION),
  doc: z.unknown().optional(),
})

export type EnvelopeResult = { ok: true; doc: ThunderDoc } | { ok: false; reason: string }

/** Validates a downloaded/imported Thunder Writer file. */
export function parseEnvelope(value: unknown): EnvelopeResult {
  const env = envelopeSchema.safeParse(value)
  if (!env.success) {
    const isOurs =
      typeof value === 'object' && value !== null && (value as Record<string, unknown>).app === ENVELOPE_APP
    return {
      ok: false,
      reason: isOurs
        ? 'This file was made by a newer or unknown version of Thunder Writer.'
        : 'This is not a Thunder Writer manuscript file.',
    }
  }
  const doc = parseDoc(env.data.doc)
  if (!doc) return { ok: false, reason: 'The manuscript inside this file is damaged or incomplete.' }
  return { ok: true, doc }
}

// ---------------------------------------------------------------------------
// Config sync. Only NON-SECRET settings are ever written to Drive.

export const CONFIG_KEYS = [
  'theme',
  'provider',
  'claudeModel',
  'openaiModel',
  'suggestionsEnabled',
  'suggestionCooldownSec',
  'suggestionIdleSec',
  'maxOpenSuggestions',
  'triviaWebSearch',
  'triviaCooldownSec',
  'driveAutosaveSec',
] as const satisfies readonly (keyof SettingsState)[]

export type SyncedConfig = Partial<Pick<SettingsState, (typeof CONFIG_KEYS)[number]>>

export interface ConfigEnvelope {
  app: typeof ENVELOPE_APP
  kind: 'config'
  version: typeof ENVELOPE_VERSION
  savedAt: number
  settings: SyncedConfig
}

/** Picks the whitelisted, non-secret settings. API keys and client ids are never included. */
export function pickConfig(s: Partial<SettingsState>): SyncedConfig {
  const out: Record<string, unknown> = {}
  for (const k of CONFIG_KEYS) if (s[k] !== undefined) out[k] = s[k]
  return out as SyncedConfig
}

export function makeConfigEnvelope(s: Partial<SettingsState>, savedAt = Date.now()): ConfigEnvelope {
  return { app: ENVELOPE_APP, kind: 'config', version: ENVELOPE_VERSION, savedAt, settings: pickConfig(s) }
}

const bounded = (k: keyof typeof SETTING_BOUNDS) => z.number().min(SETTING_BOUNDS[k].min).max(SETTING_BOUNDS[k].max)

const configSettingsSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']),
    provider: z.enum(['claude', 'openai']),
    claudeModel: z.string().min(1),
    openaiModel: z.string().min(1),
    suggestionsEnabled: z.boolean(),
    // Same bounds as the Settings UI, so a config file can't make suggestions chattier than the UI allows.
    suggestionCooldownSec: bounded('suggestionCooldownSec'),
    suggestionIdleSec: bounded('suggestionIdleSec'),
    maxOpenSuggestions: bounded('maxOpenSuggestions').int(),
    triviaWebSearch: z.boolean(),
    // Each web search is billed, so a config file can't make searches more frequent than the UI allows.
    triviaCooldownSec: bounded('triviaCooldownSec'),
    driveAutosaveSec: bounded('driveAutosaveSec'),
  })
  .partial()

const configEnvelopeSchema = z.object({
  app: z.literal(ENVELOPE_APP),
  kind: z.literal('config'),
  version: z.literal(ENVELOPE_VERSION),
  settings: z.record(z.string(), z.unknown()),
})

/**
 * Validates a config file. Unknown or invalid fields are dropped individually so
 * one bad value does not discard the rest. Secrets are never accepted.
 */
export function parseConfig(value: unknown): SyncedConfig | null {
  const env = configEnvelopeSchema.safeParse(value)
  if (!env.success) return null
  const picked = pickConfig(env.data.settings as Partial<SettingsState>)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(picked)) {
    const one = configSettingsSchema.safeParse({ [k]: v })
    if (one.success) Object.assign(out, one.data)
  }
  return out as SyncedConfig
}
