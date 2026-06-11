/** Family-dinner interior — the sleep cutscene's film set. At dusk the farmer
 * walks to the lamplit barn door and the scene CUTS INSIDE: a warm farmhouse
 * room far off-world (anchor ~(120, 0, 120)) where his wife and child share a
 * candle-lit dinner with a stand-in of the farmer himself. Owner bar: 'real
 * family, real dinner' — so the set is dressed like film: plank floor, board
 * walls with the camera-facing fourth wall OPEN, a stone fireplace with a
 * living fire, a night-blue window with star speckle, curtains, a braided
 * rug, shelves of crockery and a set table (Kenney food kit).
 *
 * SEATED POSE — the Quaternius rigs have no sit clip, so the pose is authored
 * in code. Armature (parsed from the Farmer.glb JSON chunk): Root -> Body ->
 * { Hips -> Abdomen -> Torso -> Chest -> Neck -> Head + Shoulder/Arm chains,
 * UpperLeg.L/R -> LowerLeg.L/R } and — critically — Foot.L/R are IK-style
 * bones parented to ROOT, not to the legs, so they are re-anchored under the
 * ankles by hand. The bind pose is an asymmetric idle frame, so each leg is
 * AIMED (rotate by currentAngle - targetAngle about the world X axis) rather
 * than blindly rotated ±90°. Verified by numbers via a throwaway FK script on
 * the GLB node tree: thighs land horizontal (knee y == hip y ± 0.02), knees
 * +0.41u forward, hips drop 0.40 GLB-u onto the seat (≈0.47u at farmer 1.6)
 * and both feet land within 0.04u of the floor; the bind foot bone sits
 * exactly on the ankle joint (offset 0.000), so feet follow ankles 1:1.
 *
 * BUDGET — every static material is one merged mesh; each PERSON's 10-12
 * skinned primitives are rebaked into ONE SkinnedMesh (flat GLB colors baked
 * to vertex colors, the four per-mesh skins remapped onto a unified
 * skeleton). Tally: 3 people + floor + walls/ceiling + furniture wood + stone
 * + soot + ceramics + food + rug + runner + curtains + window + picture +
 * 2 fire layers + 2 candle flames = 19 draws (target <= 22). Exactly two
 * PointLights, both 0 and root.visible=false until setLit(true). Shadows off
 * on everything. All randomness is one mulberry32 stream — fully
 * deterministic. update() allocates nothing. */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Scene,
  Skeleton,
  SkinnedMesh,
  Vector3,
  type Bone,
  type Object3D,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, type Rng } from '../game/rng'
import { tint, type Assets } from './assets'
import { normalizeHeight } from './scale'
import { makeCanvas, toTexture, woodCanvas } from './textures'

/** the set lives far off the playable farm — the camera just looks at it */
export const HOME_ANCHOR = new Vector3(120, 0, 120)
/** the open fourth wall faces the farm (south-west) — the camera shoots from there */
const ROOT_YAW = -Math.PI * 0.75

const ROOM_W = 6.5
const ROOM_D = 5.2
const WALL_H = 3.0
const FLOOR_TOP = 0.02
/** table center + top size, room-local */
const TABLE = { x: 0.35, z: 0.15, w: 1.9, d: 1.05 }
/** fireplace center x on the back wall */
const FP_X = -1.7
const FIRE_BASE_INTENSITY = 2.6
/** family heights (farmer is the 1.6u reference from the scale contract) */
const DAD_H = 1.6
const WIFE_H = 1.5
const CHILD_H = 0.95
const LEAN_AMP = 0.05

const X_AXIS = new Vector3(1, 0, 0)
const Y_AXIS = new Vector3(0, 1, 0)
const TQ1 = new Quaternion()
const TQ2 = new Quaternion()
const TQ3 = new Quaternion()
const TV1 = new Vector3()
const TV2 = new Vector3()
const TM = new Matrix4()

// ---- canvases (house art rule: no flat-color blobs, ever) -------------------

/** mortar + warm field-stone courses for the fireplace */
function stoneCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 128)
  g.fillStyle = '#4d433a'
  g.fillRect(0, 0, 128, 128)
  const tones = ['#8a7d6e', '#796c5d', '#948674', '#6e6254', '#85786a', '#7e6f60']
  for (let row = 0; row < 6; row++) {
    const y = row * 22
    let x = row % 2 === 0 ? 0 : -14
    while (x < 128) {
      const w = 26 + rng.next() * 16
      g.fillStyle = tones[Math.floor(rng.next() * tones.length)]
      g.fillRect(x + 2, y + 2, w - 3, 19)
      // a lit top edge so each stone reads round, not painted-on
      g.fillStyle = 'rgba(255,235,205,0.12)'
      g.fillRect(x + 2, y + 2, w - 3, 3)
      g.fillStyle = 'rgba(20,14,8,0.22)'
      g.fillRect(x + 2, y + 18, w - 3, 3)
      x += w
    }
  }
  for (let i = 0; i < 260; i++) {
    const t = rng.next()
    g.fillStyle = t > 0.5 ? 'rgba(255,240,220,0.10)' : 'rgba(20,12,6,0.16)'
    g.fillRect(rng.next() * 128, rng.next() * 128, 1 + rng.next() * 1.6, 1 + rng.next() * 1.4)
  }
  return c
}

/** sooted firebox interior — near-black with ash flecks and an ember warmth
 * pooled at the base */
function sootCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#171210'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 130; i++) {
    const t = rng.next()
    g.fillStyle = t > 0.6 ? 'rgba(120,110,100,0.18)' : 'rgba(0,0,0,0.3)'
    g.fillRect(rng.next() * 64, rng.next() * 64, 1 + rng.next() * 1.6, 1 + rng.next())
  }
  const glow = g.createRadialGradient(32, 62, 2, 32, 60, 34)
  glow.addColorStop(0, 'rgba(255,130,45,0.30)')
  glow.addColorStop(1, 'rgba(255,130,45,0)')
  g.fillStyle = glow
  g.fillRect(0, 0, 64, 64)
  return c
}

/** the window at night: deep blue sky, star speckle, a small moon, painted
 * cross-frame — unlit material so it glows against the dark wall */
function nightWindowCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(112, 128)
  const sky = g.createLinearGradient(0, 0, 0, 128)
  sky.addColorStop(0, '#0a142e')
  sky.addColorStop(0.6, '#152647')
  sky.addColorStop(1, '#1d3357')
  g.fillStyle = sky
  g.fillRect(0, 0, 112, 128)
  for (let i = 0; i < 46; i++) {
    const x = 10 + rng.next() * 92
    const y = 8 + rng.next() * 100
    g.globalAlpha = 0.35 + rng.next() * 0.6
    g.fillStyle = rng.next() > 0.3 ? '#e8eefc' : '#9fb6e8'
    g.beginPath()
    g.arc(x, y, 0.5 + rng.next() * 0.9, 0, Math.PI * 2)
    g.fill()
  }
  // three brighter stars get a tiny sparkle cross
  for (let i = 0; i < 3; i++) {
    const x = 14 + rng.next() * 84
    const y = 12 + rng.next() * 70
    g.globalAlpha = 0.85
    g.strokeStyle = '#f4f7ff'
    g.lineWidth = 0.8
    g.beginPath()
    g.moveTo(x - 2.6, y)
    g.lineTo(x + 2.6, y)
    g.moveTo(x, y - 2.6)
    g.lineTo(x, y + 2.6)
    g.stroke()
  }
  g.globalAlpha = 1
  // moon, upper-right pane
  const halo = g.createRadialGradient(80, 28, 2, 80, 28, 20)
  halo.addColorStop(0, 'rgba(220,232,255,0.5)')
  halo.addColorStop(1, 'rgba(220,232,255,0)')
  g.fillStyle = halo
  g.fillRect(56, 4, 56, 52)
  g.fillStyle = '#e6edfb'
  g.beginPath()
  g.arc(80, 28, 9, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = 'rgba(170,185,215,0.5)'
  g.beginPath()
  g.arc(77, 26, 2.2, 0, Math.PI * 2)
  g.arc(83, 31, 1.6, 0, Math.PI * 2)
  g.fill()
  // glass sheen
  g.fillStyle = 'rgba(255,255,255,0.05)'
  g.beginPath()
  g.moveTo(8, 120)
  g.lineTo(40, 8)
  g.lineTo(58, 8)
  g.lineTo(26, 120)
  g.closePath()
  g.fill()
  // painted frame + mullions
  g.fillStyle = '#2e2115'
  g.fillRect(0, 0, 112, 8)
  g.fillRect(0, 120, 112, 8)
  g.fillRect(0, 0, 8, 128)
  g.fillRect(104, 0, 8, 128)
  g.fillRect(53, 0, 6, 128)
  g.fillRect(0, 61, 112, 6)
  return c
}

/** rust-red curtain with vertical fold shading and a pale hem */
function curtainCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(80, 128)
  g.fillStyle = '#9c4f38'
  g.fillRect(0, 0, 80, 128)
  for (let x = 0; x < 80; x++) {
    const k = Math.sin((x / 80) * Math.PI * 5.2 + 0.6)
    g.fillStyle = k > 0 ? `rgba(255,210,180,${0.16 * k})` : `rgba(40,12,6,${-0.22 * k})`
    g.fillRect(x, 0, 1, 128)
  }
  // weave flecks
  for (let i = 0; i < 160; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,222,196,0.10)' : 'rgba(48,16,8,0.12)'
    g.fillRect(rng.next() * 80, rng.next() * 128, 1.4, 1)
  }
  g.fillStyle = '#caa27a'
  g.fillRect(0, 120, 80, 4)
  g.fillStyle = 'rgba(60,24,12,0.4)'
  g.fillRect(0, 124, 80, 4)
  return c
}

/** cream table runner with rust end-stripes and fringe ticks */
function runnerCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 64)
  g.fillStyle = '#e3d3b4'
  g.fillRect(0, 0, 128, 64)
  for (let i = 0; i < 240; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(120,96,60,0.10)' : 'rgba(255,250,235,0.12)'
    g.fillRect(rng.next() * 128, rng.next() * 64, 2, 1)
  }
  g.fillStyle = '#9c4f38'
  for (const x of [6, 14, 108, 116]) g.fillRect(x, 3, 4, 58)
  g.fillStyle = '#6f8f55'
  for (const x of [11, 113]) g.fillRect(x, 3, 2, 58)
  g.strokeStyle = 'rgba(90,60,30,0.55)'
  g.lineWidth = 1
  for (let y = 4; y < 62; y += 4) {
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(4, y)
    g.moveTo(124, y)
    g.lineTo(128, y)
    g.stroke()
  }
  return c
}

/** braided oval rug — concentric bands, transparent outside (alpha cutout) */
function rugCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(160, 112)
  const bands = ['#9c5f3a', '#7d6647', '#b08050', '#6b4f33', '#a8714a', '#8a5a40', '#74604a', '#9a6c44']
  for (let i = 0; i < 10; i++) {
    const rx = 76 - i * 7.4
    const ry = 52 - i * 5.1
    if (rx <= 3 || ry <= 2) break
    g.strokeStyle = bands[i % bands.length]
    g.lineWidth = 7.6
    g.beginPath()
    g.ellipse(80, 56, rx, ry, 0, 0, Math.PI * 2)
    g.stroke()
  }
  // braid stitches: short dark ticks along the bands
  g.strokeStyle = 'rgba(40,24,12,0.32)'
  g.lineWidth = 1.4
  for (let i = 0; i < 230; i++) {
    const a = rng.next() * Math.PI * 2
    const k = 0.2 + rng.next() * 0.78
    const x = 80 + Math.cos(a) * 76 * k
    const y = 56 + Math.sin(a) * 52 * k
    g.beginPath()
    g.moveTo(x, y - 1.6)
    g.lineTo(x + 1.6, y + 1.6)
    g.stroke()
  }
  return c
}

/** framed naive painting of the farm — a wink at the world outside */
function pictureCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 56)
  g.fillStyle = '#8fb6d8'
  g.fillRect(0, 0, 64, 56)
  g.fillStyle = '#f2e2a8'
  g.beginPath()
  g.arc(48, 14, 6, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#6f8f55'
  g.beginPath()
  g.moveTo(0, 34)
  g.quadraticCurveTo(18, 24, 38, 33)
  g.quadraticCurveTo(54, 39, 64, 32)
  g.lineTo(64, 56)
  g.lineTo(0, 56)
  g.closePath()
  g.fill()
  g.fillStyle = '#577a43'
  g.beginPath()
  g.moveTo(0, 44)
  g.quadraticCurveTo(26, 38, 64, 45)
  g.lineTo(64, 56)
  g.lineTo(0, 56)
  g.closePath()
  g.fill()
  // the little red barn
  g.fillStyle = '#9c3b2a'
  g.fillRect(16, 30, 13, 9)
  g.fillStyle = '#5e2418'
  g.beginPath()
  g.moveTo(14, 30)
  g.lineTo(22.5, 24)
  g.lineTo(31, 30)
  g.closePath()
  g.fill()
  g.fillStyle = '#3c2414'
  g.fillRect(21, 34, 3, 5)
  // grass flecks
  for (let i = 0; i < 30; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,250,220,0.25)' : 'rgba(30,50,20,0.3)'
    g.fillRect(rng.next() * 64, 40 + rng.next() * 14, 1.4, 1)
  }
  // frame
  g.fillStyle = '#4a3015'
  g.fillRect(0, 0, 64, 4)
  g.fillRect(0, 52, 64, 4)
  g.fillRect(0, 0, 4, 56)
  g.fillRect(60, 0, 4, 56)
  g.strokeStyle = 'rgba(255,220,160,0.35)'
  g.lineWidth = 1
  g.strokeRect(4.5, 4.5, 55, 47)
  return c
}

