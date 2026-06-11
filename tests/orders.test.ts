import { describe, expect, it } from 'vitest'
import { orderFor } from '../src/game/orders'

describe('delivery orders (seeded Millbrook buyers)', () => {
  it('is deterministic for the same day and run', () => {
    const a = orderFor(4, 2)
    const b = orderFor(4, 2)
    expect(a).toEqual(b)
    expect(a.buyer.length).toBeGreaterThan(0)
    expect(a.use.length).toBeGreaterThan(0)
  })

  it('varies across runs and days (the town is more than one neighbor)', () => {
    const buyers = new Set<string>()
    for (let day = 1; day <= 6; day++) {
      for (let run = 0; run < 6; run++) buyers.add(orderFor(day, run).buyer)
    }
    expect(buyers.size).toBeGreaterThanOrEqual(4)
  })
})
