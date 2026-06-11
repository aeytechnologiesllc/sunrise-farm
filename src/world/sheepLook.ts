/** Bone-puppet sheep/goat — the "I need real sheep" pass. The Quaternius
 * Sheep.glb is the only CC0 animated sheep rig anywhere, but its body is a
 * literal box: no texture or vertex displacement ever fixed the silhouette
 * (the wool.ts pass softened it, the owner still read "blob... robotic").
 * So this module keeps the GLB for what it is genuinely good at — a clean
 * skeleton with Walk/Run/Idle/Idle_Eating clips — and replaces what it is
 * bad at: every SkinnedMesh is HIDDEN and hand-built, flat-shaded, cute
 * procedural parts are hung on the bones instead. The clips animate the
 * bones, the bones carry our parts, so grazing/fleeing/herding all keep
 * working without touching a single behavior file.
 *
 * Alignment technique (same as wool.ts addFleecePuff): each bone gets a
 * Group child whose quaternion is the INVERSE of the bone's bind-pose world
 * quaternion, so everything inside it is authored in plain model/world axes
 * (model faces +z at dress time — the caller's later rotation rides along).
 * Part positions are baked into the merged geometry in world units relative
 * to the bone origin, and the mesh scale of 1/boneWorldScale cancels the
 * armature's 100x, so a part authored 0.2u wide renders 0.2u wide.
 *
 * Every dimension derives from the measured world bounding box of the
 * original skinned body, so the puppet matches the GLB's footprint and the
 * Phase 1 scale band (asserted BEFORE dressing) still holds. Cost: a one-off
 * ~25-small-geometry build per spawn, zero per-frame work, and exactly 7
 * draw calls per animal (one merged Mesh per dressed bone, one shared
 * vertex-colored material per animal). */
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../game/rng'

/** warm cream fleece / warm tan goat coat — per-seed drift applied on top */
const COAT_BASE = { sheep: '#f2ead9', goat: '#c9a06b' } as const
/** sheep face: soft charcoal (the classic black-faced lamb read) */
const SHEEP_SKIN = '#4a4440'
/** legs are dark charcoal on both kinds, hooves a step darker */
const LEG_COLOR = '#433e39'
const HOOF_COLOR = '#2a2622'
const EYE_COLOR = '#15120f'
const HORN_COLOR = '#8d8478'

/** the four leg bones of the AnimalArmature rig (each reaches the ground) */
const LEG_BONES = ['FrontLeg.L', 'FrontLeg.R', 'BackLeg.L', 'BackLeg.R'] as const

/** Hide the boxy GLB meshes and dress the skeleton in procedural parts.
 * Call AFTER sizing (the parts are measured off the scaled model) and BEFORE
 * the caller positions/rotates the group. Safe on any rig: if the expected
 * bones or skinned body are missing, the model is left exactly as authored
 * (visible) rather than dressed wrong or invisible. */
