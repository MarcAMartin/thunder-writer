import type { ThunderDoc } from '../../types'
import { makeEnvelope } from '../storage/schema'

/**
 * The existing "Thunder Writer backup" file: the same envelope as File →
 * Download backup, re-importable with File → Import .thunder.json. Uses the
 * storage module's helper so the two can never drift (it also strips this
 * browser's Drive link, so a backup never autosaves over a Drive file).
 */
export function toBackupJson(doc: ThunderDoc, savedAt = Date.now()): string {
  return JSON.stringify(makeEnvelope(doc, savedAt), null, 2)
}
