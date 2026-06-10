/** World dressing — the "make screenshots sell it" pass.
 * Canvas-painted ground (grass blotches, mowed paths, soil, a dirt road),
 * gradient sky dome, warm sun + soft shadows, white picket fence ring,
 * a little red barn, Kenney nature scatter BAKED into a handful of merged
 * meshes (draw-call budget), drifting clouds. */
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
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, type Rng } from '../game/rng'
import type { Assets, ModelKey } from './assets'

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
export const WORLD_BOUNDS = { minX: -15, maxX: 15, minZ: -9, maxZ: 13.4 }

const GROUND_SIZE = 96

// ---- lights + sky -----------------------------------------------------------

export function buildLights(scene: Scene): void {
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
  c.left = c.bottom = -24
  c.right = c.top = 24
  c.far = 80
  scene.add(sun)
  scene.add(new HemisphereLight('#bfe0ff', '#7e9a54', 0.75))
  scene.add(new AmbientLight('#fff1da', 0.42))
}

/** vertex-colored gradient dome: warm horizon melting into a soft blue */
export function buildSky(scene: Scene): void {
  const geo = new SphereGeometry(170, 24, 10)
  const pos = geo.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const top = new Color('#5fa8e0')
  const mid = new Color('#a8d4ef')
  const horizon = new Color('#f2ecca')
  const tmp = new Color()
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 170
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
}

