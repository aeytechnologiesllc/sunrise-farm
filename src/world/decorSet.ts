/** Placed-decoration renderer — turns s.decor: DecorPlacement[] into scene
 * geometry.  All 10 DecorIds (flowerbed, planter, sapling, birdbath, bench,
 * lamppost, topiary, beehive, flagpole, wellpump) are built as textured,
 * low-poly hand-built meshes.  Geometry merges per shared material so the
 * whole field of 24 mixed items stays within ~8 draw calls worst-case:
 *
 *   DRAW-CALL BUDGET (24 items, pathological worst-case mix)
 *   ─────────────────────────────────────────────────────────
 *   1. sharedWood   — bench slats, wellpump roof beams, lamp post, flagpole
 *                     post, beehive stand, planter sprigs
 *   2. sharedStone  — birdbath pedestal+basin, wellpump ring
 *   3. sharedFoliage— sapling canopies (all stages), topiary globes, planter
 *                     herb tips, flowerbed soil cover tufts
 *   4. sharedSoil   — flowerbed soil box
 *   5. terracottaTex— planter pot (canvas texture, 1 draw for all planters)
 *   6. beehiveTex   — beehive skep body (banded canvas, 1 draw)
 *   7. emissive     — lamppost glass head + birdbath water disc (emissive,
 *                     no PointLight — rule-compliant)
 *   8. flagTex      — flagpole cloth flag (canvas farm-colour)
 *
 *   Flower-petal geometry folds into sharedFoliage (per-bed hue variation is
 *   baked into vertex colours on the merged petals).  Sapling trunks merge
 *   into sharedWood.  Total: 8 draws for any mix of all 10 types.
 *
 * HARD RULES obeyed:
 *   • No Math.random / Date — mulberry32 only, keyed on (x*… ^ z*…) for
 *     per-item stability.
 *   • No PointLight or SpotLight — emissive materials only for glow.
 *   • No blob characters — flowers are stylised geometry, not blob sprites.
 *   • castShadow=true on every solid piece.
 */

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { DecorId, DecorPlacement } from '../game/decor'
import { mulberry32 } from '../game/rng'
import { makeCanvas, toTexture } from './textures'

// ─── shared material singletons (lazy-created once, reused across refresh) ────

let _wood: MeshStandardMaterial | null = null
let _stone: MeshStandardMaterial | null = null
let _foliage: MeshStandardMaterial | null = null
let _soil: MeshStandardMaterial | null = null
let _terracotta: MeshStandardMaterial | null = null
let _beehiveSkep: MeshStandardMaterial | null = null
let _emissive: MeshStandardMaterial | null = null
let _flag: MeshStandardMaterial | null = null

function woodMat(): MeshStandardMaterial {
  if (_wood) return _wood
  const rng = mulberry32(0xd3c0b4)
  const { c, g } = makeCanvas(128, 128)
  g.fillStyle = '#8b6340'
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 220; i++) {
    const x = rng.next() * 128
    const y = rng.next() * 128 - 10
    const len = 15 + rng.next() * 50
    g.strokeStyle = rng.next() > 0.55 ? '#a07848' : '#6a4828'
    g.globalAlpha = 0.18 + rng.next() * 0.32
    g.lineWidth = 0.8 + rng.next() * 1.8
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(x + (rng.next() - 0.5) * 6, y + len / 2, x + (rng.next() - 0.5) * 4, y + len)
    g.stroke()
  }
  g.globalAlpha = 1
  _wood = new MeshStandardMaterial({ map: toTexture(c, true), roughness: 0.94 })
  return _wood
}

