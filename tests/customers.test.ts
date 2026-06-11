import { describe, expect, it } from 'vitest'
import { Customers, type Stock } from '../src/game/customers'
import {
  CUSTOMER_DELAY,
  CUSTOMER_FIRST_DELAY,
  CUSTOMER_QUEUE_MAX,
  offerFor,
  tipFor,
} from '../src/game/economy'
import { Game } from '../src/game/Game'
import { initialState } from '../src/game/state'

const step = (c: Customers, seconds: number, stock: Stock): void => {
  for (let t = 0; t < seconds; t += 0.25) c.update(0.25, stock)
}

describe('customer cadence', () => {
  it('never spawns while inactive (FTUE protection)', () => {
    const c = new Customers(7)
    step(c, 600, { wheat: 5, corn: 5, egg: 5 })
    expect(c.queue).toHaveLength(0)
  })

  it('first visit lands inside the first-delay window once active', () => {
    const c = new Customers(7)
    c.active = true
    const stock: Stock = { wheat: 3, corn: 0, egg: 0 }
    let elapsed = 0
    while (c.queue.length === 0 && elapsed < 600) {
      c.update(0.25, stock)
      elapsed += 0.25
    }
    expect(elapsed).toBeGreaterThanOrEqual(CUSTOMER_FIRST_DELAY[0] - 0.5)
    expect(elapsed).toBeLessThanOrEqual(CUSTOMER_FIRST_DELAY[1] + 0.5)
  })

  it('later visits respect the 60-120s rhythm', () => {
    const c = new Customers(99)
    c.active = true
    const stock: Stock = { wheat: 9, corn: 9, egg: 9 }
    // get the first one, clear it, then time the second
    while (c.queue.length === 0) c.update(0.25, stock)
    c.remove(c.queue[0].id)
    let elapsed = 0
    while (c.queue.length === 0 && elapsed < 300) {
      c.update(0.25, stock)
      elapsed += 0.25
    }
    expect(elapsed).toBeGreaterThanOrEqual(CUSTOMER_DELAY[0] - 0.5)
    expect(elapsed).toBeLessThanOrEqual(CUSTOMER_DELAY[1] + 0.5)
  })

  it('holds the spawn until something is in stock, then fires on restock', () => {
    const c = new Customers(11)
    c.active = true
    step(c, 200, { wheat: 0, corn: 0, egg: 0 })
    expect(c.queue).toHaveLength(0)
    step(c, 0.5, { wheat: 1, corn: 0, egg: 0 })
    expect(c.queue).toHaveLength(1)
  })

  it('queue is capped (no crowd pressure)', () => {
    const c = new Customers(5)
    c.active = true
    step(c, 3600, { wheat: 50, corn: 50, egg: 50 })
    expect(c.queue.length).toBeLessThanOrEqual(CUSTOMER_QUEUE_MAX)
  })
})

describe('wants scale to stock (almost always fulfillable)', () => {
  it('only asks for kinds in stock, never more than held', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const c = new Customers(seed)
      c.active = true
      const stock: Stock = { wheat: 2, corn: 0, egg: 1 }
      while (c.queue.length === 0) c.update(0.25, stock)
      const w = c.queue[0].want
      expect(stock[w.kind]).toBeGreaterThan(0)
      expect(w.count).toBeLessThanOrEqual(stock[w.kind])
      expect(w.count).toBeGreaterThanOrEqual(1)
      expect(w.offer).toBe(offerFor(w.kind, w.count))
      // tip is a variable-ratio roll: floor 1, ceiling the 2x big-tipper band
      expect(w.tip).toBeGreaterThanOrEqual(1)
      expect(w.tip).toBeLessThanOrEqual(Math.max(1, Math.round(w.offer * 2)))
    }
  })

  it('offer is a premium over auto-sell and tip is at least 1', () => {
    expect(offerFor('wheat', 1)).toBeGreaterThan(2)
    expect(offerFor('corn', 2)).toBeGreaterThan(10)
    expect(offerFor('egg', 1)).toBeGreaterThan(8)
    expect(tipFor(offerFor('wheat', 1))).toBeGreaterThanOrEqual(1)
  })

  it('is deterministic for the same seed', () => {
    const mk = (): Array<[string, number]> => {
      const c = new Customers(1234)
      c.active = true
      const stock: Stock = { wheat: 5, corn: 5, egg: 5 }
      while (c.queue.length === 0) c.update(0.25, stock)
      return c.queue.map((q) => [q.want.kind, q.want.count])
    }
    expect(mk()).toEqual(mk())
  })
})

describe('serving flow', () => {
  const spawnOne = (stock: Stock): Customers => {
    const c = new Customers(42)
    c.active = true
    while (c.queue.length === 0) c.update(0.25, stock)
    return c
  }

  it('arriving customers cannot be served until they reach the stand', () => {
    const stock: Stock = { wheat: 4, corn: 0, egg: 0 }
    const c = spawnOne(stock)
    expect(c.frontServiceable(stock)).toBeNull()
    c.notifyArrived(c.queue[0].id)
    expect(c.frontServiceable(stock)?.id).toBe(c.queue[0].id)
  })

  it('unserved customers wait forever — never removed, never angry', () => {
    const stock: Stock = { wheat: 1, corn: 0, egg: 0 }
    const c = spawnOne(stock)
    c.notifyArrived(c.queue[0].id)
    const empty: Stock = { wheat: 0, corn: 0, egg: 0 }
    step(c, 1800, empty)
    expect(c.queue[0].phase).toBe('waiting')
    expect(c.frontServiceable(empty)).toBeNull() // browses until restock
    expect(c.frontServiceable({ wheat: 1, corn: 0, egg: 0 })).not.toBeNull()
  })

  it('serve -> leaving -> remove, and the queue spot shifts forward', () => {
    const stock: Stock = { wheat: 50, corn: 50, egg: 50 }
    const c = spawnOne(stock)
    step(c, 130, stock) // second customer arrives
    expect(c.queue.length).toBe(2)
    const [a, b] = c.queue
    expect(c.spotOf(b.id)).toBe(1)
    c.notifyArrived(a.id)
    c.serve(a.id)
    expect(a.phase).toBe('leaving')
    expect(c.spotOf(b.id)).toBe(0) // shuffles up while the first walks off
    c.remove(a.id)
    expect(c.queue.map((q) => q.id)).toEqual([b.id])
  })

  it('Game.fulfill pays the offered coins and decrements stand stock', () => {
    const g = new Game(initialState(3))
    g.state.wheat = 3
    g.state.eggs = 2
    const coinsBefore = g.state.coins
    expect(g.fulfill('wheat', 2, 7)).toBe(true)
    expect(g.state.wheat).toBe(1)
    expect(g.state.coins).toBe(coinsBefore + 7)
    expect(g.fulfill('egg', 3, 99)).toBe(false) // stock ran out -> no charge
    expect(g.state.eggs).toBe(2)
    expect(g.state.coins).toBe(coinsBefore + 7)
  })

  it('harvest banks corn for the stand and collect banks eggs', () => {
    const g = new Game(initialState(3))
    g.state.level = 2
    g.plant(0, 'corn')
    g.update(241)
    g.harvest(0)
    expect(g.state.corn).toBe(1)
    g.state.chicken.arrived = true
    g.state.chicken.name = 'Pearl'
    g.state.chicken.eggReady = true
    g.collectEgg()
    expect(g.state.eggs).toBe(1)
  })
})
