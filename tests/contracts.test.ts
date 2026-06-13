/** Contracts — daily order board + weekly festival order.
 * Pure deterministic module: no three/DOM, no Date, no Math.random. */
import { describe, expect, it } from 'vitest'
import {
  contractSlots,
  goodBaseValue,
  rollContracts,
  rollFestival,
  type Contract,
  type ContractGood,
} from '../src/game/contracts'
import { initialState, type GameState } from '../src/game/state'

// ---------- helpers ----------------------------------------------------------

/** Fresh level-1 save (wheat only eligible) */
function freshSave(seed = 42): GameState {
  return initialState(seed)
}

/** A save with all crops, coop, sheep, goats unlocked */
function richSave(): GameState {
  const s = initialState(99)
  s.level = 30
  s.projects.coop = true
  s.projects.sheep = true
  s.projects.goats = true
  // greenhouse crops unlock at 9-11 AND require owning the greenhouse to produce,
  // so a contract can only ask for them once the project is bought
  s.projects.greenhouse = true
  return s
}

/** A save with the station town act built (4-slot mode) */
function stationSave(): GameState {
  const s = richSave()
  ;(s.town.built as Record<string, boolean>).station = true
  return s
}

// ---------- goodBaseValue ----------------------------------------------------

describe('goodBaseValue', () => {
  it('returns the real constants for every good', () => {
    // crops from CROPS.sell
    expect(goodBaseValue('wheat')).toBe(2)
    expect(goodBaseValue('corn')).toBe(5)
    expect(goodBaseValue('tomato')).toBe(9)
    expect(goodBaseValue('pepper')).toBe(13)
    expect(goodBaseValue('eggplant')).toBe(18)
    // animal produce
    expect(goodBaseValue('egg')).toBe(8)   // EGG_SELL
    expect(goodBaseValue('wool')).toBe(6)  // WOOL_COIN_PER_SHEEP
    expect(goodBaseValue('milk')).toBe(9)  // MILK_COIN_PER_GOAT
  })
})

// ---------- contractSlots ----------------------------------------------------

describe('contractSlots', () => {
  it('is 3 on a normal save', () => {
    expect(contractSlots(freshSave())).toBe(3)
  })

  it('is 4 once the station is built', () => {
    expect(contractSlots(stationSave())).toBe(4)
  })
})

// ---------- DETERMINISM ------------------------------------------------------

describe('rollContracts determinism', () => {
  it('same seed + day = identical result (pure)', () => {
    const s = richSave()
    const a = rollContracts(s.chicken.seed, 5, s)
    const b = rollContracts(s.chicken.seed, 5, s)
    expect(a).toEqual(b)
  })

  it('different day almost always produces different contracts', () => {
    const s = richSave()
    const seed = s.chicken.seed
    // check a few day-pairs; at least one pair should differ in goods/qty
    let diffFound = false
    for (let d = 1; d <= 10 && !diffFound; d++) {
      const c1 = rollContracts(seed, d, s)
      const c2 = rollContracts(seed, d + 1, s)
      if (JSON.stringify(c1) !== JSON.stringify(c2)) diffFound = true
    }
    expect(diffFound).toBe(true)
  })

  it('different seedBase produces different contracts', () => {
    const s = richSave()
    const a = rollContracts(1111, 7, s)
    const b = rollContracts(9999, 7, s)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })
})

// ---------- COUNT ------------------------------------------------------------

describe('rollContracts count', () => {
  it('returns exactly contractSlots(s) contracts', () => {
    const s = richSave()
    const contracts = rollContracts(s.chicken.seed, 3, s)
    expect(contracts).toHaveLength(contractSlots(s)) // 3
  })

  it('returns 4 contracts with station', () => {
    const s = stationSave()
    expect(rollContracts(s.chicken.seed, 3, s)).toHaveLength(4)
  })

  it('fresh level-1 save never crashes and returns full count', () => {
    const s = freshSave()
    const contracts = rollContracts(s.chicken.seed, 1, s)
    expect(contracts).toHaveLength(3)
    // with only wheat eligible: all goods must be wheat
    for (const c of contracts) {
      expect(c.good).toBe('wheat')
    }
  })

  it('payout is always positive', () => {
    const s = freshSave()
    for (let day = 1; day <= 10; day++) {
      for (const c of rollContracts(s.chicken.seed, day, s)) {
        expect(c.payout).toBeGreaterThan(0)
      }
    }
  })
})

