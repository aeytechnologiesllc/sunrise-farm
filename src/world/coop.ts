/** The chicken coop — a raised plank hen house on stilts with a slanted
 * shingle shed roof, a ramp down from a small dark doorway, a nest-box bump
 * on the side and a wire-mesh run fence enclosing the front yard. House art
 * rule holds: every surface carries a painted canvas (henhouse planks,
 * staggered shingles, galvanized wire, a dark straw-lit doorway) — no flat
 * blobs. Geometry is merged per material so the whole coop is 5 draw calls.
 *
 * CoopHens drives the flock: each hen lives INSIDE (hidden) on a seeded
 * timer, pops out the doorway, hops down the ramp on a little position arc,
 * pecks and wanders the run yard with tiny hop steps, then climbs back up
 * and disappears. All behavior is fixed-step in update(); frame() runs the
 * procedural peck/bob animation with zero per-frame allocations. Randomness
 * flows through mulberry32 only — per-hen tint and size draw hue, lightness
 * and THEN henScaleFor, the same order ChickenView uses (tests/scale.test.ts
 * pins that draw order). */
import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, type Rng } from '../game/rng'
import { tint } from './assets'
import { buildHen } from './Chicken'
import { assertSpawnScale, henScaleFor, SCALE } from './scale'
import { makeCanvas, toTexture, woodCanvas } from './textures'

// ---- shared layout (the house and the hens must agree on the ramp) -----------

/** house footprint */
const W = 2.6
const D = 1.9
/** top of the raised floor — the hen door sill height */
const FLOOR_TOP = 0.5
/** wall band height above the floor; the shed roof rises RISE more at +z */
const WALL_H = 1.02
const RISE = 0.35
/** hen door: where a hen stands when she appears/disappears */
const DOOR_Z = 1.02
/** where the ramp meets the grass */
const RAMP_BASE_Z = 1.85
/** run fence: half-width and far edge; hens wander inside with a margin */
const RUN_HALF_W = 1.5
const RUN_FAR_Z = 3.45
const FENCE_H = 0.8
/** yard the hens actually use (radius ~1.4 in front of the house, clamped
 * to stay a wing's width inside the wire) */
const YARD_CZ = 2.2
const YARD_R = 1.4
const YARD_X = 1.2
const YARD_Z0 = 1.25
const YARD_Z1 = 3.2

/** meters of wall per texture tile */
const TILE = 1.1

// ---- geometry helpers ---------------------------------------------------------

/** merge a pile of geometries into one shadowed mesh (1 draw call) */
function fuse(geos: BufferGeometry[], material: MeshStandardMaterial, cast = true): Mesh | null {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g))
  const merged = mergeGeometries(parts)
  if (!merged) return null
  const m = new Mesh(merged, material)
  m.castShadow = cast
  m.receiveShadow = true
  return m
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): BoxGeometry {
  const g = new BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

/** scale uvs so a RepeatWrapping texture tiles instead of stretching */
function uvScale(geo: BufferGeometry, su: number, sv: number): BufferGeometry {
  const uv = geo.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
  return geo
}

/** single-slope shed prism: base w x d on y=0, the +z edge raised to `h`.
 * Front quad + slope quad + two side triangles; planks tile across u. */
function shedPrism(w: number, h: number, d: number): BufferGeometry {
  const hw = w / 2
  const hd = d / 2
  const pos: number[] = []
  const uv: number[] = []
  const tri = (
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cv: number,
  ): void => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz)
    uv.push(au, av, bu, bv, cu, cv)
  }
  // front face (+z), the tall edge
  tri(-hw, 0, hd, 0, 0, hw, 0, hd, 1, 0, hw, h, hd, 1, 1)
  tri(-hw, 0, hd, 0, 0, hw, h, hd, 1, 1, -hw, h, hd, 0, 1)
  // slope quad from the front-top edge down to the back-bottom edge
  tri(-hw, h, hd, 0, 0, hw, h, hd, 1, 0, hw, 0, -hd, 1, 1)
  tri(-hw, h, hd, 0, 0, hw, 0, -hd, 1, 1, -hw, 0, -hd, 0, 1)
  // side triangles
  tri(-hw, 0, -hd, 0, 0, -hw, 0, hd, 1, 0, -hw, h, hd, 1, 1)
  tri(hw, 0, hd, 0, 0, hw, 0, -hd, 1, 0, hw, h, hd, 0, 1)
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geo.computeVertexNormals()
  return geo
}

