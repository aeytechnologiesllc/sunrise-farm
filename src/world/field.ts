/** Tilled fields you could almost smell: a furrow-ridged soil mesh (real
 * geometry waves, not a painted rectangle) with a clod-and-stone soil texture,
 * plus plank-wood frames marking each plantable plot. One group per field so
 * land expansions can drop new ones in with a ceremony. */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../game/rng'
import type { FieldRect } from '../game/expansion'
import { makeCanvas, toTexture, woodCanvas } from './textures'

const FURROW_PERIOD = 0.55
const FURROW_AMP = 0.075
/** plot frame: boards this long centered on each plot */
export const PLOT_FRAME = 2.3
/** soil surface height crops should sprout from */
export const SOIL_TOP = 0.1

function smooth01(v: number): number {
  const t = Math.max(0, Math.min(1, v))
  return t * t * (3 - 2 * t)
}

function soilCanvas(seed: number, w: number, h: number, plotsLocal: Array<[number, number]>): HTMLCanvasElement {
  const rng = mulberry32(seed)
  const k = 56 // px per world unit
  const { c, g } = makeCanvas(Math.round(w * k), Math.round(h * k))
  g.fillStyle = '#7a5a38'
  g.fillRect(0, 0, c.width, c.height)

  // furrow bands (must match the geometry's cosine ridges along z)
  for (let z = FURROW_PERIOD / 2; z < h; z += FURROW_PERIOD) {
    const y = z * k
    // sunlit crest
    g.strokeStyle = '#8f6e47'
    g.globalAlpha = 0.6
    g.lineWidth = 0.2 * k
    g.beginPath()
    g.moveTo(0, y - 0.14 * k)
    for (let x = 0; x <= c.width; x += 18) g.lineTo(x, y - 0.14 * k + Math.sin(x * 0.05 + z * 7) * 2)
    g.stroke()
    // valley shadow
    g.strokeStyle = '#5b3f24'
    g.globalAlpha = 0.55
    g.lineWidth = 0.22 * k
    g.beginPath()
    g.moveTo(0, y + 0.14 * k)
    for (let x = 0; x <= c.width; x += 18) g.lineTo(x, y + 0.14 * k + Math.sin(x * 0.06 + z * 5) * 2)
    g.stroke()
  }
  g.globalAlpha = 1

  // clods
  const clods = Math.round(w * h * 30)
  for (let i = 0; i < clods; i++) {
    const tone = rng.next()
    g.fillStyle = tone > 0.6 ? '#8a684229' : tone > 0.3 ? '#5f422655' : '#96764e33'
    const r = 1 + rng.next() * 3
    g.beginPath()
    g.arc(rng.next() * c.width, rng.next() * c.height, r, 0, Math.PI * 2)
    g.fill()
  }
  // a few stones
  for (let i = 0; i < Math.round(w * h * 0.9); i++) {
    g.fillStyle = rng.next() > 0.5 ? '#9a8a6c' : '#857258'
    g.globalAlpha = 0.8
    g.beginPath()
    g.ellipse(rng.next() * c.width, rng.next() * c.height, 1.5 + rng.next() * 2, 1 + rng.next() * 1.5, rng.next() * 3, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1

  // slightly darker worked patch under each plot
  for (const [px, pz] of plotsLocal) {
    g.fillStyle = '#000000'
    g.globalAlpha = 0.1
    const half = (PLOT_FRAME / 2 + 0.08) * k
    g.fillRect(px * k - half, pz * k - half, half * 2, half * 2)
  }
  g.globalAlpha = 1
  return c
}

/** build one field block; `plots` are world-space plot centers inside it */
export function buildField(rect: FieldRect, plots: Array<[number, number]>, seed: number): Group {
  const group = new Group()
  const w = rect.x1 - rect.x0
  const h = rect.z1 - rect.z0
  const cx = (rect.x0 + rect.x1) / 2
  const cz = (rect.z0 + rect.z1) / 2

  const plotsLocal: Array<[number, number]> = plots.map(([px, pz]) => [px - rect.x0, pz - rect.z0])
  const tex = toTexture(soilCanvas(seed, w, h, plotsLocal))

  const rng = mulberry32(seed ^ 0x5f3759df)
  const geo = new PlaneGeometry(w, h, Math.max(8, Math.round(w / 0.14)), Math.max(8, Math.round(h / 0.14)))
  geo.rotateX(-Math.PI / 2) // plane y-up; plane's +y becomes -z
  const pos = geo.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i) + w / 2
    const lz = pos.getZ(i) + h / 2
    const edge = Math.min(lx, w - lx, lz, h - lz)
    const damp = smooth01(edge / 0.5)
    const ridge = 0.5 + 0.5 * Math.cos((lz / FURROW_PERIOD) * Math.PI * 2)
    pos.setY(i, damp * (FURROW_AMP * ridge + 0.012 + rng.next() * 0.014))
  }
  geo.computeVertexNormals()
  const soil = new Mesh(geo, new MeshStandardMaterial({ map: tex, roughness: 1 }))
  soil.position.set(cx, 0.012, cz)
  soil.receiveShadow = true
  group.add(soil)

  // plank frames around each plot
  const woodTex = toTexture(woodCanvas(mulberry32(seed ^ 0xabcdef), '#8a6a42'), true)
  const frames: BufferGeometry[] = []
  const half = PLOT_FRAME / 2
  for (const [px, pz] of plots) {
    for (const side of [-1, 1]) {
      const bx = new BoxGeometry(PLOT_FRAME + 0.15, 0.085, 0.075)
      bx.translate(px, SOIL_TOP + 0.05, pz + side * half)
      frames.push(bx)
      const bz = new BoxGeometry(0.075, 0.085, PLOT_FRAME + 0.15)
      bz.translate(px + side * half, SOIL_TOP + 0.05, pz)
      frames.push(bz)
    }
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const stake = new BoxGeometry(0.085, 0.3, 0.085)
        stake.translate(px + sx * half, SOIL_TOP + 0.1, pz + sz * half)
        frames.push(stake)
      }
  }
  const merged = mergeGeometries(frames)
  if (merged) {
    const mesh = new Mesh(merged, new MeshStandardMaterial({ map: woodTex, roughness: 0.95 }))
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}