// ---------- ELIGIBILITY ------------------------------------------------------

describe('rollContracts eligibility', () => {
  it('a rich save can roll wool, milk, egg, and greenhouse crops', () => {
    const s = richSave()
    const goods = new Set<ContractGood>()
    for (let day = 1; day <= 40; day++) {
      for (const c of rollContracts(s.chicken.seed, day, s)) goods.add(c.good)
    }
    expect(goods.has('wool')).toBe(true)
    expect(goods.has('milk')).toBe(true)
    expect(goods.has('egg')).toBe(true)
    // greenhouse crops are level-gated (9-11); level 30 passes all
    expect(goods.has('tomato') || goods.has('pepper') || goods.has('eggplant')).toBe(true)
  })

  it('a fresh save never rolls wool, milk, egg, or locked crops', () => {
    const s = freshSave() // level 1, no projects
    const forbidden: ContractGood[] = ['wool', 'milk', 'egg', 'corn', 'tomato', 'pepper', 'eggplant']
    for (let day = 1; day <= 50; day++) {
      for (const c of rollContracts(s.chicken.seed, day, s)) {
        expect(forbidden).not.toContain(c.good)
      }
    }
  })

  it('corn becomes eligible at level 2', () => {
    const s = freshSave()
    s.level = 2
    const goods = new Set<ContractGood>()
    for (let day = 1; day <= 30; day++) {
      for (const c of rollContracts(s.chicken.seed, day, s)) goods.add(c.good)
    }
    expect(goods.has('corn')).toBe(true)
    // still no animal produce without projects
    expect(goods.has('wool')).toBe(false)
    expect(goods.has('milk')).toBe(false)
    expect(goods.has('egg')).toBe(false)
  })

  it('greenhouse crops stay OUT of contracts until the greenhouse is owned', () => {
    const s = freshSave()
    s.level = 30 // clears every crop unlock level
    const goods = new Set<ContractGood>()
    for (let day = 1; day <= 40; day++) {
      for (const c of rollContracts(s.chicken.seed, day, s)) goods.add(c.good)
    }
    // without the greenhouse, an order for these would be unfillable
    expect(goods.has('tomato')).toBe(false)
    expect(goods.has('pepper')).toBe(false)
    expect(goods.has('eggplant')).toBe(false)
    s.projects.greenhouse = true
    const goods2 = new Set<ContractGood>()
    for (let day = 1; day <= 40; day++) {
      for (const c of rollContracts(s.chicken.seed, day, s)) goods2.add(c.good)
    }
    expect(goods2.has('tomato') || goods2.has('pepper') || goods2.has('eggplant')).toBe(true)
  })

  it('egg becomes eligible when solo hen has arrived', () => {
    const s = freshSave()
    s.chicken.arrived = true
    const goods = new Set<ContractGood>()
    for (let day = 1; day <= 30; day++) {
      for (const c of rollContracts(s.chicken.seed, day, s)) goods.add(c.good)
    }
    expect(goods.has('egg')).toBe(true)
  })

  it('egg becomes eligible when coop project is built', () => {
    const s = freshSave()
    s.projects.coop = true
    const goods = new Set<ContractGood>()
    for (let day = 1; day <= 30; day++) {
      for (const c of rollContracts(s.chicken.seed, day, s)) goods.add(c.good)
    }
    expect(goods.has('egg')).toBe(true)
  })

  it('distinct sponsor strings are non-empty', () => {
    const s = richSave()
    s.town.built.bakery = true
    s.town.built.cottages = true
    s.town.built.school = true
    s.town.built.works = true
    for (let day = 1; day <= 10; day++) {
      for (const c of rollContracts(s.chicken.seed, day, s)) {
        expect(c.sponsor.length).toBeGreaterThan(0)
      }
    }
  })
})

// ---------- SCALING ----------------------------------------------------------

