import { z } from 'zod'
import type { SuggestionKind } from '../../types'

export const SUGGESTION_KINDS = ['grammar', 'spelling', 'style', 'context', 'general', 'trivia'] as const satisfies readonly SuggestionKind[]

/**
 * Shape the model must return. Every field is required (nullable instead of
 * optional) so the same schema works with Claude structured outputs and
 * OpenAI strict JSON schema. No length/array-size constraints here — both
 * providers restrict which JSON Schema keywords are allowed; limits are
 * enforced client-side in `sanitizeItems` instead.
 */
export const SuggestionItemSchema = z.object({
  kind: z.enum(SUGGESTION_KINDS),
  title: z.string(),
  detail: z.string(),
  quote: z.string().nullable(),
  replacement: z.string().nullable(),
})

export const SuggestionBatchSchema = z.object({
  suggestions: z.array(SuggestionItemSchema),
})

export type RawSuggestion = z.infer<typeof SuggestionItemSchema>
export type SuggestionBatch = z.infer<typeof SuggestionBatchSchema>

/**
 * Hand-written JSON Schema equivalent of SuggestionBatchSchema, used for
 * Claude structured outputs (the SDK's zod helper turns zod-4 enums into a
 * description instead of a real `enum` constraint).
 */
export const SUGGESTION_BATCH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...SUGGESTION_KINDS] },
          title: { type: 'string' },
          detail: { type: 'string' },
          quote: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          replacement: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['kind', 'title', 'detail', 'quote', 'replacement'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
} as const

const LooseItemSchema = z.object({
  kind: z.string(),
  title: z.string(),
  detail: z.string().optional().default(''),
  quote: z.string().nullable().optional(),
  replacement: z.string().nullable().optional(),
})

/**
 * Validate model JSON item-by-item: an odd item is skipped rather than
 * failing the whole batch, and an unknown kind falls back to "general".
 * Returns null when the payload is not a `{ suggestions: [...] }` object.
 */
export function parseSuggestionBatch(json: unknown): RawSuggestion[] | null {
  if (typeof json !== 'object' || json === null || !Array.isArray((json as { suggestions?: unknown }).suggestions)) return null
  const out: RawSuggestion[] = []
  for (const raw of (json as { suggestions: unknown[] }).suggestions) {
    const r = LooseItemSchema.safeParse(raw)
    if (!r.success) continue
    const k = r.data.kind.trim().toLowerCase()
    const kind = (SUGGESTION_KINDS as readonly string[]).includes(k) ? (k as SuggestionKind) : 'general'
    out.push({ kind, title: r.data.title, detail: r.data.detail, quote: r.data.quote ?? null, replacement: r.data.replacement ?? null })
  }
  return out
}
