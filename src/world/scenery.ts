/** World dressing — the "make screenshots sell it" pass.
 * Canvas-painted macro ground (roads, worn paths, tonal blotches) topped by
 * REAL instanced grass blades (grass.ts), procedurally TEXTURED trees
 * (trees.ts) and furrowed soil fields (field.ts). Gradient sky dome, warm sun
 * + soft shadows, tier-aware white picket fence, a little red barn, a wooden
 * sheep pen, drifting clouds. HARD RULE: no flat-color blob assets. */
import {
  AmbientLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  BoxGeometry,
  CylinderGeometry,
  type Object3D,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, type Rng } from '../game/rng'
import { allFieldRects, fenceFor, inRect, PEN, SOUTH_GATE } from '../game/expansion'
import {
  BARN_AT,
  CRATE_AT,
  DOG_AT,
  NEST_AT,
  ROAD_Z as GEO_ROAD_Z,
  SPAWN_AT,
  TOWN_GATE_X as GEO_TOWN_GATE_X,
  WORLD_BOUNDS as GEO_WORLD_BOUNDS,
} from '../game/geo'
import { DEFAULT_PLACES, fieldTierOf, footprintOf, PLACE_IDS, type LayoutView, type Place } from '../game/layout'
import type { Assets, ModelKey } from './assets'
import { buildForest } from './trees'
import { buildGrass, type GrassField } from './grass'
import { groundDetailCanvas, makeCanvas, toTexture, woodCanvas } from './textures'

export const STAND_POS = new Vector3(DEFAULT_PLACES.stand.x, 0, DEFAULT_PLACES.stand.z)
export const NEST_POS = new Vector3(NEST_AT[0], 0, NEST_AT[1])
export const CRATE_POS = new Vector3(CRATE_AT[0], 0, CRATE_AT[1])
export const DOG_HOME = new Vector3(DOG_AT[0], 0, DOG_AT[1])
export const BARN_POS = new Vector3(BARN_AT[0], 0, BARN_AT[1])
export const PLAYER_SPAWN = new Vector3(SPAWN_AT[0], 0, SPAWN_AT[1])
/** the customer road runs east-west across the south of the farm */
export const ROAD_Z = GEO_ROAD_Z
/** the Millbrook gate — where the road leaves the farm for town. Past the
 * player bound (maxX 22) but inside the tree ring; the delivery horse gallops
 * east THROUGH the gate and must only despawn beyond this x. */
export const TOWN_GATE_X = GEO_TOWN_GATE_X
/** south gate in the picket fence (stand path + customer route). Belongs to
 * the FENCE — it must not follow the stand when the stand moves. */
export const GATE_SOUTH_X = SOUTH_GATE.center
/** the CURRENT layout, bound by main after the save loads and re-bound on
 * every relayout — scenery's ground art and exclusion zones read this */
let LV: LayoutView = { ...DEFAULT_PLACES }
export function bindLayout(lv: LayoutView): void {
  LV = lv
  rebuildPaths()
}
/** customers queue beside the stand's east edge — offsets from the stand */
const QUEUE_OFFSETS: Array<[number, number]> = [
  [2.6, 0.7],
  [3.9, 1.6],
]
/** Where selling happens RIGHT NOW. Customer.ts and main.ts read MARKET
 * every frame (queue targets + serve range), so mutating it live-moves the
 * market with no rewiring. Boots at the roadside stand; the Farm Shop
 * completion calls marketToShop() to flip it across the road; moving the
 * stand calls marketToStand() the same way. */
export const MARKET = {
  pos: STAND_POS.clone(),
  spots: QUEUE_OFFSETS.map(([dx, dz]) => new Vector3(STAND_POS.x + dx, 0, STAND_POS.z + dz)),
  atShop: false,
}
/** the stand is the counter: serving + queue ride wherever it stands */
export function marketToStand(place: Place): void {
  MARKET.atShop = false
  MARKET.pos.set(place.x, 0, place.z)
  MARKET.spots = QUEUE_OFFSETS.map(([dx, dz]) => new Vector3(place.x + dx, 0, place.z + dz))
}
/** Farm Shop built: serving crosses the road. The counter point sits between
 * the shop's north face and the road (site z − 1.9), and three queue spots
 * line up on the road's south shoulder (site z − 2.4) so customers wait
 * facing the shop while the player walks over to serve them. */
export function marketToShop(place: Place): void {
  MARKET.atShop = true
  MARKET.pos.set(place.x, 0, place.z - 1.9)
  MARKET.spots = [
    new Vector3(place.x - 1.3, 0, place.z - 2.4),
    new Vector3(place.x, 0, place.z - 2.4),
    new Vector3(place.x + 1.3, 0, place.z - 2.4),
  ]
}
// east fields run to the x=20.6 fence and the shop now sits ACROSS the road at z 15.6 — the player must reach both
export const WORLD_BOUNDS = GEO_WORLD_BOUNDS

const GROUND_SIZE = 96
const GROUND_BASE = '#6f9e4a'

/** meshes the follow-camera must never hide behind (barn pushes itself in;
 * main adds bought buildings). The camera raycasts this list every frame. */
export const OCCLUDERS: Object3D[] = []

// ---- exclusion zones (shared by grass + forest placement) --------------------

/** worn footpaths: spawn -> the CURRENT stand -> the fence gate; spawn ->
 * yard; spawn -> nest. Rebuilt whenever the layout binds (the stand leg
 * follows a moved stand; the gate leg aims at the FENCE gate, which is
 * fixed). */
let PATHS: Array<Array<[number, number]>> = []
function rebuildPaths(): void {
  const st = LV.stand
  PATHS = [
    [
      [PLAYER_SPAWN.x, PLAYER_SPAWN.z],
      [st.x - 0.2, st.z - 0.6],
      [GATE_SOUTH_X, ROAD_Z - 1.2],
    ],
    [
      [PLAYER_SPAWN.x, PLAYER_SPAWN.z],
      [1.4, 2.4],
      [3, 2],
    ],
    [
      [PLAYER_SPAWN.x, PLAYER_SPAWN.z],
      [NEST_POS.x + 1.2, NEST_POS.z + 1],
    ],
  ]
}
rebuildPaths()

