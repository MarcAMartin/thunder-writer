import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSettings } from '../../store/settings'
import { PageLayoutSwitch } from './PageLayoutSwitch'

beforeEach(() => useSettings.getState().set({ pageLayout: 'scroll' }))

describe('PageLayoutSwitch', () => {
  it('switches between scroll, side by side and flip', () => {
    render(<PageLayoutSwitch />)
    expect(screen.getByRole('group', { name: 'Page view' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scroll' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }))
    expect(useSettings.getState().pageLayout).toBe('flip')
    expect(screen.getByRole('button', { name: 'Flip' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('offers side by side only where the browser can lay pages out in rows', () => {
    const supports = CSS.supports
    CSS.supports = (() => false) as typeof CSS.supports
    try {
      const { unmount } = render(<PageLayoutSwitch />)
      expect(screen.getByRole('button', { name: 'Side by side' })).toBeDisabled()
      unmount()
      CSS.supports = (() => true) as typeof CSS.supports
      render(<PageLayoutSwitch />)
      fireEvent.click(screen.getByRole('button', { name: 'Side by side' }))
      expect(useSettings.getState().pageLayout).toBe('spread')
    } finally {
      CSS.supports = supports
    }
  })
})
