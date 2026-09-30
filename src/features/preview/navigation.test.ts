import { describe, expect, it } from 'vitest'
import {
  FLIP_MS,
  initialNav,
  JUMP_FLIP_MS,
  LAST_QUEUED_FLIP_MS,
  navReducer,
  QUEUED_FLIP_MS,
  shownView,
  type NavAction,
  type NavState,
} from './navigation'

const run = (s: NavState, ...actions: NavAction[]) => actions.reduce(navReducer, s)

describe('navReducer: single turns', () => {
  it('next starts a forward turn from the current view', () => {
    const s = run(initialNav(10), { type: 'go', delta: 1 })
    expect(s.flip).toMatchObject({ lo: 0, hi: 1, from: 0, to: 1, dest: 1, duration: FLIP_MS, drag: false })
    expect(s.current).toBe(0)
    expect(shownView(s)).toBe(1)
    const done = run(s, { type: 'flipDone' })
    expect(done).toMatchObject({ current: 1, target: 1, flip: null })
  })

  it('prev is the forward turn played backwards', () => {
    const s = run(initialNav(10, 5), { type: 'go', delta: -1 })
    expect(s.flip).toMatchObject({ lo: 4, hi: 5, from: 1, to: 0, dest: 4 })
  })

  it('stays within bounds', () => {
    expect(run(initialNav(3), { type: 'go', delta: -1 }).flip).toBeNull()
    expect(run(initialNav(3, 2), { type: 'go', delta: 1 }).flip).toBeNull()
    expect(run(initialNav(0), { type: 'go', delta: 1 })).toMatchObject({ current: 0, flip: null })
  })
})

describe('navReducer: queueing rapid presses', () => {
  it('queues presses during a turn and serves them faster, step by step', () => {
    let s = run(initialNav(20), { type: 'go', delta: 1 }, { type: 'go', delta: 1 }, { type: 'go', delta: 1 })
    expect(s.target).toBe(3)
    expect(s.flip?.dest).toBe(1)
    s = run(s, { type: 'flipDone' })
    expect(s.flip).toMatchObject({ lo: 1, hi: 2, dest: 2, duration: QUEUED_FLIP_MS })
    s = run(s, { type: 'flipDone' })
    expect(s.flip).toMatchObject({ lo: 2, hi: 3, dest: 3, duration: LAST_QUEUED_FLIP_MS })
    s = run(s, { type: 'flipDone' })
    expect(s).toMatchObject({ current: 3, target: 3, flip: null })
  })

  it('a long queue is served by a single turn straight to the target', () => {
    let s = initialNav(50)
    for (let i = 0; i < 9; i++) s = run(s, { type: 'go', delta: 1 })
    s = run(s, { type: 'flipDone' })
    expect(s.flip).toMatchObject({ lo: 1, hi: 9, dest: 9 })
  })

  it('opposite presses cancel out', () => {
    let s = run(initialNav(10, 4), { type: 'go', delta: 1 }, { type: 'go', delta: -1 })
    expect(s.target).toBe(4)
    s = run(s, { type: 'flipDone' })
    // Arrived at 5; target is 4 → one turn back.
    expect(s.flip).toMatchObject({ lo: 4, hi: 5, dest: 4 })
  })

  it('queued presses clamp at the ends', () => {
    const s = run(initialNav(3, 1), { type: 'go', delta: 1 }, { type: 'go', delta: 1 }, { type: 'go', delta: 1 })
    expect(s.target).toBe(2)
  })
})

