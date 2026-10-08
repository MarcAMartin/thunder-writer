import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { SUGGESTION_EMAIL } from '../feedback/sendSuggestion'

// The whole app is rendered, so the routes are the real ones: it needs a theme query and quiet storage.
vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => undefined, del: async () => undefined, keys: async () => [], createStore: () => ({}) }))
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
})
afterEach(() => vi.unstubAllGlobals())

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>,
  )
}

describe('Privacy Policy and Terms of Service', () => {
  it('serves the Privacy Policy at /privacy, with what Google asks a policy to say', async () => {
    renderAt('/privacy')
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument()
    expect(document.title).toBe('Privacy Policy · Thunder Writer')
    expect(screen.getByText(/^Effective /)).toBeInTheDocument()
    // The Drive permission, what is done with Google data, and the Limited Use statement.
    expect(screen.getByRole('heading', { name: 'Google Drive' })).toBeInTheDocument()
    expect(screen.getAllByText('drive.file').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Google API Services User Data Policy' })).toHaveAttribute(
      'href',
      'https://developers.google.com/terms/api-services-user-data-policy',
    )
    expect(document.body).toHaveTextContent(/including the Limited Use requirements/)
    expect(screen.getAllByRole('link', { name: SUGGESTION_EMAIL })[0]).toHaveAttribute('href', `mailto:${SUGGESTION_EMAIL}`)
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms')
  })

  it('sends /policy to the Privacy Policy', async () => {
    renderAt('/policy')
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/privacy')
  })

  it('serves the Terms of Service at /terms, linked to the Privacy Policy', async () => {
    renderAt('/terms')
    expect(await screen.findByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument()
    expect(document.title).toBe('Terms of Service · Thunder Writer')
    expect(screen.getByRole('heading', { name: 'Your writing is yours' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
    const nav = screen.getByRole('navigation', { name: 'Legal' })
    expect(nav).toContainElement(screen.getByRole('link', { name: 'Terms', current: 'page' }))
  })
})