// ---- painted canvases -----------------------------------------------------------

/** henhouse planks: 4 warm red-brown boards per tile with lit edges, gap
 * shadows, wrapped grain streaks, the odd knot and nail heads */
function coopPlankCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 256)
  const bases = ['#925836', '#8a4f2e', '#9c6240', '#84502f']
  for (let p = 0; p < 4; p++) {
    const y0 = p * 64
    g.fillStyle = bases[Math.floor(rng.next() * bases.length)]
    g.fillRect(0, y0, 256, 64)
    g.fillStyle = 'rgba(255,224,180,0.10)'
    g.fillRect(0, y0 + 1, 256, 3)
    g.fillStyle = 'rgba(30,16,8,0.7)'
    g.fillRect(0, y0 + 61, 256, 3)
    // grain streaks, wrapped at ±256 so the seam tiles
    for (let i = 0; i < 30; i++) {
      const gy = y0 + 5 + rng.next() * 53
      const x = rng.next() * 256
      const len = 24 + rng.next() * 86
      const tone = rng.next()
      g.strokeStyle = tone > 0.55 ? 'rgba(128,86,52,0.5)' : 'rgba(74,42,22,0.5)'
      g.lineWidth = 0.8 + rng.next() * 1.3
      for (const ox of [-256, 0, 256]) {
        g.beginPath()
        g.moveTo(x + ox, gy)
        g.quadraticCurveTo(x + ox + len / 2, gy + (rng.next() - 0.5) * 4, x + ox + len, gy)
        g.stroke()
      }
    }
    if (rng.next() > 0.4) {
      const x = 24 + rng.next() * 208
      const y = y0 + 14 + rng.next() * 36
      g.fillStyle = 'rgba(58,34,16,0.85)'
      g.beginPath()
      g.ellipse(x, y, 3 + rng.next() * 2.5, 2 + rng.next() * 2, 0, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = 'rgba(130,88,52,0.5)'
      g.lineWidth = 1.4
      g.beginPath()
      g.ellipse(x, y, 6 + rng.next() * 3, 4 + rng.next() * 2.5, 0, 0, Math.PI * 2)
      g.stroke()
    }
    for (const nx of [12 + rng.next() * 8, 236 + rng.next() * 8]) {
      const ny = y0 + 18 + rng.next() * 28
      g.fillStyle = 'rgba(32,24,18,0.9)'
      g.beginPath()
      g.arc(nx, ny, 1.8, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(205,188,150,0.5)'
      g.fillRect(nx - 1, ny - 1, 1.2, 1.2)
    }
  }
  // weathering speckle
  for (let i = 0; i < 80; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(170,140,108,0.10)' : 'rgba(42,24,12,0.10)'
    g.fillRect(rng.next() * 256, rng.next() * 256, 2, 2)
  }
  return c
}

/** rows of staggered shingles with per-shingle tone, shadowed gaps and a
 * soft drop shadow from the row above */
function coopShingleCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 256)
  const tones = ['#5e4930', '#6c5538', '#554027', '#74603d']
  g.fillStyle = tones[0]
  g.fillRect(0, 0, 256, 256)
  for (let r = 0; r < 8; r++) {
    const y0 = r * 32
    const off = (r % 2) * 21
    for (let i = -1; i < 7; i++) {
      const x0 = i * 43 + off + (rng.next() - 0.5) * 5
      for (const ox of [-256, 0, 256]) {
        g.fillStyle = tones[Math.floor(rng.next() * tones.length)]
        g.fillRect(x0 + ox, y0, 41, 32)
        g.fillStyle = 'rgba(16,11,6,0.5)'
        g.fillRect(x0 + ox - 1.5, y0, 3, 32)
        g.fillRect(x0 + ox, y0 + 29, 41, 3)
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.30)'
    g.fillRect(0, y0, 256, 5)
  }
  // weather speckle + a touch of moss in the gaps
  for (let i = 0; i < 100; i++) {
    const t = rng.next()
    g.fillStyle = t > 0.7 ? 'rgba(124,136,90,0.18)' : t > 0.35 ? 'rgba(222,210,188,0.10)' : 'rgba(20,14,8,0.16)'
    g.fillRect(rng.next() * 256, rng.next() * 256, 2, 2)
  }
  return c
}

