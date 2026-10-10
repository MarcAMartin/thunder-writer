import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSession } from '../../store/session'
import { useSettings } from '../../store/settings'
import { StatusBar } from './StatusBar'

beforeEach(() => {
  useSession.getState().resetSession()
  useSettings.getState().set({ pageZoom: 100, pageLayout: 'scroll' })
})

describe('StatusBar zoom', () => {
  it('starts at 100% and zooms the page up to 250% in steps of 10', () => {
    const { container } = render(<StatusBar />)
    const slider = screen.getByRole('slider', { name: 'Zoom' })
    expect(slider).toHaveAttribute('min', '100')
    expect(slider).toHaveAttribute('max', '250')
    expect(slider).toHaveAttribute('step', '10')
    expect(slider).toHaveValue('100')
    expect(slider).toHaveAttribute('aria-valuetext', '100%')
    // Lower left: the first thing in the status bar, before the session stats.
    expect(container.querySelector('.ed-status')?.firstElementChild).toContainElement(slider)

    fireEvent.change(slider, { target: { value: '170' } })
    expect(useSettings.getState().pageZoom).toBe(170)
    expect(slider).toHaveAttribute('aria-valuetext', '170%')
    expect(screen.getByText('170%')).toBeInTheDocument()
  })

  it('shows a stored zoom outside the range at the nearest end', () => {
    useSettings.getState().set({ pageZoom: 900 })
    render(<StatusBar />)
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveValue('250')
  })
})

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
