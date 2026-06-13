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
  /** dig-ceremony site for deeds whose land is NOT a crop field (e.g. the
   * crossroad lot) — world code stakes the ceremony here instead of a field */
  lot?: [number, number]
  /** true when this deed unlocks the tractor */
  tractor?: boolean
  /** sheep ADDED to the flock by this tier */
  sheep?: number
}

/** the south fence gate — exported because the customer path, Hazel's road
 * waypoint, and the worn footpath all aim at THIS opening (it belongs to the
 * fence, not to wherever the stand happens to stand) */
export const SOUTH_GATE: GateDef = { wall: 'S', center: 0.9, half: 1.7 }
const WEST_GATE: GateDef = { wall: 'W', center: 3.2, half: 1.5 }
/** wider west opening once the pasture deed frees the west lot (tier 3+) */
const PASTURE_WEST_GATE: GateDef = { wall: 'W', center: 5.2, half: 1.6 }

/** The farm grows ONE direction: each field deed joins the previous field
 * edge-to-edge heading east (field.x1 of a tier === field.x0 of the next).
 * Structures live on the WEST side; the final deed is a bare lot ACROSS the
 * road (south, z >= 13) for the farm shop. */
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
    flavor: "Grandpa's meadow joins the home field — four more plots in one long run of soil.",
    cost: 100,
    level: 3,
    field: { x0: 5.8, z0: -0.8, x1: 11.4, z1: 4.8 },
    plots: [
      [7.2, 0.6],
      [10.0, 0.6],
      [7.2, 3.4],
      [10.0, 3.4],
    ],
    fence: { minX: -8.4, maxX: 12.2, minZ: -3.4, maxZ: 10.2 },
    gates: [SOUTH_GATE, WEST_GATE],
    sign: [7.0, 2.2],
  },
  {
    name: 'The Far East Field',
    flavor: 'Four more plots east — and the old tractor still runs!',
    cost: 280,
    level: 5,
    field: { x0: 11.4, z0: -0.8, x1: 17.0, z1: 4.8 },
    plots: [
      [12.8, 0.6],
      [15.6, 0.6],
      [12.8, 3.4],
      [15.6, 3.4],
    ],
    fence: { minX: -8.4, maxX: 17.8, minZ: -3.4, maxZ: 10.2 },
    gates: [SOUTH_GATE, WEST_GATE],
    sign: [13.0, 2.2],
    tractor: true,
  },
  {
    name: 'The Old Pasture',
    flavor: 'The flock grows by two — and out west there is room for a stable now.',
    cost: 480,
    level: 6,
    field: { x0: 17.0, z0: -0.8, x1: 19.8, z1: 4.8 },
    plots: [
      [18.4, 0.6],
      [18.4, 3.4],
    ],
    fence: { minX: -15.2, maxX: 20.6, minZ: -9.0, maxZ: 10.2 },
    gates: [SOUTH_GATE, PASTURE_WEST_GATE],
    sign: [-7.4, 5.6],
    sheep: 2,
  },
  {
    name: 'The Crossroad Lot',
    flavor: 'A bare lot across the road — and you have big plans for it.',
    cost: 400,
    level: 8,
    field: null,
    lot: [2.5, 15.6],
    plots: [],
    fence: { minX: -15.2, maxX: 20.6, minZ: -9.0, maxZ: 10.2 },
    gates: [SOUTH_GATE, PASTURE_WEST_GATE],
    sign: [3.8, 12.9],
  },
  // ---- Millbrook Act 4: the neighboring farmsteads fold in --------------
  {
    name: "Old Tom's Farmstead",
    flavor: 'Tom retires to a town cottage, smiling — his north field is yours now.',
    cost: 1500,
    level: 13,
    field: { x0: -15.0, z0: -12.8, x1: -8.6, z1: -9.2 },
    plots: [
      [-13.4, -11.0],
      [-10.4, -11.0],
    ],
    fence: { minX: -15.2, maxX: 20.6, minZ: -13.0, maxZ: 10.2 },
    gates: [SOUTH_GATE, PASTURE_WEST_GATE],
    sign: [-11.8, -7.6],
  },
  {
    name: 'The Birch Farmstead',
    flavor: 'The Birch family moves to Millbrook — and waves from your stand line.',
    cost: 2200,
    level: 15,
    field: { x0: -4.0, z0: -12.8, x1: 3.6, z1: -9.2 },
    plots: [
      [-2.4, -11.0],
      [1.8, -11.0],
    ],
    fence: { minX: -15.2, maxX: 20.6, minZ: -13.0, maxZ: 10.2 },
    gates: [SOUTH_GATE, PASTURE_WEST_GATE],
    sign: [0.0, -7.6],
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
