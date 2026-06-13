/** Hazel-truth pins: daily pet/feed gates, the hearts cap, the live-pay
 * hearts bonus vs the flat offline rule, and the old-save migration. */
import { describe, expect, it } from 'vitest'
import { Game } from '../src/game/Game'
import { DELIVERY_PAY, DELIVERY_RUN_TIME, startDelivery } from '../src/game/produce'
import { catchUp, deserialize, initialState, serialize, type GameState } from '../src/game/state'

/** a game whose "today" we control (the chicken-pet test recipe) */
function gameOn(day: { d: number }, mut?: (s: GameState) => void): Game {
  const s = initialState(7)
  s.projects.stable = true
  s.projects.horse = true
  s.wheat = 10
  mut?.(s)
  return new Game(s, () => `day-${day.d}`)
}

describe('petting Hazel', () => {
  it('one heart per day, capped at 8, XP granted', () => {
    const day = { d: 1 }
    const g = gameOn(day)
    expect(g.canPetHorse()).toBe(true)
    expect(g.petHorse()).toBe(true)
    expect(g.state.hazel.hearts).toBe(1)
    expect(g.petHorse()).toBe(false) // same day: no double-dip
    for (let d = 2; d <= 20; d++) {
      day.d = d
      g.petHorse()
    }
    expect(g.state.hazel.hearts).toBe(8) // the cap
  })

  it('requires Hazel herself, not just the stable', () => {
    const day = { d: 1 }
    const g = gameOn(day, (s) => {
      s.projects.horse = false
    })
    expect(g.canPetHorse()).toBe(false)
    expect(g.petHorse()).toBe(false)
  })
})

describe('a scoop of oats', () => {
  it('costs 1 wheat; first scoop of the day warms a heart, refills do not', () => {
    const day = { d: 1 }
    const g = gameOn(day)
    expect(g.feedHorse()).toBe(true)
    expect(g.state.wheat).toBe(9)
    expect(g.state.hazel.hearts).toBe(1)
    expect(g.feedHorse()).toBe(true) // feeding again is allowed...
    expect(g.state.wheat).toBe(8)
    expect(g.state.hazel.hearts).toBe(1) // ...but hearts are daily
  })

  it('refuses an empty pantry and an empty stall', () => {
    const day = { d: 1 }
    const broke = gameOn(day, (s) => {
      s.wheat = 0
    })
    expect(broke.feedHorse()).toBe(false)
    const away = gameOn(day, (s) => {
      startDelivery(s.produce)
    })
    expect(away.feedHorse()).toBe(false) // she's out on the road
  })
})

describe('hearts pay on the road', () => {
  it('live return pays the seeded roll +1c per heart', () => {
    const run = (hearts: number): number => {
      const day = { d: 1 }
      const g = gameOn(day, (s) => {
        s.hazel.hearts = hearts
        s.rng = 12345
        startDelivery(s.produce)
      })
      let paid = 0
      g.on('deliveryDone', (e) => {
        paid = e.coins
      })
      g.update(DELIVERY_RUN_TIME + 1)
      return paid
    }
    const cold = run(0)
    const loved = run(8)
    expect(cold).toBeGreaterThanOrEqual(DELIVERY_PAY[0])
    expect(loved - cold).toBe(8)
  })

  it('offline catch-up stays the flat 34 regardless of hearts', () => {
    const s = initialState(9)
    s.projects.stable = true
    s.projects.horse = true
    s.hazel.hearts = 8
    startDelivery(s.produce)
    const before = s.coins
    const raw = deserialize(serialize(s))!
    // simulate the app reopening long after the run finished
    const res = catchUp(raw, DELIVERY_RUN_TIME + 60)
    expect(res.offlineDelivery).toBe(true)
    expect(raw.coins - before).toBe(34)
  })
})

