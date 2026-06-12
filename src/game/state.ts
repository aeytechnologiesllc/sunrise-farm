/** Save-state shape, serialization, and offline catch-up. Pure module. */
import type { CropKind } from './economy'
import { clampTier, plotCount } from './expansion'
import { ringEdges, type FenceState } from './fence'
import { catchUpHenhouse, foundingFlock, type CoopFlock } from './henhouse'
import type { LayoutState } from './layout'
import { initialProduce, tickProduce, type Produce } from './produce'
import { GREENHOUSE_BEDS } from './projects'

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
  tomatoes: number
  peppers: number
  eggplants: number
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
  /** save knows Hazel is a SEPARATE purchase from the stable (pre-split
   * saves get her grandfathered exactly once — their stable included her) */
  horseSplit: boolean
  /** which day of farm life this is (sleep ritual advances it) */
  day: number
  /** totals at dawn — the goodnight scene shows today's tally against these */
  dayStart: { coins: number; harvests: number; eggs: number }
  /** where the sun was when last saved (0..1; reload resumes the same hour) */
  dayPhase: number
  /** wool/milk/delivery production timers (see game/produce.ts) */
  produce: Produce
  /** lifetime deliveries — seeds WHO in Millbrook buys each load */
  deliveriesSent: number
  /** session cooldowns that must survive reload (anti reload-exploit) */
  timers: { sow: number; fetch: number; herd: number }
  plots: PlotState[]
  /** greenhouse planters — separate array so land expansions never reindex */
  ghPlots: PlotState[]
  /** where moved buildings stand — SPARSE: only moved ones appear, so old
   * clients render defaults and future default tweaks reach non-movers */
  layout: LayoutState
  /** every fence edge on the farm, the player's to redraw (free). Absence
   * in an old save = unmigrated: the authored tier ring converts on load. */
  fences: FenceState
  /** the henhouse: named hens, their nesting boxes, the wing tier. Eggs
   * trickle per-box (the interior's truth model). */
  coopFlock: CoopFlock
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
    tomatoes: 0,
    peppers: 0,
    eggplants: 0,
    eggs: 0,
    xp: 0,
    level: 1,
    harvests: 0,
    expansion: 0,
    herdsDone: 0,
    projects: {},
    ladder: true,
    horseSplit: true,
    day: 1,
    dayStart: { coins: 0, harvests: 0, eggs: 0 },
    dayPhase: 0.32,
    produce: initialProduce(),
    deliveriesSent: 0,
    timers: { sow: 0, fetch: 0, herd: 45 },
    plots: Array.from({ length: PLOT_COUNT }, () => ({ crop: null })),
    ghPlots: [],
    layout: {},
    fences: ringEdges(0),
    coopFlock: foundingFlock((seed ^ 0xc00b) >>> 0),
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
  /** Hazel finished her run while the app was closed (flat 34c was banked) —
   * the welcome-back banner should SAY so instead of paying silently */
  offlineDelivery: boolean
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
  let offlineDelivery = false
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
  // the henhouse boxes trickle while away too (one egg per box, capped)
  if (s.coopFlock && s.projects?.coop === true) catchUpHenhouse(s.coopFlock, el)
  // production keeps running while away; a delivery that finished offline
  // pays out flat (no seeded roll for absentee landlords)
  if (s.produce) {
    const ev = tickProduce(s.produce, el, {
      sheep: s.projects?.sheep === true,
      goats: s.projects?.goats === true,
      // the produce gate keeps its historical key name, but deliveries need
      // HAZEL, not the building — the stable and the horse are separate buys
      stable: s.projects?.horse === true,
    })
    if (ev.deliveryReturned) {
      s.coins += 34
      offlineDelivery = true
    }
  }
  return { readyPlots, eggBecameReady, offlineDelivery }
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
    s.tomatoes ??= 0
    s.peppers ??= 0
    s.eggplants ??= 0
    s.eggs ??= 0
    s.expansion = clampTier(s.expansion ?? 0)
    s.herdsDone ??= 0
    s.projects ??= {}
    s.ghPlots ??= []
    s.layout ??= {}
    // one-time fence migration: the authored picket ring becomes player
    // fence (its presence IS the migrated flag)
    s.fences ??= ringEdges(clampTier(s.expansion ?? 0))
    // henhouse migration: the founding four get boxes; a pending batch from
    // the OLD single-latch coop becomes ready boxes (nobody loses eggs)
    if (!s.coopFlock) {
      s.coopFlock = foundingFlock(((s.chicken?.seed ?? 1) ^ 0xc00b) >>> 0)
      if (s.produce?.eggsReady) for (const b of s.coopFlock.boxes) b.ready = true
    }
    // the glasshouse grew from 4 beds to 8 — owners get the new beds on load
    if (s.projects.greenhouse) while (s.ghPlots.length < GREENHOUSE_BEDS) s.ghPlots.push({ crop: null })
    // grandfather PRE-LADDER saves exactly once: they already had the stand
    // + the flock (new saves carry ladder:true from birth and earn theirs)
    if (!s.ladder) {
      s.ladder = true
      if (s.harvests > 0) {
        s.projects.stand ??= true
        s.projects.sheep ??= true
      }
    }
    // grandfather PRE-SPLIT saves exactly once: their stable project shipped
    // WITH the horse, so owning it means Hazel is already home — grant the
    // new separate horse project for free. The flag (true from birth on new
    // saves) is what guards fresh saves: a NEW player who built the stable
    // but has not bought Hazel yet must NOT be gifted her on reload.
    if (!s.horseSplit) {
      s.horseSplit = true
      if (s.projects.stable) s.projects.horse = true
    }
    s.day ??= 1
    // older saves never tracked a dawn ledger — start counting from "now"
    s.dayStart ??= { coins: s.coins, harvests: s.harvests, eggs: s.chicken?.eggsLaid ?? 0 }
    s.dayPhase ??= 0.32
    s.produce ??= initialProduce()
    // older produce objects predate the coop eggs
    s.produce.eggsT ??= 150
    s.produce.eggsReady ??= false
    s.deliveriesSent ??= 0
    // seasoned saves resume mission cadence at the REAL cooldown, not the
    // friendly first-time delay (reloading must never speed up payouts)
    s.timers ??= { sow: 0, fetch: 0, herd: s.harvests > 0 ? 150 : 45 }
    while (s.plots.length < plotCount(s.expansion)) s.plots.push({ crop: null })
    return s
  } catch {
    return null
  }
}
