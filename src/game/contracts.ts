/** CONTRACTS — the daily order board in Millbrook town. Pure module.
 *
 * Each day, sponsors post 3 (or 4 once the station exists) orders:
 * "deliver 12 corn", "8 eggs", "5 wool" — finishing pays a coin bonus.
 * A weekly festival order is the evergreen money-sink on top.
 *
 * No three/DOM imports, no Date, no Math.random — determinism is law here. */

import { CROPS } from './economy'
import { EGG_SELL } from './economy'
import { mulberry32 } from './rng'
import { WOOL_COIN_PER_SHEEP, MILK_COIN_PER_GOAT } from './produce'
import type { GameState } from './state'

// ---------- public types ----------------------------------------------------

export type ContractGood = 'wheat' | 'corn' | 'tomato' | 'pepper' | 'eggplant' | 'egg' | 'wool' | 'milk'

export interface Contract {
  good: ContractGood
  qty: number
  payout: number
  sponsor: string
}

export interface FestivalOrder {
  goods: { good: ContractGood; qty: number }[]
  payout: number
}

// ---------- slot count -------------------------------------------------------

/** 3 slots normally; 4 once the station town act is built (not yet in TownActId
 * — guard with a string-key optional lookup so tsc stays happy). */
export function contractSlots(s: GameState): number {
  const built = s.town.built as Record<string, boolean | undefined>
  return built.station === true ? 4 : 3
}

// ---------- base values ------------------------------------------------------

/** The economic base for payout math. Exported for tests and Game.ts reuse. */
export function goodBaseValue(good: ContractGood): number {
  switch (good) {
    case 'wheat':    return CROPS.wheat.sell
    case 'corn':     return CROPS.corn.sell
    case 'tomato':   return CROPS.tomato.sell
    case 'pepper':   return CROPS.pepper.sell
    case 'eggplant': return CROPS.eggplant.sell
    case 'egg':      return EGG_SELL
    case 'wool':     return WOOL_COIN_PER_SHEEP
    case 'milk':     return MILK_COIN_PER_GOAT
  }
}

// ---------- eligibility ------------------------------------------------------

/** Which goods the player can actually produce on this save. */
function eligibleGoods(s: GameState): ContractGood[] {
  const out: ContractGood[] = []

  // crops: gate on unlockLevel — AND, for the glasshouse-only crops, on actually
  // owning the greenhouse. Otherwise a level-9 player without the greenhouse gets
  // "deliver 6 tomatoes" orders they physically cannot fulfil (dead slots).
  const cropGoods: ContractGood[] = ['wheat', 'corn', 'tomato', 'pepper', 'eggplant']
  for (const g of cropGoods) {
    const cropKey = g as keyof typeof CROPS
    if (CROPS[cropKey].unlockLevel > s.level) continue
    if (CROPS[cropKey].greenhouse && s.projects.greenhouse !== true) continue
    out.push(g)
  }

  // egg: coop project OR solo hen has arrived
  if (s.projects.coop === true || (s.chicken && s.chicken.arrived)) out.push('egg')

  // wool: sheep project
  if (s.projects.sheep === true) out.push('wool')

  // milk: goats project
  if (s.projects.goats === true) out.push('milk')

  return out
}

// ---------- qty/payout helpers -----------------------------------------------

/** Base quantity range per good category. */
function baseQtyRange(good: ContractGood): [number, number] {
  if (good === 'egg') return [4, 8]
  if (good === 'wool' || good === 'milk') return [3, 6]
  return [6, 14] // crops
}

/** Roll a qty from [lo, hi] inclusive, scaled by level. */
function rollQty(rng: ReturnType<typeof mulberry32>, good: ContractGood, level: number): number {
  const [lo, hi] = baseQtyRange(good)
  const base = lo + Math.floor(rng.next() * (hi - lo + 1))
  const scaled = base * (1 + level / 25)
  return Math.max(1, Math.round(scaled))
}

/** Premium factor for payout. */
function premium(level: number): number {
  return 1.6 + Math.min(1.2, level * 0.03)
}

// ---------- sponsor flavor ---------------------------------------------------

const SPONSOR_ALWAYS = ['a friendly neighbor', 'the market 🛒', 'the travelling merchant', 'the harvest co-op']