/** galvanized wire: cool gray with vertical draw streaks and zinc speckle */
function wireCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#97a0a4'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 30; i++) {
    g.strokeStyle = rng.next() > 0.5 ? 'rgba(225,232,235,0.35)' : 'rgba(86,94,100,0.4)'
    g.lineWidth = 0.8 + rng.next()
    const x = rng.next() * 64
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x + (rng.next() - 0.5) * 5, 64)
    g.stroke()
  }
  for (let i = 0; i < 24; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(240,245,248,0.4)' : 'rgba(70,78,84,0.35)'
    g.fillRect(rng.next() * 64, rng.next() * 64, 1.6, 1.6)
  }
  return c
}

/** the dark hen doorway: near-black interior with a faint straw glow and a
 * few stray strands at the sill */
function doorwayCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#150e07'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = 'rgba(142,112,52,0.4)'
  g.beginPath()
  g.ellipse(32, 59, 27, 9, 0, 0, Math.PI * 2)
  g.fill()
  for (let i = 0; i < 12; i++) {
    g.strokeStyle = 'rgba(196,164,92,0.35)'
    g.lineWidth = 1
    const x = 8 + rng.next() * 48
    g.beginPath()
    g.moveTo(x, 50 + rng.next() * 10)
    g.lineTo(x + (rng.next() - 0.5) * 10, 58 + rng.next() * 5)
    g.stroke()
  }
  return c
}

// ---- the hen house ---------------------------------------------------------------

/** Raised hen house, ~2.6 x 1.9 footprint and ~2.0 to the high front edge of
 * the slanted shed roof. Plank shell on short stilt legs, a ramp with treads
 * down from the small dark doorway, a nest-box bump on the right side and a
 * wire-mesh run fence (wood posts + slim galvanized bars) enclosing the
 * front yard. Origin center-ground, front +z. 5 draw calls. */
