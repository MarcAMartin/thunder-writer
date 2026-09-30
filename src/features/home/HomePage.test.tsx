import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocuments } from '../../store/documents'
import { DriveError } from '../storage/drive'
import { makeDoc } from '../storage/testDocs'
import { lastManuscript } from './HeroActions'
import { phaseStart } from './demoScript'

const google = vi.hoisted(() => ({ connectDrive: vi.fn<() => Promise<void>>(), loadGis: vi.fn(async () => ({})) }))

// The Google popup can't run in jsdom; Drive availability itself still comes from the (stubbed) build env.
vi.mock('../storage/driveSession', async (importActual) => ({
  ...(await importActual<typeof import('../storage/driveSession')>()),
  connectDrive: google.connectDrive,
}))
vi.mock('../storage/googleAuth', async (importActual) => ({
  ...(await importActual<typeof import('../storage/googleAuth')>()),
  loadGis: google.loadGis,
}))

const { HomePage } = await import('./HomePage')
const { DemoPanel } = await import('./DemoPanel')

const initialDocs = useDocuments.getState()
/** Storage has loaded this browser's manuscripts (StorageProvider does this in the app). */
const hydrateWith = (docs: ReturnType<typeof makeDoc>[], currentId: string | null = docs[0]?.id ?? null) =>
  useDocuments.getState().hydrate(docs, currentId)
