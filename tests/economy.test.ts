import { describe, expect, it } from 'vitest'
import {
  EGG_SELL,
  eggTimerFor,
  eggValue,
  fountainCount,
  GOLDEN_CROP_CHANCE,
  goldenEggChance,
  rollGolden,
  sellValue,
  splitCoins,
  xpNeeded,
} from '../src/game/economy'
import { Game } from '../src/game/Game'
import { mulberry32 } from '../src/game/rng'
import { catchUp, initialState } from '../src/game/state'

describe('golden odds (seeded)', () => {
  it('crop golden rate converges near 8%', () => {
    const rng = mulberry32(42)
    let hits = 0
    const n = 20000
    for (let i = 0; i < n; i++) if (rollGolden(rng, GOLDEN_CROP_CHANCE)) hits++
    expect(hits / n).toBeGreaterThan(0.07)
    expect(hits / n).toBeLessThan(0.09)
  })

  it('is deterministic for the same seed', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    for (let i = 0; i < 100; i++) expect(rollGolden(a, 0.08)).toBe(rollGolden(b, 0.08))
  })

  it('hearts add +10% each and cap at 50%, never decreasing', () => {
    expect(goldenEggChance(0)).toBeCloseTo(0.08)
    expect(goldenEggChance(1)).toBeCloseTo(0.18)
    expect(goldenEggChance(3)).toBeCloseTo(0.38)
    expect(goldenEggChance(5)).toBeCloseTo(0.5)
    expect(goldenEggChance(50)).toBeCloseTo(0.5)
    for (let h = 1; h < 20; h++) expect(goldenEggChance(h)).toBeGreaterThanOrEqual(goldenEggChance(h - 1))
  })
})

describe('coin grants', () => {
  it('golden multiplies by exactly 4', () => {
    expect(sellValue('wheat', false)).toBe(2)
    expect(sellValue('wheat', true)).toBe(8)
    expect(sellValue('corn', false)).toBe(5)
    expect(sellValue('corn', true)).toBe(20)
    expect(eggValue(false)).toBe(EGG_SELL)
    expect(eggValue(true)).toBe(EGG_SELL * 4)
  })

  it('fountain splits sum EXACTLY to the grant for all sane inputs', () => {
    const rng = mulberry32(1)
    for (let i = 0; i < 500; i++) {
      const total = 1 + Math.floor(rng.next() * 200)
      const parts = fountainCount(total)
      expect(parts).toBeGreaterThanOrEqual(8)
      expect(parts).toBeLessThanOrEqual(15)
      const shares = splitCoins(total, parts)
      expect(shares).toHaveLength(parts)
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total)
      for (const s of shares) expect(s).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('timers and progression', () => {
  it('first two eggs are fast (FTUE), then slow', () => {
    expect(eggTimerFor(0)).toBe(180)
    expect(eggTimerFor(1)).toBe(180)
    expect(eggTimerFor(2)).toBe(900)
    expect(eggTimerFor(10)).toBe(900)
  })

  it('xp ladder rises monotonically', () => {
    for (let l = 1; l < 10; l++) expect(xpNeeded(l + 1)).toBeGreaterThan(xpNeeded(l))
  })

  it('three wheat loops reach level 2 (corn unlock pacing)', () => {
    const g = new Game(initialState(5))
    for (let i = 0; i < 3; i++) {
      g.plant(0, 'wheat')
      g.update(90.001)
      g.harvest(0)
    }
    expect(g.state.level).toBeGreaterThanOrEqual(2)
  })
})

describe('offline catch-up', () => {
  it('advances crops by elapsed time, capped at one full cycle', () => {
    const s = initialState(9)
    s.plots[0].crop = { kind: 'wheat', total: 90, remaining: 60, chimed: false }
    s.plots[1].crop = { kind: 'corn', total: 240, remaining: 240, chimed: false }
    const res = catchUp(s, 3600)
    expect(s.plots[0].crop?.remaining).toBe(0)
    expect(s.plots[1].crop?.remaining).toBe(0)
    expect(res.readyPlots).toEqual([0, 1])
    // capped: still exactly one harvest available per plot, nothing stacked
  })

  it('completes at most one egg while away', () => {
    const s = initialState(9)
    s.chicken.eggTimer = { total: 180, remaining: 100 }
    const res = catchUp(s, 100000)
    expect(res.eggBecameReady).toBe(true)
    expect(s.chicken.eggReady).toBe(true)
    expect(s.chicken.eggTimer).toBeNull()
    expect(s.chicken.eggsLaid).toBe(1)
  })

  it('partial elapse leaves the timer mid-flight', () => {
    const s = initialState(9)
    s.plots[0].crop = { kind: 'wheat', total: 90, remaining: 80, chimed: false }
    const res = catchUp(s, 30)
    expect(s.plots[0].crop?.remaining).toBe(50)
    expect(res.readyPlots).toEqual([])
  })
})

describe('game actions', () => {
  it('harvest pays coins immediately and banks wheat as feed', () => {
    const g = new Game(initialState(3))
    g.plant(0, 'wheat')
    g.update(91)
    const res = g.harvest(0)
    expect(res).not.toBeNull()
    expect(g.state.coins).toBe(res!.coins)
    expect(g.state.wheat).toBe(1)
  })

  it('corn is locked until level 2', () => {
    const g = new Game(initialState(3))
    expect(g.plant(0, 'corn')).toBe(false)
    g.state.level = 2
    expect(g.plant(0, 'corn')).toBe(true)
  })

  it('pet is once per day and hearts never decrease', () => {
    let day = '2026-06-10'
    const g = new Game(initialState(3), () => day)
    g.state.chicken.arrived = true
    g.state.chicken.name = 'Pearl'
    expect(g.pet()).toBe(true)
    expect(g.pet()).toBe(false)
    expect(g.state.chicken.hearts).toBe(1)
    day = '2026-06-11'
    expect(g.pet()).toBe(true)
    expect(g.state.chicken.hearts).toBe(2)
  })

  it('feeding consumes one wheat and starts the egg timer', () => {
    const g = new Game(initialState(3))
    g.state.chicken.arrived = true
    g.state.chicken.name = 'Pearl'
    g.state.wheat = 1
    expect(g.feed()).toBe(true)
    expect(g.state.wheat).toBe(0)
    expect(g.state.chicken.eggTimer?.total).toBe(180)
    expect(g.feed()).toBe(false) // no double-feeding while an egg cooks
    g.update(180.001)
    expect(g.state.chicken.eggReady).toBe(true)
    const egg = g.collectEgg()
    expect(egg).not.toBeNull()
    expect([8, 32]).toContain(egg!.coins)
  })
})
