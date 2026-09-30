import { describe, expect, it } from 'vitest'
import { sheetRoles } from './FlipBook'
import { initialNav, navReducer } from './navigation'
import { buildViews } from './spreads'

const views = buildViews(9, true, 'spread') // [·,0] [1,2] [3,4] [5,6] [7,8]
const roles = (m: Map<number, string>) => Object.fromEntries([...m].sort((a, b) => a[0] - b[0]))

describe('sheetRoles', () => {
  it('at rest: the spread flat, its neighbours preloaded', () => {
    expect(roles(sheetRoles(views, initialNav(5, 2), 'spread'))).toEqual({
      1: 'preload',
      2: 'preload',
      3: 'left',
      4: 'right',
      5: 'preload',
      6: 'preload',
    })
  })

  it('page 1 alone', () => {
    expect(roles(sheetRoles(views, initialNav(5, 0), 'spread'))).toEqual({ 0: 'right', 1: 'preload', 2: 'preload' })
  })

  it('forward turn: front = old recto, back = new verso, new recto revealed underneath', () => {
    const s = navReducer(initialNav(5, 1), { type: 'go', delta: 1 })
    const r = roles(sheetRoles(views, s, 'spread'))
    expect(r).toMatchObject({ 1: 'left', 2: 'front', 3: 'back', 4: 'right' })
  })

  it('backward turn uses the same leaf played in reverse', () => {
    const s = navReducer(initialNav(5, 2), { type: 'go', delta: -1 })
    expect(roles(sheetRoles(views, s, 'spread'))).toMatchObject({ 1: 'left', 2: 'front', 3: 'back', 4: 'right' })
  })

  it('a far jump turns one leaf between the two spreads', () => {
    const s = navReducer(initialNav(5, 0), { type: 'jump', to: 4 })
    expect(roles(sheetRoles(views, s, 'spread'))).toMatchObject({ 0: 'front', 7: 'back', 8: 'right' })
  })

  it('single mode: the page turns away over the next one; no back face', () => {
    const single = buildViews(4, true, 'single')
    const s = navReducer(initialNav(4, 1), { type: 'go', delta: 1 })
    const r = roles(sheetRoles(single, s, 'single'))
    expect(r).toMatchObject({ 1: 'front', 2: 'right' })
    expect(Object.values(r)).not.toContain('back')
  })
})
