import { describe, expect, it, vi } from 'vitest'
import { applyFlipStyle, easeInOut, flipKeyframes, flipStyleAt, runFlipAnimation } from './flip'

describe('flip look', () => {
  it('rotates the leaf from flat right to flat left', () => {
    expect(flipStyleAt(0).angle).toBeCloseTo(0)
    expect(flipStyleAt(0.5).angle).toBe(-90)
    expect(flipStyleAt(1).angle).toBe(-180)
    expect(flipStyleAt(-1).angle).toBeCloseTo(0)
  })

  it('casts the under-shadow while lifting and the landing shadow while coming down', () => {
    const early = flipStyleAt(0.25)
    const late = flipStyleAt(0.75)
    expect(early.under).toBeGreaterThan(0)
    expect(early.land).toBe(0)
    expect(late.under).toBe(0)
    expect(late.land).toBeGreaterThan(0)
    expect(flipStyleAt(0).under).toBeCloseTo(0)
    expect(flipStyleAt(1).land).toBeCloseTo(0)
    // The band follows the leaf's edge toward the spine and back out.
    expect(flipStyleAt(0.1).underEdge).toBeGreaterThan(flipStyleAt(0.4).underEdge)
    expect(flipStyleAt(0.9).landEdge).toBeGreaterThan(flipStyleAt(0.6).landEdge)
  })

  it('eases in and out', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(0.5)).toBeCloseTo(0.5)
    expect(easeInOut(0.1)).toBeLessThan(0.1)
  })
})

describe('flipKeyframes', () => {
  it('samples from p0 to p1 with the easing baked in', () => {
    const f = flipKeyframes(0, 1, 400, 10)
    expect(f.leaf).toHaveLength(11)
    expect(f.leaf[0]).toEqual({ offset: 0, transform: 'rotateY(0deg)' })
    expect(f.leaf[10]).toEqual({ offset: 1, transform: 'rotateY(-180deg)' })
    expect(f.under[0].transform).toBe('translateX(400px)')
    expect(f.land[10].transform).toBe('translateX(-400px)')
  })

  it('runs backwards for a backward turn and from mid-way after a drag', () => {
    const back = flipKeyframes(1, 0, 400, 4)
    expect(back.leaf[0].transform).toBe('rotateY(-180deg)')
    expect(back.leaf[4].transform).toBe('rotateY(0deg)')
    const mid = flipKeyframes(0.4, 1, 400, 4)
    expect(mid.leaf[0].transform).toBe('rotateY(-72deg)')
  })
})

describe('runFlipAnimation', () => {
  it('falls back to finishing on the next tick without the Web Animations API', async () => {
    const leaf = document.createElement('div')
    Object.defineProperty(leaf, 'animate', { value: undefined })
    const done = vi.fn()
    runFlipAnimation({ leaf }, 0, 1, 600, 300, done)
    expect(leaf.style.transform).toBe('rotateY(0deg)')
    await new Promise((r) => setTimeout(r, 5))
    expect(done).toHaveBeenCalledOnce()
    expect(leaf.style.transform).toBe('rotateY(-180deg)')
  })

  it('uses element.animate when available and can be cancelled', () => {
    const cancel = vi.fn()
    const anim = { cancel, onfinish: null as null | (() => void) }
    const leaf = document.createElement('div')
    const animate = vi.fn(() => anim)
    Object.defineProperty(leaf, 'animate', { value: animate })
    const done = vi.fn()
    const stop = runFlipAnimation({ leaf }, 0, 1, 600, 300, done)
    expect(animate).toHaveBeenCalledOnce()
    expect((animate.mock.calls[0] as unknown[])[1]).toMatchObject({ duration: 600, easing: 'linear' })
    anim.onfinish?.()
    expect(done).toHaveBeenCalledOnce()
    stop()
    expect(cancel).toHaveBeenCalled()
  })

  it('applyFlipStyle writes transforms and opacities', () => {
    const t = { leaf: document.createElement('div'), front: document.createElement('div'), under: document.createElement('div') }
    applyFlipStyle(t, 0.25, 200)
    expect(t.leaf.style.transform).toBe('rotateY(-45deg)')
    expect(Number(t.front.style.opacity)).toBeGreaterThan(0)
    expect(t.under.style.transform).toMatch(/^translateX\(141\.4\d*px\)$/)
  })
})

describe('stack edges that come or go with the leaf', () => {
  it('appear as the leaf lands and vanish as it lifts', () => {
    expect(flipStyleAt(0)).toMatchObject({ appear: 0, vanish: 1 })
    expect(flipStyleAt(0.25)).toMatchObject({ appear: 0, vanish: 0.5 })
    expect(flipStyleAt(0.75)).toMatchObject({ appear: 0.5, vanish: 0 })
    expect(flipStyleAt(1)).toMatchObject({ appear: 1, vanish: 0 })
  })
})
