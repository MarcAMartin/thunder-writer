/** Parses and clamps a number field value; null when not a number. */
export function parseNumberField(raw: string, min: number, max: number, integer = false): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  const v = integer ? Math.round(n) : n
  return Math.min(max, Math.max(min, v))
}

