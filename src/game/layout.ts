/** The farm's LAYOUT — where every player-owned structure stands.
 * Pure module (no three/DOM): defaults come from the project ladder, the
 * save stores a SPARSE overlay (only moved buildings appear), and every
 * placement rule lives here as testable math. World code resolves through
 * placeOf()/layoutView() and never reads PROJECTS sites directly again.
 *
 * Design rules (owner-approved):
 *  - Deeds gate placement, fences are expression: you may place on land
 *    your tier fence encloses, or on the crossroad lot once that deed is
 *    owned. The road, homestead, and landmark spots never host buildings.
 *  - Buildings keep their authored yaw when moved (no rotation in v1).
 *  - Moving is FREE and never punished — canPlace says no, never costs. */
import {
  BARN_AT,
  BARN_ROT,
  BARN_SIZE,
  CRATE_AT,
  DOG_AT,
  LOT_RECT,
  NEST_AT,
  ROAD_CLEAR,
  ROAD_Z,
  TOWN_GATE_X,
  WORLD_BOUNDS,
} from './geo'
import { fenceFor, gatesFor, PEN, TIERS, type FieldRect } from './expansion'
import { PADDOCK, PROJECTS } from './projects'

export type PlaceId =
  | 'stand'
  | 'shop'
  | 'coop'
  | 'stable'
  | 'greenhouse'
  | 'tractor'
  | 'pen'
  | 'field0'
  | 'field1'
  | 'field2'
  | 'field3'
  | 'field5'
  | 'field6'

export interface Place {
  x: number
  z: number
  yaw: number
}

/** sparse save overlay: only buildings the player moved appear */
export type LayoutState = Partial<Record<PlaceId, { x: number; z: number }>>

/** the minimal slice of GameState the layout math needs (no import cycle) */
export interface LayoutHost {
  layout?: LayoutState
  expansion: number
  projects: Partial<Record<string, boolean>>
  produce?: { deliveryT: number }
}

function fieldHome(tier: number): Place {
  const f = TIERS[tier].field!
  return { x: (f.x0 + f.x1) / 2, z: (f.z0 + f.z1) / 2, yaw: 0 }
}

/** which field tier a PlaceId names, or -1 */
export function fieldTierOf(id: PlaceId): number {
  return id.startsWith('field') ? Number(id.slice(5)) : -1
}

function siteOf(id: string): Place {
  const def = PROJECTS.find((p) => p.id === id)!
  return { x: def.site[0], z: def.site[1], yaw: def.yaw }
}

/** authored homes — MUST stay byte-equal to the legacy constants (pinned by
 * tests/layout.test.ts); the tractor spot moves here from main.ts */
export const DEFAULT_PLACES: Record<PlaceId, Place> = {
  stand: siteOf('stand'),
  shop: siteOf('shop'),
  coop: siteOf('coop'),
  stable: siteOf('stable'),
  greenhouse: siteOf('greenhouse'),
  tractor: { x: -7.2, z: -6.6, yaw: -0.35 },
  // the authored pen center — its rect/gate derive in penRect()
  pen: { x: (PEN.x0 + PEN.x1) / 2, z: (PEN.z0 + PEN.z1) / 2, yaw: 0 },
  // each tier's soil slab, centered on its authored rect
  field0: fieldHome(0),
  field1: fieldHome(1),
  field2: fieldHome(2),
  field3: fieldHome(3),
  // tier 4 (the crossroad lot) has no field — the ids skip to the farmsteads
  field5: fieldHome(5),
  field6: fieldHome(6),
}

export const PLACE_IDS = Object.keys(DEFAULT_PLACES) as PlaceId[]

/** footprints for placement math (PROJECTS for buildings; the tractor gets
 * a sensible body) */
export function footprintOf(id: PlaceId): { w: number; d: number } {
  if (id === 'tractor') return { w: 2.6, d: 1.6 }
  if (id === 'pen') return { w: PEN.x1 - PEN.x0, d: PEN.z1 - PEN.z0 }
  const ft = fieldTierOf(id)
  if (ft >= 0) {
    const f = TIERS[ft].field!
    return { w: f.x1 - f.x0, d: f.z1 - f.z0 }
  }
  const def = PROJECTS.find((p) => p.id === id)!
  return def.footprint
}

export function placeOf(s: LayoutHost, id: PlaceId): Place {
  const over = s.layout?.[id]
  const def = DEFAULT_PLACES[id]
  return over ? { x: over.x, z: over.z, yaw: def.yaw } : def
}

