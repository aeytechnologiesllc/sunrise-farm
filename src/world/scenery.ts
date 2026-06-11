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
  Vector3,
  BoxGeometry,
  CylinderGeometry,
  type Object3D,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, type Rng } from '../game/rng'
import { allFieldRects, fenceFor, gatesFor, inRect, PEN } from '../game/expansion'
import { PROJECTS } from '../game/projects'
import type { Assets, ModelKey } from './assets'
import { buildForest } from './trees'
import { buildGrass, type GrassField } from './grass'
import { groundDetailCanvas, toTexture, woodCanvas } from './textures'

export const STAND_POS = new Vector3(0.5, 0, 7)
export const NEST_POS = new Vector3(-4.5, 0, 1.5)
export const CRATE_POS = new Vector3(-5.5, 0, 4.5)
export const DOG_HOME = new Vector3(-1.5, 0, 5)
export const BARN_POS = new Vector3(-11.5, 0, -3.5)
export const PLAYER_SPAWN = new Vector3(-0.6, 0, 4.2)
/** the customer road runs east-west across the south of the farm */
export const ROAD_Z = 11
/** south gate in the picket fence (stand path + customer route) */
export const GATE_SOUTH_X = STAND_POS.x + 0.4
/** customers queue beside the stand's east edge — visible from the follow cam */
export const QUEUE_SPOTS = [new Vector3(3.1, 0, 7.7), new Vector3(4.4, 0, 8.6)]
export const WORLD_BOUNDS = { minX: -19, maxX: 19, minZ: -13, maxZ: 14.5 }

const GROUND_SIZE = 96
const GROUND_BASE = '#6f9e4a'

/** meshes the follow-camera must never hide behind (barn pushes itself in;
 * main adds bought buildings). The camera raycasts this list every frame. */
export const OCCLUDERS: Object3D[] = []

// ---- exclusion zones (shared by grass + forest placement) --------------------

