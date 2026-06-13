/** The order board wired into the Game: producing a contracted good fills the
 * order, pays out exactly once, and old saves grow the board cleanly. */
import { describe, expect, it } from 'vitest'
import { Game } from '../src/game/Game'
import { deserialize, initialState, serialize } from '../src/game/state'
import type { CropKind } from '../src/game/economy'

describe('contracts wired into Game', () => {
  it('producing a contracted crop fills it, pays the bonus once, never twice', () => {
    const s = initialState(123)
    s.level = 20 // bigger payouts; no animal projects, so every order is a crop
    const g = new Game(s)
    g.update(0.01) // rolls today's board + zeroes progress

    const board = g.contractBoard()
    const crops: CropKind[] = ['wheat', 'corn', 'tomato', 'pepper', 'eggplant']
    const idx = board.findIndex((r) => crops.includes(r.contract.good as CropKind))
    expect(idx).toBeGreaterThanOrEqual(0) // a crop-only farm always gets crop orders
    const target = board[idx].contract

    let firedSlot = -1
    let paidEvent = 0
    g.on('contractDone', (e) => {
      firedSlot = e.slot
      paidEvent = e.contract.payout
    })

    const coinsBefore = s.coins
    // force-harvest exactly `qty` of the contracted crop on plot 0
    for (let k = 0; k < target.qty; k++) {
      s.plots[0].crop = { kind: target.good as CropKind, total: 1, remaining: 0, chimed: true }
      g.harvest(0)
    }

    expect(firedSlot).toBe(idx)
    expect(paidEvent).toBe(target.payout)
    expect(g.contractBoard()[idx].done).toBe(true)
    // coins rose by at least the contract payout (plus the harvest sell values)
    expect(s.coins).toBeGreaterThanOrEqual(coinsBefore + target.payout)

    // one more harvest must NOT pay the contract again
    const after = s.coins
    s.plots[0].crop = { kind: target.good as CropKind, total: 1, remaining: 0, chimed: true }
    g.harvest(0)
    expect(s.coins - after).toBeLessThan(target.payout)
  })

  it('a new day re-rolls the board with fresh, empty progress', () => {
    const s = initialState(7)
    const g = new Game(s)
    g.update(0.01)
    s.contracts.progress[0] = 999 // pretend yesterday made progress
    s.day += 1 // sleep into tomorrow
    g.update(0.01) // ensureContractsFresh should reset
    expect(s.contracts.day).toBe(s.day)
    expect(s.contracts.progress.every((p) => p === 0)).toBe(true)
    expect(s.contracts.done.every((d) => d === false)).toBe(true)
  })

  it('old saves without an order board migrate to an empty one', () => {
    const raw = JSON.parse(serialize(initialState(5))) as Record<string, unknown>
    delete raw.contracts
    delete raw.festival
    delete raw.festivalRibbons
    const back = deserialize(JSON.stringify(raw))!
    expect(back.contracts).toEqual({ day: 0, progress: [], done: [] })
    expect(back.festival).toEqual({ week: -1, progress: [], done: false })
    expect(back.festivalRibbons).toBe(0)
  })
})
