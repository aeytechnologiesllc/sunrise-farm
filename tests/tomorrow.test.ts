/** Tomorrow-tease pins: at most 3 lines, deterministic, never lies. */
import { describe, expect, it } from 'vitest'
import { initialState } from '../src/game/state'
import { keeperName, tomorrowLines } from '../src/game/tomorrow'

describe('tomorrowLines', () => {
  it('is quiet on an empty farm except the affordable dream', () => {
    const s = initialState(5)
    s.coins = 100000
    s.level = 99
    const lines = tomorrowLines(s)
    expect(lines.length).toBeLessThanOrEqual(3)
    // nothing growing, no coop — only the cheapest buyable project teases
    expect(lines.some((l) => l.includes('sign is waiting'))).toBe(true)
    expect(lines.some((l) => l.includes('comes in'))).toBe(false)
  })

  it('teases the soonest crop and counts eggs truthfully', () => {
    const s = initialState(6)
    s.plots[0].crop = { kind: 'wheat', total: 60, remaining: 30, chimed: false }
    s.plots[1].crop = { kind: 'corn', total: 90, remaining: 80, chimed: false }
    s.projects.coop = true
    s.coopFlock.boxes[0].ready = true
    s.coopFlock.boxes[1].ready = true
    const lines = tomorrowLines(s)
    expect(lines[0]).toContain('wheat') // soonest, not first-planted
    expect(lines.some((l) => l.includes('2 eggs waiting'))).toBe(true)
    expect(lines.length).toBeLessThanOrEqual(3)
  })

  it('on-the-way eggs only when none are waiting', () => {
    const s = initialState(7)
    s.projects.coop = true
    const lines = tomorrowLines(s)
    expect(lines.some((l) => l.includes('on the way'))).toBe(true)
    expect(lines.some((l) => l.includes('waiting'))).toBe(false)
  })

  it('is deterministic', () => {
    const s = initialState(8)
    s.plots[0].crop = { kind: 'wheat', total: 60, remaining: 10, chimed: false }
    expect(tomorrowLines(s)).toEqual(tomorrowLines(s))
  })
})

describe('keeperName', () => {
  it('prefers the named chicken, then Hazel, then the founding hen', () => {
    const s = initialState(9)
    s.chicken.name = 'Henrietta'
    expect(keeperName(s)).toBe('Henrietta')
    s.chicken.name = null
    s.projects.horse = true
    expect(keeperName(s)).toBe('Hazel')
    s.projects.horse = false
    expect(keeperName(s)).toBe(s.coopFlock.hens[0].name)
  })
})