/** cream glazed crockery with blue band stripes (shelf silhouettes) */
function glazeCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#e9ddc6'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = '#5276a8'
  g.fillRect(0, 16, 64, 7)
  g.fillRect(0, 40, 64, 4)
  g.fillStyle = 'rgba(82,118,168,0.4)'
  g.fillRect(0, 26, 64, 2)
  for (let i = 0; i < 90; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,255,245,0.18)' : 'rgba(110,90,60,0.10)'
    g.fillRect(rng.next() * 64, rng.next() * 64, 1.4, 1.2)
  }
  return c
}

/** layered flame tongues over an ember-glow base — sampled additively by the
 * fire quads (full canvas) and the ember quad (bottom strip) */
function fireCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(96, 128)
  const ember = g.createRadialGradient(48, 119, 3, 48, 116, 42)
  ember.addColorStop(0, 'rgba(255,150,50,0.9)')
  ember.addColorStop(0.5, 'rgba(255,100,30,0.45)')
  ember.addColorStop(1, 'rgba(255,80,20,0)')
  g.fillStyle = ember
  g.fillRect(0, 76, 96, 52)
  const tongue = (cx: number, w: number, h: number, hot: number): void => {
    const tipX = cx + (rng.next() - 0.5) * 14
    const grad = g.createLinearGradient(0, 122, 0, 122 - h)
    grad.addColorStop(0, `rgba(255,247,216,${0.92 * hot})`)
    grad.addColorStop(0.35, `rgba(255,210,119,${0.85 * hot})`)
    grad.addColorStop(0.7, `rgba(255,150,54,${0.6 * hot})`)
    grad.addColorStop(0.9, `rgba(255,90,20,${0.28 * hot})`)
    grad.addColorStop(1, 'rgba(255,70,10,0)')
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(cx - w, 122)
    g.quadraticCurveTo(cx - w * 1.1, 122 - h * 0.45, tipX, 122 - h)
    g.quadraticCurveTo(cx + w * 1.1, 122 - h * 0.45, cx + w, 122)
    g.closePath()
    g.fill()
  }
  tongue(22, 11, 52 + rng.next() * 14, 0.7)
  tongue(72, 12, 58 + rng.next() * 16, 0.75)
  tongue(36, 13, 78 + rng.next() * 14, 0.85)
  tongue(60, 12, 88 + rng.next() * 16, 0.9)
  tongue(48, 14, 104 + rng.next() * 14, 1)
  return c
}

// ---- small geometry helpers ---------------------------------------------------

function uvScale(geo: BufferGeometry, su: number, sv: number): void {
  const uv = geo.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
}

function remapUV(geo: BufferGeometry, u0: number, v0: number, u1: number, v1: number): void {
  const uv = geo.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0))
}

function box(geos: BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): void {
  const g = new BoxGeometry(w, h, d)
  if (ry !== 0) g.rotateY(ry)
  g.translate(x, y, z)
  geos.push(g)
}

function cyl(geos: BufferGeometry[], rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 10): void {
  const g = new CylinderGeometry(rt, rb, h, seg)
  g.translate(x, y, z)
  geos.push(g)
}

/** merge a bucket into one draw call (static set pieces, shadows off) */
function bake(root: Group, geos: BufferGeometry[], mat: MeshBasicMaterial | MeshStandardMaterial): Mesh | null {
  const merged = mergeGeometries(geos)
  if (!merged) return null
  const m = new Mesh(merged, mat)
  m.castShadow = false
  m.receiveShadow = false
  root.add(m)
  return m
}

/** strip a spawned GLB mesh down to position/normal/uv, non-indexed, so food
 * items from different files merge into one colormap draw */
function normalizeStatic(geo: BufferGeometry): BufferGeometry {
  const ng = geo.index ? geo.toNonIndexed() : geo.clone()
  const out = new BufferGeometry()
  out.setAttribute('position', ng.getAttribute('position'))
  out.setAttribute('normal', ng.getAttribute('normal'))
  const uv = ng.getAttribute('uv')
  out.setAttribute('uv', uv ?? new BufferAttribute(new Float32Array(ng.getAttribute('position').count * 2), 2))
  return out
}

// ---- skinned-person rebake -----------------------------------------------------

/** Rebake a Quaternius character (10-12 flat-colored skinned primitives across
 * four separate skins) into ONE SkinnedMesh: material colors -> vertex colors,
 * per-skin joint indices remapped onto a unified skeleton. Verified from the
 * GLB: all four mesh nodes carry identical transforms and bind matrices, so
 * their geometries share one space. Returns the merged mesh's material (the
 * handle tint() will find). */
function bakePerson(g: Group): void {
  const sources: SkinnedMesh[] = []
  g.traverse((o) => {
    if (o instanceof SkinnedMesh) sources.push(o)
  })
  if (sources.length < 2) return
  g.updateMatrixWorld(true)
  const bones: Bone[] = []
  const inverses: Matrix4[] = []
  const indexOf = new Map<Bone, number>()
  const geos: BufferGeometry[] = []
  for (const src of sources) {
    const remap = src.skeleton.bones.map((b, i) => {
      let j = indexOf.get(b)
      if (j === undefined) {
        j = bones.length
        indexOf.set(b, j)
        bones.push(b)
        inverses.push(src.skeleton.boneInverses[i].clone())
      }
      return j
    })
    const raw = src.geometry.index ? src.geometry.toNonIndexed() : src.geometry.clone()
    const count = raw.getAttribute('position').count
    const srcMat = (Array.isArray(src.material) ? src.material[0] : src.material) as MeshStandardMaterial
    const vc = raw.getAttribute('color')
    const col = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      col[i * 3] = srcMat.color.r * (vc ? vc.getX(i) : 1)
      col[i * 3 + 1] = srcMat.color.g * (vc ? vc.getY(i) : 1)
      col[i * 3 + 2] = srcMat.color.b * (vc ? vc.getZ(i) : 1)
    }
    const si = raw.getAttribute('skinIndex')
    const sw = raw.getAttribute('skinWeight')
    const ni = new Uint16Array(count * 4)
    const nw = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      ni[i * 4] = remap[si.getX(i)]
      ni[i * 4 + 1] = remap[si.getY(i)]
      ni[i * 4 + 2] = remap[si.getZ(i)]
      ni[i * 4 + 3] = remap[si.getW(i)]
      nw[i * 4] = sw.getX(i)
      nw[i * 4 + 1] = sw.getY(i)
      nw[i * 4 + 2] = sw.getZ(i)
      nw[i * 4 + 3] = sw.getW(i)
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', raw.getAttribute('position'))
    geo.setAttribute('normal', raw.getAttribute('normal'))
    geo.setAttribute('color', new BufferAttribute(col, 3))
    geo.setAttribute('skinIndex', new BufferAttribute(ni, 4))
    geo.setAttribute('skinWeight', new BufferAttribute(nw, 4))
    geos.push(geo)
  }
  const merged = mergeGeometries(geos)
  if (!merged) return
  const ref = sources[0]
  const mesh = new SkinnedMesh(merged, new MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.08 }))
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  ref.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale)
  g.add(mesh)
  mesh.bind(new Skeleton(bones, inverses), ref.bindMatrix.clone())
  for (const s of sources) s.removeFromParent()
}