export function setPlace(s: LayoutHost, id: PlaceId, x: number, z: number): void {
  const l = (s.layout ??= {})
  const def = DEFAULT_PLACES[id]
  // landing back home erases the overlay — saves stay minimal
  if (Math.abs(x - def.x) < 1e-6 && Math.abs(z - def.z) < 1e-6) delete l[id]
  else l[id] = { x, z }
}

/** resolved snapshot for world code (scenery binds this at boot/relayout) */
export type LayoutView = Record<PlaceId, Place>

export function layoutView(s: LayoutHost): LayoutView {
  const out = {} as LayoutView
  for (const id of PLACE_IDS) out[id] = placeOf(s, id)
  return out
}

/** the sheep pen rect + its east-wall gate, derived from wherever the pen
 * stands (same shape as the authored PEN; the gate keeps its offset) */
export interface PenRect {
  x0: number
  z0: number
  x1: number
  z1: number
  gate: { z0: number; z1: number }
}

export function penRect(s: LayoutHost): PenRect {
  const p = placeOf(s, 'pen')
  const hw = (PEN.x1 - PEN.x0) / 2
  const hd = (PEN.z1 - PEN.z0) / 2
  const gateMidOff = (PEN.gate.z0 + PEN.gate.z1) / 2 - (PEN.z0 + PEN.z1) / 2
  const gateHalf = (PEN.gate.z1 - PEN.gate.z0) / 2
  return {
    x0: p.x - hw,
    z0: p.z - hd,
    x1: p.x + hw,
    z1: p.z + hd,
    gate: { z0: p.z + gateMidOff - gateHalf, z1: p.z + gateMidOff + gateHalf },
  }
}

/** a tier's soil rect, wherever its slab stands today */
export function fieldRectFor(s: LayoutHost, tier: number): FieldRect {
  const f = TIERS[tier].field!
  if (!s.layout?.[('field' + tier) as PlaceId]) return f // unmoved: bit-exact
  const p = placeOf(s, ('field' + tier) as PlaceId)
  const d = DEFAULT_PLACES[('field' + tier) as PlaceId]
  return { x0: f.x0 + p.x - d.x, z0: f.z0 + p.z - d.z, x1: f.x1 + p.x - d.x, z1: f.z1 + p.z - d.z }
}

/** cumulative plot centers for the OWNED tiers, each translated by its
 * slab's move — same order and length as expansion.plotPositions, so the
 * save's plot indices never change meaning */
export function fieldPlotsFor(s: LayoutHost): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let t = 0; t <= Math.min(s.expansion, TIERS.length - 1); t++) {
    const tierDef = TIERS[t]
    if (!tierDef.field) continue
    if (!s.layout?.[('field' + t) as PlaceId]) {
      for (const pl of tierDef.plots) out.push(pl) // unmoved: bit-exact
      continue
    }
    const p = placeOf(s, ('field' + t) as PlaceId)
    const d = DEFAULT_PLACES[('field' + t) as PlaceId]
    for (const [px, pz] of tierDef.plots) out.push([px + p.x - d.x, pz + p.z - d.z])
  }
  return out
}

/** the horse paddock TRAVELS WITH the stable: same rect, same relative
 * offsets as the authored pair (PADDOCK around the default stable site) */
export function paddockRect(s: LayoutHost): FieldRect {
  const st = placeOf(s, 'stable')
  const d = DEFAULT_PLACES.stable
  return {
    x0: PADDOCK.x0 + (st.x - d.x),
    z0: PADDOCK.z0 + (st.z - d.z),
    x1: PADDOCK.x1 + (st.x - d.x),
    z1: PADDOCK.z1 + (st.z - d.z),
  }
}

/** Hazel's run, derived from the CURRENT stable: out the paddock's east
 * side, down to the south gate, onto the road, east through the Millbrook
 * gate. Reproduces the legacy hand-tuned route exactly at the default
 * layout (regression-pinned). The gate column and road never move. */
export function deliveryRoute(s: LayoutHost): Array<[number, number]> {
  const st = placeOf(s, 'stable')
  const gateX = 0.9 // SOUTH_GATE.center — the fence gate, not the stand
  return [
    [st.x + 4.1, st.z + 1.2],
    [gateX, ROAD_Z - 1.6],
    [gateX, ROAD_Z],
    [TOWN_GATE_X + 1.8, ROAD_Z + 0.2],
  ]
}

/** is this point inside any standing building (or the homestead)? The
 * player can't walk INTO buildings — and fences can't thread through them.
 * `skip` exempts a building (the one being carried rides overhead). */