/** world position helper for crop placement on the ridged soil */
export function plotCenter(p: [number, number]): Vector3 {
  return new Vector3(p[0], 0, p[1])
}

// ---- greenhouse crop stages -------------------------------------------------
// The nature kit has no tomato/pepper/eggplant models, so the glasshouse crops
// are painted here to the same bar as the soil/grass: canvas-textured leaf
// cutout cards, a painted-wood stake, and fruit-scale spheres with skin
// texture + tint variation. buildGreenhouseCropStage(kind, stage, seed)
// returns a single-plant template Group (root at soil level, like the kit
// crop GLBs) for PlotView's merge-bake stage swap.

/** which CropKinds the painter covers (the greenhouse exclusives) */
export type GhCropKind = 'tomato' | 'pepper' | 'eggplant'

interface GhCropArt {
  /** foliage hue center (tomato vines are yellower than eggplant's) */
  leafHue: number
  /** ripe skin palette */
  base: string
  deep: string
  sheen: string
  streak: string
  /** fruit proportions: base radius, jitter, and y-squash/stretch */
  r: number
  rj: number
  sy: number
  /** fruits per cluster (min, max) */
  perCluster: [number, number]
  /** ripe-stage skin roughness (eggplants stay waxier than tomatoes) */
  gloss: number
}

const GH_ART: Record<GhCropKind, GhCropArt> = {
  // squat glossy red clusters
  tomato: { leafHue: 105, base: '#c8311f', deep: '#8f1d12', sheen: '#ef6b46', streak: '#f5a05f', r: 0.055, rj: 0.025, sy: 0.88, perCluster: [2, 3], gloss: 0.28 },
  // tall blocky golden-orange bells, hanging in ones and twos
  pepper: { leafHue: 112, base: '#e39b18', deep: '#9c660d', sheen: '#f7c95c', streak: '#f9e08a', r: 0.062, rj: 0.02, sy: 1.3, perCluster: [1, 2], gloss: 0.3 },
  // long waxy deep-purple fruit, one to a stem
  eggplant: { leafHue: 118, base: '#5b2a6e', deep: '#34173f', sheen: '#9356ad', streak: '#a98abc', r: 0.058, rj: 0.018, sy: 1.75, perCluster: [1, 1], gloss: 0.22 },
}

