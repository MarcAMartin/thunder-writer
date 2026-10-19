/**
 * A Thunder Writer AI key as the writer sees it: one string holding both the
 * OpenRouter key that pays for suggestions and that key's hash, the id a
 * top-up goes to (OpenRouter never shows a key's hash to the key itself).
 * Pasting the string into another browser brings the same credit along.
 */
export interface ThunderAiKey {
  hash: string
  key: string
}

const KEY_PATTERN = /^twai\.([a-f0-9]{64})\.(sk-or-[A-Za-z0-9-]{8,200})$/

export const formatThunderAiKey = ({ hash, key }: ThunderAiKey) => `twai.${hash}.${key}`

export function parseThunderAiKey(value: string): ThunderAiKey | null {
  const m = KEY_PATTERN.exec(value.trim())
  return m ? { hash: m[1], key: m[2] } : null
}