describe('migration', () => {
  it('old saves grow a cold hazel record', () => {
    const raw = JSON.parse(serialize(initialState(11))) as Record<string, unknown>
    delete raw.hazel
    const back = deserialize(JSON.stringify(raw))!
    expect(back.hazel).toEqual({ hearts: 0, lastPetDay: null, lastFedDay: null })
    // and a populated record round-trips untouched
    const s = initialState(12)
    s.hazel = { hearts: 5, lastPetDay: 'day-3', lastFedDay: 'day-2' }
    expect(deserialize(serialize(s))!.hazel).toEqual({ hearts: 5, lastPetDay: 'day-3', lastFedDay: 'day-2' })
  })

  it('retires the farmhand: refunds 1000c exactly once, drops the flag + post override', () => {
    const raw = JSON.parse(serialize(initialState(12))) as Record<string, unknown>
    // an old save that hired the farmhand for 1000c and parked his post
    raw.coins = 50
    raw.projects = { coop: true, farmhand: true }
    raw.layout = { farmhand: { x: -0.5, z: 5.2, yaw: 0 } }
    delete raw.farmhandRetired
    const back = deserialize(JSON.stringify(raw))!
    expect(back.coins).toBe(1050) // 50 + 1000 refund
    expect(back.projects.farmhand).toBeUndefined()
    expect(back.farmhandRetired).toBe(true)
    expect((back.layout as Record<string, unknown>).farmhand).toBeUndefined()
    // idempotent: loading the refunded save again does NOT pay twice
    expect(deserialize(serialize(back))!.coins).toBe(1050)
  })

  it('a save that never hired the farmhand keeps its coins on retirement', () => {
    const raw = JSON.parse(serialize(initialState(12))) as Record<string, unknown>
    raw.coins = 200
    raw.projects = { coop: true }
    delete raw.farmhandRetired
    expect(deserialize(JSON.stringify(raw))!.coins).toBe(200)
  })

  it('derives field parcels from the save’s own plot array (no crop orphaned)', () => {
    // an old save sized its plots from the legacy tier table — the field decoupled
    // into 4-plot parcels; the count rounds UP so every saved crop index survives
    const mk = (plots: number): GameState => {
      const s = initialState(7)
      s.plots = Array.from({ length: plots }, () => ({ crop: null }))
      delete (s as Partial<GameState>).fieldParcels
      return deserialize(serialize(s))!
    }
    expect(mk(4).fieldParcels).toBe(1) // a fresh farm
    expect(mk(12).fieldParcels).toBe(3) // the owner's save (expansion 2)
    expect(mk(11).fieldParcels).toBe(3) // legacy 11-plot tier rounds up to 3 parcels
    expect(mk(14).fieldParcels).toBe(4)
    // and the backfilled field always exposes >= the saved plot count
    for (const n of [4, 11, 12, 14, 16]) expect(mk(n).fieldParcels * 4).toBeGreaterThanOrEqual(n)
  })

  it('repairs corrupt zero/low field parcel counts without orphaning plots', () => {
    const mk = (plots: number, fieldParcels: number): GameState => {
      const s = initialState(7)
      s.plots = Array.from({ length: plots }, () => ({ crop: null }))
      const raw = JSON.parse(serialize(s)) as Record<string, unknown>
      raw.fieldParcels = fieldParcels
      return deserialize(JSON.stringify(raw))!
    }

    expect(mk(4, 0).fieldParcels).toBe(1)
    expect(mk(12, 0).fieldParcels).toBe(3)
    expect(mk(12, 1).fieldParcels).toBe(3)
    expect(mk(4, 3).fieldParcels).toBe(3)
  })

  it('strips stale pre-lock field-position overrides so fields sit home (no seam)', () => {
    // a save that MOVED a field before the lock carried a layout.fieldN override —
    // it would re-open a soil-texture seam and strand the field off its tier
    const s = initialState(12)
    s.expansion = 2
    s.layout = { field1: { x: 3, z: 3 }, coop: { x: -6, z: 8 } }
    const back = deserialize(serialize(s))!
    expect((back.layout as Record<string, unknown>).field1).toBeUndefined()
    // a moved BUILDING override is preserved — only fields are locked
    expect((back.layout as Record<string, unknown>).coop).toEqual({ x: -6, z: 8 })
  })
})