const PATHS: Array<Array<[number, number]>> = [
  [
    [PLAYER_SPAWN.x, PLAYER_SPAWN.z],
    [STAND_POS.x - 0.2, STAND_POS.z - 0.6],
    [STAND_POS.x + 0.3, ROAD_Z - 1.2],
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

/** true where grass tufts must NOT grow */
export function groundClear(x: number, z: number): boolean {
  if (Math.abs(z - ROAD_Z) < 2.4) return true
  for (const f of allFieldRects()) if (inRect(x, z, f, 0.35)) return true
  // every FUTURE building site stays clear from day one — nothing may ever
  // be built on top of a tree, a bush, or through the lawn (owner's rule:
  // the ground is ready before the crew arrives)
  for (const p of PROJECTS) {
    if (p.kind !== 'building') continue
    if (
      x > p.site[0] - p.footprint.w / 2 - 0.4 &&
      x < p.site[0] + p.footprint.w / 2 + 0.4 &&
      z > p.site[1] - p.footprint.d / 2 - 0.4 &&
      z < p.site[1] + p.footprint.d / 2 + 0.4
    )
      return true
  }
  if (x > -2.4 && x < 3.2 && z > 5.3 && z < 9.2) return true // stand + queue
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
  if (inRect(x, z, PEN, 1.2)) return true
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
  sun.shadow.mapSize.set(2048, 2048)
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

function paintGround(rng: Rng): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 2048
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

  // fallow beds where fields live (soil meshes cover the bought ones)
  for (const f of allFieldRects()) {
    g.fillStyle = '#8b9a5b'
    g.globalAlpha = 0.4
    roundRect(g, p.px(f.x0), p.pz(f.z0), p.s(f.x1 - f.x0), p.s(f.z1 - f.z0), p.s(0.5))
    g.fill()
    g.globalAlpha = 1
  }

  // dusty yard around the barn + inside the pen
  g.fillStyle = '#a98e5e'
  g.globalAlpha = 0.35
  g.beginPath()
  g.ellipse(p.px(BARN_POS.x + 1.5), p.pz(BARN_POS.z + 2.5), p.s(4), p.s(2.6), 0.2, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#9aa05e'
  g.globalAlpha = 0.3
  roundRect(g, p.px(PEN.x0), p.pz(PEN.z0), p.s(PEN.x1 - PEN.x0), p.s(PEN.z1 - PEN.z0), p.s(0.6))
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

export function buildGround(scene: Scene): void {
  const tex = new CanvasTexture(paintGround(mulberry32(20260610)))
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
  return grass
}

// ---- white picket fence ring (tier-aware, rebuilt on expansion) ------------------

export function buildPicketFence(scene: Scene, tier: number): Mesh | null {
  const f = fenceFor(tier)
  const gates = gatesFor(tier)
  const geos: BufferGeometry[] = []
  const picket = new BoxGeometry(0.09, 0.62, 0.05)
  const rail = new BoxGeometry(1, 0.07, 0.045)
  const post = new BoxGeometry(0.12, 0.78, 0.12)

  const wallOf = (x0: number, z0: number, x1: number, z1: number): 'N' | 'S' | 'E' | 'W' => {
    if (z0 === z1) return z0 === f.minZ ? 'N' : 'S'
    return x0 === x1 && x0 === f.minX ? 'W' : 'E'
  }
  const inGap = (wall: 'N' | 'S' | 'E' | 'W', t: number): boolean =>
    gates.some((g) => g.wall === wall && Math.abs(t - g.center) < g.half)

  const run = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const dirX = (x1 - x0) / len
    const dirZ = (z1 - z0) / len
    const rot = Math.atan2(dirZ, dirX)
    const wall = wallOf(x0, z0, x1, z1)
    const n = Math.round(len / 0.46)
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * len
      const wx = x0 + dirX * t
      const wz = z0 + dirZ * t
      const tc = Math.abs(dirX) > 0.5 ? wx : wz
      if (inGap(wall, tc)) continue
      const g = picket.clone()
      g.rotateY(-rot)
      g.translate(wx, 0.34, wz)
      geos.push(g)
    }
    const sections = Math.ceil(len / 2.2)
    for (let sIdx = 0; sIdx < sections; sIdx++) {
      const a = (sIdx / sections) * len
      const b = Math.min(len, a + len / sections)
      const mid = (a + b) / 2
      const wx = x0 + dirX * mid
      const wz = z0 + dirZ * mid
      const tc = Math.abs(dirX) > 0.5 ? wx : wz
      if (inGap(wall, tc)) continue
      for (const y of [0.2, 0.48]) {
        const r = rail.clone()
        r.scale(b - a, 1, 1)
        r.rotateY(-rot)
        r.translate(wx, y, wz)
        geos.push(r)
      }
      const p = post.clone()
      const px = x0 + dirX * a
      const pz = z0 + dirZ * a
      if (!inGap(wall, Math.abs(dirX) > 0.5 ? px : pz)) {
        p.translate(px, 0.39, pz)
        geos.push(p)
      }
    }
  }
  run(f.minX, f.minZ, f.maxX, f.minZ)
  run(f.maxX, f.minZ, f.maxX, f.maxZ)
  run(f.maxX, f.maxZ, f.minX, f.maxZ)
  run(f.minX, f.maxZ, f.minX, f.minZ)
  const merged = mergeGeometries(geos)
  if (!merged) return null
  const mesh = new Mesh(merged, new MeshStandardMaterial({ color: '#f4eedd', roughness: 0.85 }))
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)
  return mesh
}

// ---- wooden sheep pen (built by The Sheep Pen project) -------------------------------

export function buildPen(scene: Scene): void {
  const rng = mulberry32(424242)
  const woodTex = toTexture(woodCanvas(rng, '#7a5c38'), true)
  const geos: BufferGeometry[] = []
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
  span(PEN.x0, PEN.z0, PEN.x1, PEN.z0)
  span(PEN.x0, PEN.z1, PEN.x1, PEN.z1)
  span(PEN.x0, PEN.z0, PEN.x0, PEN.z1)
  span(PEN.x1, PEN.z0, PEN.x1, PEN.z1, { from: PEN.gate.z0, to: PEN.gate.z1 })
  const merged = mergeGeometries(geos)
  if (!merged) return
  const mesh = new Mesh(merged, new MeshStandardMaterial({ map: woodTex, roughness: 0.95 }))
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)
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
  const door = new BoxGeometry(1.7, 1.9, 0.1)
  door.translate(0.0, 0.95, D / 2 + 0.03)
  trimGeos.push(door)
  for (const s of [-1, 1]) {
    const brace = new BoxGeometry(0.16, 2.2, 0.06)
    brace.rotateZ((s * Math.PI) / 5.2)
    brace.translate(0, 0.95, D / 2 + 0.1)
    redGeos.push(brace)
  }
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

// ---- roadside stand -----------------------------------------------------------------

/** the humble roadside stand — returns its group so the Farm Shop project
 * can sweep it away when the real building goes up */
export function buildStand(scene: Scene, assets: Assets): Group {
  const root = new Group()
  scene.add(root)
  const place = (key: ModelKey, x: number, z: number, rot = 0, scale = 1, y = 0): Group => {
    const g = assets.spawn(key)
    g.position.set(x, y, z)
    g.rotation.y = rot
    g.scale.setScalar(scale)
    root.add(g)
    return g
  }
  place('boxLarge', STAND_POS.x, STAND_POS.z, 0, 2.4)
  place('box', STAND_POS.x - 1.3, STAND_POS.z + 0.3, 0.4, 1.8)
  place('barrel', STAND_POS.x + 1.4, STAND_POS.z + 0.1, 0, 1.8)
  place('signpost', STAND_POS.x + 2.3, STAND_POS.z + 1.5, -0.6, 1.6)
  place('egg', STAND_POS.x - 0.35, STAND_POS.z - 0.05, 0, 1.4, 1.06)
  place('egg', STAND_POS.x - 0.12, STAND_POS.z + 0.22, 0.8, 1.4, 1.06)
  place('cornItem', STAND_POS.x + 0.42, STAND_POS.z + 0.1, 0.4, 2.6, 1.06)
  place('pumpkinItem', STAND_POS.x - 1.3, STAND_POS.z + 0.3, 0, 2.6, 0.84)

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
    pitch.position.set(STAND_POS.x, 2.42, STAND_POS.z + 0.15 + dir * 0.58)
    pitch.rotation.x = -Math.PI / 2 + dir * 0.5
    pitch.castShadow = true
    root.add(pitch)
  }
  const postGeos: BufferGeometry[] = []
  for (const [px, pz] of [[-1.6, -0.7], [1.6, -0.7], [-1.6, 1.0], [1.6, 1.0]] as Array<[number, number]>) {
    const p = new CylinderGeometry(0.055, 0.07, 2.5, 8)
    p.translate(STAND_POS.x + px, 1.25, STAND_POS.z + pz)
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