export function pointInBuilding(s: LayoutHost, x: number, z: number, skip: PlaceId | null = null): boolean {
  if (obbContains(HOME_OBB, x, z)) return true
  for (const id of PLACE_IDS) {
    if (id === skip || id === 'pen' || fieldTierOf(id) >= 0) continue
    const exists =
      id === 'tractor'
        ? s.expansion >= 2
        : id === 'stand'
          ? s.projects.stand === true && s.projects.shop !== true
          : s.projects[id] === true
    if (!exists) continue
    const pl = placeOf(s, id)
    if (obbContains(obbFor(id, pl.x, pl.z, 0), x, z)) return true
  }
  return false
}

/** may a fence edge live here? On your land, and NEVER through a building,
 * crop soil, the pen, or the road (owner's rule: fences must not break the
 * farm's working parts). Edges along field BORDERS are fine — fencing your
 * crops in is the whole point. */
export function fenceEdgeAllowed(s: LayoutHost, mx: number, mz: number): boolean {
  // owned land: the ring (skirted) or the lot
  const ring = fenceFor(s.expansion)
  const inRing = mx > ring.minX - 0.6 && mx < ring.maxX + 0.6 && mz > ring.minZ - 0.6 && mz < ring.maxZ + 0.6
  const inLot = s.expansion >= 4 && mx > LOT_RECT.x0 && mx < LOT_RECT.x1 && mz > LOT_RECT.z0 && mz < LOT_RECT.z1
  if (!inRing && !inLot) return false
  if (Math.abs(mz - ROAD_Z) < ROAD_CLEAR) return false
  if (pointInBuilding(s, mx, mz)) return false
  // strictly INSIDE soil is off-limits; the border line itself is allowed
  for (let t = 0; t < TIERS.length; t++) {
    if (!TIERS[t].field) continue
    const fr = t <= s.expansion ? fieldRectFor(s, t) : TIERS[t].field!
    if (mx > fr.x0 + 0.05 && mx < fr.x1 - 0.05 && mz > fr.z0 + 0.05 && mz < fr.z1 - 0.05) return false
  }
  const pr = penRect(s)
  if (mx > pr.x0 + 0.05 && mx < pr.x1 - 0.05 && mz > pr.z0 + 0.05 && mz < pr.z1 - 0.05) return false
  return true
}

// ---- placement rules ---------------------------------------------------------

export type PlaceBlock =
  | 'far' // beyond where the farmer can walk — he could never lift it back
  | 'land' // outside what your deeds enclose
  | 'road' // the road must stay clear
  | 'field' // crops will grow there (any tier's soil)
  | 'pen' // the sheep pen
  | 'flock-out' // the pen can't move while sheep are loose
  | 'paddock' // Hazel's paddock (moves with the stable)
  | 'building' // overlaps another structure
  | 'home' // the homestead and its doorway
  | 'spot' // a landmark: nest, crate, dog house, deed sign
  | 'gate' // a fence gate passage must stay walkable
  | 'hazel-out' // the stable can't move while she's on the road

export interface PlaceCheck {
  ok: boolean
  reason?: PlaceBlock
}

/** oriented box for the separating-axis test: center, half extents, yaw.
 * The default farm only FITS because its buildings are rotated — axis-
 * aligned boxes would falsely collide (stable vs barn), so placement math
 * respects yaw. */
interface Obb {
  x: number
  z: number
  hw: number
  hd: number
  yaw: number
}

function obbFor(id: PlaceId, x: number, z: number, pad = 0): Obb {
  const fp = footprintOf(id)
  return { x, z, hw: fp.w / 2 + pad, hd: fp.d / 2 + pad, yaw: DEFAULT_PLACES[id].yaw }
}

function obbOfRect(r: FieldRect, pad = 0): Obb {
  return {
    x: (r.x0 + r.x1) / 2,
    z: (r.z0 + r.z1) / 2,
    hw: (r.x1 - r.x0) / 2 + pad,
    hd: (r.z1 - r.z0) / 2 + pad,
    yaw: 0,
  }
}

function corners(o: Obb): Array<[number, number]> {
  const c = Math.cos(o.yaw)
  const s = Math.sin(o.yaw)
  const out: Array<[number, number]> = []
  for (const [ex, ez] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as Array<[number, number]>) {
    const lx = ex * o.hw
    const lz = ez * o.hd
    out.push([o.x + lx * c + lz * s, o.z - lx * s + lz * c])
  }
  return out
}