/** serrated leaflets on a transparent cutout card — drawn as stem + paired
 * ragged-edge leaflets so the silhouette reads "vine", not an ellipse blob.
 * `darker` is the ripe-stage foliage (old vines dull down). */
function vineLeafCanvas(seed: number, darker: boolean, hueBase: number): HTMLCanvasElement {
  const rng = mulberry32(seed)
  const W = 256
  const H = 256
  const { c, g } = makeCanvas(W, H)
  const drop = darker ? 9 : 0
  const leaflet = (x: number, y: number, len: number, ang: number): void => {
    const hue = hueBase + (rng.next() - 0.5) * 16
    const sat = (darker ? 34 : 42) + rng.next() * 14
    const lit = (darker ? 20 : 26) + rng.next() * 12 - drop / 2
    g.save()
    g.translate(x, y)
    g.rotate(ang)
    // ragged serrated edge: lobed outline built from short arc bites
    g.fillStyle = `hsl(${hue},${sat}%,${lit}%)`
    g.beginPath()
    g.moveTo(0, 0)
    const half = len * 0.34
    for (let s = 0; s <= 4; s++) {
      const t = s / 4
      const bite = (s % 2 === 0 ? 1 : 0.62) + (rng.next() - 0.5) * 0.18
      g.quadraticCurveTo(len * (t - 0.08), -half * bite * Math.sin(t * Math.PI) - len * 0.1 * t, len * t, -half * Math.sin(t * Math.PI) * bite * 0.8)
    }
    for (let s = 4; s >= 0; s--) {
      const t = s / 4
      const bite = (s % 2 === 0 ? 1 : 0.62) + (rng.next() - 0.5) * 0.18
      g.quadraticCurveTo(len * (t + 0.04), half * bite * Math.sin(t * Math.PI) + len * 0.1 * t, len * t, half * Math.sin(t * Math.PI) * bite * 0.8)
    }
    g.closePath()
    g.fill()
    // midrib catches light
    g.strokeStyle = `hsl(${hue},${sat - 8}%,${lit + 12}%)`
    g.lineWidth = 1.6
    g.beginPath()
    g.moveTo(0, 0)
    g.quadraticCurveTo(len * 0.5, -len * 0.04, len * 0.94, -len * 0.02)
    g.stroke()
    g.restore()
  }
  // 3 compound fronds fan from the card base, leaflets paired along each
  const fronds = 3
  for (let f = 0; f < fronds; f++) {
    const baseA = -Math.PI / 2 + (f - 1) * 0.72 + (rng.next() - 0.5) * 0.2
    const sx = W / 2
    const sy = H - 12
    const stemLen = H * (0.62 + rng.next() * 0.22)
    const ex = sx + Math.cos(baseA) * stemLen
    const ey = sy + Math.sin(baseA) * stemLen
    g.strokeStyle = `hsl(100,${darker ? 30 : 36}%,${darker ? 22 : 28}%)`
    g.lineWidth = 3.2
    g.beginPath()
    g.moveTo(sx, sy)
    g.quadraticCurveTo(sx + Math.cos(baseA) * stemLen * 0.5 + (rng.next() - 0.5) * 18, sy + Math.sin(baseA) * stemLen * 0.5, ex, ey)
    g.stroke()
    // paired leaflets along the stem + a terminal one
    for (let i = 1; i <= 3; i++) {
      const t = i / 3.2
      const px = sx + Math.cos(baseA) * stemLen * t
      const py = sy + Math.sin(baseA) * stemLen * t
      const size = 34 + rng.next() * 18
      leaflet(px, py, size, baseA - 0.85 + (rng.next() - 0.5) * 0.3)
      leaflet(px, py, size, baseA + 0.85 + (rng.next() - 0.5) * 0.3)
    }
    leaflet(ex, ey, 40 + rng.next() * 16, baseA + (rng.next() - 0.5) * 0.2)
  }
  return c
}

/** fruit skin: radial sheen, faint shoulder streaks, a green star calyx —
 * wrapped on fruit-scale spheres so clusters read as fruit, not beads.
 * Unripe fruit shares the green-marble palette across all three crops. */