const blank = () => makeDoc({ id: 'blank', title: 'Untitled Manuscript', content: null, updatedAt: 9_000 })
const withDrive = ({ picker = false } = {}) => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '698829428298-abc.apps.googleusercontent.com')
  vi.stubEnv('VITE_GOOGLE_API_KEY', picker ? 'AIza-build' : '')
}

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
/** Google Cloud setup belongs to the deployment; none of it may reach the writer. */
const SETUP_WORDING = /client id|google api key|project number|cloud console|in settings\b.*drive/i

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('HomePage', () => {
  beforeEach(() => {
    mockReducedMotion(false)
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    vi.stubEnv('VITE_GOOGLE_API_KEY', '')
    google.connectDrive.mockReset()
    google.loadGis.mockClear()
    useDocuments.setState({ ...initialDocs, docs: {}, currentId: null, hydrated: false, dirtyForDrive: {} }, true)
  })

  it('shows the title and idea-processor framing', () => {
    renderHome()
    expect(screen.getByRole('heading', { level: 1, name: 'Thunder Writer' })).toBeInTheDocument()
    expect(screen.getByText(/not a word processor/i)).toBeInTheDocument()
  })

  it('"Start Writing" opens a fresh manuscript, from the hero and the closing section', () => {
    hydrateWith([makeDoc()])
    renderHome()
    const ctas = screen.getAllByRole('link', { name: /start writing/i })
    expect(ctas).toHaveLength(2)
    for (const cta of ctas) expect(cta).toHaveAttribute('href', '/write?new=1')
    fireEvent.click(ctas[0])
    expect(screen.getByTestId('location')).toHaveTextContent('/write?new=1')
  })

  it('"Continue Writing" reopens the last manuscript in this browser and names it', () => {
    withDrive()
    hydrateWith([makeDoc({ id: 'a', title: 'The Long Storm' }), makeDoc({ id: 'b', title: 'Older', updatedAt: 1 })], 'a')
    renderHome()
    const cont = screen.getByRole('link', { name: 'Continue Writing' })
    expect(cont).toHaveAttribute('href', '/write')
    expect(cont).toHaveAccessibleDescription(/Last open in this browser: “The Long Storm”, edited/)
    fireEvent.click(cont)
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/write$/)
    expect(useDocuments.getState().currentId).toBe('a')
    expect(google.connectDrive).not.toHaveBeenCalled()
  })

  it('"Continue Writing" skips a blank manuscript nobody wrote in, and replaces it', () => {
    hydrateWith([blank(), makeDoc({ id: 'a', title: 'The Long Storm', updatedAt: 5_000 })], 'blank')
    renderHome()
    const cont = screen.getByRole('link', { name: 'Continue Writing' })
    expect(cont).toHaveAccessibleDescription(/“The Long Storm”/)
    fireEvent.click(cont)
    expect(useDocuments.getState().currentId).toBe('a')
    expect(useDocuments.getState().docs.blank).toBeUndefined()
  })

  it('with no manuscript in this browser, "Continue Writing" connects Google Drive from the click and lists Drive manuscripts', async () => {
    withDrive()
    hydrateWith([blank()])
    let finish!: () => void
    google.connectDrive.mockImplementation(() => new Promise<void>((r) => (finish = r)))
    renderHome()
    expect(google.loadGis).toHaveBeenCalled() // sign-in is warmed up so the popup opens straight from the click
    const cont = screen.getByRole('button', { name: 'Continue Writing' })
    expect(cont).toHaveAccessibleDescription('Pick up a manuscript you saved to Google Drive.')
    fireEvent.click(cont)
    expect(google.connectDrive).toHaveBeenCalledTimes(1) // synchronously, inside the click
    expect(screen.getByRole('button', { name: 'Opening Google Drive…' })).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Opening Google Drive…' }))
    expect(google.connectDrive).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(screen.getByTestId('location')).toHaveTextContent('/write?open=drive')
  })

  it('shows why Google Drive didn’t connect and lets the writer try again', async () => {
    withDrive()
    hydrateWith([])
    google.connectDrive.mockRejectedValueOnce(new DriveError('popup_blocked', 'Your browser blocked the Google window. Allow pop-ups and try again.'))
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'Continue Writing' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your browser blocked the Google window.')
    google.connectDrive.mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Continue Writing' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/write?open=drive'))
  })

  it('offers only "Start Writing" when there is nothing to continue and this build has no Google Drive', () => {
    hydrateWith([])
    renderHome()
    expect(screen.queryByRole('link', { name: /continue writing/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue writing/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /google drive/i })).not.toBeInTheDocument()
    expect(google.loadGis).not.toHaveBeenCalled()
  })

  it('while this browser’s manuscripts are still loading, "Continue Writing" goes to the writer page', () => {
    withDrive()
    renderHome()
    expect(screen.getByRole('link', { name: 'Continue Writing' })).toHaveAttribute('href', '/write')
  })

  it('"Import a manuscript" navigates to /write?import=local', () => {
    renderHome()
    fireEvent.click(screen.getByRole('link', { name: /import a manuscript/i }))
    expect(screen.getByTestId('location')).toHaveTextContent('/write?import=local')
  })

  it('offers a direct Google Drive import (the Picker) only when this build has it', () => {
    withDrive({ picker: true })
    const { unmount } = renderHome()
    fireEvent.click(screen.getByRole('link', { name: /import it from google drive/i }))
    expect(screen.getByTestId('location')).toHaveTextContent('/write?open=picker')
    unmount()
    withDrive()
    renderHome()
    expect(screen.queryByRole('link', { name: /import it from google drive/i })).not.toBeInTheDocument()
  })

  it('doesn’t promise Google Drive in a build without it', () => {
    hydrateWith([])
    const { container } = renderHome()
    expect(container.textContent).not.toMatch(/google drive/i)
    expect(container.textContent).toMatch(/save a copy to your computer/)
  })

  it('never mentions Google Cloud setup, with or without Drive', () => {
    for (const setup of [() => undefined, () => withDrive({ picker: true })]) {
      setup()
      hydrateWith([])
      const { container, unmount } = renderHome()
      expect(container.textContent).not.toMatch(SETUP_WORDING)
      unmount()
    }
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

describe('lastManuscript', () => {
  it('prefers the one last open, then the most recently edited, ignoring blank ones', () => {
    const a = makeDoc({ id: 'a', updatedAt: 1 })
    const b = makeDoc({ id: 'b', updatedAt: 3 })
    const docs = { a, b, blank: blank() }
    expect(lastManuscript({ docs, currentId: 'a' })).toBe(a)
    expect(lastManuscript({ docs, currentId: 'blank' })).toBe(b)
    expect(lastManuscript({ docs, currentId: null })).toBe(b)
    expect(lastManuscript({ docs: { blank: blank() }, currentId: 'blank' })).toBeNull()
    // A blank manuscript already in Drive, or renamed, is the writer's.
    const named = { ...blank(), title: 'Book Two' }
    expect(lastManuscript({ docs: { named }, currentId: 'named' })).toBe(named)
    const linked = { ...blank(), driveFileId: 'F' }
    expect(lastManuscript({ docs: { linked }, currentId: 'linked' })).toBe(linked)
    // Book setup already chosen (trim size, running heads): not blank, even with no text yet.
    const setUp = { ...blank(), format: { presetId: 'trade-5x8', chapterStartsNewPage: true } }
    expect(lastManuscript({ docs: { setUp }, currentId: 'setUp' })).toBe(setUp)
    // An override cleared back to unset still counts as the default format.
    const cleared = { ...blank(), format: { presetId: 'trade-6x9', chapterStartsNewPage: true, fontSizePt: undefined } }
    expect(lastManuscript({ docs: { cleared }, currentId: 'cleared' })).toBeNull()
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
