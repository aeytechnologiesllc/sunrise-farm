/** Tilled fields you could almost smell: a furrow-ridged soil mesh (real
 * geometry waves, not a painted rectangle) with a clod-and-stone soil texture,
 * plus plank-wood frames marking each plantable plot. One group per field so
 * land expansions can drop new ones in with a ceremony. */
import {
  BoxGeometry,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
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
