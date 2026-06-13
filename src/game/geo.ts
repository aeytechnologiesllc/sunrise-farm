/** World geography as PURE DATA — the fixed bones of the land that never
 * move: the road, the town gate, the homestead, the spawn-side landmarks.
 * Lives in game/ (no three imports) so placement rules (layout.ts) can know
 * the world without touching rendering. world/scenery.ts wraps these in
 * Vector3s and re-exports the legacy names, so world code never churned. */

export const ROAD_Z = 11
export const TOWN_GATE_X = 23.6
export const WORLD_BOUNDS = { minX: -19, maxX: 22, minZ: -13, maxZ: 18.5 }

/** the player's east walk bound GROWS with the crop field: it must always be
 * possible to walk to the far edge of the last parcel (field strip ends at
 * x = 8 + parcels*5.6). Never shrinks below the authored 22 (the town gate
 * approach east of the homestead). Mirrors expansion.PARCEL_W / FIELD_X0. */
export function worldMaxX(parcels: number): number {
  return Math.max(22, 8 + Math.max(1, parcels) * 5.6 + 2)
}

export const SPAWN_AT: [number, number] = [-0.6, 4.2]
export const NEST_AT: [number, number] = [-4.5, 1.5]
export const CRATE_AT: [number, number] = [-5.5, 4.5]
export const DOG_AT: [number, number] = [-1.5, 5]
export const BARN_AT: [number, number] = [-11.5, -3.5]
/** the homestead's authored size + facing (world/homestead.ts mirrors this) */
export const BARN_SIZE = { w: 5.2, d: 4.2 }
export const BARN_ROT = 0.55

/** the crossroad lot ACROSS the road (tier 4 deed) — explicit for the first
 * time: placement may use this island once the deed is owned. Sized to hold
 * the shop's default footprint with walking room, inside WORLD_BOUNDS. */
export const LOT_RECT = { x0: -1.2, z0: 13.4, x1: 6.4, z1: 18.0 }

/** half-width of the dirt road's keep-clear band for PLACEMENT — matches the
 * painted road (±1.45); the authored coop sits 0.05 clear of it, so this is
 * exactly as wide as the farm allows */
export const ROAD_CLEAR = 1.45