function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2))
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

function nearPath(x: number, z: number, r: number): boolean {
  for (const path of PATHS)
    for (let i = 0; i < path.length - 1; i++)
      if (distToSeg(x, z, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]) < r) return true
  return false
}

/** every tier's field rect at its CURRENT slab position (unbought tiers
 * sit at their authored homes — LV holds defaults for them) */
function fieldRectsNow(): Array<{ x0: number; z0: number; x1: number; z1: number }> {
  const out: Array<{ x0: number; z0: number; x1: number; z1: number }> = []
  for (const id of PLACE_IDS) {
    const t = fieldTierOf(id)
    if (t < 0) continue
    const f = allFieldRects()[t]
    const pl = LV[id]
    const d = DEFAULT_PLACES[id]
    out.push({ x0: f.x0 + pl.x - d.x, z0: f.z0 + pl.z - d.z, x1: f.x1 + pl.x - d.x, z1: f.z1 + pl.z - d.z })
  }
  return out
}

/** true where grass tufts must NOT grow */
export function groundClear(x: number, z: number): boolean {
  if (Math.abs(z - ROAD_Z) < 2.4) return true
  for (const f of fieldRectsNow()) if (inRect(x, z, f, 0.35)) return true
  // every building site — at its CURRENT layout position — stays clear
  // (owner's rule: the ground is ready before the crew arrives)
  for (const id of PLACE_IDS) {
    if (id === 'tractor' || id === 'farmhand') continue // they stand ON the lawn
    const pl = LV[id]
    const fp = footprintOf(id)
    if (
      x > pl.x - fp.w / 2 - 0.4 &&
      x < pl.x + fp.w / 2 + 0.4 &&
      z > pl.z - fp.d / 2 - 0.4 &&
      z < pl.z + fp.d / 2 + 0.4
    )
      return true
  }
  const st = LV.stand
  if (x > st.x - 2.9 && x < st.x + 2.7 && z > st.z - 1.7 && z < st.z + 2.2) return true // stand + queue
  const bx = BARN_POS.x + 1.5
  const bz = BARN_POS.z + 2.5
  if (((x - bx) / 4.2) ** 2 + ((z - bz) / 2.8) ** 2 < 1) return true // barn yard
  if (Math.hypot(x - NEST_POS.x, z - NEST_POS.z) < 1.3) return true
  if (Math.hypot(x - CRATE_POS.x, z - CRATE_POS.z) < 1.1) return true
  if (Math.hypot(x - DOG_HOME.x, z - DOG_HOME.z) < 0.9) return true
  if (nearPath(x, z, 0.5)) return true
  return false
}

/** true where trees/bushes must NOT grow: everything above PLUS the whole
 * (eventual) fenced play space and the pen */
export function forestClear(x: number, z: number): boolean {
  if (groundClear(x, z)) return true
  const f = fenceFor(99) // max-tier ring
  if (x > f.minX - 1.4 && x < f.maxX + 1.4 && z > f.minZ - 1.4 && z < f.maxZ + 1.4) return true
  if (inRect(x, z, PEN, 1.2)) return true // the DEFAULT pen yard stays tree-free
  if (Math.abs(z - ROAD_Z) < 3.0) return true
  return false
}

// ---- lights + sky -----------------------------------------------------------

export interface LightHandles {
  sun: DirectionalLight
  fill: DirectionalLight
  hemi: HemisphereLight
  ambient: AmbientLight
}

export function buildLights(scene: Scene): LightHandles {
  scene.fog = new Fog('#dfe8c2', 46, 120)
  scene.background = new Color('#9fd0ee')
  // sun sits on the camera's side of the sky so faces the player sees are lit
  const sun = new DirectionalLight('#ffe9bd', 2.6)
  sun.position.set(12, 22, -9)
  sun.castShadow = true
  // phones render the shadow map every frame too — half-res there ("heavy"
  // report); PCF + normalBias keep edges acceptable at 1024
  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.02
  const c = sun.shadow.camera
  c.left = c.bottom = -26
  c.right = c.top = 26
  c.far = 80
  scene.add(sun)
  const hemi = new HemisphereLight('#bfe0ff', '#74934e', 0.75)
  scene.add(hemi)
  const ambient = new AmbientLight('#fff1da', 0.42)
  scene.add(ambient)
  // warm fill from the south-west (opposite the sun) so characters keep
  // modeled warmth on their shadow side
  const fill = new DirectionalLight('#ffd9ad', 1.0)
  fill.position.set(-9, 11, 14)
  scene.add(fill)
  return { sun, fill, hemi, ambient }
}

export interface SkyMeshes {
  dome: Mesh
  sunDisk: Mesh
}

/** vertex-colored gradient dome + a visible sun disk (god-rays light source).
 * The DayCycle rewrites the dome's color attribute and moves the disk. */
export function buildSky(scene: Scene): SkyMeshes {
  // radius must clear the off-world interior set at (120,0,120) ≈ 170u out —
  // a 170 shell sliced through that room and occluded its far walls
  const geo = new SphereGeometry(240, 24, 10)
  const pos = geo.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const top = new Color('#5fa8e0')
  const mid = new Color('#a8d4ef')
  const horizon = new Color('#f2ecca')
  const tmp = new Color()
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 240
    const t = Math.max(0, Math.min(1, (y + 0.12) / 0.9))
    if (t < 0.35) tmp.copy(horizon).lerp(mid, t / 0.35)
    else tmp.copy(mid).lerp(top, (t - 0.35) / 0.65)
    colors[i * 3] = tmp.r
    colors[i * 3 + 1] = tmp.g
    colors[i * 3 + 2] = tmp.b
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3))
  const dome = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false }))
  scene.add(dome)
  const sunDisk = new Mesh(
    new SphereGeometry(7, 16, 12),
    new MeshBasicMaterial({ color: '#fff3c8', fog: false }),
  )
  sunDisk.position.set(60, 110, -45)
  scene.add(sunDisk)
  return { dome, sunDisk }
}

