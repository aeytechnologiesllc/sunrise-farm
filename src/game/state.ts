/** Save-state shape, serialization, and offline catch-up. Pure module. */
import type { CropKind } from './economy'
import { clampTier, plotCount } from './expansion'
import { initialProduce, tickProduce, type Produce } from './produce'

export interface CropState {
  kind: CropKind
  total: number
  remaining: number
  /** one-shot flags so chime/shimmer fire once per crop */
  chimed: boolean
}

export interface PlotState {
  crop: CropState | null
}

export interface EggTimer {
  total: number
  remaining: number
}

export interface ChickenState {
  arrived: boolean
  /** null until the mandatory naming ceremony completes */
  name: string | null
  seed: number
  hearts: number
  lastPetDay: string | null
  eggTimer: EggTimer | null
  eggReady: boolean
  eggsLaid: number
}

export type ChipId = 'plant' | 'harvest' | 'feed' | 'collect' | 'pet'

export interface GameState {
  v: 1
  coins: number
  /** harvested wheat kept as feed + stand stock (auto-sell still pays coins) */
  wheat: number
  /** stand stock for customers — banked on harvest/collect, additive bonus */
  corn: number
  eggs: number
  xp: number
  level: number
  harvests: number
  /** land tier owned (see game/expansion.ts); plots length tracks it */
  expansion: number
  /** completed herding missions (reward scaling + story beats) */
  herdsDone: number
  /** construction projects owned (see game/projects.ts) */
  projects: Partial<Record<string, boolean>>
  /** save knows the start-from-scratch ladder (pre-ladder saves get
   * grandfathered exactly once) */
  ladder: boolean
  /** which day of farm life this is (sleep ritual advances it) */
  day: number
  /** wool/milk/delivery production timers (see game/produce.ts) */
  produce: Produce
  plots: PlotState[]
  /** greenhouse planters — separate array so land expansions never reindex */
  ghPlots: PlotState[]
  chicken: ChickenState
  chipsDone: Record<ChipId, boolean>
  rng: number
  savedAt: number
}

export const PLOT_COUNT = 4
export const SAVE_KEY = 'sunrise-farm-v1'

export function initialState(seed: number): GameState {
  return {
    v: 1,
    coins: 0,
    wheat: 0,
    corn: 0,
    eggs: 0,
    xp: 0,
    level: 1,
    harvests: 0,
    expansion: 0,
    herdsDone: 0,
    projects: {},
    ladder: true,
    day: 1,
    produce: initialProduce(),
    plots: Array.from({ length: PLOT_COUNT }, () => ({ crop: null })),
    ghPlots: [],
    chicken: {
      arrived: false,
      name: null,
      seed: (seed * 2654435761) >>> 0,
      hearts: 0,
      lastPetDay: null,
      eggTimer: null,
      eggReady: false,
      eggsLaid: 0,
    },
    chipsDone: { plant: false, harvest: false, feed: false, collect: false, pet: false },
    rng: seed >>> 0,
    savedAt: Date.now(),
  }
}

export interface CatchUpResult {
  readyPlots: number[]
  eggBecameReady: boolean
}

/** Advance timers by elapsed real seconds. Each timer completes at most
 * once (none auto-restart), which is the "one full cycle" cap. */
export function catchUp(s: GameState, elapsedSec: number): CatchUpResult {
  const el = Math.max(0, elapsedSec)
  const readyPlots: number[] = []
  // combined index space: field plots first, then greenhouse planters
  const all = [...s.plots, ...(s.ghPlots ?? [])]
  for (let i = 0; i < all.length; i++) {
    const crop = all[i].crop
    if (!crop || crop.remaining <= 0) continue
    crop.remaining = Math.max(0, crop.remaining - el)
    if (crop.remaining <= 0) readyPlots.push(i)
  }
  let eggBecameReady = false
  const t = s.chicken.eggTimer
  if (t && t.remaining > 0) {
    t.remaining = Math.max(0, t.remaining - el)
    if (t.remaining <= 0) {
      s.chicken.eggTimer = null
      s.chicken.eggReady = true
      s.chicken.eggsLaid += 1
      eggBecameReady = true
    }
  }
  // production keeps running while away; a delivery that finished offline
  // pays out flat (no seeded roll for absentee landlords)
  if (s.produce) {
    const ev = tickProduce(s.produce, el, {
      sheep: s.projects?.sheep === true,
      goats: s.projects?.goats === true,
      stable: s.projects?.stable === true,
    })
    if (ev.deliveryReturned) s.coins += 34
  }
  return { readyPlots, eggBecameReady }
}

export function serialize(s: GameState): string {
  return JSON.stringify({ ...s, savedAt: Date.now() })
}

export function deserialize(json: string | null): GameState | null {
  if (!json) return null
  try {
    const s = JSON.parse(json) as GameState
    if (s.v !== 1 || !Array.isArray(s.plots)) return null
    // backfill fields added after first ship (saves stay v1-compatible)
    s.corn ??= 0
    s.eggs ??= 0
    s.expansion = clampTier(s.expansion ?? 0)
    s.herdsDone ??= 0
    s.projects ??= {}
    s.ghPlots ??= []
    // grandfather PRE-LADDER saves exactly once: they already had the stand
    // + the flock (new saves carry ladder:true from birth and earn theirs)
    if (!s.ladder) {
      s.ladder = true
      if (s.harvests > 0) {
        s.projects.stand ??= true
        s.projects.sheep ??= true
      }
    }
    s.day ??= 1
    s.produce ??= initialProduce()
    while (s.plots.length < plotCount(s.expansion)) s.plots.push({ crop: null })
    return s
  } catch {
    return null
  }
}
