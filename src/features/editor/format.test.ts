import { describe, expect, it } from 'vitest'
import { describeElapsed, formatCost, formatCount, formatElapsed } from './format'

describe('status formatting', () => {
  it('formats elapsed time as H:MM:SS', () => {
    expect(formatElapsed(0)).toBe('0:00:00')
    expect(formatElapsed(59_999)).toBe('0:00:59')
    expect(formatElapsed(61_000)).toBe('0:01:01')
    expect(formatElapsed(3_600_000 + 5 * 60_000 + 9_000)).toBe('1:05:09')
    expect(formatElapsed(-5000)).toBe('0:00:00')
    expect(describeElapsed(3_660_000)).toBe('1 hour 1 minute')
  })

  it('formats cost with four decimals', () => {
    expect(formatCost(0)).toBe('$0.0000')
    expect(formatCost(0.00123)).toBe('$0.0012')
    expect(formatCost(1.5)).toBe('$1.5000')
    expect(formatCost(Number.NaN)).toBe('$0.0000')
  })

  it('formats counts with separators', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
  })
})