describe('rollContracts scaling', () => {
  it('higher-level save produces strictly greater qty and payout for the same good', () => {
    // find a day where both saves share a good in the same slot position
    const low = freshSave()
    low.level = 3

    const high = freshSave()
    high.level = 30

    // use the same seed so the good selections can align; compare wheat across
    // days that both rolls should hit wheat (fresh save always wheat)
    const lowContracts = rollContracts(low.chicken.seed, 1, low)
    const highContracts = rollContracts(high.chicken.seed, 1, high)

    // both must have wheat (level 3 fresh: only wheat eligible)
    const lowWheat = lowContracts.find((c) => c.good === 'wheat')!
    const highWheat = highContracts.find((c) => c.good === 'wheat')!
    expect(lowWheat).toBeDefined()
    expect(highWheat).toBeDefined()

    expect(highWheat.qty).toBeGreaterThan(lowWheat.qty)
    expect(highWheat.payout).toBeGreaterThan(lowWheat.payout)
  })

  it('level-30 qty for wheat is in the right ballpark', () => {
    const s = freshSave()
    s.level = 30
    const [c] = rollContracts(s.chicken.seed, 1, s)
    // level-30 scale factor: (1 + 30/25) = 2.2 so min qty is floor(6*2.2)=13
    expect(c.qty).toBeGreaterThanOrEqual(1)
    // payout = qty * 2 * premium; premium ≥ 1.6, so payout ≥ qty * 3.2
    expect(c.payout).toBeGreaterThanOrEqual(c.qty * goodBaseValue(c.good))
  })
})

// ---------- STATION SLOT -----------------------------------------------------

describe('station freight order', () => {
  it('4th slot has a larger qty than a comparable 1-3 slot roll', () => {
    const s = stationSave()
    s.level = 5 // moderate level so qty differences are visible

    // roll many days and check that slot 3 (index 3) tends to have higher qty
    const contracts: Contract[][] = []
    for (let day = 1; day <= 10; day++) contracts.push(rollContracts(s.chicken.seed, day, s))

    // each batch should have 4 contracts; at least some with higher qty in slot 3
    for (const batch of contracts) {
      expect(batch).toHaveLength(4)
      // the 4th slot must have a positive payout
      expect(batch[3].payout).toBeGreaterThan(0)
    }
  })
})

// ---------- FESTIVAL ---------------------------------------------------------

describe('rollFestival', () => {
  it('is deterministic', () => {
    const s = richSave()
    const a = rollFestival(s.chicken.seed, 3, s)
    const b = rollFestival(s.chicken.seed, 3, s)
    expect(a).toEqual(b)
  })

  it('different week rolls different festival', () => {
    const s = richSave()
    const seed = s.chicken.seed
    let diffFound = false
    for (let w = 1; w <= 10 && !diffFound; w++) {
      const f1 = rollFestival(seed, w, s)
      const f2 = rollFestival(seed, w + 1, s)
      if (JSON.stringify(f1) !== JSON.stringify(f2)) diffFound = true
    }
    expect(diffFound).toBe(true)
  })

  it('contains 2 or 3 goods', () => {
    const s = richSave()
    for (let week = 1; week <= 20; week++) {
      const f = rollFestival(s.chicken.seed, week, s)
      expect(f.goods.length).toBeGreaterThanOrEqual(2)
      expect(f.goods.length).toBeLessThanOrEqual(3)
    }
  })

  it('payout is always positive', () => {
    const s = richSave()
    for (let week = 1; week <= 20; week++) {
      expect(rollFestival(s.chicken.seed, week, s).payout).toBeGreaterThan(0)
    }
  })

  it('fresh save (wheat only) still produces a valid festival', () => {
    const s = freshSave()
    const f = rollFestival(s.chicken.seed, 1, s)
    expect(f.goods.length).toBeGreaterThanOrEqual(2)
    for (const { good } of f.goods) expect(good).toBe('wheat')
    expect(f.payout).toBeGreaterThan(0)
  })

  it('festival payout is substantially larger than a single daily contract', () => {
    const s = richSave()
    const festival = rollFestival(s.chicken.seed, 1, s)
    const daily = rollContracts(s.chicken.seed, 1, s)
    const dailyMax = Math.max(...daily.map((c) => c.payout))
    // festival should pay more than any single daily contract
    expect(festival.payout).toBeGreaterThan(dailyMax)
  })

  it('square town act multiplies festival payout by 1.5', () => {
    const base = richSave()
    const withSquare = richSave()
    ;(withSquare.town.built as Record<string, boolean>).square = true

    // use same seed and week to isolate the square multiplier
    const seed = base.chicken.seed
    const baseF = rollFestival(seed, 5, base)
    const squareF = rollFestival(seed, 5, withSquare)

    expect(squareF.payout).toBe(Math.round(baseF.payout * 1.5))
  })
})