export function buildCoopHouse(seed: number): Group {
  const rng = mulberry32(seed)
  const group = new Group()
  const hz = D / 2 // front wall plane z = 0.95
  const bodyY0 = FLOOR_TOP - 0.04 // shell drops just below the floor line

  const plankMat = new MeshStandardMaterial({ map: toTexture(coopPlankCanvas(rng), true), roughness: 0.9 })
  const shingleMat = new MeshStandardMaterial({ map: toTexture(coopShingleCanvas(rng), true), roughness: 0.95 })
  const timberMat = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#6b4a2a'), true), roughness: 0.95 })
  const wireMat = new MeshStandardMaterial({ map: toTexture(wireCanvas(rng), true), roughness: 0.6, metalness: 0.35 })
  const doorMat = new MeshStandardMaterial({ map: toTexture(doorwayCanvas(rng)), roughness: 1 })

  // -- plank shell: body box + shed prism + floor slab + nest-box bump -------------
  const planks: BufferGeometry[] = []
  planks.push(uvScale(box(W, WALL_H + 0.04, D, 0, bodyY0 + (WALL_H + 0.04) / 2, 0), W / TILE, WALL_H / TILE))
  const shed = shedPrism(W, RISE, D)
  shed.translate(0, bodyY0 + WALL_H + 0.04, 0)
  planks.push(uvScale(shed, W / TILE, RISE / TILE))
  planks.push(uvScale(box(W - 0.12, 0.08, D - 0.12, 0, FLOOR_TOP - 0.04, 0), W / TILE, D / TILE))
  // nest box riding the right wall, its own little shingle lid joins the roof mesh
  planks.push(uvScale(box(0.46, 0.42, 0.72, 1.42, 0.99, -0.12), 0.7 / TILE, 0.42 / TILE))
  const plankMesh = fuse(planks, plankMat)
  if (plankMesh) group.add(plankMesh)

  // -- timber: stilts, corner trim, door frame, ramp, fence posts + rails, gate -----
  const timber: BufferGeometry[] = []
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 0, 1]) {
      const stilt = new CylinderGeometry(0.055, 0.07, FLOOR_TOP + 0.04, 7)
      stilt.translate(sx * (W / 2 - 0.16), (FLOOR_TOP + 0.04) / 2 - 0.02, sz * (D / 2 - 0.18))
      timber.push(stilt)
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    timber.push(box(0.07, WALL_H + 0.06, 0.07, sx * (W / 2 - 0.02), bodyY0 + WALL_H / 2, sz * (hz - 0.02)))
  }
  // hen-door frame (opening 0.4 x 0.5 over the sill at FLOOR_TOP)
  for (const sx of [-1, 1]) timber.push(box(0.06, 0.56, 0.07, sx * 0.24, 0.77, hz + 0.015))
  timber.push(box(0.54, 0.06, 0.07, 0, 1.07, hz + 0.015))
  // ramp board + treads, pitched from the sill down to the grass
  const rampPitch = Math.atan2(FLOOR_TOP, RAMP_BASE_Z - 0.03 - hz)
  const rampLen = Math.hypot(FLOOR_TOP, RAMP_BASE_Z - 0.03 - hz) + 0.1
  const ramp = new BoxGeometry(0.44, 0.05, rampLen)
  uvScale(ramp, 0.5, rampLen / TILE)
  ramp.rotateX(rampPitch)
  ramp.translate(0, FLOOR_TOP / 2 + 0.01, hz + (RAMP_BASE_Z - 0.03 - hz) / 2)
  timber.push(ramp)
  for (let i = 1; i <= 4; i++) {
    const u = i / 5
    const tread = new BoxGeometry(0.4, 0.028, 0.07)
    tread.rotateX(rampPitch)
    tread.translate(0, FLOOR_TOP * (1 - u) + 0.045, hz + 0.02 + (RAMP_BASE_Z - hz) * u)
    timber.push(tread)
  }
  // run fence posts: square stakes along both sides and the front line
  const postAt = (px: number, pz: number): void => {
    timber.push(box(0.06, FENCE_H, 0.06, px, FENCE_H / 2, pz))
  }
  for (const sx of [-1, 1]) {
    for (const pz of [1.0, 2.25, RUN_FAR_Z]) postAt(sx * RUN_HALF_W, pz)
    postAt(sx * 0.91, RUN_FAR_Z)
    postAt(sx * 0.32, RUN_FAR_Z) // gate posts
  }
  // wooden top rails (the wire hangs below these)
  const railY = FENCE_H - 0.03
  for (const sx of [-1, 1]) {
    timber.push(uvScale(box(0.05, 0.05, RUN_FAR_Z - 1.0, sx * RUN_HALF_W, railY, (1.0 + RUN_FAR_Z) / 2), 0.5, (RUN_FAR_Z - 1.0) / TILE))
    timber.push(uvScale(box(1.18, 0.05, 0.05, sx * 0.91, railY, RUN_FAR_Z), 1.18 / TILE, 0.5)) // front, gate gap at center
    timber.push(box(RUN_HALF_W - W / 2 + 0.06, 0.05, 0.05, sx * (W / 2 + (RUN_HALF_W - W / 2) / 2), railY, 1.0)) // ties back to the house
  }
  // little wooden gate filling the front gap: rails, two pickets, a diagonal
  for (const gy of [0.24, 0.7]) timber.push(box(0.58, 0.05, 0.045, 0, gy, RUN_FAR_Z))
  for (const gx of [-0.11, 0.11]) timber.push(box(0.05, 0.6, 0.04, gx, 0.46, RUN_FAR_Z + 0.005))
  const brace = new BoxGeometry(0.05, 0.66, 0.035)
  brace.rotateZ(0.66)
  brace.translate(0, 0.47, RUN_FAR_Z - 0.005)
  timber.push(brace)
  const timberMesh = fuse(timber, timberMat)
  if (timberMesh) group.add(timberMesh)

  // -- slanted shed roof + nest-box lid, both shingled ------------------------------
  const roof: BufferGeometry[] = []
  const roofPitch = Math.atan2(RISE, D)
  const slopeLen = Math.hypot(RISE, D) + 0.34
  const slab = new BoxGeometry(W + 0.36, 0.09, slopeLen)
  uvScale(slab, (W + 0.36) / 1.2, slopeLen / 1.2)
  slab.rotateX(-roofPitch) // +z edge rises — the shed slope falls to the back
  slab.translate(0, bodyY0 + WALL_H + 0.04 + RISE / 2 + 0.045, 0.04)
  roof.push(slab)
  const lid = new BoxGeometry(0.56, 0.05, 0.82)
  uvScale(lid, 0.5, 0.7)
  lid.rotateZ(-0.34) // tips down away from the wall
  lid.translate(1.46, 1.3, -0.12)
  roof.push(lid)
  const roofMesh = fuse(roof, shingleMat)
  if (roofMesh) group.add(roofMesh)

  // -- slim galvanized mesh: two runs of wire bars below the top rails --------------
  const wire: BufferGeometry[] = []
  for (const wy of [0.14, 0.45]) {
    for (const sx of [-1, 1]) {
      wire.push(box(0.022, 0.022, RUN_FAR_Z - 1.0, sx * RUN_HALF_W, wy, (1.0 + RUN_FAR_Z) / 2))
      wire.push(box(1.18, 0.022, 0.022, sx * 0.91, wy, RUN_FAR_Z))
    }
  }
  // thin verticals every ~0.24 — close enough to read as mesh, light enough to merge
  for (const sx of [-1, 1]) {
    for (let pz = 1.14; pz < RUN_FAR_Z - 0.08; pz += 0.245) {
      wire.push(box(0.016, FENCE_H - 0.12, 0.016, sx * RUN_HALF_W, (FENCE_H - 0.12) / 2 + 0.02, pz))
    }
    for (let px = 0.44; px < RUN_HALF_W - 0.05; px += 0.22) {
      wire.push(box(0.016, FENCE_H - 0.12, 0.016, sx * px, (FENCE_H - 0.12) / 2 + 0.02, RUN_FAR_Z))
    }
  }
  const wireMesh = fuse(wire, wireMat)
  if (wireMesh) group.add(wireMesh)

  // -- the dark doorway, proud of the front wall so it never z-fights ---------------
  const doorway = new Mesh(new PlaneGeometry(0.4, 0.5), doorMat)
  doorway.position.set(0, 0.77, hz + 0.012)
  doorway.castShadow = false
  doorway.receiveShadow = true
  group.add(doorway)

  return group
}

