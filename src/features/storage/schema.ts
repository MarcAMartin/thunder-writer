import { z } from 'zod'
import { DEFAULT_FORMAT } from '../../store/documents'
import type { ThunderDoc } from '../../types'

/** Validation for documents coming from IndexedDB, Drive or an imported file. */
const formatSchema = z.object({
  presetId: z.string().min(1),
  fontFamily: z.string().optional(),
  fontSizePt: z.number().positive().optional(),
  lineHeight: z.number().positive().optional(),
  chapterStartsNewPage: z.boolean().default(true),
  // Printed-book settings. Kept as loose records here (z.object would strip them
  // and they'd vanish on reload / Drive sync); normalizeHeaderFooter and
  // normalizeBookLayout validate every field when they are read. A value that
  // isn't an object at all (null, a string, another version's shape) falls back
  // to the defaults rather than making the whole manuscript unreadable.
  headerFooter: z.record(z.string(), z.unknown()).optional().catch(undefined),
  bookLayout: z.record(z.string(), z.unknown()).optional().catch(undefined),
  // Paper & ink; read through normalizePrint (features/preview/printSettings).
  print: z.record(z.string(), z.unknown()).optional().catch(undefined),
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