const SPONSOR_BY_ACT: Array<{ act: string; label: string }> = [
  { act: 'bakery',   label: "Rosie's Bakery 🥖" },
  { act: 'cottages', label: 'the Cottagers 🏡' },
  { act: 'school',   label: "Miss Hart's class 🏫" },
  { act: 'works',    label: 'the Wool Works 🧶' },
]

function buildSponsorPool(s: GameState): string[] {
  const built = s.town.built as Record<string, boolean | undefined>
  const pool = [...SPONSOR_ALWAYS]
  for (const { act, label } of SPONSOR_BY_ACT) {
    if (built[act] === true) pool.push(label)
  }
  return pool
}

function pickSponsor(rng: ReturnType<typeof mulberry32>, pool: string[]): string {
  return pool[Math.floor(rng.next() * pool.length)]
}

// ---------- rollContracts ----------------------------------------------------

/** Return contractSlots(s) deterministic daily contracts for (seedBase, day).
 * seedBase = state.chicken.seed (the per-save integer). */
export function rollContracts(seedBase: number, day: number, s: GameState): Contract[] {
  const seed = (((day * 73856093) ^ (seedBase * 19349663) ^ 0x0c0ffee) >>> 0)
  const rng = mulberry32(seed)

  const slots = contractSlots(s)
  const eligible = eligibleGoods(s)
  const lvl = s.level
  const prem = premium(lvl)
  const sponsorPool = buildSponsorPool(s)

  const contracts: Contract[] = []

  for (let i = 0; i < slots; i++) {
    // pick a good: prefer distinct, fall back to wheat
    let good: ContractGood
    const usedGoods = contracts.map((c) => c.good)
    const fresh = eligible.filter((g) => !usedGoods.includes(g))

    if (fresh.length > 0) {
      good = fresh[Math.floor(rng.next() * fresh.length)]
    } else if (eligible.length > 0) {
      // repeats allowed when pool exhausted
      good = eligible[Math.floor(rng.next() * eligible.length)]
    } else {
      // absolute fallback: wheat is always produceable at level 1
      good = 'wheat'
    }

    const isStationSlot = i === 3 // 4th slot is a freight order
    const rawQty = rollQty(rng, good, lvl)
    const qty = isStationSlot ? rawQty * 2 : rawQty
    const slotPrem = isStationSlot ? prem + 0.4 : prem
    const payout = Math.round(qty * goodBaseValue(good) * slotPrem)
    const sponsor = pickSponsor(rng, sponsorPool)

    contracts.push({ good, qty, payout, sponsor })
  }

  return contracts
}

// ---------- rollFestival -----------------------------------------------------

/** Return a weekly festival order deterministic for (seedBase, week).
 * Only meaningful once cottages are built, but the fn is pure — caller checks. */
export function rollFestival(seedBase: number, week: number, s: GameState): FestivalOrder {
  const seed = (((week * 73856093) ^ (seedBase * 19349663) ^ 0xfe57) >>> 0)
  const rng = mulberry32(seed)

  const eligible = eligibleGoods(s)
  const lvl = s.level
  const prem = premium(lvl)

  // 2 or 3 goods
  const count = 2 + Math.floor(rng.next() * 2) // 2..3
  const goods: { good: ContractGood; qty: number }[] = []

  for (let i = 0; i < count; i++) {
    const used = goods.map((g) => g.good)
    const fresh = eligible.filter((g) => !used.includes(g))
    let good: ContractGood
    if (fresh.length > 0) {
      good = fresh[Math.floor(rng.next() * fresh.length)]
    } else if (eligible.length > 0) {
      good = eligible[Math.floor(rng.next() * eligible.length)]
    } else {
      good = 'wheat'
    }

    // festival qty ≈ 1.5× a daily qty
    const [lo, hi] = baseQtyRange(good)
    const base = lo + Math.floor(rng.next() * (hi - lo + 1))
    const scaled = base * (1 + lvl / 25) * 1.5
    const qty = Math.max(1, Math.round(scaled))

    goods.push({ good, qty })
  }

  // payout = round(sum(per-good qty*base*premium) * 1.8), optionally *1.5 if square
  const rawPayout = goods.reduce((sum, { good, qty }) => sum + qty * goodBaseValue(good) * prem, 0)
  let payout = Math.round(rawPayout * 1.8)

  // town square bonus — 'square' may not be a TownActId yet; use safe lookup
  if ((s.town.built as Record<string, boolean | undefined>).square === true) {
    payout = Math.round(payout * 1.5)
  }

  return { goods, payout }
}
