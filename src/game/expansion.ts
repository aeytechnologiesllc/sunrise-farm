/** Land progression — the farm physically GROWS as you invest.
 * Pure module (no three/DOM imports): tier definitions, cumulative plot
 * positions, fence rectangles and gates per tier. World code (scenery/field)
 * and Game actions both derive from this single table; unit-tested. */

export interface FieldRect {
  x0: number
  z0: number
  x1: number
  z1: number
}

export interface GateDef {
  /** which fence wall the opening sits on */
  wall: 'N' | 'S' | 'E' | 'W'
  /** center along the wall (x for N/S walls, z for E/W walls) */
  center: number
  half: number
}

export interface FenceRect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface TierDef {
  name: string
  /** story beat shown on the purchase banner */
  flavor: string
  cost: number
  /** player level required before the deed can be bought */
  level: number
  field: FieldRect | null
  /** plot centers ADDED by this tier */
  plots: Array<[number, number]>
  fence: FenceRect
  gates: GateDef[]
  /** where the FOR-SALE sign for buying THIS tier stands (null = base tier) */
  sign: [number, number] | null
  /** true when this deed unlocks the tractor */
  tractor?: boolean
  /** sheep ADDED to the flock by this tier */
  sheep?: number
}

const SOUTH_GATE: GateDef = { wall: 'S', center: 0.9, half: 1.7 }
const WEST_GATE: GateDef = { wall: 'W', center: 3.2, half: 1.5 }

export const TIERS: TierDef[] = [
  {
    name: 'Sunrise Farm',
    flavor: 'Home sweet home.',
    cost: 0,
    level: 1,
    field: { x0: 0.2, z0: -0.8, x1: 5.8, z1: 4.8 },
    plots: [
      [1.6, 0.6],
      [4.4, 0.6],
      [1.6, 3.4],
      [4.4, 3.4],
    ],
    fence: { minX: -8.4, maxX: 8.2, minZ: -3.4, maxZ: 10.2 },
    gates: [SOUTH_GATE, WEST_GATE],
    sign: null,
  },
  {
    name: 'The East Meadow',
    flavor: "Grandpa's old wheat meadow is yours again.",
    cost: 150,
    level: 3,
    field: { x0: 9.2, z0: -0.5, x1: 14.5, z1: 4.9 },
    plots: [
      [10.3, 0.7],
      [13.0, 0.7],
      [10.3, 3.5],
      [13.0, 3.5],
    ],
    fence: { minX: -8.4, maxX: 15.0, minZ: -3.4, maxZ: 10.2 },
    gates: [SOUTH_GATE, WEST_GATE],
    sign: [7.4, 2.2],
  },
  {
    name: 'The North Acres',
    flavor: 'Real acreage — and the old tractor still runs!',
    cost: 400,
    level: 5,
    field: { x0: -1.4, z0: -8.3, x1: 7.0, z1: -4.5 },
    plots: [
      [0.2, -6.4],
      [2.9, -6.4],
      [5.6, -6.4],
    ],
    fence: { minX: -8.4, maxX: 15.0, minZ: -9.0, maxZ: 10.2 },
    gates: [SOUTH_GATE, WEST_GATE],
    sign: [1.2, -2.5],
    tractor: true,
  },
  {
    name: 'The Old Pasture',
    flavor: 'The flock doubles — Rex has never been prouder.',
    cost: 900,
    level: 7,
    field: { x0: -14.0, z0: -2.9, x1: -10.6, z1: 2.2 },
    plots: [
      [-12.3, -1.55],
      [-12.3, 0.95],
    ],
    fence: { minX: -15.2, maxX: 15.0, minZ: -9.0, maxZ: 10.2 },
    gates: [SOUTH_GATE, { wall: 'W', center: 5.2, half: 1.6 }],
    sign: [-7.4, 5.6],
    sheep: 2,
  },
]

export const MAX_TIER = TIERS.length - 1

/** sheep pen (outside the picket ring until tier 3 fences it in) */
export const PEN = { x0: -14.4, z0: 2.8, x1: -10.2, z1: 7.8, gate: { z0: 4.7, z1: 6.1 } }

export function clampTier(tier: number): number {
  return Math.max(0, Math.min(MAX_TIER, Math.floor(tier)))
}

/** cumulative plot centers unlocked at `tier` */
export function plotPositions(tier: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let t = 0; t <= clampTier(tier); t++) out.push(...TIERS[t].plots)
  return out
}

export function plotCount(tier: number): number {
  return plotPositions(tier).length
}

export function fenceFor(tier: number): FenceRect {
  return TIERS[clampTier(tier)].fence
}

export function gatesFor(tier: number): GateDef[] {
  return TIERS[clampTier(tier)].gates
}

/** field rects unlocked at `tier` */
export function fieldRects(tier: number): FieldRect[] {
  const out: FieldRect[] = []
  for (let t = 0; t <= clampTier(tier); t++) {
    const f = TIERS[t].field
    if (f) out.push(f)
  }
  return out
}

/** EVERY tier's field rect — grass never grows where soil will ever be */
export function allFieldRects(): FieldRect[] {
  return fieldRects(MAX_TIER)
}

/** next purchasable tier def, or null at max */
export function nextTier(tier: number): TierDef | null {
  return tier >= MAX_TIER ? null : TIERS[tier + 1]
}

export function inRect(x: number, z: number, r: FieldRect, pad = 0): boolean {
  return x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad
}

/** total sheep in the flock at `tier` */
export function sheepCount(tier: number): number {
  let n = 3
  for (let t = 1; t <= clampTier(tier); t++) n += TIERS[t].sheep ?? 0
  return n
}
