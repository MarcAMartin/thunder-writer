import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TipJarLink, venmoLabel, venmoUrl } from './tipJar'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('tip jar', () => {
  it('links to the Venmo profile, with or without the leading @', () => {
    expect(venmoUrl('@MarcAMartin')).toBe('https://venmo.com/u/MarcAMartin')
    expect(venmoUrl('MarcAMartin')).toBe('https://venmo.com/u/MarcAMartin')
    expect(venmoLabel('MarcAMartin')).toBe('@MarcAMartin')
  })

  it('defaults to @MarcAMartin and can be overridden at build time', () => {
    expect(venmoUrl()).toBe('https://venmo.com/u/MarcAMartin')
    vi.stubEnv('VITE_VENMO_HANDLE', '@SomeoneElse')
    expect(venmoUrl()).toBe('https://venmo.com/u/SomeoneElse')
  })

  it('is a plain link that opens Venmo in a new tab', () => {
    render(<TipJarLink />)
    const link = screen.getByRole('link', { name: /Tip jar/ })
    expect(link).toHaveAttribute('href', 'https://venmo.com/u/MarcAMartin')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAccessibleName(/opens Venmo in a new tab/)
  })
})