// ---- painted macro ground -----------------------------------------------------

interface WorldPainter {
  ctx: CanvasRenderingContext2D
  px: (wx: number) => number
  pz: (wz: number) => number
  s: (units: number) => number
}

function painter(canvas: HTMLCanvasElement): WorldPainter {
  const ctx = canvas.getContext('2d')!
  const k = canvas.width / GROUND_SIZE
  return {
    ctx,
    px: (wx) => (wx + GROUND_SIZE / 2) * k,
    pz: (wz) => (wz + GROUND_SIZE / 2) * k,
    s: (u) => u * k,
  }
}

function paintGround(rng: Rng, into?: HTMLCanvasElement): HTMLCanvasElement {
  const c = into ?? document.createElement('canvas')
  c.width = c.height = 2048 // re-assigning also clears on repaint
  const p = painter(c)
  const g = p.ctx

  // base grass + large soft tonal blotches (kills the flat-green look)
  g.fillStyle = GROUND_BASE
  g.fillRect(0, 0, c.width, c.height)
  const blotches = ['#7aa953', '#699647', '#82b35c', '#618c41', '#76a450']
  for (let i = 0; i < 260; i++) {
    g.fillStyle = blotches[Math.floor(rng.next() * blotches.length)]
    g.globalAlpha = 0.1 + rng.next() * 0.12
    const r = p.s(1.5 + rng.next() * 5)
    g.beginPath()
    g.ellipse(rng.next() * c.width, rng.next() * c.height, r, r * (0.55 + rng.next() * 0.5), rng.next() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1

  // mowed stripes — alternating light diagonal bands, very subtle
  g.save()
  g.translate(c.width / 2, c.height / 2)
  g.rotate(0.5)
  g.fillStyle = '#ffffff'
  for (let i = -16; i < 16; i += 2) {
    g.globalAlpha = 0.04
    g.fillRect(i * p.s(3.4), -c.width, p.s(3.4), c.width * 2)
  }
  g.restore()
  g.globalAlpha = 1

  // dirt road (east-west) with rough edges + wheel ruts
  const roadHalf = p.s(1.45)
  const ry = p.pz(ROAD_Z)
  g.fillStyle = '#c8a169'
  g.beginPath()
  g.moveTo(0, ry - roadHalf)
  for (let x = 0; x <= c.width; x += 16) g.lineTo(x, ry - roadHalf + Math.sin(x * 0.05) * 3 + (rng.next() - 0.5) * 4)
  g.lineTo(c.width, ry + roadHalf)
  for (let x = c.width; x >= 0; x -= 16) g.lineTo(x, ry + roadHalf + Math.sin(x * 0.04) * 3 + (rng.next() - 0.5) * 4)
  g.closePath()
  g.fill()
  g.strokeStyle = '#b08a55'
  g.lineWidth = p.s(0.16)
  for (const off of [-0.55, 0.55]) {
    g.globalAlpha = 0.5
    g.beginPath()
    g.moveTo(0, ry + p.s(off))
    for (let x = 0; x <= c.width; x += 24) g.lineTo(x, ry + p.s(off) + Math.sin(x * 0.03 + off) * 2)
    g.stroke()
  }
  g.globalAlpha = 1
  // pebbles on the road
  for (let i = 0; i < 180; i++) {
    g.fillStyle = rng.next() > 0.5 ? '#bd965e' : '#d4b07a'
    g.globalAlpha = 0.5 + rng.next() * 0.4
    const x = rng.next() * c.width
    const y = ry + (rng.next() - 0.5) * roadHalf * 1.7
    g.beginPath()
    g.arc(x, y, 1.5 + rng.next() * 3, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1

  // worn footpaths (lighter trodden grass)
  const path = (pts: Array<[number, number]>, w: number, color: string, alpha: number): void => {
    g.strokeStyle = color
    g.globalAlpha = alpha
    g.lineWidth = p.s(w)
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(p.px(pts[0][0]), p.pz(pts[0][1]))
    for (let i = 1; i < pts.length; i++) g.lineTo(p.px(pts[i][0]), p.pz(pts[i][1]))
    g.stroke()
    g.globalAlpha = 1
  }
  for (const w of [1.5, 1.0, 0.55]) {
    const a = w === 0.55 ? 0.32 : 0.16
    for (let pi = 0; pi < PATHS.length; pi++) path(PATHS[pi], w, '#b3bd7c', pi === 0 ? a : a * 0.85)
  }

  // worn-dirt apron at the farm-shop lot + a short trodden stub to the road
  // edge — same layered irregular language as the stand path above, but in
  // road browns (bare churned dirt, not trodden grass). Derived from the
  // LAYOUT so the art tracks a moved shop; painted only while the shop sits
  // SOUTH of the road so a moved-north shop never gets a road smear
  const shopPl = LV.shop
  if (shopPl.z > ROAD_Z) {
    const sx = shopPl.x
    const sz = shopPl.z
    const frontZ = sz - footprintOf('shop').d / 2
    g.fillStyle = '#b69465'
    for (let i = 0; i < 9; i++) {
      g.globalAlpha = 0.09 + rng.next() * 0.1
      const r = p.s(1.0 + rng.next() * 1.3)
      g.beginPath()
      g.ellipse(
        p.px(sx + (rng.next() - 0.5) * 2.8),
        p.pz(sz - 0.6 + (rng.next() - 0.5) * 2.2),
        r,
        r * (0.5 + rng.next() * 0.4),
        rng.next() * Math.PI,
        0,
        Math.PI * 2,
      )
      g.fill()
    }
    g.globalAlpha = 1
    const stub: Array<[number, number]> = [
      [sx + 0.2, ROAD_Z + 1.3],
      [sx - 0.15, (ROAD_Z + 1.45 + frontZ) / 2],
      [sx + 0.1, frontZ + 0.3],
    ]
    for (const w of [1.4, 0.9, 0.5]) path(stub, w, '#b08a55', w === 0.5 ? 0.3 : 0.14)
    // scuffed specks keep the apron edge ragged, like the road shoulder
    for (let i = 0; i < 26; i++) {
      g.fillStyle = rng.next() > 0.5 ? '#bd965e' : '#a98e5e'
      g.globalAlpha = 0.25 + rng.next() * 0.3
      g.beginPath()
      g.arc(
        p.px(sx + (rng.next() - 0.5) * 3.4),
        p.pz(sz - 0.7 + (rng.next() - 0.5) * 2.6),
        1.2 + rng.next() * 2.4,
        0,
        Math.PI * 2,
      )
      g.fill()
    }
    g.globalAlpha = 1
  }

  // fallow beds where fields live (soil meshes cover the bought ones)
  for (const f of fieldRectsNow()) {
    g.fillStyle = '#8b9a5b'
    g.globalAlpha = 0.4
    roundRect(g, p.px(f.x0), p.pz(f.z0), p.s(f.x1 - f.x0), p.s(f.z1 - f.z0), p.s(0.5))
    g.fill()
    g.globalAlpha = 1
  }

  // dusty yard around the barn + inside the pen (wherever it stands today)
  g.fillStyle = '#a98e5e'
  g.globalAlpha = 0.35
  g.beginPath()
  g.ellipse(p.px(BARN_POS.x + 1.5), p.pz(BARN_POS.z + 2.5), p.s(4), p.s(2.6), 0.2, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#9aa05e'
  g.globalAlpha = 0.3
  const penW = PEN.x1 - PEN.x0
  const penD = PEN.z1 - PEN.z0
  roundRect(g, p.px(LV.pen.x - penW / 2), p.pz(LV.pen.z - penD / 2), p.s(penW), p.s(penD), p.s(0.6))
  g.fill()
  g.globalAlpha = 1

  // grass blade ticks — thousands of tiny strokes give it tooth up close
  for (let i = 0; i < 9000; i++) {
    const x = rng.next() * c.width
    const y = rng.next() * c.height
    if (Math.abs(y - ry) < roadHalf) continue
    g.strokeStyle = rng.next() > 0.5 ? '#86b75e' : '#5d8a3e'
    g.globalAlpha = 0.2 + rng.next() * 0.3
    g.lineWidth = 1.4
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + (rng.next() - 0.5) * 4, y - 3 - rng.next() * 4)
    g.stroke()
  }
  g.globalAlpha = 1
  return c
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

let groundCanvas: HTMLCanvasElement | null = null
let groundTex: CanvasTexture | null = null

/** repaint the macro ground in place (a moved building takes its worn dirt
 * with it) — one-off canvas redraw + texture upload, fired at placement
 * commit while the landing squash hides the hitch */
export function repaintGround(): void {
  if (!groundCanvas || !groundTex) return
  paintGround(mulberry32(20260610), groundCanvas)
  groundTex.needsUpdate = true
}

export function buildGround(scene: Scene): void {
  groundCanvas = paintGround(mulberry32(20260610))
  const tex = new CanvasTexture(groundCanvas)
  groundTex = tex
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  // crisp tiling grain layered over the painted macro: the lawn stays
  // detailed at boot-heel distance (phone landscape brought this to light)
  const detail = toTexture(groundDetailCanvas(mulberry32(606)), true)
  const mat = new MeshStandardMaterial({ map: tex, roughness: 1 })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        diffuseColor.rgb *= 0.72 + 0.56 * texture2D(uDetail, vMapUv * 42.0).rgb;`,
      )
  }
  const ground = new Mesh(new PlaneGeometry(GROUND_SIZE, GROUND_SIZE), mat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  // horizon skirt so the painted square never shows an edge
  const skirt = new Mesh(
    new PlaneGeometry(700, 700),
    new MeshStandardMaterial({ color: GROUND_BASE, roughness: 1 }),
  )
  skirt.rotation.x = -Math.PI / 2
  skirt.position.y = -0.03
  scene.add(skirt)
}

// ---- static prop batching ------------------------------------------------------

/** Bake placed props into ONE mesh (vertex-colored). Only for the small
 * untextured accents that remain: flowers, rocks, stumps, mushrooms. */
class Batcher {
  private geos: BufferGeometry[] = []

  add(obj: Group): void {
    obj.updateMatrixWorld(true)
    obj.traverse((o) => {
      if (o instanceof Mesh && o.geometry instanceof BufferGeometry) {
        const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as Material
        const src = nonIndexed(o.geometry.clone().applyMatrix4(o.matrixWorld))
        const pos = src.getAttribute('position')
        const geo = new BufferGeometry()
        geo.setAttribute('position', pos)
        const normal = src.getAttribute('normal')
        if (normal) geo.setAttribute('normal', normal)
        else geo.computeVertexNormals()
        const c = mat instanceof MeshStandardMaterial ? mat.color : new Color('#ffffff')
        const colors = new Float32Array(pos.count * 3)
        for (let i = 0; i < pos.count; i++) {
          colors[i * 3] = c.r
          colors[i * 3 + 1] = c.g
          colors[i * 3 + 2] = c.b
        }
        geo.setAttribute('color', new BufferAttribute(colors, 3))
        this.geos.push(geo)
      }
    })
  }

  flush(scene: Scene, shadows = true): void {
    if (this.geos.length === 0) return
    const merged = mergeGeometries(this.geos)
    this.geos = []
    if (!merged) return
    const mesh = new Mesh(merged, new MeshStandardMaterial({ vertexColors: true, roughness: 1 }))
    mesh.castShadow = shadows
    mesh.receiveShadow = true
    scene.add(mesh)
  }
}

function nonIndexed(geo: BufferGeometry): BufferGeometry {
  return geo.index ? geo.toNonIndexed() : geo
}

// ---- meadow dressing --------------------------------------------------------------

export function buildMeadow(scene: Scene, assets: Assets): GrassField {
  buildForest(scene, forestClear)
  const grass = buildGrass(scene, groundClear)

  const rng = mulberry32(1234)
  const batch = new Batcher()
  const place = (key: ModelKey, x: number, z: number, rot = 0, scale = 1): void => {
    const g = assets.spawn(key)
    g.position.set(x, 0, z)
    g.rotation.y = rot
    g.scale.setScalar(scale)
    batch.add(g)
  }

  // flower accents only — the Kenney rocks/stumps/mushrooms read as pale
  // blobs in the new textured world, so they're retired
  const scatter: ModelKey[] = ['flowerR', 'flowerY', 'flowerP', 'flowerR2', 'flowerY2']
  for (let i = 0; i < 56; i++) {
    const x = (rng.next() - 0.5) * 34
    const z = (rng.next() - 0.5) * 28 + 1
    if (groundClear(x, z)) continue
    place(scatter[Math.floor(rng.next() * scatter.length)], x, z, rng.next() * Math.PI * 2, 1.2 + rng.next() * 1.2)
  }
  // flower beds hugging the fence corners
  const beds: Array<[number, number]> = [[-7.6, -2.6], [7.4, -2.6], [-7.6, 9.6], [7.4, 9.6]]
  for (const [bx, bz] of beds) {
    for (let i = 0; i < 4; i++) {
      const keys: ModelKey[] = ['flowerR', 'flowerY', 'flowerP', 'flowerY2']
      place(keys[Math.floor(rng.next() * keys.length)], bx + (rng.next() - 0.5) * 1.6, bz + (rng.next() - 0.5) * 1.2, rng.next() * 3, 1.5)
    }
  }
  batch.flush(scene)

  buildBarn(scene)
  buildTownGate(scene)
  return grass
}

// ---- white picket fence, edge by edge (the player's to redraw) ---------------

/** Render the whole fence network from the saved edge set: each unit edge
 * gets pickets + two rails; posts stand at every used grid vertex (deduped).
 * A GATE edge renders as an open little frame — taller flanking posts and a
 * header bar, no pickets — so openings read on purpose, not as missing
 * fence. One merged mesh, one draw call, rebuilt only when the fence edits. */
export function buildFenceEdges(scene: Scene, edges: Iterable<number>, gates: Iterable<number>): Mesh | null {
  const geos: BufferGeometry[] = []
  const picket = new BoxGeometry(0.09, 0.62, 0.05)
  const rail = new BoxGeometry(1, 0.07, 0.045)
  const post = new BoxGeometry(0.12, 0.78, 0.12)
  const gatePost = new BoxGeometry(0.13, 1.05, 0.13)
  const posts = new Set<string>()
  const gatePosts = new Set<string>()

  const decode = (key: number): { cx: number; cz: number; axis: number } => {
    const axis = key % 2
    const cell = (key - axis) / 2
    return { cx: Math.floor(cell / 256) - 64, cz: (cell % 256) - 64, axis }
  }

  for (const key of edges) {
    const { cx, cz, axis } = decode(key)
    const rot = axis === 1 ? Math.PI / 2 : 0
    const mx = axis === 0 ? cx + 0.5 : cx
    const mz = axis === 0 ? cz : cz + 0.5
    for (const t of [-0.25, 0.25]) {
      const g = picket.clone()
      g.rotateY(rot)
      g.translate(axis === 0 ? mx + t : mx, 0.34, axis === 0 ? mz : mz + t)
      geos.push(g)
    }
    for (const y of [0.2, 0.48]) {
      const r = rail.clone()
      r.rotateY(rot)
      r.translate(mx, y, mz)
      geos.push(r)
    }
    posts.add(`${cx},${cz}`)
    posts.add(axis === 0 ? `${cx + 1},${cz}` : `${cx},${cz + 1}`)
  }
  for (const key of gates) {
    const { cx, cz, axis } = decode(key)
    const rot = axis === 1 ? Math.PI / 2 : 0
    const mx = axis === 0 ? cx + 0.5 : cx
    const mz = axis === 0 ? cz : cz + 0.5
    // header bar over the opening
    const h = new BoxGeometry(1.06, 0.07, 0.06)
    h.rotateY(rot)
    h.translate(mx, 1.0, mz)
    geos.push(h)
    gatePosts.add(`${cx},${cz}`)
    gatePosts.add(axis === 0 ? `${cx + 1},${cz}` : `${cx},${cz + 1}`)
  }
  for (const k of gatePosts) {
    posts.delete(k) // the taller gate post wins the corner
    const [x, z] = k.split(',').map(Number)
    const p = gatePost.clone()
    p.translate(x, 0.52, z)
    geos.push(p)
  }
  for (const k of posts) {
    const [x, z] = k.split(',').map(Number)
    const p = post.clone()
    p.translate(x, 0.39, z)
    geos.push(p)
  }
  // a fully demolished farm is a legal farm — nothing to merge, nothing drawn
  if (geos.length === 0) return null
  const merged = mergeGeometries(geos)
  if (!merged) return null
  const mesh = new Mesh(merged, new MeshStandardMaterial({ color: '#f4eedd', roughness: 0.85 }))
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)
  return mesh
}

// ---- wooden sheep pen (built by The Sheep Pen project) -------------------------------

/** the wooden sheep pen, ROOT-RELATIVE (it's a movable now): rails and the
 * gate gap are built around the local origin; the root sits at the place */
export function buildPen(scene: Scene, at: { x: number; z: number }): Group {
  const rng = mulberry32(424242)
  const woodTex = toTexture(woodCanvas(rng, '#7a5c38'), true)
  const geos: BufferGeometry[] = []
  const cx = (PEN.x0 + PEN.x1) / 2
  const cz = (PEN.z0 + PEN.z1) / 2
  // local frame: the authored rect re-centered on the origin
  const L = { x0: PEN.x0 - cx, z0: PEN.z0 - cz, x1: PEN.x1 - cx, z1: PEN.z1 - cz, gate: { z0: PEN.gate.z0 - cz, z1: PEN.gate.z1 - cz } }
  const post = (x: number, z: number): void => {
    const p = new BoxGeometry(0.14, 0.95, 0.14)
    p.translate(x, 0.45, z)
    geos.push(p)
  }
  const rail = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const rot = Math.atan2(z1 - z0, x1 - x0)
    for (const y of [0.38, 0.72]) {
      const r = new BoxGeometry(len, 0.075, 0.055)
      r.rotateY(-rot)
      r.translate((x0 + x1) / 2, y, (z0 + z1) / 2)
      geos.push(r)
    }
  }
  const span = (x0: number, z0: number, x1: number, z1: number, gate?: { from: number; to: number }): void => {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const dirX = (x1 - x0) / len
    const dirZ = (z1 - z0) / len
    const n = Math.max(1, Math.round(len / 1.05))
    let prevT: number | null = 0
    post(x0, z0)
    for (let i = 1; i <= n; i++) {
      const t = (i / n) * len
      const along = dirX !== 0 ? x0 + dirX * t : z0 + dirZ * t
      const inGate = gate && along > gate.from && along < gate.to
      const px = x0 + dirX * t
      const pz = z0 + dirZ * t
      if (!inGate) {
        post(px, pz)
        if (prevT !== null) rail(x0 + dirX * prevT, z0 + dirZ * prevT, px, pz)
        prevT = t
      } else {
        prevT = null
      }
    }
  }
  span(L.x0, L.z0, L.x1, L.z0)
  span(L.x0, L.z1, L.x1, L.z1)
  span(L.x0, L.z0, L.x0, L.z1)
  span(L.x1, L.z0, L.x1, L.z1, { from: L.gate.z0, to: L.gate.z1 })
  const root = new Group()
  const merged = mergeGeometries(geos)
  if (merged) {
    const mesh = new Mesh(merged, new MeshStandardMaterial({ map: woodTex, roughness: 0.95 }))
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)
  }
  root.position.set(at.x, 0, at.z)
  scene.add(root)
  return root
}

// ---- FOR SALE deed sign --------------------------------------------------------------

/** wooden board on two posts advertising a land deed or a build project */
export function buildDeedSign(title: string, cost: number, header = 'FOR SALE', accent = '#b3541e'): Group {
  const group = new Group()
  const rng = mulberry32(8989)
  const woodTex = toTexture(woodCanvas(rng, '#8a6a42'), true)
  const post = new MeshStandardMaterial({ map: woodTex, roughness: 0.95 })
  for (const side of [-0.55, 0.55]) {
    const p = new Mesh(new BoxGeometry(0.09, 1.15, 0.09), post)
    p.position.set(side, 0.55, 0)
    p.castShadow = true
    group.add(p)
  }
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#f7eed7'
  g.fillRect(0, 0, 256, 128)
  g.strokeStyle = accent
  g.lineWidth = 8
  g.strokeRect(5, 5, 246, 118)
  g.fillStyle = accent
  g.font = '800 34px Trebuchet MS, sans-serif'
  g.textAlign = 'center'
  g.fillText(header, 128, 46)
  g.fillStyle = '#3a2d1e'
  g.font = '700 24px Trebuchet MS, sans-serif'
  g.fillText(title, 128, 80)
  g.font = '800 26px Trebuchet MS, sans-serif'
  g.fillStyle = '#8a6d1a'
  g.fillText(`${cost} coins`, 128, 112)
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  const board = new Mesh(new BoxGeometry(1.6, 0.8, 0.05), [
    post, post, post, post,
    new MeshStandardMaterial({ map: tex, roughness: 0.85 }),
    post,
  ])
  board.position.set(0, 1.05, 0.05)
  board.castShadow = true
  group.add(board)
  return group
}

// ---- little red barn ---------------------------------------------------------------

function buildBarn(scene: Scene): void {
  const red = new MeshStandardMaterial({ color: '#b4402e', roughness: 0.9 })
  const roof = new MeshStandardMaterial({ color: '#5d4a3a', roughness: 0.95 })
  const trim = new MeshStandardMaterial({ color: '#f4eedd', roughness: 0.85 })

  const redGeos: BufferGeometry[] = []
  const roofGeos: BufferGeometry[] = []
  const trimGeos: BufferGeometry[] = []

  const W = 5.2
  const D = 4.2
  const H = 2.6
  const body = new BoxGeometry(W, H, D)
  body.translate(0, H / 2, 0)
  redGeos.push(body)
  const prism = prismGeometry(W, 1.5, D)
  prism.translate(0, H, 0)
  redGeos.push(prism)
  const slope = Math.hypot(W / 2, 1.5)
  for (const side of [-1, 1]) {
    const slab = new BoxGeometry(slope + 0.5, 0.12, D + 0.6)
    slab.rotateZ(side * Math.atan2(1.5, W / 2))
    slab.translate((side * W) / 4 - side * 0.06, H + 0.78, 0)
    roofGeos.push(slab)
  }
  // door + cross braces are LIVE geometry owned by Homestead (homestead.ts) so cutscenes can swing it
  for (const cx of [-W / 2, W / 2]) {
    const corner = new BoxGeometry(0.16, H, 0.16)
    corner.translate(cx, H / 2, D / 2)
    trimGeos.push(corner)
    const corner2 = corner.clone()
    corner2.translate(0, 0, -D)
    trimGeos.push(corner2)
  }
  const loft = new BoxGeometry(0.9, 0.9, 0.08)
  loft.translate(0, H + 0.55, D / 2 + 0.02)
  trimGeos.push(loft)

  const groupRot = 0.55
  const bare = (src: BufferGeometry): BufferGeometry => {
    const g = nonIndexed(src)
    const out = new BufferGeometry()
    out.setAttribute('position', g.getAttribute('position'))
    const normal = g.getAttribute('normal')
    if (normal) out.setAttribute('normal', normal)
    else out.computeVertexNormals()
    return out
  }
  const placeMerged = (geos: BufferGeometry[], mat: MeshStandardMaterial): void => {
    const merged = mergeGeometries(geos.map(bare))
    if (!merged) return
    const m = new Mesh(merged, mat)
    m.castShadow = true
    m.receiveShadow = true
    m.position.copy(BARN_POS)
    m.rotation.y = groupRot
    scene.add(m)
    OCCLUDERS.push(m)
  }
  placeMerged(redGeos, red)
  placeMerged(roofGeos, roof)
  placeMerged(trimGeos, trim)
}

/** axis-aligned triangular prism (gable), apex up, centered */
function prismGeometry(w: number, h: number, d: number): BufferGeometry {
  const hw = w / 2
  const hd = d / 2
  const v = [
    -hw, 0, hd, hw, 0, hd, 0, h, hd,
    hw, 0, -hd, -hw, 0, -hd, 0, h, -hd,
    -hw, 0, hd, 0, h, hd, 0, h, -hd, -hw, 0, hd, 0, h, -hd, -hw, 0, -hd,
    hw, 0, hd, hw, 0, -hd, 0, h, -hd, hw, 0, hd, 0, h, -hd, 0, h, hd,
  ]
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(v), 3))
  geo.computeVertexNormals()
  return geo
}

// ---- the Millbrook gate (east road exit) ----------------------------------------------

/** Weathered plank sign: dark wood grain, warm cream 'MILLBROOK' lettering
 * with a painted right-arrow pointing on toward town, wear speckle so it
 * reads as years-old roadside carpentry — same canvas quality bar as the
 * deed signs, never a flat-color slab. */
function millbrookSignCanvas(rng: Rng): HTMLCanvasElement {
  const W = 320
  const H = 100
  const { c, g } = makeCanvas(W, H)
  g.fillStyle = '#43321f'
  g.fillRect(0, 0, W, H)
  // three planks with seams + grain streaks
  for (const seam of [33, 66]) {
    g.strokeStyle = 'rgba(24,16,8,0.6)'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(0, seam + 0.5)
    g.lineTo(W, seam + 0.5)
    g.stroke()
  }
  for (let i = 0; i < 70; i++) {
    const y = rng.next() * H
    const x = rng.next() * W
    const len = 20 + rng.next() * 70
    g.strokeStyle = rng.next() > 0.5 ? 'rgba(96,72,42,0.4)' : 'rgba(40,28,14,0.45)'
    g.lineWidth = 0.8 + rng.next() * 1.2
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(x + len / 2, y + (rng.next() - 0.5) * 4, x + len, y)
    g.stroke()
  }
  // thin cream border, slightly worn
  g.strokeStyle = 'rgba(238,222,180,0.8)'
  g.lineWidth = 3
  g.strokeRect(7, 7, W - 14, H - 14)
  // lettering + right-arrow to town
  g.fillStyle = '#f2e3bd'
  g.font = '800 38px Trebuchet MS, sans-serif'
  g.textAlign = 'center'
  g.fillText('MILLBROOK', 132, 64)
  g.strokeStyle = '#f2e3bd'
  g.lineWidth = 7
  g.beginPath()
  g.moveTo(248, 50)
  g.lineTo(288, 50)
  g.stroke()
  g.beginPath()
  g.moveTo(284, 36)
  g.lineTo(304, 50)
  g.lineTo(284, 64)
  g.closePath()
  g.fill()
  // wear speckle: paint flecks gone dark + sun-bleached chips
  for (let i = 0; i < 90; i++) {
    g.fillStyle = rng.next() > 0.5 ? '#2c2013' : '#caa86a'
    g.globalAlpha = 0.08 + rng.next() * 0.14
    g.beginPath()
    g.arc(rng.next() * W, rng.next() * H, 0.8 + rng.next() * 2.2, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1
  return c
}

/** Rustic wooden gate marking where the road hands the horse off to town —
 * the road's permanent east landmark, so the delivery horse exits THROUGH
 * something instead of vanishing in plain sight. Two capped posts flank the
 * road at z = ROAD_Z ± 2.1, a crossbeam spans them at 2.7 (the road passes
 * UNDER it) and the painted MILLBROOK board hangs beneath on short hangers.
 * It stands at TOWN_GATE_X = 23.6: past the player bound (maxX 22), inside
 * the tree ring (radius 23.5+), and safe from trunks because forestClear
 * voids the whole |z − ROAD_Z| < 3 band. All structural wood merges into ONE
 * static mesh; the sign board is its own small mesh for its painted face.
 * Deliberately NOT an occluder — thin posts must never yank the camera in. */
function buildTownGate(scene: Scene): void {
  const rng = mulberry32(23611)
  const woodTex = toTexture(woodCanvas(rng, '#6f5234'), true)
  const wood = new MeshStandardMaterial({ map: woodTex, roughness: 0.95 })
  const geos: BufferGeometry[] = []

  // posts + caps flanking the road, with knee braces tucking into the beam
  for (const dz of [-2.1, 2.1]) {
    const post = new BoxGeometry(0.28, 3.1, 0.28)
    post.translate(TOWN_GATE_X, 1.55, ROAD_Z + dz)
    geos.push(post)
    const cap = new BoxGeometry(0.42, 0.12, 0.42)
    cap.translate(TOWN_GATE_X, 3.16, ROAD_Z + dz)
    geos.push(cap)
    const brace = new BoxGeometry(0.09, 0.78, 0.09)
    brace.rotateX(dz < 0 ? Math.PI / 4 : -Math.PI / 4)
    brace.translate(TOWN_GATE_X, 2.34, ROAD_Z + dz - Math.sign(dz) * 0.36)
    geos.push(brace)
  }
  // crossbeam overhead — 4.9 long so it overhangs each post by ~0.35
  const beam = new BoxGeometry(0.2, 0.26, 4.9)
  beam.translate(TOWN_GATE_X, 2.7, ROAD_Z)
  geos.push(beam)
  // short hangers dropping from beam underside to the sign board's top edge
  for (const hz of [-0.6, 0.6]) {
    const hang = new BoxGeometry(0.05, 0.18, 0.05)
    hang.translate(TOWN_GATE_X, 2.51, ROAD_Z + hz)
    geos.push(hang)
  }
  const merged = mergeGeometries(geos)
  if (merged) {
    const frame = new Mesh(merged, wood)
    frame.castShadow = true
    frame.receiveShadow = true
    scene.add(frame)
  }

  // hanging sign board — painted faces read along the road (±x), wood edges
  const paint = new MeshStandardMaterial({ map: toTexture(millbrookSignCanvas(rng)), roughness: 0.85 })
  const board = new Mesh(new BoxGeometry(0.07, 0.55, 1.7), [paint, paint, wood, wood, wood, wood])
  board.position.set(TOWN_GATE_X, 2.18, ROAD_Z)
  board.castShadow = true
  scene.add(board)

  // lucky horseshoe nailed to the north post's farm-facing side, gap up
  const shoeGeo = new TorusGeometry(0.085, 0.022, 8, 18, Math.PI * 1.5)
  shoeGeo.rotateZ(Math.PI * 0.75)
  shoeGeo.rotateY(-Math.PI / 2)
  const shoe = new Mesh(shoeGeo, new MeshStandardMaterial({ color: '#3d3b38', roughness: 0.6, metalness: 0.55 }))
  shoe.position.set(TOWN_GATE_X - 0.16, 1.62, ROAD_Z - 2.1)
  shoe.castShadow = true
  scene.add(shoe)
}

// ---- roadside stand -----------------------------------------------------------------

/** the humble roadside stand — returns its group so the Farm Shop project
 * can sweep it away when the real building goes up. Built ROOT-RELATIVE so
 * the whole stand (crates, awning, queue art) moves as one piece; the root
 * sits at the CURRENT layout place. */
export function buildStand(scene: Scene, assets: Assets): Group {
  const root = new Group()
  root.position.set(LV.stand.x, 0, LV.stand.z)
  scene.add(root)
  const place = (key: ModelKey, x: number, z: number, rot = 0, scale = 1, y = 0): Group => {
    const g = assets.spawn(key)
    g.position.set(x, y, z)
    g.rotation.y = rot
    g.scale.setScalar(scale)
    root.add(g)
    return g
  }
  place('boxLarge', 0, 0, 0, 2.4)
  place('box', -1.3, 0.3, 0.4, 1.8)
  place('barrel', 1.4, 0.1, 0, 1.8)
  place('signpost', 2.3, 1.5, -0.6, 1.6)
  place('egg', -0.35, -0.05, 0, 1.4, 1.06)
  place('egg', -0.12, 0.22, 0.8, 1.4, 1.06)
  place('cornItem', 0.42, 0.1, 0.4, 2.6, 1.06)
  place('pumpkinItem', -1.3, 0.3, 0, 2.6, 0.84)

  // striped awning (canvas texture) + posts
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const g2 = c.getContext('2d')!
  for (let i = 0; i < 8; i++) {
    g2.fillStyle = i % 2 ? '#f5f0e0' : '#e0526e'
    g2.fillRect(i * 16, 0, 16, 64)
  }
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  const awningMat = new MeshStandardMaterial({ map: tex, roughness: 0.9, side: 2 })
  for (const dir of [-1, 1]) {
    const pitch = new Mesh(new PlaneGeometry(3.8, 1.35, 8, 1), awningMat)
    const ap = pitch.geometry.getAttribute('position')
    for (let i = 0; i < ap.count; i++) if (ap.getY(i) < -0.6) ap.setY(i, -0.72 + (i % 2) * 0.06)
    pitch.position.set(0, 2.42, 0.15 + dir * 0.58)
    pitch.rotation.x = -Math.PI / 2 + dir * 0.5
    pitch.castShadow = true
    root.add(pitch)
  }
  const postGeos: BufferGeometry[] = []
  for (const [px, pz] of [[-1.6, -0.7], [1.6, -0.7], [-1.6, 1.0], [1.6, 1.0]] as Array<[number, number]>) {
    const p = new CylinderGeometry(0.055, 0.07, 2.5, 8)
    p.translate(px, 1.25, pz)
    postGeos.push(p)
  }
  const posts = new Mesh(mergeGeometries(postGeos)!, new MeshStandardMaterial({ color: '#9a6b3f', roughness: 1 }))
  posts.castShadow = true
  root.add(posts)
  return root
}

// ---- drifting clouds -----------------------------------------------------------------

export interface CloudField {
  update(dt: number): void
}

export function buildClouds(scene: Scene): CloudField {
  const rng = mulberry32(99)
  const mat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.92, fog: false })
  const clouds: Array<{ mesh: Mesh; speed: number }> = []
  for (let i = 0; i < 6; i++) {
    const geos: BufferGeometry[] = []
    const lobes = 3 + Math.floor(rng.next() * 3)
    for (let l = 0; l < lobes; l++) {
      const s = new SphereGeometry(1.4 + rng.next() * 1.6, 10, 8)
      s.scale(1.6, 0.55, 1)
      s.translate((l - lobes / 2) * 1.9 + rng.next(), rng.next() * 0.5, (rng.next() - 0.5) * 1.4)
      geos.push(s)
    }
    const merged = mergeGeometries(geos)
    if (!merged) continue
    const m = new Mesh(merged, mat)
    m.position.set((rng.next() - 0.5) * 110, 19 + rng.next() * 9, (rng.next() - 0.5) * 90 - 10)
    m.scale.setScalar(0.9 + rng.next() * 0.9)
    scene.add(m)
    clouds.push({ mesh: m, speed: 0.25 + rng.next() * 0.45 })
  }
  return {
    update(dt: number): void {
      for (const cl of clouds) {
        cl.mesh.position.x += cl.speed * dt
        if (cl.mesh.position.x > 70) cl.mesh.position.x = -70
      }
    },
  }
}
