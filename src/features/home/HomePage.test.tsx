import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomePage } from './HomePage'
import { DemoPanel } from './DemoPanel'
import { phaseStart } from './demoScript'

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('reduce'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  )
}

const FORBIDDEN = [/\blog\s*-?\s*in\b/i, /\blogin\b/i, /\bsign\s*-?\s*(up|in)\b/i, /\bregister\b/i]

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('HomePage', () => {
  beforeEach(() => mockReducedMotion(false))

  it('shows the title and idea-processor framing', () => {
    renderHome()
    expect(screen.getByRole('heading', { level: 1, name: 'Thunder Writer' })).toBeInTheDocument()
    expect(screen.getByText(/not a word processor/i)).toBeInTheDocument()
  })

  it('"Start Writing" navigates to /write', () => {
    renderHome()
    const ctas = screen.getAllByRole('link', { name: /start writing/i })
    expect(ctas.length).toBeGreaterThan(0)
    fireEvent.click(ctas[0])
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/write$/)
  })

  it('"Open from Google Drive" navigates to /write?open=drive', () => {
    renderHome()
    fireEvent.click(screen.getByRole('link', { name: /open from google drive/i }))
    expect(screen.getByTestId('location')).toHaveTextContent('/write?open=drive')
  })

  it('"Import a manuscript" navigates to /write?import=local', () => {
    renderHome()
    fireEvent.click(screen.getByRole('link', { name: /import a manuscript/i }))
    expect(screen.getByTestId('location')).toHaveTextContent('/write?import=local')
  })

  it('offers a direct Google Drive import (the Picker) for drafts already in Google Docs', () => {
    renderHome()
    fireEvent.click(screen.getByRole('link', { name: /import it straight from google drive/i }))
    expect(screen.getByTestId('location')).toHaveTextContent('/write?open=picker')
  })

  it('links to Settings and includes the theme toggle', () => {
    renderHome()
    const settings = screen.getAllByRole('link', { name: /^settings$/i })
    expect(settings[0]).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument()
  })

  it('never uses account wording (log in / sign up / register)', () => {
    const { container } = renderHome()
    const text = container.textContent ?? ''
    const html = container.innerHTML
    for (const re of FORBIDDEN) {
      expect(text).not.toMatch(re)
      expect(html).not.toMatch(re)
    }
  })
})

describe('DemoPanel', () => {
  it('animates and can be paused', () => {
    mockReducedMotion(false)
    vi.useFakeTimers()
    render(<DemoPanel />)
    const demo = screen.getByTestId('hm-demo')
    expect(demo).toHaveAttribute('data-phase', 'idle')
    act(() => {
      vi.advanceTimersByTime(phaseStart('typing') + 400)
    })
    expect(demo).toHaveAttribute('data-phase', 'typing')

    fireEvent.click(screen.getByRole('button', { name: /pause the demo/i }))
    expect(demo).toHaveAttribute('data-animating', 'false')
    const before = demo.textContent
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(demo.textContent).toBe(before)
    expect(screen.getByRole('button', { name: /play the demo/i })).toBeInTheDocument()
  })

  it('shows a static frame and no pause control under reduced motion', () => {
    mockReducedMotion(true)
    vi.useFakeTimers()
    render(<DemoPanel />)
    const demo = screen.getByTestId('hm-demo')
    expect(demo).toHaveAttribute('data-phase', 'suggest')
    expect(demo).toHaveAttribute('data-animating', 'false')
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(demo).toHaveAttribute('data-phase', 'suggest')
    expect(screen.queryByRole('button', { name: /demo/i })).not.toBeInTheDocument()
  })
})
