/** PHASE 1 SCALE CONTRACT — the one table every living thing spawns against.
 * Owner's screenshot diagnosis: the dog read human-sized and the hen read
 * human-sized, so nothing felt real. The ladder, in world units:
 *   farmer 1.6u (reference) > customers farmer±10% > dog 0.45u AT THE
 *   SHOULDER (farmer knee height) > hen 0.28u (shin height) > chicks less.
 * Views must derive their spawn scale from THIS table (no magic numbers);
 * tests/scale.test.ts asserts every view's spawn lands inside its band and
 * that each view actually imports its sizing from here. */
import { Box3, SkinnedMesh, Vector3, type Object3D } from 'three'
import type { Rng } from '../game/rng'

export const SCALE = {
  /** the reference human: the farmer, head-to-toe */
  farmer: 1.6,
  /** customers: adults of the same model family, farmer ±10% seeded variety */
  customer: { min: 1.6 * 0.9, max: 1.6 * 1.1 },
  /** dog: height of the shoulder line (top of the back), knee-high */
  dogShoulder: 0.45,
  /** per-dog seeded variety stays inside ±5% of the shoulder target */
  dog: { min: 0.45 * 0.95, max: 0.45 * 1.05 },
  /** hen: head-to-toe (comb included), shin-high; ±8% per-bird variety */
  hen: { target: 0.28, min: 0.28 * 0.92, max: 0.28 * 1.08 },
  /** chick babies (content ladder, Phase 4): half a hen */
  chick: 0.14,
  /** sheep: head-to-toe, waist-high on the farmer; ±8% per-animal variety */
  sheep: { target: 0.95, min: 0.95 * 0.92, max: 0.95 * 1.08 },
} as const

/** seeded sheep scale: world height inside the sheep band given the GLB's
 * measured bind height */
export function sheepScaleFor(rng: Rng, measuredFullHeight: number): number {
  const h = SCALE.sheep.min + rng.next() * (SCALE.sheep.max - SCALE.sheep.min)
  return h / measuredFullHeight
}

/** Shoulder line (top of back) as a fraction of the Shiba GLB's full bind
 * height — measured from the GLB node hierarchy: Back bone y=1.85 of 3.07
 * total (ground to ear tips). Lets us aim the SHOULDER at the table value
 * while normalizing with the full bounding box. */
export const DOG_SHOULDER_OF_HEIGHT = 0.59

/** seeded customer height inside the farmer±10% band */
export function customerHeightFor(rng: Rng): number {
  return SCALE.customer.min + rng.next() * (SCALE.customer.max - SCALE.customer.min)
}

/** seeded hen scale: world height inside the hen band for a sculpt that is
 * `builtHeight` units tall at scale 1 */
export function henScaleFor(rng: Rng, builtHeight: number): number {
  const h = SCALE.hen.min + rng.next() * (SCALE.hen.max - SCALE.hen.min)
  return h / builtHeight
}

/** scale that puts a dog model's shoulder at the table height, given its
 * measured full (ground-to-ear) bind height */
export function dogScaleForHeight(measuredFullHeight: number): number {
  return SCALE.dogShoulder / (DOG_SHOULDER_OF_HEIGHT * measuredFullHeight)
}

/** model height that respects skinning — Quaternius character rigs keep
 * vertices in tiny bind space with the scale living on armature bones, so a
 * plain Box3.setFromObject reads near-zero. computeBoundingBox() on a
 * SkinnedMesh runs the vertices through the current bone transforms. */
export function measuredHeight(model: Object3D): number {
  model.updateMatrixWorld(true)
  const box = new Box3()
  const tmp = new Box3()
  let found = false
  model.traverse((o) => {
    if (o instanceof SkinnedMesh) {
      o.computeBoundingBox()
      if (o.boundingBox) {
        tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld)
        box.union(tmp)
        found = true
      }
    }
  })
  if (!found) box.setFromObject(model)
  const h = box.getSize(new Vector3()).y
  return h > 0.01 ? h : 1
}

/** scale `model` uniformly so it stands `target` units tall; returns the
 * applied scale factor */
export function normalizeHeight(model: Object3D, target: number): number {
  const s = target / measuredHeight(model)
  model.scale.setScalar(s)
  return s
}

/** dev guard: every view calls this right after computing its spawn size so
 * a scale regression is loud in the console long before a screenshot review */
export function assertSpawnScale(kind: string, height: number, min: number, max: number): void {
  if (height < min - 1e-6 || height > max + 1e-6) {
    console.warn(`[scale] ${kind} spawned ${height.toFixed(3)}u tall — outside its band [${min}, ${max}]`)
  }
}
