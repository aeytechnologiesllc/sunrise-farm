/** Economy constants and pure math. No three/DOM imports — unit-tested. */
import type { Rng } from './rng'

export type CropKind = 'wheat' | 'corn'

export interface CropDef {
  label: string
  growSec: number
  sell: number
  unlockLevel: number
}

export const CROPS: Record<CropKind, CropDef> = {
  wheat: { label: 'Wheat', growSec: 90, sell: 2, unlockLevel: 1 },
  corn: { label: 'Corn', growSec: 240, sell: 5, unlockLevel: 2 },
}

export const GOLDEN_CROP_CHANCE = 0.08
export const GOLDEN_MULT = 4
export const EGG_SELL = 8
/** first two eggs hatch fast (FTUE), then the real cadence */
export const EGG_TIME_FTUE = 180
export const EGG_TIME = 900
export const FTUE_EGG_COUNT = 2
export const GOLDEN_EGG_BASE = 0.08
export const HEART_GOLDEN_BONUS = 0.1
export const GOLDEN_EGG_CAP = 0.5

export const XP_GAIN = {
  plant: 2,
  harvest: 5,
  feed: 3,
  collectEgg: 6,
  pet: 4,
  serve: 6,
  expand: 25,
  herd: 18,
  fetch: 2,
  shear: 4,
  milk: 4,
  deliver: 8,
  sleep: 10,
} as const

// ---- land + missions -------------------------------------------------------
/** tractor "sow everything" cooldown (seconds) */
export const TRACTOR_COOLDOWN = 75
/** coins per sheep brought home */
export const HERD_COIN_PER_SHEEP = 12
/** herding mission cadence (seconds between escapes) */
export const HERD_COOLDOWN: [number, number] = [150, 240]
/** first escape happens soon after the hen settles in */
export const HERD_FIRST_DELAY: [number, number] = [35, 55]
/** stick-fetch: chance Rex digs up a little treasure on the return */
export const FETCH_TREASURE_CHANCE = 0.22
export const FETCH_TREASURE: [number, number] = [2, 6]

// ---- customers (roadside stand) ------------------------------------------
/** what a customer can ask for; eggs only exist once the hen is laying */
export type GoodKind = CropKind | 'egg'

export const GOOD_SELL: Record<GoodKind, number> = { wheat: 2, corn: 5, egg: 8 }
/** customers pay a premium over auto-sell — additive bonus, never required */
export const CUSTOMER_PREMIUM = 1.6
export const CUSTOMER_TIP_RATE = 0.3
export const CUSTOMER_QUEUE_MAX = 2
/** spawn cadence: first visit comes quick, then a relaxed 60-120s rhythm */
export const CUSTOMER_FIRST_DELAY: [number, number] = [18, 30]
export const CUSTOMER_DELAY: [number, number] = [60, 120]

export function offerFor(kind: GoodKind, count: number, premium = CUSTOMER_PREMIUM): number {
  return Math.ceil(GOOD_SELL[kind] * count * premium)
}

export function tipFor(offer: number): number {
  return Math.max(1, Math.round(offer * CUSTOMER_TIP_RATE))
}

/** XP needed to clear the given level (level 1 -> 20, 2 -> 30, ...) */
export function xpNeeded(level: number): number {
  return 10 + level * 10
}

export function sellValue(kind: CropKind, golden: boolean): number {
  return CROPS[kind].sell * (golden ? GOLDEN_MULT : 1)
}

export function eggValue(golden: boolean): number {
  return EGG_SELL * (golden ? GOLDEN_MULT : 1)
}

/** hearts only ever add chance; capped, never gates the base reward */
export function goldenEggChance(hearts: number): number {
  return Math.min(GOLDEN_EGG_BASE + HEART_GOLDEN_BONUS * hearts, GOLDEN_EGG_CAP)
}

export function eggTimerFor(eggsLaid: number): number {
  return eggsLaid < FTUE_EGG_COUNT ? EGG_TIME_FTUE : EGG_TIME
}

export function rollGolden(rng: Rng, chance: number): boolean {
  return rng.next() < chance
}

/** Sprite count for the coin fountain: 8..15, scaled by grant size. */
export function fountainCount(total: number): number {
  return Math.max(8, Math.min(15, total))
}

/** Split `total` coins into `parts` non-negative integers that sum EXACTLY
 * to total. Remainder goes to the earliest sprites so ticks front-load. */
export function splitCoins(total: number, parts: number): number[] {
  const base = Math.floor(total / parts)
  const rem = total - base * parts
  const out: number[] = []
  for (let i = 0; i < parts; i++) out.push(base + (i < rem ? 1 : 0))
  return out
}