export function dressSheep(model: Object3D, seed: number, kind: 'sheep' | 'goat'): void {
  // -- measure FIRST: every part size derives from the original footprint --
  const skinned: SkinnedMesh[] = []
  let body: SkinnedMesh | null = null
  let most = 0
  model.traverse((o) => {
    if (o instanceof SkinnedMesh) {
      skinned.push(o)
      const c = o.geometry.hasAttribute('position') ? o.geometry.getAttribute('position').count : 0
      if (c > most) {
        body = o
        most = c
      }
    }
  })
  if (!body) return
  const bodyMesh: SkinnedMesh = body
  model.updateMatrixWorld(true)
  bodyMesh.computeBoundingBox()
  if (!bodyMesh.boundingBox) return
  const bb = bodyMesh.boundingBox.clone().applyMatrix4(bodyMesh.matrixWorld)
  const size = bb.getSize(new Vector3())
  /** master proportion unit: the animal's measured world height */
  const H = size.y
  if (!(H > 0) || !(size.z > 0) || !(size.x > 0)) return

  const bodyBone = model.getObjectByName('Body')
  const headBone = model.getObjectByName('Head')
  if (!bodyBone || !headBone) return // unexpected rig — keep the authored look

  // -- only now is it safe to hide the boxy original entirely --
  for (const m of skinned) m.visible = false

  const rng = mulberry32(seed)
  const jit = (k: number): number => (rng.next() - 0.5) * k

  // -- seeded palette: coat lightness/warmth varies per animal --
  const coat = new Color(COAT_BASE[kind])
  coat.offsetHSL(jit(0.02), jit(0.05), jit(0.07))
  // sheep wear the charcoal lamb face; goat faces are a darker cut of their
  // own coat so face and body always agree per seed
  const skin = kind === 'sheep' ? new Color(SHEEP_SKIN) : coat.clone().offsetHSL(0, 0.03, -0.1)
  skin.offsetHSL(0, 0, jit(0.04))
  const legC = new Color(LEG_COLOR)
  const hoofC = new Color(HOOF_COLOR)
  const eyeC = new Color(EYE_COLOR)

  // one material per animal, all variation in vertex colors: 7 draws total
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true })

  // -- bone landmarks (bind-pose world space, model facing +z) --
  const bodyPos = bodyBone.getWorldPosition(new Vector3())
  const headPos = headBone.getWorldPosition(new Vector3())
  const legBones = LEG_BONES
    .map((n) => model.getObjectByName(n))
    .filter((b): b is Object3D => b !== undefined)
  const legZ = legBones.map((b) => b.getWorldPosition(new Vector3()).z)
  // torso span: between the front and back leg roots (bbox-derived fallback)
  const frontZ = legZ.length ? Math.max(...legZ) : bb.max.z - size.z * 0.45
  const backZ = legZ.length ? Math.min(...legZ) : bb.min.z + size.z * 0.32
  const cz = (frontZ + backZ) / 2
  const half = Math.max((frontZ - backZ) / 2, size.z * 0.12)
  const cy = bodyPos.y

  /** one seeded coat puff in world coords, baked relative to `anchor` */
  const coatBall = (anchor: Vector3, x: number, y: number, z: number, r: number): BufferGeometry => {
    const s = new SphereGeometry(r, 7, 6)
    s.rotateY(rng.next() * Math.PI)
    const c = coat.clone().offsetHSL(0, 0, jit(0.035))
    return part(s, c, new Vector3(x, y, z).sub(anchor))
  }

  // -- Body bone: the full fluffy torso (14 overlapping low-poly puffs) --
  const r0 = H * 0.21
  const torso: BufferGeometry[] = []
  for (let i = 0; i < 5; i++) {
    // spine row, rump to chest, with seeded waddle in every axis
    const t = i / 4 - 0.5
    torso.push(coatBall(
      bodyPos,
      jit(size.x * 0.1),
      cy + H * 0.05 + jit(H * 0.03),
      cz + t * half * 2.1 + jit(half * 0.1),
      r0 * (0.92 + rng.next() * 0.18),
    ))
  }
  // chest and rump fullness caps the oval
  torso.push(coatBall(bodyPos, 0, cy - H * 0.01, cz + half * 1.5, r0 * (1.02 + rng.next() * 0.12)))
  torso.push(coatBall(bodyPos, 0, cy + H * 0.01, cz - half * 1.55, r0 * (1.08 + rng.next() * 0.12)))
  // flank puffs round out the sides
  for (const sx of [-1, 1]) {
    torso.push(coatBall(bodyPos, sx * size.x * 0.2, cy - H * 0.02, cz + half * 0.6 + jit(half * 0.3), r0 * (0.9 + rng.next() * 0.15)))
    torso.push(coatBall(bodyPos, sx * size.x * 0.2, cy - H * 0.01, cz - half * 0.6 + jit(half * 0.3), r0 * (0.92 + rng.next() * 0.15)))
  }
  // small back curls break up the top line
  for (let i = 0; i < 3; i++) {
    torso.push(coatBall(bodyPos, jit(size.x * 0.3), cy + H * 0.17, cz + jit(half * 1.6), r0 * (0.5 + rng.next() * 0.2)))
  }
  mount(bodyBone, torso, mat, true)

  // -- Head bone: skull + muzzle + droopy ears + eyes + kind trims --
  const hr = H * 0.135
  /** skull center, world: forward and up of the neck-base Head bone */
  const hc = headPos.clone().add(new Vector3(0, H * 0.045, H * 0.14))
  const head: BufferGeometry[] = []
  const skull = new SphereGeometry(hr, 8, 6)
  skull.scale(0.95, 0.88, 1.05) // slightly squashed, slightly long
  head.push(part(skull, skin, new Vector3(0, 0, 0)))
  // rounded muzzle in front (+z), nose-level with the eyes
  head.push(part(
    new BoxGeometry(H * 0.125, H * 0.105, H * 0.15),
    skin,
    new Vector3(0, -H * 0.03, hr * 0.95 + H * 0.04),
  ))
  for (const sx of [-1, 1]) {
    // droopy ear flap: flattened sphere angled down-and-out, seeded droop
    const ear = new SphereGeometry(H * 0.07, 7, 6)
    ear.scale(1.45, 0.4, 0.75)
    ear.rotateZ(-sx * (0.75 + jit(0.3)))
    head.push(part(ear, skin, new Vector3(sx * H * 0.115, H * 0.005, -H * 0.015)))
    // tiny black eye
    head.push(part(new SphereGeometry(H * 0.026, 6, 5), eyeC, new Vector3(sx * H * 0.075, H * 0.03, H * 0.1)))
  }
  if (kind === 'sheep') {
    // cream wool cap curls on top of the charcoal face
    for (let i = 0; i < 3; i++) {
      const curl = new SphereGeometry(H * 0.052, 7, 6)
      const c = coat.clone().offsetHSL(0, 0, jit(0.03))
      head.push(part(curl, c, new Vector3(jit(H * 0.1), hr * 0.78, -H * 0.02 + rng.next() * H * 0.08)))
    }
  } else {
    // small back-swept horn cones + chin-tuft beard
    const hornC = new Color(HORN_COLOR)
    for (const sx of [-1, 1]) {
      const horn = new ConeGeometry(H * 0.034, H * 0.16, 6)
      horn.rotateX(-0.95 + jit(0.15))
      horn.rotateZ(-sx * 0.2)
      head.push(part(horn, hornC, new Vector3(sx * H * 0.055, hr * 0.75, -H * 0.03)))
    }
    const beard = new ConeGeometry(H * 0.028, H * 0.095, 6)
    beard.rotateX(Math.PI)
    head.push(part(beard, skin.clone().offsetHSL(0, 0, -0.12), new Vector3(0, -H * 0.095, H * 0.16)))
  }
  // seeded head tilt around the skull center, then shift onto the neck bone
  const tilt = jit(0.16)
  const toBone = hc.clone().sub(headPos)
  for (const g of head) {
    g.rotateZ(tilt)
    g.translate(toBone.x, toBone.y, toBone.z)
  }
  mount(headBone, head, mat, true)

  // -- Tail bone: one wool puff near the tail tip --
  const tailBone = model.getObjectByName('Tail')
  if (tailBone) {
    const tp = tailBone.getWorldPosition(new Vector3())
    const te = model.getObjectByName('Tail_end')
    const tip = te ? te.getWorldPosition(new Vector3()) : tp.clone().add(new Vector3(0, 0, -H * 0.35))
    const puff = new SphereGeometry(H * 0.085, 7, 6)
    puff.rotateY(rng.next() * Math.PI)
    mount(tailBone, [part(puff, coat.clone().offsetHSL(0, 0, 0.02), tp.clone().lerp(tip, 0.8).sub(tp))], mat, false)
  }

  // -- legs: slim charcoal cylinder from each leg root down to the ground --
  for (const bone of legBones) {
    const len = Math.max(bone.getWorldPosition(new Vector3()).y, H * 0.2)
    const hoofH = len * 0.18
    // shaft overlaps the belly a touch so hip swings never show a gap
    const shaft = new CylinderGeometry(H * 0.05, H * 0.038, len - hoofH + H * 0.02, 7)
    const hoof = new CylinderGeometry(H * 0.055, H * 0.05, hoofH, 7)
    mount(bone, [
      part(shaft, legC, new Vector3(0, -(len - hoofH) / 2 + H * 0.01, 0)),
      part(hoof, hoofC, new Vector3(0, -(len - hoofH / 2), 0)),
    ], mat, false)
  }
}

