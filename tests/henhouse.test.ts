/** Henhouse truth-model pins: trickling per-box timers, the one-cycle
 * offline cap, capacity-before-coins purchase precedence, wing gating, and
 * the migration from the old single-latch coop. */
import { describe, expect, it } from 'vitest'
import {
  buyHen,
  catchUpHenhouse,
  collectAllBoxes,
  collectBox,
  foundingFlock,
  HEN_CAPACITY,
  henBuyStatus,
  henCost,
  layTimeFor,
  openWing,
  tickHenhouse,
  WING_LEVEL,
  wingStatus,
} from '../src/game/henhouse'
import { COOP_TIME } from '../src/game/produce'
import { deserialize, initialState, serialize } from '../src/game/state'

describe('the boxes trickle', () => {
  it('founding flock: 4 named hens, 4 boxes, staggered timers', () => {
    const f = foundingFlock(7)
    expect(f.hens).toHaveLength(4)
    expect(new Set(f.hens.map((h) => h.name)).size).toBe(4)
    expect(f.boxes).toHaveLength(4)
    // timers differ (the interleave rule) and sit in the ±35% band
    const times = f.boxes.map((b) => b.t)
    expect(new Set(times.map((t) => Math.round(t))).size).toBeGreaterThan(1)
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(COOP_TIME * 0.65)
      expect(t).toBeLessThanOrEqual(COOP_TIME * 1.35)
    }
  })

  it('ticking ripens boxes one by one, never re-ripens a ready box', () => {
    const f = foundingFlock(7)
    let readyEvents = 0
    for (let i = 0; i < 300; i++) readyEvents += tickHenhouse(f, 1).readyBoxes.length
    expect(readyEvents).toBe(4)
    expect(f.boxes.every((b) => b.ready)).toBe(true)
    expect(tickHenhouse(f, 100).readyBoxes).toHaveLength(0)
  })

  it('offline catch-up caps at one egg per box', () => {
    const f = foundingFlock(9)
    expect(catchUpHenhouse(f, 100000)).toBe(4)
    expect(f.boxes.every((b) => b.ready)).toBe(true)
  })

  it('collect restarts the box with a fresh seeded timer', () => {
    const f = foundingFlock(9)
    catchUpHenhouse(f, 100000)
    expect(collectBox(f, 0)).toBe(true)
    expect(f.boxes[0].ready).toBe(false)
    expect(f.boxes[0].t).toBeCloseTo(layTimeFor(0, f.hens[0].seed), 6)
    expect(collectBox(f, 0)).toBe(false) // not ready again yet
    expect(collectAllBoxes(f)).toBe(3)
  })
})

describe('buying hens and opening wings', () => {
  it('capacity outranks coins — the "expand first" precedence', () => {
    const f = foundingFlock(3)
    expect(henBuyStatus(f, 0)).toBe('coins')
    expect(henBuyStatus(f, 999)).toBe('ok')
    while (f.hens.length < HEN_CAPACITY[0]) buyHen(f, f.hens.length)
    expect(henBuyStatus(f, 99999)).toBe('capacity')
    openWing(f)
    expect(henBuyStatus(f, 99999)).toBe('ok')
  })

  it('hen prices climb from the fifth hen on', () => {
    expect(henCost(4)).toBe(120)
    expect(henCost(5)).toBe(150)
    expect(henCost(11)).toBe(330)
  })

  it('a bought hen gets a box and an unused name', () => {
    const f = foundingFlock(3)
    openWing(f)
    const before = f.hens.map((h) => h.name)
    const hen = buyHen(f, 12345)
    expect(before).not.toContain(hen.name)
    expect(f.boxes).toHaveLength(f.hens.length)
  })

  it('wings gate on level then coins, and stop at the last wall', () => {
    const f = foundingFlock(3)
    expect(wingStatus(f, WING_LEVEL[0] - 1, 99999)).toBe('level')
    expect(wingStatus(f, WING_LEVEL[0], 10)).toBe('coins')
    expect(wingStatus(f, WING_LEVEL[0], 99999)).toBe('ok')
    openWing(f)
    openWing(f)
    openWing(f)
    expect(wingStatus(f, 99, 99999)).toBe('max')
    expect(openWing(f)).toBe(false)
  })
})

describe('migration from the single-latch coop', () => {
  it('old saves grow a founding flock; a pending batch becomes ready boxes', () => {
    const raw = JSON.parse(serialize(initialState(11))) as Record<string, unknown>
    delete raw.coopFlock
    ;(raw.produce as { eggsReady: boolean }).eggsReady = true
    const back = deserialize(JSON.stringify(raw))!
    expect(back.coopFlock.hens).toHaveLength(4)
    expect(back.coopFlock.boxes.every((b) => b.ready)).toBe(true)
    // and without a pending batch, boxes start mid-countdown
    const raw2 = JSON.parse(serialize(initialState(12))) as Record<string, unknown>
    delete raw2.coopFlock
    const back2 = deserialize(JSON.stringify(raw2))!
    expect(back2.coopFlock.boxes.every((b) => !b.ready && b.t > 0)).toBe(true)
  })
})