// ---- bone math ------------------------------------------------------------------

function mustGet(g: Object3D, name: string): Object3D {
  const o = g.getObjectByName(name)
  if (!o) throw new Error(`interior rig: missing bone ${name}`)
  return o
}

/** rotate a bone about a WORLD axis through its own origin:
 * local' = (p⁻¹ · W · p) · local, p = parent world rotation */
function rotWorld(bone: Object3D, axis: Vector3, angle: number): void {
  const parent = bone.parent
  if (!parent) return
  const pq = parent.getWorldQuaternion(TQ1)
  const d = TQ2.setFromAxisAngle(axis, angle)
  bone.quaternion.premultiply(TQ3.copy(pq).invert().multiply(d).multiply(pq))
}

/** aim the bone->tip segment at a target direction in the sagittal (y/z)
 * plane: a rotation about world X by (currentAngle - targetAngle). Self-
 * corrects the rig's asymmetric idle bind frame (verified by FK numbers). */
function aimSagittal(g: Group, name: string, tipName: string, ty: number, tz: number): void {
  const bone = mustGet(g, name)
  const d = mustGet(g, tipName).getWorldPosition(TV1).sub(bone.getWorldPosition(TV2))
  rotWorld(bone, X_AXIS, Math.atan2(d.y, d.z) - Math.atan2(ty, tz))
}

/** seat height this rig needs for vertical shins: foot height + shin length.
 * NOTE bone names are GLTFLoader-sanitized: 'UpperLeg.L' in the GLB loads as
 * 'UpperLegL' (PropertyBinding strips the dots) — verified at runtime. */
function seatHeightOf(g: Group): number {
  g.updateMatrixWorld(true)
  const knee = mustGet(g, 'LowerLegL').getWorldPosition(TV2).clone()
  const shin = mustGet(g, 'LowerLegL_end').getWorldPosition(TV1).distanceTo(knee)
  return mustGet(g, 'FootL').getWorldPosition(TV1).y + shin
}

/** sit the character: thighs aimed forward, shins down, hips dropped to the
 * seat, IK feet re-anchored under the ankles, arms brought in over the lap.
 * Runs with the group unparented at the origin facing +z. */
function poseSeated(g: Group, hipTarget: number, rng: Rng, dangle: boolean): void {
  g.updateMatrixWorld(true)
  // bind foot positions + foot->ankle offsets (offset 0.000 on this rig —
  // kept general for safety)
  const bindL = mustGet(g, 'FootL').getWorldPosition(new Vector3())
  const bindR = mustGet(g, 'FootR').getWorldPosition(new Vector3())
  const offL = bindL.clone().sub(mustGet(g, 'LowerLegL_end').getWorldPosition(TV1))
  const offR = bindR.clone().sub(mustGet(g, 'LowerLegR_end').getWorldPosition(TV1))
  for (const s of ['L', 'R'] as const) {
    aimSagittal(g, `UpperLeg${s}`, `LowerLeg${s}`, -0.1 - rng.next() * 0.08, 1)
    aimSagittal(g, `LowerLeg${s}`, `LowerLeg${s}_end`, -1, (dangle ? -0.03 : 0.05) + rng.next() * 0.07)
  }
  // drop the hips onto the seat (Body carries torso + legs; feet stay put)
  const hipY = (mustGet(g, 'UpperLegL').getWorldPosition(TV1).y + mustGet(g, 'UpperLegR').getWorldPosition(TV2).y) / 2
  const body = mustGet(g, 'Body')
  const parent = body.parent
  if (parent) {
    parent.updateWorldMatrix(true, false)
    TM.copy(parent.matrixWorld).invert()
    const la = body.getWorldPosition(TV1)
    const lb = TV2.set(la.x, la.y + hipTarget - hipY, la.z).applyMatrix4(TM)
    body.position.add(lb.sub(la.applyMatrix4(TM)))
  }
  // feet follow ankles (Foot.L/R are parented to Root, not the legs)
  const rootBone = mustGet(g, 'Root')
  rootBone.updateWorldMatrix(true, false)
  TM.copy(rootBone.matrixWorld).invert()
  for (const [s, off, bind] of [['L', offL, bindL], ['R', offR, bindR]] as Array<['L' | 'R', Vector3, Vector3]>) {
    const tgt = mustGet(g, `LowerLeg${s}_end`).getWorldPosition(TV1).add(off)
    // never below bind height: feet rest flush on the floor, not buried
    tgt.y = Math.max(tgt.y, bind.y)
    mustGet(g, `Foot${s}`).position.copy(tgt.applyMatrix4(TM))
  }
  // arms in over the lap, hands toward the table edge
  for (const s of ['L', 'R'] as const) {
    aimSagittal(g, `UpperArm${s}`, `LowerArm${s}`, -0.8, 0.55 + rng.next() * 0.15)
    aimSagittal(g, `LowerArm${s}`, `Wrist${s}`, -0.1 - rng.next() * 0.1, 1)
  }
}

/** a bone the eat-motion animates: posed base orientation + its pitch/yaw
 * axes pre-converted into the parent's frame (so per-frame work is two
 * quaternion ops, no matrix math, no allocation) */
interface AnimBone {
  bone: Object3D
  base: Quaternion
  axP: Vector3
  axY: Vector3
}

/** capture runs AFTER the person is seated and turned to face the table, so
 * the pitch axis is THEIR right — (cos f, 0, -sin f) for facing f — not the
 * room's X (else dad and the child, rotated ±90°, would lean sideways) */
