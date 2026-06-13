/** Millbrook pins: act gating precedence, the funding spend, Rosie's daily
 * order, the wool-works multiplier, farmstead tiers, and save migration. */
import { describe, expect, it } from 'vitest'
import { Game } from '../src/game/Game'
import { nextTier, plotCount, TIERS } from '../src/game/expansion'
import { deserialize, initialState, serialize, type GameState } from '../src/game/state'
import {
  BAKERY_RATE,
  BAKERY_WHEAT,
  busWindow,
  busWindowPm,
  nextTownAct,
  recessNow,
  TOWN_ACTS,
  townActDef,
  townStatus,
  woolMult,
} from '../src/game/town'

function rich(mut?: (s: GameState) => void): GameState {
  const s = initialState(3)
  s.coins = 99999
  s.wheat = 999
  mut?.(s)
  return s
}

describe('town act gating', () => {
  it('story gates outrank money gates', () => {
    const bakery = townActDef('bakery')
    const s = rich()
    expect(townStatus(bakery, s)).toBe('delivered') // no deliveries yet
    s.town.delivered = 3
    expect(townStatus(bakery, s)).toBe('ok')
    s.coins = 0
    expect(townStatus(bakery, s)).toBe('coins')
    s.coins = 99999
    s.wheat = 0
    expect(townStatus(bakery, s)).toBe('wheat')
    // cottages wait for the bakery no matter how rich the farm is
    const cottages = townActDef('cottages')
    s.wheat = 999
    s.town.delivered = 99
    expect(townStatus(cottages, s)).toBe('after')
    s.town.built.bakery = true
    expect(townStatus(cottages, s)).toBe('ok')
  })

  it('acts come up one at a time on the board', () => {
    const s = rich()
    expect(nextTownAct(s)!.id).toBe('bakery')
    s.town.built.bakery = true
    expect(nextTownAct(s)!.id).toBe('cottages')
    for (const a of TOWN_ACTS) s.town.built[a.id] = true
    expect(nextTownAct(s)).toBeNull()
  })

  it('buyTownAct spends coins AND wheat, exactly once', () => {
    const s = rich((x) => {
      x.town.delivered = 3
    })
    const g = new Game(s)
    const def = townActDef('bakery')
    expect(g.buyTownAct('bakery')).toBe(true)
    expect(s.coins).toBe(99999 - def.coins)
    expect(s.wheat).toBe(999 - def.wheat)
    expect(s.town.built.bakery).toBe(true)
    expect(g.buyTownAct('bakery')).toBe(false) // owned
  })
})

describe("Rosie's standing order", () => {
  it('sells 4 wheat at the premium once per day, hands-free', () => {
    const day = { d: 1 }
    const s = rich((x) => {
      x.town.built.bakery = true
      x.wheat = 10
    })
    const g = new Game(s, () => `day-${day.d}`)
    let paid = 0
    g.on('bakerySold', (e) => {
      paid += e.coins
    })
    g.update(0.1)
    expect(s.wheat).toBe(10 - BAKERY_WHEAT)
    expect(paid).toBe(BAKERY_WHEAT * BAKERY_RATE)
    g.update(0.1) // same day: once means once
    expect(s.wheat).toBe(10 - BAKERY_WHEAT)
    day.d = 2
    g.update(0.1)
    expect(s.wheat).toBe(10 - 2 * BAKERY_WHEAT)
  })

  it('waits when the pantry is short — never sells you to zero unfairly', () => {
    const s = rich((x) => {
      x.town.built.bakery = true
      x.wheat = BAKERY_WHEAT - 1
    })
    const g = new Game(s)
    g.update(0.1)
    expect(s.wheat).toBe(BAKERY_WHEAT - 1)
  })
})

describe('the wool works', () => {
  it('wool pays half again more once the works spin', () => {
    const base = rich((x) => {
      x.produce.woolReady = true
    })
    const works = rich((x) => {
      x.produce.woolReady = true
      x.town.built.works = true
    })
    expect(woolMult(base)).toBe(1)
    expect(woolMult(works)).toBe(1.5)
    const a = new Game(base).shearFlock(4)
    const b = new Game(works).shearFlock(4)
    expect(b).toBe(Math.round(a * 1.5))
  })
})

describe('day-clock windows', () => {
  it('bus and recess bands are sane and non-degenerate', () => {
    expect(busWindow(0.35)).toBe(true)
    expect(busWindow(0.8)).toBe(false)
    expect(recessNow(0.5)).toBe(true)
    expect(recessNow(0.2)).toBe(false)
  })

  it('afternoon bus window is distinct from morning and off elsewhere', () => {
    // morning band still passes
    expect(busWindow(0.35)).toBe(true)
    expect(busWindow(0.8)).toBe(false)
    // pm band: 0.66..0.78
    expect(busWindowPm(0.72)).toBe(true)
    expect(busWindowPm(0.5)).toBe(false)
    // pm band edges are clean
    expect(busWindowPm(0.66)).toBe(true)
    expect(busWindowPm(0.78)).toBe(true)
    expect(busWindowPm(0.65)).toBe(false)
    expect(busWindowPm(0.79)).toBe(false)
  })

  it('widened recess covers both bands and is dark at edges', () => {
    // morning recess: 0.30..0.44
    expect(recessNow(0.35)).toBe(true)
    // post-lunch recess: 0.48..0.66
    expect(recessNow(0.5)).toBe(true)   // original assertion preserved
    expect(recessNow(0.6)).toBe(true)
    // quiet gap between bands
    expect(recessNow(0.46)).toBe(false)
    // before school
    expect(recessNow(0.2)).toBe(false)  // original assertion preserved
    // after school
    expect(recessNow(0.9)).toBe(false)
  })
})

describe('the farmstead deeds (Act 4 land)', () => {
  it('tiers 5 and 6 follow the crossroad lot', () => {
    expect(nextTier(4)!.name).toBe("Old Tom's Farmstead")
    expect(nextTier(5)!.name).toBe('The Birch Farmstead')
    expect(nextTier(6)).toBeNull()
    expect(TIERS[6].sheep).toBe(2)
  })

  it('buying Old Tom adds his two plots through the normal deed flow', () => {
    let s = initialState(8)
    s.expansion = 4
    s.level = 13
    s.coins = 2000
    s = deserialize(serialize(s))! // pads plots to the owned tier
    const before = s.plots.length
    expect(before).toBe(plotCount(4))
    const g = new Game(s)
    const def = g.expand()
    expect(def?.name).toBe("Old Tom's Farmstead")
    expect(s.expansion).toBe(5)
    expect(s.plots.length).toBe(before + 2)
  })
})

describe('migration', () => {
  it('old saves grow an empty town square', () => {
    const raw = JSON.parse(serialize(initialState(11))) as Record<string, unknown>
    delete raw.town
    const back = deserialize(JSON.stringify(raw))!
    expect(back.town).toEqual({ delivered: 0, built: {}, lastBakeryDay: null, lastBusDay: null })
  })
})