// ---- painted ground ----------------------------------------------------------

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
  c.width = c.height = 1024
  const p = painter(c)
  const g = p.ctx

  // base grass + large soft tonal blotches (kills the flat-green look)
  g.fillStyle = '#7cab57'
  g.fillRect(0, 0, c.width, c.height)
  const blotches = ['#86b65f', '#74a350', '#8fbd68', '#6d9c4a', '#82b15a']
  for (let i = 0; i < 240; i++) {
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
    g.globalAlpha = 0.045
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
  for (let i = 0; i < 130; i++) {
    g.fillStyle = rng.next() > 0.5 ? '#bd965e' : '#d4b07a'
    g.globalAlpha = 0.5 + rng.next() * 0.4
    const x = rng.next() * c.width
    const y = ry + (rng.next() - 0.5) * roadHalf * 1.7
    g.beginPath()
    g.arc(x, y, 1 + rng.next() * 2.2, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1

  // worn footpaths: spawn -> stand -> road, field, nest (lighter trodden grass)
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
    const a = w === 0.55 ? 0.30 : 0.16
    path([[PLAYER_SPAWN.x, PLAYER_SPAWN.z], [STAND_POS.x - 0.2, STAND_POS.z - 0.6], [STAND_POS.x + 0.3, ROAD_Z - 1.2]], w, '#b9c27e', a)
    path([[PLAYER_SPAWN.x, PLAYER_SPAWN.z], [1.4, 2.4], [3, 2]], w, '#b9c27e', a * 0.85)
    path([[PLAYER_SPAWN.x, PLAYER_SPAWN.z], [NEST_POS.x + 1.2, NEST_POS.z + 1]], w, '#b9c27e', a * 0.85)
  }

  // tilled soil patch under the field plots
  const sx = p.px(0.2)
  const sz = p.pz(-0.9)
  const sw = p.px(5.9) - sx
  const sh = p.pz(5.0) - sz
  g.fillStyle = '#8a6a42'
  roundRect(g, sx, sz, sw, sh, p.s(0.8))
  g.fill()
  g.strokeStyle = '#75552f'
  g.lineWidth = 2
  g.globalAlpha = 0.5
  for (let i = 1; i < 9; i++) {
    g.beginPath()
    g.moveTo(sx + 8, sz + (sh / 9) * i)
    g.lineTo(sx + sw - 8, sz + (sh / 9) * i)
    g.stroke()
  }
  g.globalAlpha = 1
  for (let i = 0; i < 220; i++) {
    g.fillStyle = rng.next() > 0.5 ? '#7a5a34' : '#96764e'
    g.globalAlpha = 0.4 + rng.next() * 0.4
    g.beginPath()
    g.arc(sx + rng.next() * sw, sz + rng.next() * sh, 1 + rng.next() * 2, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1

  // dusty yard around the barn
  g.fillStyle = '#a98e5e'
  g.globalAlpha = 0.35
  g.beginPath()
  g.ellipse(p.px(BARN_POS.x + 1.5), p.pz(BARN_POS.z + 2.5), p.s(4), p.s(2.6), 0.2, 0, Math.PI * 2)
  g.fill()
  g.globalAlpha = 1

  // grass blade ticks — thousands of tiny strokes give it tooth up close
  for (let i = 0; i < 2600; i++) {
    const x = rng.next() * c.width
    const y = rng.next() * c.height
    if (Math.abs(y - ry) < roadHalf) continue
    g.strokeStyle = rng.next() > 0.5 ? '#92c168' : '#6d9c4a'
    g.globalAlpha = 0.25 + rng.next() * 0.3
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + (rng.next() - 0.5) * 3, y - 2 - rng.next() * 3)
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
  tex.anisotropy = 4
  const ground = new Mesh(
    new PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new MeshStandardMaterial({ map: tex, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  // horizon skirt so the painted square never shows an edge
  const skirt = new Mesh(
    new PlaneGeometry(700, 700),
    new MeshStandardMaterial({ color: '#7cab57', roughness: 1 }),
  )
  skirt.rotation.x = -Math.PI / 2
  skirt.position.y = -0.03
  scene.add(skirt)
}

// ---- static prop batching ------------------------------------------------------

/** Bake placed props into ONE mesh: each source material's flat color is
 * written into a vertex-color attribute, geometries are normalized to
 * position+normal+color and merged. 100+ scattered plants/trees/rocks
 * collapse to a single draw call. (Only safe for untextured materials —
 * the nature kit qualifies; textured packs are placed individually.) */
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

// ---- meadow scatter --------------------------------------------------------------

export function buildMeadow(scene: Scene, assets: Assets): void {
  const rng = mulberry32(1234)
  const batch = new Batcher()
  const place = (key: ModelKey, x: number, z: number, rot = 0, scale = 1): void => {
    const g = assets.spawn(key)
    g.position.set(x, 0, z)
    g.rotation.y = rot
    g.scale.setScalar(scale)
    batch.add(g)
  }
  const clear = (x: number, z: number): boolean =>
    // keep the field, yard, stand and road clear
    (x > -1.5 && x < 7.5 && z > -2.5 && z < 6) ||
    (x > -8 && x < 3 && z > 0 && z < 10.5) ||
    Math.abs(z - ROAD_Z) < 2.6 ||
    (x > BARN_POS.x - 4.5 && x < BARN_POS.x + 5 && z > BARN_POS.z - 4 && z < BARN_POS.z + 5)

  // tree ring just outside the play space
  const trees: ModelKey[] = ['treeA', 'treeB', 'treeC', 'pine', 'treeA', 'treeB']
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + rng.next() * 0.28
    const r = 18.5 + rng.next() * 10
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r * 0.9
    if (Math.abs(z - ROAD_Z) < 2.8) continue
    place(trees[Math.floor(rng.next() * trees.length)], x, z, rng.next() * Math.PI * 2, 2.3 + rng.next() * 1.7)
  }
  // a couple of friendly trees inside the meadow
  place('treeB', -9.5, 7.5, 0.6, 2.6)
  place('treeC', 8.6, -4.6, 2.1, 2.4)
  place('pine', 11.5, 4.4, 1.2, 2.5)

  // bushes/flowers/rocks/grass-tufts scatter
  const scatter: ModelKey[] = [
    'bush', 'bushLarge', 'flowerR', 'flowerY', 'flowerP', 'flowerR2', 'flowerY2',
    'rock', 'rockTall', 'stump', 'grassTuft', 'grassLarge', 'grassTuft', 'mushroom',
  ]
  for (let i = 0; i < 90; i++) {
    const x = (rng.next() - 0.5) * 32
    const z = (rng.next() - 0.5) * 26 + 1
    if (clear(x, z)) continue
    place(scatter[Math.floor(rng.next() * scatter.length)], x, z, rng.next() * Math.PI * 2, 1.2 + rng.next() * 1.3)
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

  buildPicketFence(scene)
  buildBarn(scene)
}

// ---- white picket fence ring -----------------------------------------------------

function buildPicketFence(scene: Scene): void {
  const minX = -8.4
  const maxX = 8.2
  const minZ = -3.4
  const maxZ = 10.2
  const gaps: Array<{ axis: 'x' | 'z'; at: number; center: number; half: number }> = [
    { axis: 'x', at: maxZ, center: GATE_SOUTH_X, half: 1.7 }, // south gate to the road
    { axis: 'z', at: minX, center: 3.2, half: 1.5 }, // west gate near the coop
  ]
  const geos: BufferGeometry[] = []
  const picket = new BoxGeometry(0.09, 0.62, 0.05)
  const rail = new BoxGeometry(1, 0.07, 0.045)
  const post = new BoxGeometry(0.12, 0.78, 0.12)
  const inGap = (axis: 'x' | 'z', at: number, t: number): boolean =>
    gaps.some((g) => g.axis === axis && Math.abs(g.at - at) < 0.01 && Math.abs(t - g.center) < g.half)

  const run = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const dirX = (x1 - x0) / len
    const dirZ = (z1 - z0) / len
    const rot = Math.atan2(dirZ, dirX)
    const axis: 'x' | 'z' = Math.abs(dirX) > 0.5 ? 'x' : 'z'
    const at = axis === 'x' ? z0 : x0
    const n = Math.round(len / 0.46)
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * len
      const wx = x0 + dirX * t
      const wz = z0 + dirZ * t
      const tc = axis === 'x' ? wx : wz
      if (inGap(axis, at, tc)) continue
      const g = picket.clone()
      g.rotateY(-rot)
      g.translate(wx, 0.34, wz)
      geos.push(g)
    }
    // rails in ~2.2u sections, skipping gap spans
    const sections = Math.ceil(len / 2.2)
    for (let sIdx = 0; sIdx < sections; sIdx++) {
      const a = (sIdx / sections) * len
      const b = Math.min(len, a + len / sections)
      const mid = (a + b) / 2
      const wx = x0 + dirX * mid
      const wz = z0 + dirZ * mid
      const tc = axis === 'x' ? wx : wz
      if (inGap(axis, at, tc)) continue
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
      if (!inGap(axis, at, axis === 'x' ? px : pz)) {
        p.translate(px, 0.39, pz)
        geos.push(p)
      }
    }
  }
  run(minX, minZ, maxX, minZ)
  run(maxX, minZ, maxX, maxZ)
  run(maxX, maxZ, minX, maxZ)
  run(minX, maxZ, minX, minZ)
  const merged = mergeGeometries(geos)
  if (!merged) return
  const mesh = new Mesh(merged, new MeshStandardMaterial({ color: '#f4eedd', roughness: 0.85 }))
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)
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
  // walls
  const body = new BoxGeometry(W, H, D)
  body.translate(0, H / 2, 0)
  redGeos.push(body)
  // gable: triangular prism
  const prism = prismGeometry(W, 1.5, D)
  prism.translate(0, H, 0)
  redGeos.push(prism)
  // roof slabs
  const slope = Math.hypot(W / 2, 1.5)
  for (const side of [-1, 1]) {
    const slab = new BoxGeometry(slope + 0.5, 0.12, D + 0.6)
    slab.rotateZ(side * Math.atan2(1.5, W / 2))
    slab.translate((side * W) / 4 - (side * 0.06), H + 0.78, 0)
    roofGeos.push(slab)
  }
  // big front door + white X brace + corner trim
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
  // hay window
  const loft = new BoxGeometry(0.9, 0.9, 0.08)
  loft.translate(0, H + 0.55, D / 2 + 0.02)
  trimGeos.push(loft)

  const groupRot = 0.55
  // strip to position+normal: BoxGeometry carries uv but prismGeometry does
  // not, and mergeGeometries refuses mixed attribute sets (returns null)
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
    // front triangle
    -hw, 0, hd, hw, 0, hd, 0, h, hd,
    // back triangle
    hw, 0, -hd, -hw, 0, -hd, 0, h, -hd,
    // left slope
    -hw, 0, hd, 0, h, hd, 0, h, -hd, -hw, 0, hd, 0, h, -hd, -hw, 0, -hd,
    // right slope
    hw, 0, hd, hw, 0, -hd, 0, h, -hd, hw, 0, hd, 0, h, -hd, 0, h, hd,
  ]
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(v), 3))
  geo.computeVertexNormals()
  return geo
}