function capture(bone: Object3D, facing: number): AnimBone {
  const pq = bone.parent ? bone.parent.getWorldQuaternion(TQ1) : TQ1.identity()
  const inv = TQ2.copy(pq).invert()
  return {
    bone,
    base: bone.quaternion.clone(),
    axP: new Vector3(Math.cos(facing), 0, -Math.sin(facing)).applyQuaternion(inv),
    axY: new Vector3(0, 1, 0).applyQuaternion(inv),
  }
}

function setQ(h: AnimBone, pitch: number, yaw: number): void {
  const q = h.bone.quaternion.copy(h.base)
  if (pitch !== 0) q.premultiply(TQ1.setFromAxisAngle(h.axP, pitch))
  if (yaw !== 0) q.premultiply(TQ1.setFromAxisAngle(h.axY, yaw))
}

function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

interface GazeSeg {
  yaw: number
  pitch: number
  dur: number
}

interface Diner {
  facing: number
  torso: AnimBone
  chest: AnimBone
  head: AnimBone
  shL: AnimBone
  shR: AnimBone
  armU: AnimBone
  armL: AnimBone
  gaze: GazeSeg[]
  gi: number
  gt: number
  curYaw: number
  curPitch: number
  leanW: number
  leanP: number
  breathP: number
  biteP: number
  biteO: number
  /** child only: dangling-leg swing + per-frame ankle-follow for the IK feet */
  swing: {
    legL: AnimBone
    legR: AnimBone
    footL: Object3D
    footR: Object3D
    ankL: Object3D
    ankR: Object3D
    root: Object3D
  } | null
}

// ---- the set --------------------------------------------------------------------

export class HomeInterior {
  /** the authored shot (cutscene camera uses these exactly) */
  readonly camFocus: Vector3
  readonly camYaw: number
  readonly camPitch: number
  readonly camDist: number
  readonly camFov: number

  private readonly root = new Group()
  private readonly fireLight: PointLight
  private readonly tableLight: PointLight
  private readonly roomFill: PointLight
  private readonly fireA: Mesh
  private readonly fireB: Mesh
  private readonly flames: Mesh[] = []
  private readonly diners: Diner[] = []
  private lit = false
  private t = 0

