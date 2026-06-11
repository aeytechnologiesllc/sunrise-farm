import { describe, expect, it } from 'vitest'
import {
  canDeliver,
  collectMilk,
  DELIVERY_COOLDOWN,
  DELIVERY_PAY,
  DELIVERY_RUN_TIME,
  deliveryPay,
  initialProduce,
  MILK_TIME,
  shearWool,
  startDelivery,
  tickProduce,
  WOOL_TIME,
} from '../src/game/produce'
import type { ProduceFlags } from '../src/game/produce'
import { mulberry32 } from '../src/game/rng'

const none: ProduceFlags = { sheep: false, goats: false, stable: false }
const all: ProduceFlags = { sheep: true, goats: true, stable: true }

describe('initialProduce', () => {
  it('starts timers full and nothing ready, horse home and rested', () => {
    const p = initialProduce()
    expect(p.woolT).toBe(WOOL_TIME)
    expect(p.woolReady).toBe(false)
    expect(p.milkT).toBe(MILK_TIME)
    expect(p.milkReady).toBe(false)
    expect(p.deliveryT).toBe(0)
    expect(p.deliveryCd).toBe(0)
  })
})

describe('timers gate on flags', () => {
  it('nothing moves and no events fire when nothing is owned', () => {
    const p = initialProduce()
    const ev = tickProduce(p, 10000, none)
    expect(p.woolT).toBe(WOOL_TIME)
    expect(p.milkT).toBe(MILK_TIME)
    expect(ev).toEqual({ woolBecameReady: false, milkBecameReady: false, deliveryReturned: false, eggsBecameReady: false })
  })

  it('sheep alone tick wool but never milk', () => {
    const p = initialProduce()
    tickProduce(p, 50, { ...none, sheep: true })
    expect(p.woolT).toBe(WOOL_TIME - 50)
    expect(p.milkT).toBe(MILK_TIME)
  })

  it('goats alone tick milk but never wool', () => {
    const p = initialProduce()
    tickProduce(p, 50, { ...none, goats: true })
    expect(p.milkT).toBe(MILK_TIME - 50)
    expect(p.woolT).toBe(WOOL_TIME)
  })
})

describe('ready latches at 0 and does not re-trigger', () => {
  it('wool fires its event exactly once, then parks at 0', () => {
    const p = initialProduce()
    expect(tickProduce(p, WOOL_TIME - 1, all).woolBecameReady).toBe(false)
    expect(tickProduce(p, 5, all).woolBecameReady).toBe(true)
    expect(p.woolReady).toBe(true)
    expect(p.woolT).toBe(0)
    for (let i = 0; i < 10; i++) expect(tickProduce(p, 99, all).woolBecameReady).toBe(false)
    expect(p.woolReady).toBe(true)
    expect(p.woolT).toBe(0)
  })

  it('milk fires its event exactly once, then parks at 0', () => {
    const p = initialProduce()
    expect(tickProduce(p, MILK_TIME, all).milkBecameReady).toBe(true)
    expect(p.milkReady).toBe(true)
    expect(tickProduce(p, MILK_TIME, all).milkBecameReady).toBe(false)
  })

  it('a huge dt overshoot still clamps the timer to exactly 0', () => {
    const p = initialProduce()
    tickProduce(p, 100000, all)
    expect(p.woolT).toBe(0)
    expect(p.milkT).toBe(0)
  })
})

describe('shear and collect', () => {
  it('shearWool refuses until ready, then consumes and restarts the timer', () => {
    const p = initialProduce()
    expect(shearWool(p)).toBe(false)
    expect(p.woolT).toBe(WOOL_TIME)
    tickProduce(p, WOOL_TIME, all)
    expect(shearWool(p)).toBe(true)
    expect(p.woolReady).toBe(false)
    expect(p.woolT).toBe(WOOL_TIME)
    expect(shearWool(p)).toBe(false) // no double-dipping the same batch
  })

  it('collectMilk refuses until ready, then consumes and restarts the timer', () => {
    const p = initialProduce()
    expect(collectMilk(p)).toBe(false)
    tickProduce(p, MILK_TIME, all)
    expect(collectMilk(p)).toBe(true)
    expect(p.milkReady).toBe(false)
    expect(p.milkT).toBe(MILK_TIME)
    expect(collectMilk(p)).toBe(false)
  })

  it('the next batch grows again after a shear', () => {
    const p = initialProduce()
    tickProduce(p, WOOL_TIME, all)
    shearWool(p)
    expect(tickProduce(p, WOOL_TIME, all).woolBecameReady).toBe(true)
  })
})

