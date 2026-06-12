/** Player fences — free, infinite, yours to redraw (owner: "give an option
 * to break the fence down, rebuild it somewhere else. Fence building should
 * be free"). Pure module: the data model, the migration from the authored
 * tier ring, and the collision math. Rendering lives in world/scenery.ts.
 *
 * Model: a SET of unit edges on the 1u grid. An edge is (cx, cz, axis):
 * axis 0 runs from grid vertex (cx,cz) to (cx+1,cz); axis 1 to (cz+1).
 * Encoded to one int so a whole farm of fence is a compact JSON array.
 * Gates are edges too — rendered as an opening, crossable by everyone.
 *
 * Who fences stop: the PLAYER (and, from Phase 3, the sheep). Customers,
 * Hazel, Rex and the farmhand are polite neighbors — a guest stuck behind
 * fence art is a bug, not gameplay. Deeds gate where fences may go. */
import { fenceFor, gatesFor, type GateDef } from './expansion'

/** encode range: cx, cz in [-64, 191] — far beyond the world bounds */
const OFF = 64
const SPAN = 256

export function encodeEdge(cx: number, cz: number, axis: 0 | 1): number {
  return ((cx + OFF) * SPAN + (cz + OFF)) * 2 + axis
}

export function decodeEdge(key: number): { cx: number; cz: number; axis: 0 | 1 } {
  const axis = (key % 2) as 0 | 1
  const cell = (key - axis) / 2
  const cx = Math.floor(cell / SPAN) - OFF
  const cz = (cell % SPAN) - OFF
  return { cx, cz, axis }
}

export interface FenceState {
  edges: number[]
  gates: number[]
}

/** the saved arrays -> fast lookup sets (rebuilt on load + after edits) */
export interface FenceSets {
  edges: Set<number>
  gates: Set<number>
}

export function toSets(f: FenceState): FenceSets {
  return { edges: new Set(f.edges), gates: new Set(f.gates) }
}

export function toState(s: FenceSets): FenceState {
  return { edges: [...s.edges].sort((a, b) => a - b), gates: [...s.gates].sort((a, b) => a - b) }
}

/** Synthesize the authored picket ring as player edges: each wall snapped to
 * the grid, gate spans left as GATE edges. This is both the one-time save
 * migration and the ring a land deed adds. */
export function ringEdges(tier: number): FenceState {
  const f = fenceFor(tier)
  const gates = gatesFor(tier)
  const x0 = Math.round(f.minX)
  const x1 = Math.round(f.maxX)
  const z0 = Math.round(f.minZ)
  const z1 = Math.round(f.maxZ)
  const edges: number[] = []
  const gateEdges: number[] = []
  const inGate = (wall: GateDef['wall'], t: number): boolean =>
    gates.some((g) => g.wall === wall && t + 0.5 > g.center - g.half && t + 0.5 < g.center + g.half)
  for (let x = x0; x < x1; x++) {
    ;(inGate('N', x) ? gateEdges : edges).push(encodeEdge(x, z0, 0))
    ;(inGate('S', x) ? gateEdges : edges).push(encodeEdge(x, z1, 0))
  }
  for (let z = z0; z < z1; z++) {
    ;(inGate('W', z) ? gateEdges : edges).push(encodeEdge(x0, z, 1))
    ;(inGate('E', z) ? gateEdges : edges).push(encodeEdge(x1, z, 1))
  }
  return { edges, gates: gateEdges }
}

/** A land deed grew the farm: swap the OLD default ring for the NEW one.
 * Player-built fence elsewhere survives untouched; ring pieces the player
 * already demolished simply aren't there to remove. Deterministic and
 * idempotent — running it twice changes nothing. */
export function expandRing(current: FenceSets, fromTier: number, toTier: number): void {
  const old = ringEdges(fromTier)
  for (const e of old.edges) current.edges.delete(e)
  for (const g of old.gates) current.gates.delete(g)
  const next = ringEdges(toTier)
  for (const e of next.edges) current.edges.add(e)
  for (const g of next.gates) current.gates.add(g)
}

/** Cancel a step that crosses a fence edge (gates pass). The fixed step
 * moves <0.1u, so at most one grid line per axis is crossed. Returns true
 * if the step was blocked (the caller keeps prev). */
export function blockByEdges(
  prev: { x: number; z: number },
  next: { x: number; z: number },
  sets: FenceSets,
): boolean {
  let blocked = false
  // crossing a vertical grid line x = k: the blocking edge runs ALONG that
  // line (axis 1) at the z-cell of the crossing point
  const pcx = Math.floor(prev.x)
  const ncx = Math.floor(next.x)
  if (pcx !== ncx) {
    const k = Math.max(pcx, ncx) // the line between the two cells
    const t = prev.x === next.x ? 0 : (k - prev.x) / (next.x - prev.x)
    const zAt = prev.z + (next.z - prev.z) * t
    const key = encodeEdge(k, Math.floor(zAt), 1)
    if (sets.edges.has(key) && !sets.gates.has(key)) {
      next.x = prev.x
      blocked = true
    }
  }
  const pcz = Math.floor(prev.z)
  const ncz = Math.floor(next.z)
  if (pcz !== ncz) {
    const k = Math.max(pcz, ncz)
    const t = prev.z === next.z ? 0 : (k - prev.z) / (next.z - prev.z)
    const xAt = prev.x + (next.x - prev.x) * t
    const key = encodeEdge(Math.floor(xAt), k, 0)
    if (sets.edges.has(key) && !sets.gates.has(key)) {
      next.z = prev.z
      blocked = true
    }
  }
  return blocked
}

/** the edge nearest a world point (for the Remove action), within maxD */
export function nearestEdge(sets: FenceSets, x: number, z: number, maxD = 1.6): number | null {
  let best: number | null = null
  let bd = maxD
  const scan = (key: number): void => {
    const { cx, cz, axis } = decodeEdge(key)
    // distance from p to the edge's midpoint
    const mx = axis === 0 ? cx + 0.5 : cx
    const mz = axis === 0 ? cz : cz + 0.5
    const d = Math.hypot(x - mx, z - mz)
    if (d < bd) {
      bd = d
      best = key
    }
  }
  for (const k of sets.edges) scan(k)
  for (const k of sets.gates) scan(k)
  return best
}

/** the edge the player JUST walked across (walk-to-draw places it behind
 * them — you never fence yourself in mid-stride). Returns null when the
 * step stayed inside one cell. */
export function crossedEdge(prev: { x: number; z: number }, next: { x: number; z: number }): number | null {
  const pcx = Math.floor(prev.x)
  const ncx = Math.floor(next.x)
  if (pcx !== ncx) {
    const k = Math.max(pcx, ncx)
    const t = prev.x === next.x ? 0 : (k - prev.x) / (next.x - prev.x)
    const zAt = prev.z + (next.z - prev.z) * t
    return encodeEdge(k, Math.floor(zAt), 1)
  }
  const pcz = Math.floor(prev.z)
  const ncz = Math.floor(next.z)
  if (pcz !== ncz) {
    const k = Math.max(pcz, ncz)
    const t = prev.z === next.z ? 0 : (k - prev.z) / (next.z - prev.z)
    const xAt = prev.x + (next.x - prev.x) * t
    return encodeEdge(Math.floor(xAt), k, 0)
  }
  return null
}