function fruitSkinCanvas(seed: number, ripe: boolean, art: GhCropArt): HTMLCanvasElement {
  const rng = mulberry32(seed)
  const S = 64
  const { c, g } = makeCanvas(S, S)
  const base = ripe ? art.base : '#7da13e'
  const deep = ripe ? art.deep : '#5c7a2c'
  const sheen = ripe ? art.sheen : '#a4c45f'
  const grad = g.createRadialGradient(S * 0.38, S * 0.34, S * 0.08, S * 0.5, S * 0.5, S * 0.62)
  grad.addColorStop(0, sheen)
  grad.addColorStop(0.55, base)
  grad.addColorStop(1, deep)
  g.fillStyle = grad
  g.fillRect(0, 0, S, S)
  // shoulder streaks (ripening rays around the stem end)
  g.globalAlpha = 0.22
  for (let i = 0; i < 7; i++) {
    g.strokeStyle = ripe ? art.streak : '#c9dd84'
    g.lineWidth = 1.4 + rng.next()
    const x = rng.next() * S
    g.beginPath()
    g.moveTo(x, 2 + rng.next() * 4)
    g.quadraticCurveTo(x + (rng.next() - 0.5) * 6, S * 0.22, x + (rng.next() - 0.5) * 10, S * (0.3 + rng.next() * 0.18))
    g.stroke()
  }
  g.globalAlpha = 1
  // green star calyx at the stem pole (top of the wrapped sphere)
  g.fillStyle = '#4c6e2a'
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.next() * 0.3
    g.beginPath()
    g.ellipse(S / 2 + Math.cos(a) * 5, 3 + Math.sin(a) * 2, 6, 2.2, a, 0, Math.PI * 2)
    g.fill()
  }
  return c
}

/** weathered painted stake: plank-wood grain showing through chipped white-
 * green paint — the garden-stake look, not a flat colored stick */
function gardenStakeCanvas(seed: number): HTMLCanvasElement {
  const rng = mulberry32(seed)
  const c = woodCanvas(rng, '#8a6a42')
  const g = c.getContext('2d')!
  // worn paint coat: vertical strokes with gaps so grain peeks through
  for (let i = 0; i < 46; i++) {
    const x = rng.next() * 128
    const y = rng.next() * 128
    const len = 18 + rng.next() * 46
    g.strokeStyle = rng.next() > 0.3 ? 'rgba(214,218,200,0.5)' : 'rgba(150,168,140,0.45)'
    g.lineWidth = 3 + rng.next() * 5
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + (rng.next() - 0.5) * 4, y + len)
    g.stroke()
  }
  // chips and dings back down to bare wood
  for (let i = 0; i < 14; i++) {
    g.fillStyle = 'rgba(90,64,36,0.55)'
    g.beginPath()
    g.ellipse(rng.next() * 128, rng.next() * 128, 2 + rng.next() * 4, 1 + rng.next() * 2, rng.next() * 3, 0, Math.PI * 2)
    g.fill()
  }
  return c
}

/** crossed cutout cards (the grass/foliage trick) — two perpendicular planes
 * sharing the leaf material so the vine has volume from every camera angle */
function leafCross(mat: MeshStandardMaterial, size: number, x: number, y: number, z: number, yaw: number): Mesh[] {
  const out: Mesh[] = []
  for (const a of [0, Math.PI / 2]) {
    const geo = new PlaneGeometry(size, size)
    geo.rotateY(yaw + a)
    geo.translate(x, y, z)
    const m = new Mesh(geo, mat)
    m.castShadow = true
    out.push(m)
  }
  return out
}

/** Single greenhouse plant for growth stage 0..3, root at y=0 (PlotView lifts
 * templates to the bed soil and merge-bakes 6 of them per plot):
 *   0 seedling sprigs - 1 leafy vine on a painted stake -
 *   2 taller vine, small green fruit - 3 ripe colored fruit, dusky foliage */