// ---- the flock --------------------------------------------------------------------

type HenPhase = 'inside' | 'descend' | 'yard' | 'toRamp' | 'ascend'
type HenPose = 'idle' | 'walk' | 'peck' | 'hop'
type HenRig = ReturnType<typeof buildHen>['rig']

/** hen ambling speed inside the run (u/s) */
const WALK_SPEED = 0.35
const TURN_RATE = 7
const ARRIVE_R = 0.07
/** seconds to hop the length of the ramp */
const RAMP_TIME = 1.2
/** height of each little hop on the ramp arc (three hops per transit) */
const HOP_H = 0.055
/** ground per leg cycle per unit of hen scale — matches the hen sculpt */
const STRIDE_PER_SCALE = 0.52
const MAX_STRIDE_RATE = 30
/** peck rhythm: two quick dips then a pause, repeating */
const PECK_PERIOD = 1.7

interface HenState {
  group: Group
  rig: HenRig
  rng: Rng
  scale: number
  phase: HenPhase
  pose: HenPose
  /** inside-countdown / yard decision timer */
  timer: number
  yardLeft: number
  peckLeft: number
  /** ramp transit parameter 0..1 */
  u: number
  tx: number
  tz: number
  moving: boolean
  heading: number
  walkPhase: number
  peckPhase: number
  flapEnv: number
  /** per-hen time offset so bobs/blinks never sync across the flock */
  bobOff: number
}