describe('navReducer: jumps', () => {
  it('a far jump is one turn, not one per page', () => {
    const s = run(initialNav(200, 3), { type: 'jump', to: 150 })
    expect(s.flip).toMatchObject({ lo: 3, hi: 150, dest: 150, duration: JUMP_FLIP_MS })
    expect(run(s, { type: 'flipDone' })).toMatchObject({ current: 150, flip: null })
  })

  it('an adjacent jump is a normal turn', () => {
    expect(run(initialNav(10, 3), { type: 'jump', to: 4 }).flip?.duration).toBe(FLIP_MS)
  })

  it('jump without animation (scrubber, thumbnails) is instant, even mid-turn', () => {
    const s = run(initialNav(100), { type: 'go', delta: 1 }, { type: 'jump', to: 60, animate: false })
    expect(s).toMatchObject({ current: 60, target: 60, flip: null })
  })

  it('a jump during a turn is queued', () => {
    let s = run(initialNav(100), { type: 'go', delta: 1 }, { type: 'jump', to: 40 })
    expect(s.target).toBe(40)
    s = run(s, { type: 'flipDone' })
    expect(s.flip).toMatchObject({ lo: 1, hi: 40 })
  })

  it('clamps out-of-range jumps', () => {
    expect(run(initialNav(10), { type: 'jump', to: 99, animate: false }).current).toBe(9)
    expect(run(initialNav(10, 5), { type: 'jump', to: -4, animate: false }).current).toBe(0)
  })
})

describe('navReducer: drag to turn', () => {
  it('drags then commits forward from the release point', () => {
    let s = run(initialNav(10, 2), { type: 'dragStart', dir: 1 })
    expect(s.flip).toMatchObject({ lo: 2, hi: 3, drag: true, dest: 2 })
    // Presses are ignored while dragging.
    expect(run(s, { type: 'go', delta: 1 })).toBe(s)
    s = run(s, { type: 'dragEnd', commit: true, progress: 0.4 })
    expect(s.flip).toMatchObject({ from: 0.4, to: 1, dest: 3, drag: false, duration: Math.round(FLIP_MS * 0.6) })
    expect(run(s, { type: 'flipDone' })).toMatchObject({ current: 3, flip: null })
  })

  it('a cancelled drag falls back', () => {
    let s = run(initialNav(10, 2), { type: 'dragStart', dir: 1 }, { type: 'dragEnd', commit: false, progress: 0.2 })
    expect(s.flip).toMatchObject({ from: 0.2, to: 0, dest: 2 })
    s = run(s, { type: 'flipDone' })
    expect(s).toMatchObject({ current: 2, flip: null })
  })

  it('a backward drag runs from 1 towards 0', () => {
    const s = run(initialNav(10, 2), { type: 'dragStart', dir: -1 }, { type: 'dragEnd', commit: true, progress: 0.7 })
    expect(s.flip).toMatchObject({ lo: 1, hi: 2, from: 0.7, to: 0, dest: 1 })
  })

  it('cannot drag past the ends or with reduced motion', () => {
    expect(run(initialNav(10, 0), { type: 'dragStart', dir: -1 }).flip).toBeNull()
    expect(run(initialNav(10, 3, true), { type: 'dragStart', dir: 1 }).flip).toBeNull()
  })
})

describe('navReducer: reduced motion, count changes', () => {
  it('reduced motion turns instantly', () => {
    const s = run(initialNav(10, 0, true), { type: 'go', delta: 1 }, { type: 'jump', to: 7 })
    expect(s).toMatchObject({ current: 7, target: 7, flip: null })
  })

  it('switching reduced motion on mid-turn lands on the target', () => {
    const s = run(initialNav(10), { type: 'go', delta: 1 }, { type: 'go', delta: 1 }, { type: 'setMotion', reduced: true })
    expect(s).toMatchObject({ current: 2, flip: null })
  })

  it('pages arriving (layout in progress) keep the position', () => {
    const s = run(initialNav(2, 1), { type: 'setCount', count: 40 })
    expect(s).toMatchObject({ count: 40, current: 1 })
  })

  it('a mode switch resets to the given view', () => {
    const s = run(initialNav(20, 5), { type: 'go', delta: 1 }, { type: 'setCount', count: 40, current: 11 })
    expect(s).toMatchObject({ count: 40, current: 11, target: 11, flip: null })
  })

  it('shrinking below the current view clamps it', () => {
    expect(run(initialNav(20, 15), { type: 'setCount', count: 10 })).toMatchObject({ current: 9, target: 9 })
  })
})