describe('delivery lifecycle ok -> out -> returned -> resting -> ok', () => {
  it('walks the full loop once around', () => {
    const p = initialProduce()
    expect(canDeliver(p, all, 1)).toBe('ok')

    expect(startDelivery(p)).toBe(true)
    expect(p.deliveryT).toBe(DELIVERY_RUN_TIME)
    expect(canDeliver(p, all, 1)).toBe('out')
    expect(startDelivery(p)).toBe(false) // she is already out

    const ev = tickProduce(p, DELIVERY_RUN_TIME, none)
    expect(ev.deliveryReturned).toBe(true)
    expect(p.deliveryT).toBe(0)
    expect(p.deliveryCd).toBe(DELIVERY_COOLDOWN)
    expect(canDeliver(p, all, 1)).toBe('resting')
    expect(startDelivery(p)).toBe(false) // still resting

    expect(tickProduce(p, 1, none).deliveryReturned).toBe(false) // no re-fire
    tickProduce(p, DELIVERY_COOLDOWN, none)
    expect(p.deliveryCd).toBe(0)
    expect(canDeliver(p, all, 1)).toBe('ok')
    expect(startDelivery(p)).toBe(true)
  })

  it('returned fires exactly once across many small ticks', () => {
    const p = initialProduce()
    startDelivery(p)
    let returns = 0
    for (let i = 0; i < 200; i++) if (tickProduce(p, 1, none).deliveryReturned) returns++
    expect(returns).toBe(1)
  })

  it('the run does not start counting on its own', () => {
    const p = initialProduce()
    tickProduce(p, 500, all)
    expect(p.deliveryT).toBe(0)
    expect(tickProduce(p, 500, all).deliveryReturned).toBe(false)
  })
})

describe('canDeliver precedence: no-stable > out > resting > feed', () => {
  it('no-stable wins over everything', () => {
    const p = initialProduce()
    p.deliveryT = 10
    p.deliveryCd = 10
    expect(canDeliver(p, { ...all, stable: false }, 0)).toBe('no-stable')
  })

  it('out wins over resting and feed', () => {
    const p = initialProduce()
    p.deliveryT = 10
    p.deliveryCd = 10
    expect(canDeliver(p, all, 0)).toBe('out')
  })

  it('resting wins over feed', () => {
    const p = initialProduce()
    p.deliveryCd = 10
    expect(canDeliver(p, all, 0)).toBe('resting')
  })

  it('feed gates last, and one wheat is enough', () => {
    const p = initialProduce()
    expect(canDeliver(p, all, 0)).toBe('feed')
    expect(canDeliver(p, all, 1)).toBe('ok')
  })
})

describe('deliveryPay', () => {
  it('roll 0 pays the floor, roll 0.999 pays the ceiling, both integers', () => {
    expect(deliveryPay(0)).toBe(DELIVERY_PAY[0])
    expect(deliveryPay(0.999)).toBe(DELIVERY_PAY[1])
    expect(Number.isInteger(deliveryPay(0))).toBe(true)
    expect(Number.isInteger(deliveryPay(0.999))).toBe(true)
  })

  it('seeded sweep stays an integer inside the inclusive range', () => {
    const rng = mulberry32(11)
    for (let i = 0; i < 5000; i++) {
      const pay = deliveryPay(rng.next())
      expect(Number.isInteger(pay)).toBe(true)
      expect(pay).toBeGreaterThanOrEqual(DELIVERY_PAY[0])
      expect(pay).toBeLessThanOrEqual(DELIVERY_PAY[1])
    }
  })
})
