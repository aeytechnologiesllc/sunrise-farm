/** DECORATION catalog — repeatable cosmetic items the player buys and
 * places on the farm.  Pure module (no three/DOM/Date/Math.random). */
import { WORLD_BOUNDS } from './geo'
import { pointInBuilding } from './layout'
import type { GameState } from './state'

export type DecorId =
  | 'flowerbed'
  | 'planter'
  | 'bench'
  | 'lamppost'
  | 'birdbath'
  | 'flagpole'
  | 'beehive'
  | 'sapling'
  | 'topiary'
  | 'wellpump'

export interface DecorDef {
  id: DecorId
  name: string
  emoji: string
  cost: number
  level: number
  blurb: string
}

/** one placed decoration.  `d` = state.day when placed (saplings grow over days) */
export interface DecorPlacement {
  item: DecorId
  x: number
  z: number
  rot: number
  d: number
}

/** the catalog, cheapest first */
export const DECOR: DecorDef[] = [
  { id: 'flowerbed', name: 'Flower Bed',    emoji: '🌷', cost:  150, level:  8, blurb: 'A burst of tulips' },
  { id: 'planter',   name: 'Clay Planter',  emoji: '🪴', cost:  220, level:  8, blurb: 'Herbs in a terracotta pot' },
  { id: 'sapling',   name: 'Young Sapling', emoji: '🌱', cost:  300, level:  9, blurb: 'Plant it small — it grows' },
  { id: 'birdbath',  name: 'Bird Bath',     emoji: '🐦', cost:  420, level: 10, blurb: 'Songbirds drop by' },
  { id: 'bench',     name: 'Garden Bench',  emoji: '🪑', cost:  500, level: 10, blurb: 'A spot to rest' },
  { id: 'lamppost',  name: 'Lamp Post',     emoji: '🏮', cost:  650, level: 12, blurb: 'A warm glow at dusk' },
  { id: 'topiary',   name: 'Topiary',       emoji: '🌳', cost:  800, level: 13, blurb: 'A neatly clipped shrub' },
  { id: 'beehive',   name: 'Bee Hive',      emoji: '🐝', cost:  900, level: 14, blurb: 'Busy little neighbours' },
  { id: 'flagpole',  name: 'Flag Pole',     emoji: '🚩', cost: 1000, level: 15, blurb: "Fly the farm's colours" },
  { id: 'wellpump',  name: 'Old Well',      emoji: '⛲', cost: 1200, level: 16, blurb: 'A stone wishing well' },
]

/** maximum decorations on the farm at once */
export const DECOR_MAX = 24

/** look up a catalog entry by id (throws on unknown id) */
export function decorDef(id: DecorId): DecorDef {
  const d = DECOR.find((d) => d.id === id)
  if (!d) throw new Error(`Unknown DecorId: ${id}`)
  return d
}

/** minimum gap required between any two placed decorations (world units) */
export const DECOR_CLEAR = 0.9

export interface DecorCheck {
  ok: boolean
  reason?: 'far' | 'occupied' | 'full'
}

/** May a new decoration be placed at (x, z)?
 *
 * Rules (in priority order):
 *  1. 'full'     — the farm already has DECOR_MAX decorations.
 *  2. 'far'      — outside WORLD_BOUNDS inset by 1 (exact mirror of
 *                  layout.ts canPlace reach guard — the player must be
 *                  able to walk up to it).
 *  3. 'occupied' — hypot to any existing decoration < DECOR_CLEAR.
 *  4. ok         — anything else (cosmetics don't collide with structures).
 *
 * Safe when s.decor is undefined (treat as empty). */
export function canPlaceDecor(s: GameState, x: number, z: number): DecorCheck {
  const placed = (s as GameState & { decor?: DecorPlacement[] }).decor ?? []

  if (placed.length >= DECOR_MAX) return { ok: false, reason: 'full' }

  if (
    x < WORLD_BOUNDS.minX + 1 ||
    x > WORLD_BOUNDS.maxX - 1 ||
    z < WORLD_BOUNDS.minZ + 1 ||
    z > WORLD_BOUNDS.maxZ - 1
  ) {
    return { ok: false, reason: 'far' }
  }

  for (const p of placed) {
    if (Math.hypot(x - p.x, z - p.z) < DECOR_CLEAR) return { ok: false, reason: 'occupied' }
  }

  // no planting a bench inside the coop: respect building/pen/paddock footprints
  if (pointInBuilding(s, x, z)) return { ok: false, reason: 'occupied' }

  return { ok: true }
}
