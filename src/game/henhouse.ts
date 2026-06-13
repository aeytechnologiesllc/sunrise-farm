/** The HENHOUSE model — the coop interior's economy truth. Pure module.
 *
 * Eggs TRICKLE: every owned hen has a named nesting box with her own seeded
 * lay timer (offset so the boxes never sync — the repo's interleave rule).
 * Walking past a ready box inside collects it with a GOLDEN roll per egg
 * (jackpot texture); the outside one-tap batch still collects every ready
 * box at flat value — additive bonus, never required (cozy law).
 *
 * Capacity is the room: 6 hens in the base house, 9 with the east wing,
 * 12 with the long wing — boarded partitions that visibly open on purchase
 * (the shell is built once; nothing rebuilds live). Buying past capacity
 * tells you to open the next wing first — the owner's exact ask. */
import { COOP_COIN_PER_HEN, COOP_TIME } from './produce'
import { mulberry32 } from './rng'

export interface HenDef {
  seed: number
  name: string
}

export interface NestBox {
  /** countdown to the next egg in this box, seconds */
  t: number
  ready: boolean
}

export interface CoopFlock {
  hens: HenDef[]
  /** 0 = base house (4), 1 = east wing (8), 2 = the long wing (12), 3 = the long roost (16) */
  tier: number
  boxes: NestBox[]
}

/** base house holds the founders plus two empty boxes (the crate gets to
 * SELL before it teaches expansion); wings take the row to 9, then 12,
 * then 16 with the Long Roost */
export const HEN_CAPACITY = [6, 9, 12, 16]
export const MAX_COOP_TIER = HEN_CAPACITY.length - 1
/** wing prices + the level that unlocks each (extends the ladder past 11) */
export const WING_COST = [350, 800, 2800]
export const WING_LEVEL = [12, 13, 18]
/** a new hen's price climbs with each purchase beyond the founding four */
export const HEN_BASE_COST = 120
export const HEN_COST_STEP = 30

export const HEN_POOL = [
  'Clementine', 'Biscuit', 'Pickles', 'Dottie', 'Maple', 'Ginger',
  'Pumpernickel', 'Olive', 'Tilly', 'Mabel', 'Sprout', 'Petunia',
  'Poppy', 'Saffron', 'Marigold', 'Juniper',
]

export function henCapacity(tier: number): number {
  return HEN_CAPACITY[Math.max(0, Math.min(MAX_COOP_TIER, tier))]
}

export function henCost(owned: number): number {
  // the founding four came with the coop; price climbs from the fifth on
  return HEN_BASE_COST + Math.max(0, owned - 4) * HEN_COST_STEP
}

/** seeded lay offset so the boxes trickle instead of clumping (±35%).
 * imul-mix the box index: a plain `seed ^ i*7919` cancels against the
 * founding flock's `seed + i*7919` hen seeds and SYNCS boxes 1 and 3 */
export function layTimeFor(boxIndex: number, seed: number): number {
  const rng = mulberry32((Math.imul(boxIndex + 1, 0x9e3779b1) ^ seed) >>> 0)
  return COOP_TIME * (0.65 + rng.next() * 0.7)
}

/** the founding flock for migration + fresh builds */
export function foundingFlock(seed: number, count = 4): CoopFlock {
  const rng = mulberry32(seed)
  const hens: HenDef[] = []
  for (let i = 0; i < count; i++) {
    hens.push({ seed: (seed + i * 7919) >>> 0, name: HEN_POOL[Math.floor(rng.next() * HEN_POOL.length)] })
  }
  // distinct names for the founders — swap duplicates forward
  const seen = new Set<string>()
  let cursor = 0
  for (const h of hens) {
    while (seen.has(h.name)) h.name = HEN_POOL[cursor++ % HEN_POOL.length]
    seen.add(h.name)
  }
  return {
    hens,
    tier: 0,
    boxes: hens.map((h, i) => ({ t: layTimeFor(i, h.seed), ready: false })),
  }
}

export interface HenhouseEvents {
  /** indices of boxes whose egg just became ready */
  readyBoxes: number[]
}

/** fixed-step: every box with a hen counts down toward its next egg */
export function tickHenhouse(f: CoopFlock, dt: number): HenhouseEvents {
  const ev: HenhouseEvents = { readyBoxes: [] }
  for (let i = 0; i < f.hens.length; i++) {
    const b = f.boxes[i]
    if (!b || b.ready) continue
    b.t = Math.max(0, b.t - dt)
    if (b.t === 0) {
      b.ready = true
      ev.readyBoxes.push(i)
    }
  }
  return ev
}

/** offline: each box completes AT MOST one egg (the one-cycle cap) */
export function catchUpHenhouse(f: CoopFlock, elapsed: number): number {
  let became = 0
  for (let i = 0; i < f.hens.length; i++) {
    const b = f.boxes[i]
    if (!b || b.ready) continue
    b.t = Math.max(0, b.t - elapsed)
    if (b.t === 0) {
      b.ready = true
      became++
    }
  }
  return became
}

/** collect ONE box (the inside walk-past). Restarts its timer. */
export function collectBox(f: CoopFlock, i: number): boolean {
  const b = f.boxes[i]
  if (!b?.ready || !f.hens[i]) return false
  b.ready = false
  b.t = layTimeFor(i, f.hens[i].seed)
  return true
}

/** collect EVERY ready box (the outside one-tap batch). Returns count. */
export function collectAllBoxes(f: CoopFlock): number {
  let n = 0
  for (let i = 0; i < f.boxes.length; i++) if (collectBox(f, i)) n++
  return n
}

export const EGG_BOX_COIN = COOP_COIN_PER_HEN

export type HenBuyBlock = 'ok' | 'capacity' | 'coins'

/** why a new hen can(not) join right now — capacity outranks coins (the
 * "expand the stable first" precedence, reused for the coop) */
export function henBuyStatus(f: CoopFlock, coins: number): HenBuyBlock {
  if (f.hens.length >= henCapacity(f.tier)) return 'capacity'
  if (coins < henCost(f.hens.length)) return 'coins'
  return 'ok'
}

export function buyHen(f: CoopFlock, seed: number): HenDef {
  const rng = mulberry32(seed)
  const taken = new Set(f.hens.map((h) => h.name))
  let name = HEN_POOL[Math.floor(rng.next() * HEN_POOL.length)]
  let cursor = 0
  while (taken.has(name) && cursor < HEN_POOL.length * 2) name = HEN_POOL[cursor++ % HEN_POOL.length]
  if (taken.has(name)) name = `Henny ${f.hens.length + 1}`
  const hen: HenDef = { seed, name }
  f.hens.push(hen)
  f.boxes.push({ t: layTimeFor(f.boxes.length, seed), ready: false })
  return hen
}

export type WingBuyBlock = 'ok' | 'max' | 'level' | 'coins'

export function wingStatus(f: CoopFlock, level: number, coins: number): WingBuyBlock {
  if (f.tier >= MAX_COOP_TIER) return 'max'
  if (level < WING_LEVEL[f.tier]) return 'level'
  if (coins < WING_COST[f.tier]) return 'coins'
  return 'ok'
}

export function openWing(f: CoopFlock): boolean {
  if (f.tier >= MAX_COOP_TIER) return false
  f.tier += 1
  return true
}