/** 2D separating-axis overlap test for two oriented boxes (true = overlap) */
export function overlaps(a: Obb, b: Obb): boolean {
  const ca = corners(a)
  const cb = corners(b)
  for (const o of [a, b]) {
    const axes: Array<[number, number]> = [
      [Math.cos(o.yaw), -Math.sin(o.yaw)],
      [Math.sin(o.yaw), Math.cos(o.yaw)],
    ]
    for (const [ax, az] of axes) {
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity
      for (const [px, pz] of ca) {
        const d = px * ax + pz * az
        aMin = Math.min(aMin, d)
        aMax = Math.max(aMax, d)
      }
      for (const [px, pz] of cb) {
        const d = px * ax + pz * az
        bMin = Math.min(bMin, d)
        bMax = Math.max(bMax, d)
      }
      if (aMax < bMin || bMax < aMin) return false // separated on this axis
    }
  }
  return true
}

/** point-in-obb (for containment checks against the fence ring / lot) */
function obbInsideRect(o: Obb, r: FieldRect): boolean {
  for (const [px, pz] of corners(o)) {
    if (px < r.x0 || px > r.x1 || pz < r.z0 || pz > r.z1) return false
  }
  return true
}

/** unpadded on purpose: the authored greenhouse breathes 0.2 from the barn */
const HOME_OBB: Obb = { x: BARN_AT[0], z: BARN_AT[1], hw: BARN_SIZE.w / 2, hd: BARN_SIZE.d / 2, yaw: BARN_ROT }
/** the doorway patch in front of the homestead door (the sleep walk's
 * landing) — sized so the AUTHORED stable, which threads the needle right
 * beside the walk, stays legal where it stands */
const HOME_DOOR_OBB: Obb = (() => {
  const k = BARN_SIZE.d / 2 + 1.1
  return {
    x: BARN_AT[0] + Math.sin(BARN_ROT) * k,
    z: BARN_AT[1] + Math.cos(BARN_ROT) * k,
    hw: 0.6,
    hd: 0.8,
    yaw: BARN_ROT,
  }
})()

const SPOT_RADII: Array<{ at: [number, number]; r: number }> = [
  { at: NEST_AT, r: 1.2 },
  { at: CRATE_AT, r: 1.0 },
  { at: DOG_AT, r: 0.7 },
]

function obbContains(o: Obb, px: number, pz: number): boolean {
  const c = Math.cos(o.yaw)
  const s = Math.sin(o.yaw)
  const dx = px - o.x
  const dz = pz - o.z
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  return Math.abs(lx) < o.hw && Math.abs(lz) < o.hd
}

function obbNearPoint(o: Obb, px: number, pz: number, r: number): boolean {
  // closest point on the obb to p, in obb-local space
  const c = Math.cos(o.yaw)
  const s = Math.sin(o.yaw)
  const dx = px - o.x
  const dz = pz - o.z
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  const qx = Math.max(-o.hw, Math.min(o.hw, lx))
  const qz = Math.max(-o.hd, Math.min(o.hd, lz))
  return Math.hypot(lx - qx, lz - qz) < r
}