function stoneMat(): MeshStandardMaterial {
  if (_stone) return _stone
  const rng = mulberry32(0x7a8c94)
  const { c, g } = makeCanvas(128, 128)
  g.fillStyle = '#8c9aa0'
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 400; i++) {
    const x = rng.next() * 128
    const y = rng.next() * 128
    const r = 0.7 + rng.next() * 2.2
    g.fillStyle = rng.next() > 0.5 ? '#a0adb4' : '#707c82'
    g.globalAlpha = 0.2 + rng.next() * 0.4
    g.beginPath()
    g.ellipse(x, y, r, r * (0.5 + rng.next() * 0.7), rng.next() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  // mortar seams
  g.strokeStyle = '#5e6b70'
  g.lineWidth = 1.2
  g.globalAlpha = 0.55
  for (let row = 0; row < 4; row++) {
    const y = row * 32 + 0.5
    g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke()
    const off = row % 2 === 0 ? 0 : 16
    for (let col = 0; col < 4; col++) {
      const x = off + col * 32 + 16
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke()
    }
  }
  g.globalAlpha = 1
  _stone = new MeshStandardMaterial({ map: toTexture(c, true), roughness: 0.97 })
  return _stone
}

function foliageMat(): MeshStandardMaterial {
  if (_foliage) return _foliage
  _foliage = new MeshStandardMaterial({ color: '#4a8c3c', roughness: 0.88, vertexColors: true })
  return _foliage
}

function soilMat(): MeshStandardMaterial {
  if (_soil) return _soil
  const rng = mulberry32(0x5c3d22)
  const { c, g } = makeCanvas(128, 128)
  g.fillStyle = '#6b4a2a'
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 300; i++) {
    g.fillStyle = rng.next() > 0.5 ? '#7e5a34' : '#56381e'
    g.globalAlpha = 0.15 + rng.next() * 0.3
    const r = 1 + rng.next() * 3
    g.beginPath()
    g.ellipse(rng.next() * 128, rng.next() * 128, r, r * (0.5 + rng.next() * 0.8), rng.next() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1
  _soil = new MeshStandardMaterial({ map: toTexture(c, true), roughness: 0.99 })
  return _soil
}

function terracottaMat(): MeshStandardMaterial {
  if (_terracotta) return _terracotta
  const rng = mulberry32(0xc04a2e)
  const { c, g } = makeCanvas(128, 128)
  // base terracotta
  g.fillStyle = '#c2623c'
  g.fillRect(0, 0, 128, 128)
  // horizontal throw-bands
  for (let y = 0; y < 128; y += 8) {
    g.strokeStyle = rng.next() > 0.5 ? '#a84e2c' : '#d4784e'
    g.globalAlpha = 0.18 + rng.next() * 0.22
    g.lineWidth = 1.4
    g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(128, y + 0.5); g.stroke()
  }
  // fine grit pores
  for (let i = 0; i < 200; i++) {
    g.fillStyle = rng.next() > 0.5 ? '#8c3c22' : '#d8846a'
    g.globalAlpha = 0.12 + rng.next() * 0.2
    g.beginPath()
    g.arc(rng.next() * 128, rng.next() * 128, 0.6 + rng.next() * 1.8, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1
  _terracotta = new MeshStandardMaterial({ map: toTexture(c, true), roughness: 0.95 })
  return _terracotta
}

function beehiveMat(): MeshStandardMaterial {
  if (_beehiveSkep) return _beehiveSkep
  const rng = mulberry32(0xe0c060)
  const { c, g } = makeCanvas(128, 128)
  // straw base
  g.fillStyle = '#c8a840'
  g.fillRect(0, 0, 128, 128)
  // horizontal coil bands
  const BANDS = 10
  for (let b = 0; b < BANDS; b++) {
    const y = (b / BANDS) * 128
    const bandH = 128 / BANDS
    g.strokeStyle = rng.next() > 0.5 ? '#a88820' : '#e0c060'
    g.globalAlpha = 0.35 + rng.next() * 0.3
    g.lineWidth = bandH * 0.55
    g.beginPath(); g.moveTo(0, y + bandH / 2); g.lineTo(128, y + bandH / 2); g.stroke()
    // straw fibre glints
    for (let i = 0; i < 8; i++) {
      g.strokeStyle = rng.next() > 0.5 ? '#d4b050' : '#8c7018'
      g.globalAlpha = 0.12 + rng.next() * 0.22
      g.lineWidth = 0.8
      const sx = rng.next() * 128
      g.beginPath(); g.moveTo(sx, y); g.lineTo(sx + (rng.next() - 0.5) * 12, y + bandH); g.stroke()
    }
  }
  g.globalAlpha = 1
  _beehiveSkep = new MeshStandardMaterial({ map: toTexture(c, true), roughness: 0.97 })
  return _beehiveSkep
}

function emissiveMat(): MeshStandardMaterial {
  if (_emissive) return _emissive
  // warm amber glow for lamp glass + water shimmer on birdbath
  _emissive = new MeshStandardMaterial({
    color: '#ffe8a0',
    emissive: new Color('#ffcc60'),
    emissiveIntensity: 0.9,
    roughness: 0.3,
    metalness: 0.1,
  })
  return _emissive
}

function flagMat(): MeshStandardMaterial {
  if (_flag) return _flag
  const rng = mulberry32(0x2e7a3c)
  const { c, g } = makeCanvas(128, 64)
  // farm-colour flag: green field with a cream diagonal stripe
  g.fillStyle = '#2e6e30'
  g.fillRect(0, 0, 128, 64)
  g.strokeStyle = '#f4eedd'
  g.lineWidth = 12
  g.globalAlpha = 0.85
  g.beginPath(); g.moveTo(0, 64); g.lineTo(128, 0); g.stroke()
  g.globalAlpha = 1
  // worn edge speckling
  for (let i = 0; i < 60; i++) {
    g.fillStyle = '#1a5020'
    g.globalAlpha = 0.08 + rng.next() * 0.18
    g.beginPath()
    g.arc(rng.next() * 128, rng.next() * 64, 1 + rng.next() * 2.5, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1
  _flag = new MeshStandardMaterial({ map: toTexture(c), roughness: 0.88, side: 2 })
  return _flag
}

// ─── geometry helpers ──────────────────────────────────────────────────────────

/** translate+clone shorthand */
function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): BoxGeometry {
  const g = new BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

function cyl(rTop: number, rBot: number, h: number, segs: number, x = 0, y = 0, z = 0): CylinderGeometry {
  const g = new CylinderGeometry(rTop, rBot, h, segs)
  g.translate(x, y + h / 2, z)
  return g
}

/** non-indexed for mergeGeometries compat */
function ni(g: BufferGeometry): BufferGeometry {
  return g.index ? g.toNonIndexed() : g
}

/** stamp per-vertex colour onto every vertex in a geometry (for foliage blends) */
function colorize(geo: BufferGeometry, r: number, gr: number, b: number): BufferGeometry {
  const pos = geo.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3] = r; colors[i * 3 + 1] = gr; colors[i * 3 + 2] = b
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geo
}

// ─── per-item geometry builders ────────────────────────────────────────────────
// Each returns geos sorted into the 8 shared material buckets.
// Caller accumulates the lists and merges once per bucket.

interface GeoAccum {
  wood:       BufferGeometry[]
  stone:      BufferGeometry[]
  foliage:    BufferGeometry[]  // vertex-coloured
  soil:       BufferGeometry[]
  terracotta: BufferGeometry[]
  beehive:    BufferGeometry[]
  emissive:   BufferGeometry[]
  flag:       BufferGeometry[]
}

function makeAccum(): GeoAccum {
  return { wood: [], stone: [], foliage: [], soil: [], terracotta: [], beehive: [], emissive: [], flag: [] }
}

// ---- flowerbed ----------------------------------------------------------------
// Soil box + 5-7 flowers, petal hue driven by per-bed seeded rng(x,z)

const PETAL_HUES: Array<[number, number, number]> = [
  [1.0, 0.35, 0.55],  // rose pink
  [1.0, 0.75, 0.10],  // sunflower yellow
  [0.62, 0.38, 0.92], // lavender
  [1.0, 0.55, 0.15],  // orange
  [0.90, 0.90, 1.00], // white-blue
]

function addFlowerbed(acc: GeoAccum, x: number, z: number, rot: number): void {
  // soil bed — centred at origin, translated to world pos after merge
  const soilG = box(1.4, 0.12, 1.0, x, 0.06, z)
  soilG.rotateY(rot)
  acc.soil.push(ni(soilG))

  // per-bed rng keyed on position so petal colour is stable across reloads
  const seed = ((x * 73856093) ^ (z * 19349663)) >>> 0
  const rng = mulberry32(seed)
  rng.next() // discard seed artefact

  const count = 5 + Math.floor(rng.next() * 3) // 5-7
  const palIdx = Math.floor(rng.next() * PETAL_HUES.length)
  const [pr, pg, pb] = PETAL_HUES[palIdx]

  for (let i = 0; i < count; i++) {
    const fx = x + (rng.next() - 0.5) * 1.1
    const fz = z + (rng.next() - 0.5) * 0.8
    const h = 0.14 + rng.next() * 0.12

    // stem — green, merged into foliage
    const stem = cyl(0.018, 0.022, h, 5, fx, 0.12, fz)
    const [sr, sg, sb]: [number, number, number] = [0.22, 0.62, 0.18]
    acc.foliage.push(ni(colorize(stem, sr, sg, sb)))

    // petal blob — a flattened sphere, vertex-coloured with the bed's hue
    const petal = new SphereGeometry(0.07 + rng.next() * 0.04, 7, 5)
    petal.scale(1.0, 0.55, 1.0)
    petal.translate(fx, 0.12 + h, fz)
    acc.foliage.push(ni(colorize(petal, pr, pg, pb)))
  }
}

// ---- planter ------------------------------------------------------------------
// Terracotta pot + 3 herb sprigs (thin cylinders + small sphere tips)

function addPlanter(acc: GeoAccum, x: number, z: number, rot: number): void {
  // pot body — terracotta frustum
  const body = cyl(0.22, 0.30, 0.38, 10, x, 0.0, z)
  acc.terracotta.push(ni(body))
  // pot rim ring — slightly wider
  const rim = new CylinderGeometry(0.25, 0.22, 0.04, 10)
  rim.translate(x, 0.40, z)
  acc.terracotta.push(ni(rim))

  // soil cap
  const soilCap = new CylinderGeometry(0.20, 0.20, 0.03, 10)
  soilCap.translate(x, 0.40, z)
  acc.soil.push(ni(soilCap))

  // herb sprigs
  const rng = mulberry32(((x * 37) ^ (z * 61)) >>> 0)
  rng.next()
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + rng.next() * 0.5
    const r = 0.08 + rng.next() * 0.06
    const sx = x + Math.cos(angle + rot) * r
    const sz = z + Math.sin(angle + rot) * r
    const sh = 0.20 + rng.next() * 0.15
    const stalk = cyl(0.014, 0.018, sh, 5, sx, 0.43, sz)
    // a green herb stalk belongs in the vertex-coloured FOLIAGE bucket — pushing
    // a colorize()'d geometry into the plain WOOD bucket gives it an extra
    // attribute the other wood geos lack, and mergeGeometries() rejects the lot
    acc.foliage.push(ni(colorize(stalk, 0.28, 0.58, 0.20)))
    const tip = new SphereGeometry(0.038, 6, 4)
    tip.translate(sx, 0.43 + sh + 0.02, sz)
    acc.foliage.push(ni(colorize(tip, 0.30, 0.70, 0.22)))
  }
}

// ---- sapling ------------------------------------------------------------------
// 3 growth stages: dayAge 0-1 = tiny, 2-4 = medium, 5+ = full little tree
// Trunk → wood, canopy → foliage

function addSapling(acc: GeoAccum, x: number, z: number, rot: number, dayAge: number): void {
  // stage 0: just-planted nubbin; stage 1: mid; stage 2: small tree
  const stage = dayAge <= 1 ? 0 : dayAge <= 4 ? 1 : 2
  const trunkH  = [0.18, 0.42, 0.78][stage]
  const trunkR  = [0.028, 0.042, 0.058][stage]
  const canopyR = [0.14, 0.26, 0.44][stage]

  const trunk = cyl(trunkR * 0.65, trunkR, trunkH, 7, x, 0.0, z)
  acc.wood.push(ni(trunk))

  // canopy — one rounded blob (sphere), vertex-coloured forest green
  const canopy = new SphereGeometry(canopyR, 7, 6)
  canopy.scale(1.0, 0.82, 1.0)
  canopy.translate(x, trunkH + canopyR * 0.7, z)
  const cr = 0.26, cg = 0.68, cb = 0.24
  acc.foliage.push(ni(colorize(canopy, cr, cg, cb)))

  // stage 2 gets a small secondary tuft for silhouette interest
  if (stage === 2) {
    const tuft = new SphereGeometry(canopyR * 0.55, 6, 5)
    tuft.translate(x + Math.cos(rot) * 0.22, trunkH + canopyR * 0.9, z + Math.sin(rot) * 0.22)
    acc.foliage.push(ni(colorize(tuft, 0.24, 0.64, 0.22)))
  }
}

// ---- birdbath -----------------------------------------------------------------
// Stone pedestal + basin + emissive water disc (NO PointLight)

function addBirdbath(acc: GeoAccum, x: number, z: number): void {
  // pedestal shaft
  const shaft = cyl(0.10, 0.13, 0.60, 8, x, 0.0, z)
  acc.stone.push(ni(shaft))
  // base plate
  const base = box(0.36, 0.06, 0.36, x, 0.03, z)
  acc.stone.push(ni(base))
  // basin lip — flared cylinder
  const lip = new CylinderGeometry(0.32, 0.22, 0.10, 12)
  lip.translate(x, 0.65, z)
  acc.stone.push(ni(lip))
  // basin floor
  const floor_ = new CylinderGeometry(0.22, 0.22, 0.03, 10)
  floor_.translate(x, 0.60, z)
  acc.stone.push(ni(floor_))
  // emissive water disc (soft blue-tinted glow)
  const water = new CylinderGeometry(0.20, 0.20, 0.012, 12)
  water.translate(x, 0.635, z)
  acc.emissive.push(ni(water))
}

// ---- bench --------------------------------------------------------------------
// Two legs + two seat slats + back rest — all wood material

function addBench(acc: GeoAccum, x: number, z: number, rot: number): void {
  const cos = Math.cos(rot), sin = Math.sin(rot)
  const off = (dx: number, dz: number): [number, number] =>
    [x + cos * dx - sin * dz, z + sin * dx + cos * dz]

  // legs (two pairs)
  for (const side of [-0.4, 0.4]) {
    for (const front of [-0.05, 0.25]) {
      const [lx, lz] = off(side, front)
      const leg = cyl(0.04, 0.04, 0.38, 6, lx, 0.0, lz)
      acc.wood.push(ni(leg))
    }
  }
  // seat slats
  for (const sv of [0, 0.12]) {
    const [sx, sz] = off(0, sv)
    const slat = box(0.9, 0.06, 0.12, sx, 0.38, sz)
    slat.rotateY(rot)
    acc.wood.push(ni(slat))
  }
  // back rest post pair
  for (const side of [-0.38, 0.38]) {
    const [px, pz] = off(side, -0.06)
    const post = cyl(0.03, 0.03, 0.44, 5, px, 0.38, pz)
    acc.wood.push(ni(post))
  }
  // back rest rail
  const [rx, rz] = off(0, -0.06)
  const rail = box(0.88, 0.07, 0.07, rx, 0.76, rz)
  rail.rotateY(rot)
  acc.wood.push(ni(rail))
}

// ---- lamppost -----------------------------------------------------------------
// Tall post + arm + glass globe (emissive — no PointLight)

function addLamppost(acc: GeoAccum, x: number, z: number): void {
  // post shaft — tapered
  const shaft = cyl(0.055, 0.075, 2.0, 8, x, 0.0, z)
  acc.wood.push(ni(shaft))
  // horizontal arm
  const arm = box(0.06, 0.06, 0.36, x, 1.85, z + 0.18)
  acc.wood.push(ni(arm))
  // globe cage (thin ring)
  const cage = new CylinderGeometry(0.11, 0.11, 0.22, 10)
  cage.translate(x, 1.92, z + 0.36)
  acc.wood.push(ni(cage))
  // emissive glass globe inside the cage
  const globe = new SphereGeometry(0.09, 8, 7)
  globe.translate(x, 1.92, z + 0.36)
  acc.emissive.push(ni(globe))
  // base plate
  const base = box(0.22, 0.04, 0.22, x, 0.02, z)
  acc.wood.push(ni(base))
}

// ---- topiary ------------------------------------------------------------------
// Clipped green shrub: a cone base + sphere stack on a short post

function addTopiary(acc: GeoAccum, x: number, z: number): void {
  // short post
  const post = cyl(0.05, 0.06, 0.25, 7, x, 0.0, z)
  acc.wood.push(ni(post))
  // lower cone body
  const cone = new CylinderGeometry(0.0, 0.30, 0.60, 10)
  cone.translate(x, 0.55, z)
  acc.foliage.push(ni(colorize(cone, 0.20, 0.60, 0.18)))
  // upper sphere
  const ball = new SphereGeometry(0.26, 9, 8)
  ball.translate(x, 1.05, z)
  acc.foliage.push(ni(colorize(ball, 0.22, 0.65, 0.20)))
  // cap knob
  const knob = new SphereGeometry(0.08, 6, 5)
  knob.translate(x, 1.35, z)
  acc.foliage.push(ni(colorize(knob, 0.24, 0.68, 0.22)))
}

// ---- beehive ------------------------------------------------------------------
// Stacked skep (banded canvas texture) on a small wooden stand

function addBeehive(acc: GeoAccum, x: number, z: number): void {
  // stand legs (two crossed planks)
  const plkA = box(0.56, 0.06, 0.10, x, 0.06, z)
  const plkB = box(0.10, 0.06, 0.56, x, 0.06, z)
  acc.wood.push(ni(plkA))
  acc.wood.push(ni(plkB))
  // skep body — tapered cylinder (banded straw texture)
  const body = new CylinderGeometry(0.08, 0.30, 0.60, 12)
  body.translate(x, 0.42, z)
  acc.beehive.push(ni(body))
  // domed cap
  const dome = new SphereGeometry(0.12, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2)
  dome.scale(1.0, 1.4, 1.0)
  dome.translate(x, 0.72, z)
  acc.beehive.push(ni(dome))
}

// ---- flagpole -----------------------------------------------------------------
// Thin post + cloth flag (flat angled plane, farm-colour canvas)

function addFlagpole(acc: GeoAccum, x: number, z: number, rot: number): void {
  // pole
  const pole = cyl(0.035, 0.04, 2.2, 7, x, 0.0, z)
  acc.wood.push(ni(pole))
  // base plate
  const base = box(0.18, 0.04, 0.18, x, 0.02, z)
  acc.wood.push(ni(base))
  // flag cloth — thin BoxGeometry standing proud of the pole
  const flagGeo = new BoxGeometry(0.55, 0.32, 0.015)
  flagGeo.rotateY(rot + Math.PI / 6) // slight angle so it reads as waving
  flagGeo.translate(x + Math.cos(rot) * 0.30, 1.88, z + Math.sin(rot) * 0.30)
  acc.flag.push(ni(flagGeo))
}

// ---- wellpump -----------------------------------------------------------------
// Low stone well ring + a timber A-frame roof over it

function addWellpump(acc: GeoAccum, x: number, z: number, rot: number): void {
  // stone ring wall
  const ring = new TorusGeometry(0.38, 0.12, 8, 16)
  ring.rotateX(Math.PI / 2)
  ring.translate(x, 0.24, z)
  acc.stone.push(ni(ring))
  // floor disk inside
  const floor_ = new CylinderGeometry(0.26, 0.26, 0.05, 12)
  floor_.translate(x, 0.05, z)
  acc.stone.push(ni(floor_))

  // A-frame roof: two slanted planks
  for (const side of [-1, 1]) {
    const rafter = box(0.06, 0.06, 0.74, x + side * 0.22 * Math.cos(rot), 0.70, z + side * 0.22 * Math.sin(rot))
    rafter.rotateZ(side * 0.55)
    rafter.rotateY(rot)
    acc.wood.push(ni(rafter))
  }
  // ridge beam
  const ridge = box(0.60, 0.05, 0.06, x, 0.92, z)
  ridge.rotateY(rot)
  acc.wood.push(ni(ridge))
  // two support posts
  for (const side of [-1, 1]) {
    const [px, pz] = [x + Math.cos(rot + Math.PI / 2) * 0.32 * side, z + Math.sin(rot + Math.PI / 2) * 0.32 * side]
    const post = cyl(0.04, 0.04, 0.85, 6, px, 0.0, pz)
    acc.wood.push(ni(post))
  }
}

// ─── builder dispatch ──────────────────────────────────────────────────────────

function addItem(
  acc: GeoAccum,
  id: DecorId,
  px: number,
  pz: number,
  rot: number,
  dayAge: number,
): void {
  switch (id) {
    case 'flowerbed': addFlowerbed(acc, px, pz, rot); break
    case 'planter':   addPlanter(acc, px, pz, rot); break
    case 'sapling':   addSapling(acc, px, pz, rot, dayAge); break
    case 'birdbath':  addBirdbath(acc, px, pz); break
    case 'bench':     addBench(acc, px, pz, rot); break
    case 'lamppost':  addLamppost(acc, px, pz); break
    case 'topiary':   addTopiary(acc, px, pz); break
    case 'beehive':   addBeehive(acc, px, pz); break
    case 'flagpole':  addFlagpole(acc, px, pz, rot); break
    case 'wellpump':  addWellpump(acc, px, pz, rot); break
  }
}

// ─── helper: flush accum into scene meshes ─────────────────────────────────────

function flushAccum(acc: GeoAccum, scene: Scene): Mesh[] {
  const out: Mesh[] = []

  const emit = (geos: BufferGeometry[], mat: MeshStandardMaterial, emissive = false): void => {
    if (geos.length === 0) return
    const merged = mergeGeometries(geos)
    for (const g of geos) g.dispose() // the source primitives are spent once merged
    if (!merged) return
    const m = new Mesh(merged, mat)
    m.castShadow = !emissive
    m.receiveShadow = true
    scene.add(m)
    out.push(m)
  }

  emit(acc.wood,       woodMat())
  emit(acc.stone,      stoneMat())
  emit(acc.foliage,    foliageMat())
  emit(acc.soil,       soilMat())
  emit(acc.terracotta, terracottaMat())
  emit(acc.beehive,    beehiveMat())
  emit(acc.emissive,   emissiveMat(), true)
  emit(acc.flag,       flagMat())

  return out
}

// ─── buildOne: standalone Group (placement ghost) ──────────────────────────────
// Builds a single item as a Group positioned at the origin (for ghost previews).
// dayAge controls sapling growth stage. Caller tints + moves a clone.

function buildOneGroup(id: DecorId, dayAge: number): Group {
  const acc = makeAccum()
  // build at origin (x=0, z=0)
  addItem(acc, id, 0, 0, 0, dayAge)

  const group = new Group()

  const addToGroup = (geos: BufferGeometry[], mat: MeshStandardMaterial, isEmissive = false): void => {
    if (geos.length === 0) return
    const merged = mergeGeometries(geos)
    for (const g of geos) g.dispose() // free the source primitives post-merge
    if (!merged) return
    const m = new Mesh(merged, mat)
    m.castShadow = !isEmissive
    m.receiveShadow = true
    group.add(m)
  }

  addToGroup(acc.wood,       woodMat())
  addToGroup(acc.stone,      stoneMat())
  addToGroup(acc.foliage,    foliageMat())
  addToGroup(acc.soil,       soilMat())
  addToGroup(acc.terracotta, terracottaMat())
  addToGroup(acc.beehive,    beehiveMat())
  addToGroup(acc.emissive,   emissiveMat(), true)
  addToGroup(acc.flag,       flagMat())

  return group
}

// ─── DecorSet ─────────────────────────────────────────────────────────────────

export class DecorSet {
  private scene: Scene
  private meshes: Mesh[] = []

  constructor(scene: Scene) {
    this.scene = scene
  }

  /** Dispose all previous decor meshes and rebuild from the placement array.
   *  Called on boot and after every add/remove. Safe to call with [] (clears). */
  refresh(decor: DecorPlacement[], day: number): void {
    // dispose old geometry to avoid GPU memory leaks across edit cycles
    for (const m of this.meshes) {
      m.geometry.dispose()
      this.scene.remove(m)
    }
    this.meshes = []

    if (decor.length === 0) return

    const acc = makeAccum()
    for (const p of decor) {
      const dayAge = day - p.d
      addItem(acc, p.item, p.x, p.z, p.rot, dayAge < 0 ? 0 : dayAge)
    }

    this.meshes = flushAccum(acc, this.scene)
  }

  /** Build ONE item as a standalone Group at origin, facing +z.
   *  Used by main for the placement GHOST: main tints + translates a clone.
   *  dayAge = how many game-days since placed (sapling shows its current stage). */
  buildOne(id: DecorId, dayAge: number): Group {
    return buildOneGroup(id, dayAge)
  }
}
