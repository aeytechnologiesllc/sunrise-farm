/** Pure camera math — zero three.js imports so the occlusion-clamp and
 * confinement rules are unit-testable (tests/cameraMath.test.ts pins the
 * "lens never lands beyond a wall" invariant that bit us in 48c58e0). */

/** axis-aligned volume the camera may occupy inside a room */
export interface CamBox {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

/** radius of the sphere that fully contains the camera's near-plane
 * rectangle (with 20% slack): keep the lens at least this far from any
 * wall or the near frustum slices through it and shows the outside */
export function nearSafeRadius(near: number, vFovDeg: number, aspect: number): number {
  const hh = near * Math.tan((vFovDeg * Math.PI) / 360)
  const hw = hh * aspect
  return 1.2 * Math.sqrt(near * near + hh * hh + hw * hw)
}

/** the occlusion pull-in target distance.
 * INVARIANT (the 48c58e0 regression, never again): for any hit, the
 * returned distance keeps the lens at least `margin` in FRONT of the hit —
 * a floor must never push the camera past the wall it was fleeing. The
 * comfortable floor of 1.0 (over-the-shoulder) applies only when the wall
 * allows it; 0.4 is the degenerate guard, also wall-capped. */
export function occlusionWant(blocked: number | null, dist: number, margin: number): number {
  if (blocked === null) return dist
  const hard = blocked - margin
  const soft = Math.max(1.0, blocked - 0.5)
  // 0.05 absolute floor: a wall closer to the FOCUS than the margin can't
  // satisfy the invariant — park just in front of the focus, never mirror
  // the camera through it with a negative distance
  return Math.max(0.05, Math.min(hard, Math.max(0.4, Math.min(hard, soft))))
}

/** componentwise clamp of a point into a CamBox; returns true if moved */
export function clampToBox(v: { x: number; y: number; z: number }, box: CamBox): boolean {
  const x = Math.min(box.maxX, Math.max(box.minX, v.x))
  const y = Math.min(box.maxY, Math.max(box.minY, v.y))
  const z = Math.min(box.maxZ, Math.max(box.minZ, v.z))
  const moved = x !== v.x || y !== v.y || z !== v.z
  v.x = x
  v.y = y
  v.z = z
  return moved
}

/** build a CamBox from a walk-bounds rect. Positive inset shrinks the rect,
 * negative grows it (camera may stand a little closer to a wall than the
 * player's own margin allows). Collapses to the center line rather than
 * inverting when a room is narrower than twice the inset. */
export function camBoxFromRect(
  rect: { minX: number; maxX: number; minZ: number; maxZ: number },
  insetXZ: number,
  yMin: number,
  yMax: number,
): CamBox {
  const cx = (rect.minX + rect.maxX) / 2
  const cz = (rect.minZ + rect.maxZ) / 2
  const minX = Math.min(cx, rect.minX + insetXZ)
  const maxX = Math.max(cx, rect.maxX - insetXZ)
  const minZ = Math.min(cz, rect.minZ + insetXZ)
  const maxZ = Math.max(cz, rect.maxZ - insetXZ)
  return { minX, maxX, minY: yMin, maxY: yMax, minZ, maxZ }
}