/** 3-4 hens living around the coop: hidden inside on seeded timers, down the
 * ramp, pecking and wandering the run yard, back up and gone again. */
export class CoopHens {
  private root = new Group()
  private hens: HenState[] = []

  /** the coop moved — the hens' whole world is root-relative, so they ride */
  moveTo(at: Vector3, yaw: number): void {
    this.root.position.copy(at)
    this.root.rotation.y = yaw
  }

  constructor(scene: Scene, at: Vector3, yaw: number, count: number, seed: number) {
    this.root.position.copy(at)
    this.root.rotation.y = yaw
    scene.add(this.root)
    for (let i = 0; i < count; i++) {
      const rng = mulberry32((seed + i * 7919) >>> 0)
      const { group, rig } = buildHen()
      // measure at scale 1, then draw hue + lightness BEFORE size — the same
      // rng order ChickenView uses (pinned by tests/scale.test.ts)
      const built = new Box3().setFromObject(group).getSize(new Vector3()).y
      const hue = (rng.next() - 0.5) * 0.08
      const light = (rng.next() - 0.5) * 0.12
      tint(group, hue, light)
      const scale = henScaleFor(rng, built)
      assertSpawnScale('coop hen', built * scale, SCALE.hen.min, SCALE.hen.max)
      group.scale.setScalar(scale)
      group.visible = false
      this.root.add(group)
      this.hens.push({
        group,
        rig,
        rng,
        scale,
        phase: 'inside',
        pose: 'idle',
        timer: 6 + rng.next() * 8,
        yardLeft: 0,
        peckLeft: 0,
        u: 0,
        tx: 0,
        tz: 0,
        moving: false,
        heading: 0,
        walkPhase: 0,
        peckPhase: 0,
        flapEnv: 0,
        bobOff: rng.next() * 10,
      })
    }
  }

  /** fixed-step behavior: the inside → ramp → yard → ramp → inside cycle */
  update(dt: number): void {
    for (let i = 0; i < this.hens.length; i++) this.stepHen(this.hens[i], dt)
  }

