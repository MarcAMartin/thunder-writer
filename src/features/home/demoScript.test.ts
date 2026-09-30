import { describe, expect, it } from 'vitest'
import {
  DEMO_FIX,
  DEMO_LOOP_MS,
  DEMO_PHASES,
  DEMO_TEXT,
  DEMO_TYPO,
  STATIC_FRAME_MS,
  TYPO_INDEX,
  countWords,
  getDemoFrame,
  getDemoSegments,
  loopTime,
  phaseStart,
} from './demoScript'

describe('demoScript', () => {
  it('locates the typo inside the demo text', () => {
    expect(TYPO_INDEX).toBeGreaterThan(0)
    expect(DEMO_TEXT.slice(TYPO_INDEX, TYPO_INDEX + DEMO_TYPO.length)).toBe(DEMO_TYPO)
  })

  it('loop length is the sum of phases', () => {
    expect(DEMO_LOOP_MS).toBe(DEMO_PHASES.reduce((s, p) => s + p.ms, 0))
  })

  it('normalises elapsed time into the loop', () => {
    expect(loopTime(0)).toBe(0)
    expect(loopTime(DEMO_LOOP_MS + 5)).toBe(5)
    expect(loopTime(-5)).toBe(DEMO_LOOP_MS - 5)
    expect(loopTime(Number.NaN)).toBe(0)
  })

  it('visits every phase in order across one loop', () => {
    const seen: string[] = []
    for (let t = 0; t < DEMO_LOOP_MS; t += 25) {
      const p = getDemoFrame(t).phase
      if (seen[seen.length - 1] !== p) seen.push(p)
    }
    expect(seen).toEqual(DEMO_PHASES.map((p) => p.phase))
  })

  it('starts on a blank page and types progressively', () => {
    expect(getDemoFrame(0).typedChars).toBe(0)
    const start = phaseStart('typing')
    const a = getDemoFrame(start + 300).typedChars
    const b = getDemoFrame(start + 900).typedChars
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(getDemoFrame(phaseStart('thinking')).typedChars).toBe(DEMO_TEXT.length)
  })

  it('highlights, shows the card, then accepts and fixes the typo', () => {
    const thinking = getDemoFrame(phaseStart('thinking') + 10)
    expect(thinking.highlight).toBe(false)
    expect(thinking.cardVisible).toBe(false)

    const suggest = getDemoFrame(phaseStart('suggest') + 10)
    expect(suggest.highlight).toBe(true)
    expect(suggest.cardVisible).toBe(true)
    expect(suggest.fixed).toBe(false)
    expect(suggest.openSuggestions).toBe(1)
    expect(suggest.acceptedCount).toBe(0)

    const accepting = getDemoFrame(phaseStart('accepting') + 10)
    expect(accepting.acceptPressed).toBe(true)

    const accepted = getDemoFrame(phaseStart('accepted') + 10)
    expect(accepted.fixed).toBe(true)
    expect(accepted.cardAccepted).toBe(true)
    expect(accepted.acceptedCount).toBe(1)
    expect(accepted.openSuggestions).toBe(0)

    const idea = getDemoFrame(phaseStart('idea') + 10)
    expect(idea.cardVisible).toBe(false)
    expect(idea.ideaVisible).toBe(true)
    expect(idea.openSuggestions).toBe(1)
    expect(idea.costUsd).toBeGreaterThan(accepted.costUsd)

    expect(getDemoFrame(phaseStart('fade') + 10).fading).toBe(true)
  })

  it('never shows more than two suggestions at once', () => {
    for (let t = 0; t < DEMO_LOOP_MS; t += 50) {
      expect(getDemoFrame(t).openSuggestions).toBeLessThanOrEqual(2)
    }
  })

  it('splits text around the typo and swaps in the fix', () => {
    const marked = getDemoSegments(getDemoFrame(phaseStart('suggest') + 10))
    expect(marked.target).toBe(DEMO_TYPO)
    expect(marked.targetState).toBe('marked')
    expect(marked.before + marked.target + marked.after).toBe(DEMO_TEXT)

    const fixed = getDemoSegments(getDemoFrame(phaseStart('accepted') + 10))
    expect(fixed.target).toBe(DEMO_FIX)
    expect(fixed.targetState).toBe('fixed')

    const early = getDemoSegments(getDemoFrame(phaseStart('typing') + 60))
    expect(early.target).toBe('')
    expect(early.after).toBe('')
    expect(early.targetState).toBe('plain')
  })

  it('static (reduced motion) frame shows the highlighted suggestion', () => {
    const f = getDemoFrame(STATIC_FRAME_MS)
    expect(f.phase).toBe('suggest')
    expect(f.highlight && f.cardVisible).toBe(true)
  })

  it('counts words', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('  one  two\nthree ')).toBe(3)
    expect(getDemoFrame(0).wordCount).toBe(2) // "Chapter One"
  })
})
