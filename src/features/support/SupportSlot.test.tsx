import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettings } from '../../store/settings'
import { BOOK_PICKS, bookUrl, pickForDay } from './bookPicks'
import { SupportSlot } from './SupportSlot'

beforeEach(() => {
  useSettings.setState({ supportDeveloper: false })
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Support the developer', () => {
  it('is off by default: just an offer, no ad', () => {
    expect(useSettings.getInitialState().supportDeveloper).toBe(false)
    render(<SupportSlot />)
    expect(screen.getByRole('button', { name: /Support Developer/ })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('turning it on shows a book pick marked as an ad, keeps keyboard focus, and the choice is saved', async () => {
    const user = userEvent.setup()
    render(<SupportSlot />)
    await user.click(screen.getByRole('button', { name: /Support Developer/ }))
    expect(useSettings.getState().supportDeveloper).toBe(true)
    expect(screen.getByRole('button', { name: 'Turn off book picks' })).toHaveFocus()
    // Persisted with the other settings (localStorage), so it stays on after a reload.
    expect(JSON.parse(localStorage.getItem('thunder-writer:settings') ?? '{}').state.supportDeveloper).toBe(true)
    const ad = screen.getByRole('group', { name: /Book pick \(ad\)\. Supports the developer/ })
    const link = within(ad).getByRole('link')
    const pick = pickForDay()
    expect(link).toHaveTextContent(pick.title)
    expect(link).toHaveAttribute('href', bookUrl(pick))
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toMatch(/sponsored/)
    expect(link).toHaveAccessibleName(/opens Bookshop\.org in a new tab/)
  })

  it('turning it off asks the writer to reconsider; "Keep supporting" keeps it, "Turn off" turns it off', async () => {
    useSettings.setState({ supportDeveloper: true })
    const user = userEvent.setup()
    render(<SupportSlot />)
    await user.click(screen.getByRole('button', { name: 'Turn off book picks' }))
    let dialog = screen.getByRole('dialog', { name: 'Please reconsider' })
    expect(dialog).toHaveTextContent(/This supports the product\./)
    expect(dialog).toHaveTextContent(/how Thunder Writer stays free/)
    expect(within(dialog).getByRole('button', { name: 'Keep supporting' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Keep supporting' }))
    expect(useSettings.getState().supportDeveloper).toBe(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Turn off book picks' }))
    dialog = screen.getByRole('dialog', { name: 'Please reconsider' })
    await user.click(within(dialog).getByRole('button', { name: 'Turn off' }))
    expect(useSettings.getState().supportDeveloper).toBe(false)
    expect(screen.getByRole('button', { name: /Support Developer/ })).toHaveFocus()
  })
})

describe('book picks', () => {
  it('links to Bookshop.org: an affiliate link when the build has an id, a plain search otherwise', () => {
    const pick = BOOK_PICKS[0]
    expect(bookUrl(pick, '')).toBe(`https://bookshop.org/search?keywords=${pick.isbn}`)
    expect(bookUrl(pick, '12345')).toBe(`https://bookshop.org/a/12345/${pick.isbn}`)
    expect(bookUrl(pick, 'not-a-number')).toBe(`https://bookshop.org/search?keywords=${pick.isbn}`)
    vi.stubEnv('VITE_BOOKSHOP_AFFILIATE_ID', '777')
    expect(bookUrl(pick)).toBe(`https://bookshop.org/a/777/${pick.isbn}`)
  })

  it('shows the same pick all day and a different one the next', () => {
    const day = Date.UTC(2026, 9, 1, 9)
    expect(pickForDay(day)).toBe(pickForDay(day + 8 * 3600_000))
    expect(pickForDay(day)).not.toBe(pickForDay(day + 86_400_000))
    expect(BOOK_PICKS.every((p) => /^97[89]\d{10}$/.test(p.isbn))).toBe(true)
  })
})
