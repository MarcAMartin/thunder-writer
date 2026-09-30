import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSession } from '../../store/session'
import { StatusBar } from './StatusBar'

beforeEach(() => useSession.getState().resetSession())

describe('StatusBar AI cost', () => {
  it('lists web searches in the cost tooltip once any were billed', () => {
    const { unmount } = render(<StatusBar />)
    const tip = () => screen.getByText('AI cost').closest('.ed-stat')?.getAttribute('title') ?? ''
    expect(tip()).not.toMatch(/web search/)
    unmount()

    useSession.getState().addUsage({ inputTokens: 1000, outputTokens: 100, costUsd: 0.012, webSearches: 1 })
    useSession.getState().addUsage({ inputTokens: 500, outputTokens: 50, costUsd: 0.001 })
    render(<StatusBar />)
    expect(useSession.getState().usage).toMatchObject({ inputTokens: 1500, outputTokens: 150, webSearches: 1 })
    expect(useSession.getState().usage.costUsd).toBeCloseTo(0.013)
    expect(tip()).toMatch(/1,?500 input · 150 output tokens · 1 web search$/)
    act(() => useSession.getState().addUsage({ inputTokens: 0, outputTokens: 0, costUsd: 0.01, webSearches: 1 }))
    expect(tip()).toMatch(/2 web searches$/)
  })
})