// ---- roadside stand -----------------------------------------------------------------

export function buildStand(scene: Scene, assets: Assets): void {
  const place = (key: ModelKey, x: number, z: number, rot = 0, scale = 1, y = 0): Group => {
    const g = assets.spawn(key)
    g.position.set(x, y, z)
    g.rotation.y = rot
    g.scale.setScalar(scale)
    scene.add(g)
    return g
  }
  place('boxLarge', STAND_POS.x, STAND_POS.z, 0, 2.4)
  place('box', STAND_POS.x - 1.3, STAND_POS.z + 0.3, 0.4, 1.8)
  place('barrel', STAND_POS.x + 1.4, STAND_POS.z + 0.1, 0, 1.8)
  place('signpost', STAND_POS.x + 2.3, STAND_POS.z + 1.5, -0.6, 1.6)
  // produce on display
  place('egg', STAND_POS.x - 0.35, STAND_POS.z - 0.05, 0, 2.2, 1.06)
  place('egg', STAND_POS.x - 0.12, STAND_POS.z + 0.22, 0.8, 2.2, 1.06)
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
  // gabled canvas roof: two striped pitches meeting at a ridge, so the stand
  // reads as a market stall from EVERY camera side (a single tilted plane
  // looked like a floating line from behind)
  const awningMat = new MeshStandardMaterial({ map: tex, roughness: 0.9, side: 2 })
  for (const dir of [-1, 1]) {
    const pitch = new Mesh(new PlaneGeometry(3.8, 1.35, 8, 1), awningMat)
    // gentle scallop on the outer hem
    const ap = pitch.geometry.getAttribute('position')
    for (let i = 0; i < ap.count; i++) if (ap.getY(i) < -0.6) ap.setY(i, -0.72 + (i % 2) * 0.06)
    pitch.position.set(STAND_POS.x, 2.42, STAND_POS.z + 0.15 + dir * 0.58)
    pitch.rotation.x = -Math.PI / 2 + dir * 0.5
    pitch.castShadow = true
    scene.add(pitch)
  }
  const postGeos: BufferGeometry[] = []
  for (const [px, pz] of [[-1.6, -0.7], [1.6, -0.7], [-1.6, 1.0], [1.6, 1.0]] as Array<[number, number]>) {
    const p = new CylinderGeometry(0.055, 0.07, 2.5, 8)
    p.translate(STAND_POS.x + px, 1.25, STAND_POS.z + pz)
    postGeos.push(p)
  }
  const posts = new Mesh(mergeGeometries(postGeos)!, new MeshStandardMaterial({ color: '#9a6b3f', roughness: 1 }))
  posts.castShadow = true
  scene.add(posts)
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