/** May `id` stand at (x,z) right now? Pure — UI and tests share it. */
export function canPlace(s: LayoutHost, id: PlaceId, x: number, z: number): PlaceCheck {
  if (id === 'stable' && (s.produce?.deliveryT ?? 0) > 0) return { ok: false, reason: 'hazel-out' }
  // the farmer must be able to WALK BACK to whatever he sets down: the
  // carry ghost aims past his nose, and a center beyond the walkable rect
  // is a building nobody can ever pick up again (the owner stranded a
  // field across the south wall exactly this way)
  if (
    x < WORLD_BOUNDS.minX + 1 ||
    x > WORLD_BOUNDS.maxX - 1 ||
    z < WORLD_BOUNDS.minZ + 1 ||
    z > WORLD_BOUNDS.maxZ - 1
  ) {
    return { ok: false, reason: 'far' }
  }
  // a building's AUTHORED home is always legal — the original farm was laid
  // out by hand (the stable/barn footprints even interpenetrate on paper and
  // coexist only by their rotations), and walking a building back home must
  // never fail. The rules below govern NEW ground.
  const home = DEFAULT_PLACES[id]
  if (Math.hypot(x - home.x, z - home.z) < 0.45) return { ok: true }
  const box = obbFor(id, x, z, 0.25)
  const snug = obbFor(id, x, z, 0)
  // the stable brings her paddock along — validate the WHOLE unit
  const bodies: Obb[] = [box]
  if (id === 'stable') {
    const dx = x - DEFAULT_PLACES.stable.x
    const dz = z - DEFAULT_PLACES.stable.z
    bodies.push(obbOfRect({ x0: PADDOCK.x0 + dx, z0: PADDOCK.z0 + dz, x1: PADDOCK.x1 + dx, z1: PADDOCK.z1 + dz }))
  }

  // the road stays clear — measured snug (the authored coop is 0.05 from it)
  const roadBand = obbOfRect({ x0: -64, z0: ROAD_Z - ROAD_CLEAR, x1: 64, z1: ROAD_Z + ROAD_CLEAR })
  const overRoad = id === 'stable' ? [snug, bodies[1]] : [snug]
  // only spots truly PAST the band count as the lot side of the street
  const onLotSide = z > ROAD_Z + ROAD_CLEAR + 1.0
  if (!onLotSide && overRoad.some((b) => overlaps(b, roadBand))) return { ok: false, reason: 'road' }

  // owned land: inside the tier fence ring (padded — the authored farm lets
  // eaves breathe past the pickets), or on the lot once the crossroad deed
  // is owned.
  const ring = fenceFor(s.expansion)
  const inRing = obbInsideRect(box, {
    x0: ring.minX - 1.0,
    z0: ring.minZ - 1.0,
    x1: ring.maxX + 1.0,
    z1: ring.maxZ + 1.0,
  })
  const inLot = s.expansion >= 4 && obbInsideRect(box, LOT_RECT)
  if (!inRing && !inLot) return { ok: false, reason: 'land' }
  if (onLotSide && !inLot) return { ok: false, reason: inRing ? 'road' : 'land' }

  // soil, present and future (mirrors the grass rule: fields stay
  // buildable-free) — OWNED slabs at their current spots, unbought tiers
  // at their authored homes
  const selfTier = fieldTierOf(id)
  for (let t = 0; t < TIERS.length; t++) {
    if (!TIERS[t].field || t === selfTier) continue
    const fr = t <= s.expansion ? fieldRectFor(s, t) : TIERS[t].field!
    for (const b of bodies) if (overlaps(b, obbOfRect(fr, 0.3))) return { ok: false, reason: 'field' }
  }

  // the sheep pen — wherever it stands today. Snug + 0.3: the authored
  // stable's rotated corner clears it by exactly that much.
  if (id !== 'pen') {
    const penObb = obbOfRect(penRect(s), 0.3)
    if (overlaps(snug, penObb)) return { ok: false, reason: 'pen' }
    if (bodies.length > 1 && overlaps(bodies[1], penObb)) return { ok: false, reason: 'pen' }
  }
  if (id !== 'stable' && overlaps(box, obbOfRect(paddockRect(s), 0.2))) return { ok: false, reason: 'paddock' }

  // the homestead has roots (BUILDING only, snug: the paddock wraps the
  // barn yard and the greenhouse breathes 0.2 from it — both authored)
  if (overlaps(snug, HOME_OBB) || overlaps(snug, HOME_DOOR_OBB)) return { ok: false, reason: 'home' }

  // landmark spots: hen nest, crate, dog house, the next FOR-SALE sign —
  // measured against the UNPADDED footprint (the authored farm is snug:
  // the stand and the dog house are real neighbors)
  for (const sp of SPOT_RADII) {
    if (obbNearPoint(snug, sp.at[0], sp.at[1], sp.r)) return { ok: false, reason: 'spot' }
  }
  const next = TIERS[Math.min(TIERS.length - 1, s.expansion + 1)]
  if (next?.sign && s.expansion < TIERS.length - 1 && obbNearPoint(snug, next.sign[0], next.sign[1], 1.2)) {
    return { ok: false, reason: 'spot' }
  }

  // fence gate passages stay walkable (customers + the player use them)
  for (const g of gatesFor(s.expansion)) {
    const strip: Obb =
      g.wall === 'N' || g.wall === 'S'
        ? { x: g.center, z: g.wall === 'N' ? ring.minZ : ring.maxZ, hw: g.half, hd: 1.4, yaw: 0 }
        : { x: g.wall === 'W' ? ring.minX : ring.maxX, z: g.center, hw: 1.4, hd: g.half, yaw: 0 }
    if (overlaps(box, strip)) return { ok: false, reason: 'gate' }
  }

  // other structures (only ones that exist: owned, or the always-there tractor pad)
  for (const other of PLACE_IDS) {
    if (other === id) continue
    const exists =
      other === 'tractor'
        ? s.expansion >= 2
        : other === 'pen'
          ? false // its layout-aware rect is checked above
          : other === 'stand'
            ? s.projects.stand === true && s.projects.shop !== true // the shop replaced it
            : s.projects[other] === true
    if (!exists) continue
    const p = placeOf(s, other)
    if (overlaps(box, obbFor(other, p.x, p.z, 0.3))) return { ok: false, reason: 'building' }
  }

  return { ok: true }
}
