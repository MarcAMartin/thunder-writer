import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileOpenMenu } from './MobileOpenMenu'

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname + loc.search}</div>
}
const renderMenu = () =>
  render(
    <MemoryRouter initialEntries={['/write']}>
      <MobileOpenMenu />
      <Where />
    </MemoryRouter>,
  )

afterEach(() => vi.unstubAllEnvs())

describe('MobileOpenMenu (phones)', () => {
  it('opens manuscripts from Google Drive, imports from Drive, or starts a new one', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '698829428298-abc.apps.googleusercontent.com')
    vi.stubEnv('VITE_GOOGLE_API_KEY', 'AIza-build')
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'Open' }))
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent)
    expect(items).toEqual(['Your manuscripts in Google Drive', 'Import a Google Doc or Word file from Drive', 'New manuscript'])
    // The hidden File menu opens its Drive list for ?open=drive.
    await user.click(screen.getByRole('menuitem', { name: 'Your manuscripts in Google Drive' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/write?open=drive')
    expect(screen.queryByRole('menu')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('menuitem', { name: /Import a Google Doc/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/write?open=picker')
  })

  it('without Google Drive in this build, offers just a new manuscript', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['New manuscript'])
    await user.click(screen.getByRole('menuitem', { name: 'New manuscript' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/write?new=1')
  })
})