/** Non-indexed copy of `geo` painted one uniform vertex color and translated
 * to `at` — world-unit offsets relative to the owning bone's origin. Vertex
 * colors keep the whole animal on ONE material (7 draw calls total). */
function part(geo: BufferGeometry, c: Color, at: Vector3): BufferGeometry {
  const g = geo.toNonIndexed()
  const n = g.getAttribute('position').count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3)
  g.setAttribute('color', new Float32BufferAttribute(arr, 3))
  g.translate(at.x, at.y, at.z)
  return g
}

/** Merge `parts` into one Mesh and hang it on `bone` via the wool.ts
 * alignment trick: a Group child canceling the bone's bind world rotation
 * puts the mesh in model/world axes, and scale 1/boneWorldScale cancels the
 * armature's 100x so baked world-unit geometry renders at world size. The
 * clips rotate the bone, the bone carries the mesh — animation for free. */
function mount(bone: Object3D, parts: BufferGeometry[], material: MeshStandardMaterial, shadow: boolean): void {
  const merged = mergeGeometries(parts)
  if (!merged) return
  const mesh = new Mesh(merged, material)
  mesh.castShadow = shadow
  const align = new Group()
  align.quaternion.copy(bone.getWorldQuaternion(new Quaternion()).invert())
  const bs = bone.getWorldScale(new Vector3()).x || 1
  mesh.scale.setScalar(1 / bs)
  align.add(mesh)
  bone.add(align)
}
