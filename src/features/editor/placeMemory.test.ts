import { beforeEach, describe, expect, it } from 'vitest'
import { placeOf, rememberPlace } from './placeMemory'

beforeEach(() => localStorage.clear())

describe('placeMemory', () => {
  it('remembers where the writer was in each manuscript', () => {
    expect(placeOf('a')).toBeNull()
    rememberPlace('a', 120)
    rememberPlace('b', 7)
    rememberPlace('a', 140)
    expect(placeOf('a')).toBe(140)
    expect(placeOf('b')).toBe(7)
  })

  it('keeps only the most recent manuscripts and survives bad stored data', () => {
    for (let i = 0; i < 60; i++) rememberPlace(`doc-${i}`, i + 2, 1000 + i)
    expect(placeOf('doc-0')).toBeNull()
    expect(placeOf('doc-59')).toBe(61)
    localStorage.setItem('thunder-writer:places', 'not json')
    expect(placeOf('doc-59')).toBeNull()
    rememberPlace('x', 5)
    expect(placeOf('x')).toBe(5)
  })
})
