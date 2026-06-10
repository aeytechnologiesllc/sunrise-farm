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

export const XP_GAIN = { plant: 2, harvest: 5, feed: 3, collectEgg: 6, pet: 4 } as const

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