  constructor(scene: Scene, assets: Assets) {
    const rng = mulberry32(0x715e77)

    // ---- the family first: the farmer's rig dictates the seat height ------
    const dadG = assets.spawnSkinned('farmer')
    const wifeG = assets.spawnSkinned('customerC')
    const childG = assets.spawnSkinned('customerC')
    bakePerson(dadG)
    bakePerson(wifeG)
    bakePerson(childG)
    normalizeHeight(dadG, DAD_H)
    normalizeHeight(wifeG, WIFE_H)
    normalizeHeight(childG, CHILD_H)
    // mom a hair warmer, the kid clearly their own little person
    tint(wifeG, -0.03, 0.03)
    childG.traverse((o) => {
      if (o instanceof SkinnedMesh && o.material instanceof MeshStandardMaterial) o.material.color.set('#ffe3cf')
    })
    tint(childG, 0.06, 0.05)

    /** person-space seat height for vertical adult shins (~0.45u) */
    const seat = seatHeightOf(dadG)
    const tableH = seat + 0.31
    const tableTop = FLOOR_TOP + tableH

    poseSeated(dadG, seat + 0.02, rng, false)
    poseSeated(wifeG, seat + 0.02, rng, false)
    poseSeated(childG, seat + 0.02, rng, true)

    // dad at the head, mom across from the camera, the kid facing dad —
    // nobody's back to the open fourth wall (film-set blocking)
    const chairGap = TABLE.w / 2 + 0.18
    const places: Array<{ g: Group; x: number; z: number; facing: number }> = [
      { g: dadG, x: TABLE.x - chairGap, z: TABLE.z, facing: Math.PI / 2 },
      { g: wifeG, x: TABLE.x, z: TABLE.z - (TABLE.d / 2 + 0.18), facing: 0 },
      { g: childG, x: TABLE.x + chairGap, z: TABLE.z, facing: -Math.PI / 2 },
    ]
    for (const p of places) {
      p.g.position.set(p.x, FLOOR_TOP, p.z)
      p.g.rotation.y = p.facing
      this.root.add(p.g)
    }
    this.root.updateMatrixWorld(true)

    // ---- eat-motion rigging -------------------------------------------------
    const heads: Vector3[] = []
    for (const p of places) heads.push(mustGet(p.g, 'Head').getWorldPosition(new Vector3()))
    const look = (from: number, to: number): { yaw: number; pitch: number } => {
      const d = TV1.copy(heads[to]).sub(heads[from])
      return {
        yaw: clamp(wrapPi(Math.atan2(d.x, d.z) - places[from].facing), -0.95, 0.95),
        pitch: clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)) * 0.8, -0.35, 0.2),
      }
    }
    const seg = (at: { yaw: number; pitch: number }, dur: number): GazeSeg => ({
      yaw: at.yaw,
      pitch: at.pitch,
      dur: dur * (0.85 + rng.next() * 0.3),
    })
    const plate = { yaw: 0, pitch: 0.26 }
    // the emotional beat: the child's gaze keeps returning to dad, and stays
    const gazes: GazeSeg[][] = [
      [seg(plate, 2.4), seg(look(0, 1), 1.7), seg(plate, 2.6), seg(look(0, 2), 2.3), seg(look(0, 1), 1.3)],
      [seg(plate, 2.1), seg(look(1, 2), 2.4), seg(plate, 1.7), seg(look(1, 0), 1.9), seg(plate, 1.5)],
      [seg(look(2, 0), 5.0), seg(plate, 1.7), seg(look(2, 1), 1.5), seg(look(2, 0), 4.4), seg(plate, 2.1)],
    ]
    for (let i = 0; i < places.length; i++) {
      const g = places[i].g
      const f = places[i].facing
      const diner: Diner = {
        facing: f,
        torso: capture(mustGet(g, 'Torso'), f),
        chest: capture(mustGet(g, 'Chest'), f),
        head: capture(mustGet(g, 'Head'), f),
        shL: capture(mustGet(g, 'ShoulderL'), f),
        shR: capture(mustGet(g, 'ShoulderR'), f),
        armU: capture(mustGet(g, 'UpperArmR'), f),
        armL: capture(mustGet(g, 'LowerArmR'), f),
        gaze: gazes[i],
        gi: 0,
        gt: rng.next() * 1.5,
        curYaw: 0,
        curPitch: 0.2,
        leanW: 0.45 + rng.next() * 0.25,
        leanP: rng.next() * Math.PI * 2,
        breathP: rng.next() * Math.PI * 2,
        biteP: 5.5 + rng.next() * 2.5,
        biteO: rng.next() * 6,
        swing: null,
      }
      if (g === childG) {
        diner.swing = {
          legL: capture(mustGet(g, 'LowerLegL'), f),
          legR: capture(mustGet(g, 'LowerLegR'), f),
          footL: mustGet(g, 'FootL'),
          footR: mustGet(g, 'FootR'),
          ankL: mustGet(g, 'LowerLegL_end'),
          ankR: mustGet(g, 'LowerLegR_end'),
          root: mustGet(g, 'Root'),
        }
      }
      this.diners.push(diner)
    }

    // ---- shell: plank floor, three board walls, ceiling hint ---------------
    // faint emissive floors on the shell: the set plays under FULL night, and
    // any face the point lights miss would otherwise render as black void
    const floorMat = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#6e4f30'), true), roughness: 0.92, emissive: '#160d06', emissiveIntensity: 1 })
    const floorGeo = new BoxGeometry(ROOM_W, 0.06, ROOM_D)
    uvScale(floorGeo, 5, 4)
    floorGeo.translate(0, FLOOR_TOP - 0.03, 0)
    bake(this.root, [floorGeo], floorMat)

    const wallMat = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#8a6c47'), true), roughness: 0.95, emissive: '#1c1209', emissiveIntensity: 1 })
    const walls: BufferGeometry[] = []
    const backWall = new PlaneGeometry(ROOM_W, WALL_H)
    uvScale(backWall, 4.6, 2.1)
    backWall.translate(0, WALL_H / 2, -ROOM_D / 2)
    walls.push(backWall)
    const leftWall = new PlaneGeometry(ROOM_D, WALL_H)
    uvScale(leftWall, 3.7, 2.1)
    leftWall.rotateY(Math.PI / 2)
    leftWall.translate(-ROOM_W / 2, WALL_H / 2, 0)
    walls.push(leftWall)
    const rightWall = new PlaneGeometry(ROOM_D, WALL_H)
    uvScale(rightWall, 3.7, 2.1)
    rightWall.rotateY(-Math.PI / 2)
    rightWall.translate(ROOM_W / 2, WALL_H / 2, 0)
    walls.push(rightWall)
    const ceiling = new PlaneGeometry(ROOM_W, 3.4)
    uvScale(ceiling, 4.6, 2.4)
    ceiling.rotateX(Math.PI / 2)
    ceiling.translate(0, WALL_H, -0.9)
    walls.push(ceiling)
    bake(this.root, walls, wallMat)

    // ---- furniture wood: table, chairs, mantel, shelves, beams, candles ----
    const woodMat = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#5d3f24'), true), roughness: 0.85 })
    const wood: BufferGeometry[] = []
    box(wood, TABLE.w + 0.08, 0.07, TABLE.d + 0.08, TABLE.x, FLOOR_TOP + tableH - 0.035, TABLE.z)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(wood, 0.09, tableH - 0.07, 0.09, TABLE.x + sx * (TABLE.w / 2 - 0.14), FLOOR_TOP + (tableH - 0.07) / 2, TABLE.z + sz * (TABLE.d / 2 - 0.14))
      }
      box(wood, TABLE.w - 0.5, 0.09, 0.05, TABLE.x, FLOOR_TOP + tableH - 0.13, TABLE.z + sx * (TABLE.d / 2 - 0.12))
    }
    const seatTop = FLOOR_TOP + seat - 0.03
    const chair = (cx: number, cz: number, ry: number): void => {
      const part = (w: number, h: number, d: number, lx: number, ly: number, lz: number): void => {
        const g = new BoxGeometry(w, h, d)
        g.translate(lx, ly, lz)
        g.rotateY(ry)
        g.translate(cx, 0, cz)
        wood.push(g)
      }
      part(0.46, 0.05, 0.44, 0, seatTop - 0.025, 0)
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) part(0.05, seatTop - 0.05, 0.05, sx * 0.19, (seatTop - 0.05) / 2, sz * 0.17)
        part(0.05, 0.6, 0.05, sx * 0.19, seatTop + 0.3, -0.195)
      }
      part(0.37, 0.08, 0.035, 0, seatTop + 0.5, -0.195)
      part(0.37, 0.07, 0.035, 0, seatTop + 0.3, -0.195)
    }
    for (const p of places) chair(p.x, p.z, p.facing)
    // mantel over the fireplace, two shelf boards on the right wall, beams
    box(wood, 1.9, 0.09, 0.55, FP_X, 1.53, -ROOM_D / 2 + 0.32)
    box(wood, 0.26, 0.05, 1.1, ROOM_W / 2 - 0.15, 1.45, -0.6)
    box(wood, 0.26, 0.05, 1.1, ROOM_W / 2 - 0.15, 1.9, -0.6)
    for (const bz of [-2.0, -0.7, 0.6]) box(wood, ROOM_W, 0.16, 0.14, 0, WALL_H - 0.1, bz)
    // candlesticks on the runner
    const candleAt: Array<[number, number]> = [
      [TABLE.x - 0.38, TABLE.z - 0.2],
      [TABLE.x + 0.18, TABLE.z + 0.28],
    ]
    for (const [cx, cz] of candleAt) {
      cyl(wood, 0.042, 0.052, 0.025, cx, tableTop + 0.0125, cz)
      cyl(wood, 0.013, 0.015, 0.13, cx, tableTop + 0.09, cz, 8)
    }
    bake(this.root, wood, woodMat)

    // ---- stone fireplace on the back wall, opening toward the camera -------
    const stoneMat = new MeshStandardMaterial({ map: toTexture(stoneCanvas(rng), true), roughness: 0.98 })
    const stone: BufferGeometry[] = []
    const fpZ = -ROOM_D / 2
    box(stone, 2.1, 0.06, 0.8, FP_X, FLOOR_TOP + 0.03, fpZ + 0.42)
    for (const s of [-1, 1]) box(stone, 0.42, 1.0, 0.5, FP_X + s * 0.66, 0.58, fpZ + 0.25)
    box(stone, 1.74, 0.4, 0.5, FP_X, 1.28, fpZ + 0.25)
    box(stone, 1.1, WALL_H - 1.48, 0.42, FP_X, (WALL_H + 1.48) / 2, fpZ + 0.21)
    bake(this.root, stone, stoneMat)

    // sooted firebox interior (back + side panels)
    const sootMat = new MeshStandardMaterial({ map: toTexture(sootCanvas(rng)), roughness: 1 })
    const soot: BufferGeometry[] = []
    const sootBack = new PlaneGeometry(0.94, 1.04)
    sootBack.translate(FP_X, 0.58, fpZ + 0.05)
    soot.push(sootBack)
    for (const s of [-1, 1]) {
      const panel = new PlaneGeometry(0.46, 1.04)
      panel.rotateY((-s * Math.PI) / 2)
      panel.translate(FP_X + s * 0.45, 0.58, fpZ + 0.27)
      soot.push(panel)
    }
    bake(this.root, soot, sootMat)

    // ---- the fire: two additive layers + the ember bed ----------------------
    const fireMat = new MeshBasicMaterial({
      map: toTexture(fireCanvas(rng)),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    })
    const flameQuad = (w: number, h: number, ry: number): BufferGeometry => {
      const q = new PlaneGeometry(w, h)
      q.translate(0, h / 2, 0)
      if (ry !== 0) q.rotateY(ry)
      return q
    }
    const geoA = mergeGeometries([flameQuad(0.64, 0.78, 0.55), flameQuad(0.58, 0.72, -0.5)])
    const ember = new PlaneGeometry(0.6, 0.36)
    remapUV(ember, 0.18, 0, 0.82, 0.24)
    ember.rotateX(-Math.PI / 2)
    ember.translate(0, 0.02, 0.05)
    const geoB = mergeGeometries([flameQuad(0.5, 0.62, 0.05), ember])
    this.fireA = new Mesh(geoA ?? new PlaneGeometry(0.6, 0.7), fireMat)
    this.fireB = new Mesh(geoB ?? new PlaneGeometry(0.5, 0.6), fireMat)
    for (const f of [this.fireA, this.fireB]) {
      f.position.set(FP_X, FLOOR_TOP + 0.07, fpZ + 0.3)
      f.renderOrder = 2
      this.root.add(f)
    }
    // candle flames ride their sticks (tiny, same additive sheet)
    for (let i = 0; i < candleAt.length; i++) {
      const flame = new Mesh(flameQuad(0.06, 0.12, 0), fireMat)
      flame.position.set(candleAt[i][0], tableTop + 0.15, candleAt[i][1])
      flame.renderOrder = 2
      this.flames.push(flame)
      this.root.add(flame)
    }

    // ---- window (unlit night glow), curtains, picture, rug, runner ---------
    const winMat = new MeshBasicMaterial({ map: toTexture(nightWindowCanvas(rng)) })
    const win = new PlaneGeometry(1.05, 0.95)
    win.translate(1.3, 1.62, -ROOM_D / 2 + 0.015)
    bake(this.root, [win], winMat)

    const curtainMat = new MeshStandardMaterial({ map: toTexture(curtainCanvas(rng)), roughness: 1, side: DoubleSide })
    const curtains: BufferGeometry[] = []
    for (const s of [-1, 1]) {
      const panel = new PlaneGeometry(0.48, 1.32)
      panel.rotateY(s * 0.22)
      panel.translate(1.3 + s * 0.74, 1.56, -ROOM_D / 2 + 0.09)
      curtains.push(panel)
    }
    bake(this.root, curtains, curtainMat)

    const picMat = new MeshStandardMaterial({ map: toTexture(pictureCanvas(rng)), roughness: 0.9 })
    const pic = new PlaneGeometry(0.62, 0.52)
    pic.translate(-0.2, 1.95, -ROOM_D / 2 + 0.02)
    bake(this.root, [pic], picMat)

    const rugMat = new MeshStandardMaterial({ map: toTexture(rugCanvas(rng)), roughness: 1, alphaTest: 0.5 })
    const rug = new PlaneGeometry(3.1, 2.3)
    rug.rotateX(-Math.PI / 2)
    rug.translate(TABLE.x, FLOOR_TOP + 0.012, TABLE.z)
    bake(this.root, [rug], rugMat)

    const runnerMat = new MeshStandardMaterial({ map: toTexture(runnerCanvas(rng)), roughness: 1, side: DoubleSide })
    const runner: BufferGeometry[] = []
    const runTop = new PlaneGeometry(TABLE.w + 0.06, 0.5)
    runTop.rotateX(-Math.PI / 2)
    runTop.translate(TABLE.x, tableTop + 0.005, TABLE.z)
    runner.push(runTop)
    for (const s of [-1, 1]) {
      const drop = new PlaneGeometry(0.5, 0.26)
      remapUV(drop, 0.3, 0, 0.7, 1)
      drop.rotateY((s * Math.PI) / 2)
      drop.translate(TABLE.x + s * (TABLE.w / 2 + 0.035), tableTop - 0.13, TABLE.z)
      runner.push(drop)
    }
    bake(this.root, runner, runnerMat)

    // ---- crockery silhouettes on the shelves --------------------------------
    const glazeMat = new MeshStandardMaterial({ map: toTexture(glazeCanvas(rng), true), roughness: 0.5 })
    const glaze: BufferGeometry[] = []
    const shelfX = ROOM_W / 2 - 0.15
    for (const cz of [-1.0, -0.62, -0.26]) cyl(glaze, 0.044, 0.05, 0.08, shelfX, 1.515, cz)
    for (const cz of [-0.95, -0.4]) {
      cyl(glaze, 0.036, 0.042, 0.17, shelfX, 2.01, cz)
      cyl(glaze, 0.016, 0.02, 0.07, shelfX, 2.13, cz, 8)
    }
    cyl(glaze, 0.075, 0.075, 0.05, shelfX, 1.95, -0.66)
    bake(this.root, glaze, glazeMat)

    // ---- the set table: Kenney food kit, merged into ONE colormap draw ------
    // measured GLB sizes (units at scale 1): turkey 0.95w, pie 0.95ø, plate
    // 0.89ø, bowl 0.58, cup 0.29, bread 0.44 — the kit is authored near
    // life-size, so it reads on the 1.9u table at 0.4-0.85, NOT 1.5-2.5
    // (a 1.5x plate would be 1.34u — wider than a chair)
    const foodGeos: BufferGeometry[] = []
    let foodMat: MeshStandardMaterial | null = null
    const food = (key: 'turkey' | 'pie' | 'breadLoaf' | 'plateDinner' | 'bowlSoup' | 'cupTea', s: number, dx: number, dz: number, dy = 0.008): void => {
      const g = assets.spawn(key)
      g.scale.setScalar(s)
      // dy floats every item just above the runner cloth (no z-fighting)
      g.position.set(TABLE.x + dx, tableTop + dy, TABLE.z + dz)
      g.rotation.y = rng.next() * Math.PI * 2
      g.updateMatrixWorld(true)
      g.traverse((o) => {
        if (o instanceof Mesh && !(o instanceof SkinnedMesh)) {
          const geo = normalizeStatic(o.geometry)
          geo.applyMatrix4(o.matrixWorld)
          foodGeos.push(geo)
          if (!foodMat) {
            const m = Array.isArray(o.material) ? o.material[0] : o.material
            if (m instanceof MeshStandardMaterial) foodMat = m
          }
        }
      })
    }
    food('turkey', 0.5, 0, 0)
    food('breadLoaf', 0.85, -0.42, 0.3)
    food('pie', 0.38, 0.42, 0.32)
    // a place setting per chair: plate at the edge, soup bowl sitting in the
    // plate (real table setting — and it keeps the crowded top collision-free,
    // clearances hand-checked against each item's measured radius)
    food('plateDinner', 0.42, -0.66, 0)
    food('bowlSoup', 0.42, -0.66, 0, 0.06)
    food('cupTea', 0.5, -0.78, 0.3)
    food('plateDinner', 0.42, 0, -0.33)
    food('bowlSoup', 0.42, 0, -0.33, 0.06)
    food('cupTea', 0.5, -0.28, -0.3)
    food('plateDinner', 0.42, 0.66, 0)
    food('bowlSoup', 0.42, 0.66, 0, 0.06)
    food('cupTea', 0.5, 0.6, -0.3)
    const foodMerged = mergeGeometries(foodGeos)
    if (foodMerged && foodMat) {
      const m = new Mesh(foodMerged, foodMat)
      m.castShadow = false
      m.receiveShadow = false
      this.root.add(m)
    }

    // ---- the scene's lights, dark until it plays ----------------------------
    this.fireLight = new PointLight('#ff9a4e', 0, 7.5, 2)
    this.fireLight.position.set(FP_X, 0.62, fpZ + 0.55)
    this.root.add(this.fireLight)
    this.tableLight = new PointLight('#ffc98a', 0, 6.5, 2)
    this.tableLight.position.set(TABLE.x, tableTop + 1.15, TABLE.z)
    this.root.add(this.tableLight)
    // a high warm fill so the WALLS read as a room (the cutscene plays under
    // full night, when the world's ambient light is nearly gone) — gentle
    // falloff (decay 1.2) or the corners go void-black at wall distance
    this.roomFill = new PointLight('#8a6f4e', 0, 11, 1.2)
    this.roomFill.position.set(0, 2.45, 0)
    this.root.add(this.roomFill)

    // ---- place the set off-world and author the shot ------------------------
    this.root.position.copy(HOME_ANCHOR)
    this.root.rotation.y = ROOT_YAW
    scene.add(this.root)
    // focus nudged toward the kid's end so all THREE diners frame together
    this.camFocus = new Vector3(TABLE.x + 0.18, 0.92, TABLE.z - 0.1).applyAxisAngle(Y_AXIS, ROOT_YAW).add(HOME_ANCHOR)
    // the shot lives INSIDE the room (dist past ~2.9 walks the camera out the
    // open fourth wall and the set reads as a floating dollhouse) — a low 3/4
    // diagonal at seated eye height through a WIDE lens (the gameplay 42° fov
    // can't hold three diners at a 1.9u table from in-room distance): dad
    // foreground-left, mom center facing the lens past the turkey's edge,
    // the kid right
    this.camYaw = ROOT_YAW + 0.55
    this.camPitch = 0.11
    this.camDist = 2.95
    this.camFov = 54
    this.setLit(false)
  }

  /** lights + visibility on only while the scene plays (perf) */
  setLit(on: boolean): void {
    this.lit = on
    this.root.visible = on
    this.fireLight.intensity = on ? FIRE_BASE_INTENSITY : 0
    this.tableLight.intensity = on ? 2.4 : 0
    this.roomFill.intensity = on ? 2.3 : 0
  }

  /** fire flicker, candle sway, family eat-motion — zero allocations */
  update(dt: number): void {
    if (!this.lit) return
    this.t += dt
    const t = this.t
    // hearth flicker: ±12%, two incommensurate sines (never strobes)
    const n = Math.sin(t * 7.3) * 0.6 + Math.sin(t * 11.9 + 2.1) * 0.4
    this.fireLight.intensity = FIRE_BASE_INTENSITY * (1 + 0.12 * n)
    this.fireA.scale.set(1 + 0.05 * Math.sin(t * 9.1 + 1.3), 1 + 0.13 * n, 1)
    this.fireA.rotation.y = 0.07 * Math.sin(t * 3.4)
    this.fireB.scale.set(1 - 0.04 * n, 1 + 0.1 * Math.sin(t * 8.2 + 4.0), 1)
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i]
      f.rotation.z = 0.09 * Math.sin(t * 2.6 + i * 2.1)
      f.scale.set(1 - 0.06 * Math.sin(t * 9.6 + i * 1.7), 1 + 0.16 * Math.sin(t * 8.8 + i * 2.4), 1)
    }
    for (const p of this.diners) {
      // independent lean-forward/back cycle (~0.05 rad) + chest breathing
      setQ(p.torso, LEAN_AMP * Math.sin(t * p.leanW + p.leanP), 0)
      const breath = Math.sin(t * 1.55 + p.breathP)
      setQ(p.chest, 0.016 * breath, 0)
      setQ(p.shL, 0.024 * breath, 0)
      setQ(p.shR, 0.024 * Math.sin(t * 1.55 + p.breathP + 0.4), 0)
      // the occasional fork-to-mouth bite with the right arm
      const bt = (t + p.biteO) % p.biteP
      const bite = bt < 1.3 ? Math.sin((bt / 1.3) * Math.PI) ** 2 : 0
      setQ(p.armU, -0.12 * bite, 0)
      setQ(p.armL, -0.58 * bite, 0)
      // gaze: glide between plate and family (the child lingers on dad)
      p.gt += dt
      let s = p.gaze[p.gi]
      if (p.gt >= s.dur) {
        p.gt -= s.dur
        p.gi = (p.gi + 1) % p.gaze.length
        s = p.gaze[p.gi]
      }
      const k = 1 - Math.exp(-4 * dt)
      p.curYaw += (s.yaw - p.curYaw) * k
      p.curPitch += (s.pitch - p.curPitch) * k
      setQ(p.head, p.curPitch + 0.05 * bite, p.curYaw)
      // dangling legs swing — feet are Root-parented IK bones, so they chase
      // their ankles every frame while the shins move
      if (p.swing) {
        const a = 0.13 * Math.sin(t * 1.25 + 0.8)
        setQ(p.swing.legL, a, 0)
        setQ(p.swing.legR, -a * 0.85, 0)
        p.swing.footL.position.copy(p.swing.ankL.getWorldPosition(TV1).applyMatrix4(TM.copy(p.swing.root.matrixWorld).invert()))
        p.swing.footR.position.copy(p.swing.ankR.getWorldPosition(TV1).applyMatrix4(TM.copy(p.swing.root.matrixWorld).invert()))
      }
    }
  }
}
