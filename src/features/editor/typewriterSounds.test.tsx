import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettings } from '../../store/settings'

const played = vi.hoisted(() => [] as string[])
vi.mock('./typewriterSounds', async (importActual) => ({
  ...(await importActual<typeof import('./typewriterSounds')>()),
  playStrike: vi.fn(() => void played.push('strike')),
  playDelete: vi.fn(() => void played.push('delete')),
}))

const { soundForKey } = await import('./typewriterSounds')
const { useTypewriterSounds } = await import('./useTypewriterSounds')

function Harness() {
  useTypewriterSounds()
  return (
    <>
      <div className="ed-prose" contentEditable="true" suppressContentEditableWarning data-testid="prose">
        Words
      </div>
      <input aria-label="Manuscript title" />
    </>
  )
}

const press = (el: Element, key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(el, { key, ...init })

beforeEach(() => {
  played.length = 0
  useSettings.setState({ typewriterSounds: false })
})
afterEach(() => vi.useRealTimers())

describe('typewriter sounds', () => {
  it('two sounds: a strike for typing, a knock for deleting; none for shortcuts or moving around', () => {
    const k = (key: string, extra: Partial<KeyboardEvent> = {}) =>
      soundForKey({ key, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...extra })
    expect(k('a')).toBe('strike')
    expect(k(' ')).toBe('strike')
    expect(k('Enter')).toBe('strike')
    expect(k('Backspace')).toBe('delete')
    expect(k('Delete')).toBe('delete')
    expect(k('ArrowLeft')).toBeNull()
    expect(k('Shift')).toBeNull()
    expect(k('b', { metaKey: true })).toBeNull()
    expect(k('z', { ctrlKey: true })).toBeNull()
    expect(k('a', { isComposing: true })).toBeNull()
    expect(k('å', { altKey: true })).toBe('strike')
  })

  it('is off by default, and then makes no sound', () => {
    expect(useSettings.getInitialState().typewriterSounds).toBe(false)
    render(<Harness />)
    press(screen.getByTestId('prose'), 'a')
    expect(played).toEqual([])
  })

  it('when on, plays in the manuscript only: a strike per key, a knock for Backspace', () => {
    vi.useFakeTimers()
    useSettings.setState({ typewriterSounds: true })
    render(<Harness />)
    const prose = screen.getByTestId('prose')
    press(prose, 'a')
    act(() => void vi.advanceTimersByTime(50))
    press(prose, 'Backspace')
    act(() => void vi.advanceTimersByTime(50))
    press(screen.getByLabelText('Manuscript title'), 'b')
    expect(played).toEqual(['strike', 'delete'])
  })
})