  private stepHen(h: HenState, dt: number): void {
    if (h.phase === 'inside') {
      h.timer -= dt
      if (h.timer <= 0) {
        h.phase = 'descend'
        h.pose = 'hop'
        h.u = 0
        h.heading = 0 // facing +z, straight down the ramp
        h.group.rotation.y = 0
        h.flapEnv = 1 // a little wing flare on the way out
        this.placeOnRamp(h, 0)
        h.group.visible = true
      }
    } else if (h.phase === 'descend') {
      h.u = Math.min(1, h.u + dt / RAMP_TIME)
      this.placeOnRamp(h, h.u)
      if (h.u >= 1) {
        h.phase = 'yard'
        h.pose = 'idle'
        h.yardLeft = 10 + h.rng.next() * 15
        h.timer = 0.4 + h.rng.next() * 0.8
        h.moving = false
      }
    } else if (h.phase === 'yard') {
      h.yardLeft -= dt
      if (h.pose === 'peck') {
        h.peckLeft -= dt
        if (h.peckLeft <= 0) {
          h.pose = 'idle'
          h.timer = 0.5 + h.rng.next() * 1.5
        }
      } else if (h.moving) {
        if (this.walkStep(h, dt)) {
          h.moving = false
          h.timer = 0.4 + h.rng.next() * 1.2
        }
      } else if (h.yardLeft <= 0) {
        // done foraging — head for the foot of the ramp
        h.phase = 'toRamp'
        h.tx = 0
        h.tz = RAMP_BASE_Z
        h.moving = true
      } else {
        h.timer -= dt
        if (h.timer <= 0) {
          if (h.rng.next() < 0.45) {
            h.pose = 'peck'
            h.peckPhase = 0
            h.peckLeft = 1.6 + h.rng.next() * 1.8
          } else {
            // relocate: a fresh spot inside the run, clamped off the wire
            const a = h.rng.next() * Math.PI * 2
            const r = 0.3 + h.rng.next() * (YARD_R - 0.3)
            h.tx = Math.max(-YARD_X, Math.min(YARD_X, Math.sin(a) * r))
            h.tz = Math.max(YARD_Z0, Math.min(YARD_Z1, YARD_CZ + Math.cos(a) * r))
            h.moving = true
          }
        }
      }
    } else if (h.phase === 'toRamp') {
      if (this.walkStep(h, dt)) {
        h.phase = 'ascend'
        h.pose = 'hop'
        h.u = 0
        h.heading = Math.PI // about-face: up the ramp toward the door
        h.group.rotation.y = Math.PI
        h.flapEnv = 1
      }
    } else {
      // ascend
      h.u = Math.min(1, h.u + dt / RAMP_TIME)
      this.placeOnRamp(h, 1 - h.u)
      if (h.u >= 1) {
        h.group.visible = false
        h.phase = 'inside'
        h.pose = 'idle'
        h.timer = 6 + h.rng.next() * 8
      }
    }
  }

  /** the ramp arc: k=0 at the doorway sill, k=1 on the grass; three little
   * hop bumps ride on top of the straight descent */
  private placeOnRamp(h: HenState, k: number): void {
    h.group.position.x = 0
    h.group.position.z = DOOR_Z + (RAMP_BASE_Z - DOOR_Z) * k
    h.group.position.y = FLOOR_TOP * (1 - k) + HOP_H * Math.abs(Math.sin(k * Math.PI * 3))
  }

  /** smooth-turn + step toward (tx, tz); true when arrived */
  private walkStep(h: HenState, dt: number): boolean {
    const dx = h.tx - h.group.position.x
    const dz = h.tz - h.group.position.z
    const d = Math.hypot(dx, dz)
    if (d < ARRIVE_R) {
      h.pose = 'idle'
      return true
    }
    h.pose = 'walk'
    let turn = Math.atan2(dx, dz) - h.heading
    while (turn > Math.PI) turn -= Math.PI * 2
    while (turn < -Math.PI) turn += Math.PI * 2
    h.heading += turn * Math.min(1, TURN_RATE * dt)
    h.group.rotation.y = h.heading
    const step = Math.min(d, WALK_SPEED * dt)
    h.group.position.x += (dx / d) * step
    h.group.position.z += (dz / d) * step
    return false
  }

