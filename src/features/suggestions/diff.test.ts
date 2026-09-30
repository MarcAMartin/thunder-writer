import { describe, expect, it } from 'vitest'
import { diffWords } from './diff'

describe('diffWords', () => {
  it('marks only the changed middle', () => {
    expect(diffWords('a dark and stormy nite', 'a dark and stormy night')).toEqual([
      { type: 'same', text: 'a dark and stormy ' },
      { type: 'del', text: 'nite' },
      { type: 'ins', text: 'night' },
    ])
  })

  it('handles pure insertions', () => {
    expect(diffWords('the cat', 'the black cat')).toEqual([
      { type: 'same', text: 'the ' },
      { type: 'ins', text: 'black ' },
      { type: 'same', text: 'cat' },
    ])
  })

  it('handles identical text', () => {
    expect(diffWords('same', 'same')).toEqual([{ type: 'same', text: 'same' }])
  })
})