export function buildGreenhouseCropStage(kind: GhCropKind, stage: number, seed: number): Group {
  const art = GH_ART[kind]
  const rng = mulberry32(seed ^ 0x70a701)
  const group = new Group()
  const ripe = stage >= 3
  const leafMat = new MeshStandardMaterial({
    map: toTexture(vineLeafCanvas(seed ^ (stage >= 3 ? 0xdead : 0xbeef), ripe, art.leafHue)),
    alphaTest: 0.5,
    side: DoubleSide,
    roughness: 0.9,
  })

  if (stage <= 0) {
    // seedling: a pair of tiny sprig crosses straight out of the furrow
    for (const m of leafCross(leafMat, 0.16, 0, 0.07, 0, rng.next() * Math.PI)) group.add(m)
    for (const m of leafCross(leafMat, 0.1, 0.04, 0.045, -0.03, rng.next() * Math.PI)) group.add(m)
    return group
  }

  const tall = stage >= 2
  const stakeH = tall ? 0.92 : 0.7
  // thin square garden stake, weathered paint over plank grain
  const stakeMat = new MeshStandardMaterial({ map: toTexture(gardenStakeCanvas(seed ^ 0x57a4e)), roughness: 0.95 })
  const stakeGeo = new BoxGeometry(0.045, stakeH, 0.045)
  stakeGeo.translate(0.05, stakeH / 2, -0.04)
  const stake = new Mesh(stakeGeo, stakeMat)
  stake.castShadow = true
  group.add(stake)

  // the vine: a gently kinked stem hugging the stake, then leaf crosses
  const vineH = tall ? 0.84 : 0.52
  const stemMat = new MeshStandardMaterial({ color: '#4a6b2e', roughness: 0.9 })
  let px = -0.02
  let pz = 0.03
  const segs = tall ? 3 : 2
  for (let i = 0; i < segs; i++) {
    const y0 = (vineH / segs) * i
    const segGeo = new CylinderGeometry(0.016, 0.02, vineH / segs + 0.02, 5)
    segGeo.translate(0, y0 + vineH / segs / 2, 0)
    segGeo.rotateY(rng.next() * Math.PI)
    segGeo.translate(px, 0, pz)
    const seg = new Mesh(segGeo, stemMat)
    seg.castShadow = true
    group.add(seg)
    px += (rng.next() - 0.5) * 0.05
    pz += (rng.next() - 0.5) * 0.05
  }
  const leaves = tall ? 5 : 4
  for (let i = 0; i < leaves; i++) {
    const t = (i + 1) / (leaves + 0.5)
    const size = (tall ? 0.34 : 0.27) * (0.8 + rng.next() * 0.4) * (1 - t * 0.25)
    for (const m of leafCross(leafMat, size, px * t + (rng.next() - 0.5) * 0.1, vineH * t + size * 0.3, pz * t + (rng.next() - 0.5) * 0.1, rng.next() * Math.PI)) group.add(m)
  }

  // fruit: green marbles at stage 2, ripe colored fruit when grown — two
  // tinted skin materials per stage so clusters vary, never uniform beads
  if (stage >= 2) {
    const fruitMats = [0, 1].map(
      (i) =>
        new MeshStandardMaterial({
          map: toTexture(fruitSkinCanvas(seed ^ (0xf001 + i * 77), ripe, art)),
          roughness: ripe ? art.gloss : 0.55,
          color: i === 0 ? '#ffffff' : ripe ? '#e3cfc8' : '#d9e6c2',
        }),
    )
    const clusters = ripe ? 3 : 2
    for (let cl = 0; cl < clusters; cl++) {
      const cy = vineH * (0.35 + 0.55 * (cl / Math.max(1, clusters - 1))) + 0.04
      const ca = rng.next() * Math.PI * 2
      const cx = px * 0.5 + Math.cos(ca) * 0.09
      const cz = pz * 0.5 + Math.sin(ca) * 0.09
      const [nLo, nHi] = art.perCluster
      const n = nLo + Math.floor(rng.next() * (nHi - nLo + 1))
      for (let f = 0; f < n; f++) {
        const r = (ripe ? art.r : art.r * 0.66) + rng.next() * (ripe ? art.rj : art.rj * 0.55)
        const geo = new SphereGeometry(r, 10, 8)
        // proportions make the crop: squat tomato, tall bell, long eggplant
        geo.scale(1, ripe ? art.sy : 0.9, 1)
        const fa = rng.next() * Math.PI * 2
        geo.translate(cx + Math.cos(fa) * r * 1.1, cy - f * r * 1.15, cz + Math.sin(fa) * r * 1.1)
        const fruit = new Mesh(geo, fruitMats[(cl + f) % 2])
        fruit.castShadow = true
        group.add(fruit)
      }
    }
  }
  return group
}