  /** render-rate procedural animation — peck dip-dip-pause, hop steps,
   * blinks, breathing. Scalar math only: zero allocations per frame. */
  frame(dt: number, t: number): void {
    const e4 = Math.min(1, 4 * dt)
    const e6 = Math.min(1, 6 * dt)
    const e8 = Math.min(1, 8 * dt)
    const e10 = Math.min(1, 10 * dt)
    const e12 = Math.min(1, 12 * dt)
    const e14 = Math.min(1, 14 * dt)
    const e22 = Math.min(1, 22 * dt)
    const flapDecay = Math.pow(0.4, dt)
    for (let i = 0; i < this.hens.length; i++) {
      const h = this.hens[i]
      if (!h.group.visible) continue
      const r = h.rig
      const tt = t + h.bobOff
      // blinks on a per-hen offset clock
      const blink = tt % 3.8 < 0.1 ? 0.15 : 1
      for (let e = 0; e < r.eyes.length; e++) r.eyes[e].scale.y = blink
      // wing flare bursts (ramp hops) decaying to folded
      h.flapEnv *= flapDecay
      const flap = (Math.sin(tt * 24) * 0.5 + 0.5) * h.flapEnv
      r.wingL.rotation.z = -0.06 - flap * 1.1
      r.wingR.rotation.z = 0.06 + flap * 1.1
      if (h.pose === 'walk') {
        // stride-matched tiny hop steps — leg cycle covers the ground passing
        // under her at her seeded size, with a bouncier lift than an amble
        const stride = STRIDE_PER_SCALE * h.scale
        h.walkPhase += dt * Math.min(MAX_STRIDE_RATE, (WALK_SPEED / stride) * Math.PI * 2)
        const s = Math.sin(h.walkPhase)
        r.legL.rotation.x = s * 0.55
        r.legR.rotation.x = -s * 0.55
        r.root.position.y = Math.abs(Math.cos(h.walkPhase)) * 0.05
        r.root.rotation.z = s * 0.05
        r.root.rotation.x += (0.06 - r.root.rotation.x) * e8
        r.head.rotation.x += (0.1 + Math.sin(h.walkPhase * 2) * 0.12 - r.head.rotation.x) * e12
        r.head.rotation.y += (0 - r.head.rotation.y) * e8
      } else if (h.pose === 'hop') {
        // ramp transit: legs trail together, body pitched with the slope
        const lean = h.phase === 'descend' ? 0.22 : -0.16
        r.legL.rotation.x += (0.45 - r.legL.rotation.x) * e10
        r.legR.rotation.x += (0.45 - r.legR.rotation.x) * e10
        r.root.rotation.x += (lean - r.root.rotation.x) * e8
        r.root.rotation.z += (0 - r.root.rotation.z) * e6
        r.root.position.y += (0 - r.root.position.y) * e8
        r.head.rotation.x += (-0.08 - r.head.rotation.x) * e8
        r.head.rotation.y += (0 - r.head.rotation.y) * e8
      } else if (h.pose === 'peck') {
        // dip-dip … pause: two quick jabs at the ground, then a watchful beat
        h.peckPhase += dt
        const p = h.peckPhase % PECK_PERIOD
        let down = 0
        if (p < 0.3) down = Math.sin((p / 0.3) * Math.PI)
        else if (p >= 0.42 && p < 0.72) down = Math.sin(((p - 0.42) / 0.3) * Math.PI)
        r.head.rotation.x += (0.35 + down - r.head.rotation.x) * e22
        r.root.rotation.x += (0.1 + down * 0.08 - r.root.rotation.x) * e14
        r.head.rotation.y += (0 - r.head.rotation.y) * e10
        r.root.rotation.z += (0 - r.root.rotation.z) * e6
        r.root.position.y += (0 - r.root.position.y) * e8
        this.settleLegs(r, e8)
      } else {
        // idle: breathe-adjacent head bob + slow curious glances
        r.head.rotation.x += (Math.sin(tt * 1.9) * 0.06 - r.head.rotation.x) * e6
        r.head.rotation.y += (Math.sin(tt * 0.7) * 0.5 - r.head.rotation.y) * e4
        r.root.rotation.x += (0 - r.root.rotation.x) * e6
        r.root.rotation.z += (0 - r.root.rotation.z) * e6
        r.root.position.y += (0 - r.root.position.y) * e8
        this.settleLegs(r, e8)
      }
      // breathing squash/stretch, flattened a touch mid-flap
      r.root.scale.y = 1 + Math.sin(tt * 2.6) * 0.012 - h.flapEnv * 0.04
    }
  }

  private settleLegs(r: HenRig, k: number): void {
    r.legL.rotation.x *= 1 - k
    r.legR.rotation.x *= 1 - k
  }
}
