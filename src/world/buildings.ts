/** Procedurally-textured farm buildings — timber stable, white greenhouse and
 * the farm shop — plus the wooden construction scaffold shown during build
 * cutscenes. House art rule: NO flat-color blobs, so every surface carries a
 * painted canvas (plank grain + knots, shingle rows, straw, cream siding,
 * dark soil, striped awning fabric). Each builder returns a Group with origin
 * at center-ground and the front facing +z, with geometry merged per material
 * so every building stays well under ~10 draw calls. All randomness flows
 * through mulberry32(seed) — never the global generator. */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, type Rng } from '../game/rng'
import { makeCanvas, toTexture, woodCanvas } from './textures'

/** meters of wall per texture tile — keeps plank/board rows a believable size */
const TILE = 1.4

// ---- geometry helpers --------------------------------------------------------

/** merge a pile of geometries into one shadowed mesh (1 draw call) */
function fuse(geos: BufferGeometry[], material: MeshStandardMaterial, cast = true, receive = true): Mesh | null {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g))
  const merged = mergeGeometries(parts)
  if (!merged) return null
  const m = new Mesh(merged, material)
  m.castShadow = cast
  m.receiveShadow = receive
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

/** swap u/v — turns shingle rows the right way on a sloped roof slab */
function uvTranspose(geo: BufferGeometry): BufferGeometry {
  const uv = geo.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i)
    uv.setXY(i, uv.getY(i), u)
  }
  return geo
}

/** axis-aligned gable prism (apex along z, base on y=0, centered) with uvs:
 * triangles map u across the width, slope quads map u along the depth */
function gablePrism(w: number, h: number, d: number): BufferGeometry {
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
  // front + back gable triangles
  tri(-hw, 0, hd, 0, 0, hw, 0, hd, 1, 0, 0, h, hd, 0.5, 1)
  tri(hw, 0, -hd, 0, 0, -hw, 0, -hd, 1, 0, 0, h, -hd, 0.5, 1)
  // left slope (u runs along depth, v up the rise)
  tri(-hw, 0, hd, 1, 0, 0, h, hd, 1, 1, 0, h, -hd, 0, 1)
  tri(-hw, 0, hd, 1, 0, 0, h, -hd, 0, 1, -hw, 0, -hd, 0, 0)
  // right slope
  tri(hw, 0, hd, 1, 0, hw, 0, -hd, 0, 0, 0, h, -hd, 0, 1)
  tri(hw, 0, hd, 1, 0, 0, h, -hd, 0, 1, 0, h, hd, 1, 1)
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geo.computeVertexNormals()
  return geo
}

/** single gable triangle facing +z (greenhouse glass gables) */
function gableTri(w: number, h: number): BufferGeometry {
  const hw = w / 2
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array([-hw, 0, 0, hw, 0, 0, 0, h, 0]), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2))
  geo.computeVertexNormals()
  return geo
}

/** the one true glass recipe (owner spec) — meshes using it never cast shadow */
function glassMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    transparent: true,
    opacity: 0.28,
    roughness: 0.08,
    metalness: 0,
    color: '#cfe8ef',
    side: DoubleSide,
    depthWrite: false,
  })
}

// ---- painted canvases ----------------------------------------------------------

/** rustic stable planks: 4 horizontal boards per tile, grain, knots, nails */
function stablePlankCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 256)
  const bases = ['#7d5a36', '#82603a', '#76532f', '#866441']
  for (let p = 0; p < 4; p++) {
    const y0 = p * 64
    g.fillStyle = bases[Math.floor(rng.next() * bases.length)]
    g.fillRect(0, y0, 256, 64)
    // lit top edge + gap shadow between boards
    g.fillStyle = 'rgba(255,228,176,0.10)'
    g.fillRect(0, y0 + 1, 256, 3)
    g.fillStyle = 'rgba(28,17,7,0.7)'
    g.fillRect(0, y0 + 61, 256, 3)
    // grain streaks, wrapped at ±256 so the seam tiles
    for (let i = 0; i < 34; i++) {
      const gy = y0 + 5 + rng.next() * 53
      const x = rng.next() * 256
      const len = 26 + rng.next() * 90
      const tone = rng.next()
      g.strokeStyle = tone > 0.55 ? 'rgba(118,88,50,0.5)' : 'rgba(72,50,26,0.5)'
      g.lineWidth = 0.8 + rng.next() * 1.3
      for (const ox of [-256, 0, 256]) {
        g.beginPath()
        g.moveTo(x + ox, gy)
        g.quadraticCurveTo(x + ox + len / 2, gy + (rng.next() - 0.5) * 4, x + ox + len, gy)
        g.stroke()
      }
    }
    // a knot with a halo ring on most boards
    if (rng.next() > 0.35) {
      const x = 24 + rng.next() * 208
      const y = y0 + 14 + rng.next() * 36
      g.fillStyle = 'rgba(56,38,18,0.85)'
      g.beginPath()
      g.ellipse(x, y, 3 + rng.next() * 2.5, 2 + rng.next() * 2, 0, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = 'rgba(120,90,52,0.5)'
      g.lineWidth = 1.4
      g.beginPath()
      g.ellipse(x, y, 6 + rng.next() * 3, 4 + rng.next() * 2.5, 0, 0, Math.PI * 2)
      g.stroke()
    }
    // nail heads near both board ends
    for (const nx of [12 + rng.next() * 8, 236 + rng.next() * 8]) {
      const ny = y0 + 18 + rng.next() * 28
      g.fillStyle = 'rgba(30,24,18,0.9)'
      g.beginPath()
      g.arc(nx, ny, 1.8, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(200,185,150,0.5)'
      g.fillRect(nx - 1, ny - 1, 1.2, 1.2)
    }
  }
  // weathering speckle
  for (let i = 0; i < 90; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(160,140,110,0.10)' : 'rgba(40,28,14,0.10)'
    g.fillRect(rng.next() * 256, rng.next() * 256, 2, 2)
  }
  return c
}

/** rows of staggered shingles with per-shingle tone, gaps and row shadows */
function shingleCanvas(rng: Rng, tones: string[]): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 256)
  g.fillStyle = tones[0]
  g.fillRect(0, 0, 256, 256)
  for (let r = 0; r < 8; r++) {
    const y0 = r * 32
    const off = (r % 2) * 20
    for (let i = -1; i < 7; i++) {
      const x0 = i * 42 + off + (rng.next() - 0.5) * 5
      g.fillStyle = tones[Math.floor(rng.next() * tones.length)]
      for (const ox of [-256, 0, 256]) {
        g.fillRect(x0 + ox, y0, 40, 32)
        // shadowed gap between neighbours + worn bottom lip
        g.fillStyle = 'rgba(18,12,6,0.5)'
        g.fillRect(x0 + ox - 1.5, y0, 3, 32)
        g.fillRect(x0 + ox, y0 + 29, 40, 3)
        g.fillStyle = tones[Math.floor(rng.next() * tones.length)]
      }
    }
    // the row above casts a soft shadow onto this row's top
    g.fillStyle = 'rgba(0,0,0,0.30)'
    g.fillRect(0, y0, 256, 5)
  }
  // weather speckle + a touch of moss in the gaps
  for (let i = 0; i < 110; i++) {
    const t = rng.next()
    g.fillStyle = t > 0.7 ? 'rgba(126,138,92,0.18)' : t > 0.35 ? 'rgba(220,210,190,0.10)' : 'rgba(20,14,8,0.16)'
    g.fillRect(rng.next() * 256, rng.next() * 256, 2, 2)
  }
  return c
}

/** golden straw: hundreds of crossing strands, wraps on both axes */
function strawCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 128)
  g.fillStyle = '#c29c44'
  g.fillRect(0, 0, 128, 128)
  const tones = ['#e3c468', '#b8923c', '#d9b558', '#a07f2f', '#efd587']
  for (let i = 0; i < 300; i++) {
    const x = rng.next() * 128
    const y = rng.next() * 128
    const a = rng.next() * Math.PI
    const len = 8 + rng.next() * 18
    g.strokeStyle = tones[Math.floor(rng.next() * tones.length)]
    g.globalAlpha = 0.35 + rng.next() * 0.45
    g.lineWidth = 0.8 + rng.next() * 1.1
    const dx = Math.cos(a) * len
    const dy = Math.sin(a) * len
    for (const [ox, oy] of [[0, 0], [-128, 0], [128, 0], [0, -128], [0, 128]]) {
      g.beginPath()
      g.moveTo(x + ox, y + oy)
      g.lineTo(x + ox + dx, y + oy + dy)
      g.stroke()
    }
  }
  g.globalAlpha = 1
  return c
}

/** warm cream shop siding: 8 boards per tile with shadow lines and faint grain */
function sidingCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 256)
  g.fillStyle = '#ece1c4'
  g.fillRect(0, 0, 256, 256)
  for (let b = 0; b < 8; b++) {
    const y0 = b * 32
    // per-board tint shift keeps the wall from reading as one flat slab
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,250,235,0.10)' : 'rgba(170,150,110,0.08)'
    g.fillRect(0, y0, 256, 32)
    g.fillStyle = 'rgba(255,252,240,0.5)'
    g.fillRect(0, y0 + 1, 256, 1.5)
    g.fillStyle = 'rgba(92,72,40,0.35)'
    g.fillRect(0, y0 + 29.5, 256, 2.5)
    for (let i = 0; i < 12; i++) {
      const gy = y0 + 5 + rng.next() * 23
      const x = rng.next() * 256
      const len = 24 + rng.next() * 70
      g.strokeStyle = 'rgba(176,156,116,0.20)'
      g.lineWidth = 0.8
      for (const ox of [-256, 0, 256]) {
        g.beginPath()
        g.moveTo(x + ox, gy)
        g.quadraticCurveTo(x + ox + len / 2, gy + (rng.next() - 0.5) * 2.5, x + ox + len, gy)
        g.stroke()
      }
    }
    if (rng.next() > 0.6) {
      g.fillStyle = 'rgba(70,55,32,0.55)'
      g.beginPath()
      g.arc(20 + rng.next() * 216, y0 + 10 + rng.next() * 14, 1.5, 0, Math.PI * 2)
      g.fill()
    }
  }
  return c
}

/** rich dark greenhouse soil with speckle and the odd pebble */
function soilCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 128)
  g.fillStyle = '#3a2c1f'
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 420; i++) {
    const t = rng.next()
    g.fillStyle = t > 0.72 ? '#56432c' : t > 0.45 ? '#2c2117' : t > 0.2 ? '#4a3826' : '#241a11'
    g.globalAlpha = 0.5 + rng.next() * 0.5
    g.fillRect(rng.next() * 128, rng.next() * 128, 1.5 + rng.next() * 2, 1.5 + rng.next() * 2)
  }
  for (let i = 0; i < 9; i++) {
    g.globalAlpha = 0.55
    g.fillStyle = rng.next() > 0.5 ? '#6b6258' : '#57504a'
    g.beginPath()
    g.ellipse(rng.next() * 128, rng.next() * 128, 1.6 + rng.next() * 2.2, 1.2 + rng.next() * 1.6, rng.next() * 3, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1
  return c
}

/** white painted frame: subtle streaks + scuffs so it never reads flat */
function framePaintCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#f3f5f2'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = 'rgba(182,190,184,0.20)'
    g.lineWidth = 0.8 + rng.next()
    const x = rng.next() * 64
    g.beginPath()
    g.moveTo(x, rng.next() * 20)
    g.lineTo(x + (rng.next() - 0.5) * 4, 30 + rng.next() * 34)
    g.stroke()
  }
  for (let i = 0; i < 12; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(140,150,144,0.14)' : 'rgba(255,255,255,0.4)'
    g.fillRect(rng.next() * 64, rng.next() * 64, 2, 2)
  }
  return c
}

/** market awning fabric: red/cream stripes with a hint of weave */
function awningCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 128)
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#f5f0e0' : '#e0526e'
    g.fillRect(i * 32, 0, 32, 128)
  }
  // weave: faint horizontal thread lines + sun-fade speckle
  g.fillStyle = 'rgba(0,0,0,0.045)'
  for (let y = 0; y < 128; y += 4) g.fillRect(0, y, 256, 1)
  for (let i = 0; i < 130; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(60,30,30,0.05)'
    g.fillRect(rng.next() * 256, rng.next() * 128, 2, 2)
  }
  return c
}

/** the hanging FARM SHOP board — wood grain, cream border, pumpkin crest */
function signCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 128)
  g.fillStyle = '#6e4f2f'
  g.fillRect(0, 0, 256, 128)
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = rng.next() > 0.5 ? 'rgba(120,90,52,0.4)' : 'rgba(60,40,20,0.4)'
    g.lineWidth = 0.8 + rng.next()
    const y = rng.next() * 128
    g.beginPath()
    g.moveTo(0, y)
    g.quadraticCurveTo(128, y + (rng.next() - 0.5) * 6, 256, y)
    g.stroke()
  }
  // border runs to the canvas edge so the thin box sides sample cream, not text
  g.strokeStyle = '#f4e8c8'
  g.lineWidth = 7
  g.strokeRect(4, 4, 248, 120)
  // little pumpkin crest
  g.fillStyle = '#cf7029'
  g.beginPath()
  g.ellipse(128, 32, 14, 11, 0, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(120,55,15,0.8)'
  g.lineWidth = 1.6
  for (const dx of [-6, 0, 6]) {
    g.beginPath()
    g.ellipse(128 + dx * 0.7, 32, Math.abs(dx) * 0.9 + 3, 11, 0, 0, Math.PI * 2)
    g.stroke()
  }
  g.strokeStyle = '#4c6b2f'
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(128, 22)
  g.quadraticCurveTo(132, 16, 136, 14)
  g.stroke()
  g.fillStyle = '#f7edd2'
  g.font = '800 28px Trebuchet MS'
  g.textAlign = 'center'
  g.fillText('FARM SHOP', 128, 92)
  return c
}

/** dim shop interior seen through the front glass: shelves of produce */
function shelfCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 160)
  const grad = g.createLinearGradient(0, 0, 0, 160)
  grad.addColorStop(0, '#2a1d12')
  grad.addColorStop(1, '#180f08')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 160)
  const shelfY = [64, 118]
  for (const y of shelfY) {
    g.fillStyle = '#5d4326'
    g.fillRect(0, y, 256, 7)
    g.fillStyle = 'rgba(0,0,0,0.5)'
    g.fillRect(0, y + 7, 256, 4)
  }
  // produce sitting on each shelf: pumpkins, jars, bottles, apples
  for (const y of shelfY) {
    let x = 14 + rng.next() * 10
    while (x < 240) {
      const kind = rng.next()
      if (kind < 0.35) {
        const r = 9 + rng.next() * 4
        g.fillStyle = '#b5641f'
        g.beginPath()
        g.ellipse(x, y - r * 0.8, r, r * 0.8, 0, 0, Math.PI * 2)
        g.fill()
        g.strokeStyle = 'rgba(80,40,10,0.7)'
        g.lineWidth = 1.2
        g.beginPath()
        g.ellipse(x, y - r * 0.8, r * 0.45, r * 0.8, 0, 0, Math.PI * 2)
        g.stroke()
        x += r * 2 + 6
      } else if (kind < 0.6) {
        g.fillStyle = 'rgba(186,138,58,0.85)'
        g.fillRect(x - 5, y - 17, 11, 17)
        g.fillStyle = '#8a6a3a'
        g.fillRect(x - 6, y - 20, 13, 4)
        x += 18
      } else if (kind < 0.8) {
        g.fillStyle = '#3e6b3a'
        g.fillRect(x - 3, y - 22, 7, 22)
        g.fillRect(x - 1.5, y - 27, 4, 6)
        x += 14
      } else {
        for (let a = 0; a < 3; a++) {
          g.fillStyle = a % 2 ? '#a93b2c' : '#bf4a32'
          g.beginPath()
          g.arc(x + a * 9, y - 4.5, 4.5, 0, Math.PI * 2)
          g.fill()
        }
        x += 32
      }
    }
  }
  // basket on the floor
  g.fillStyle = '#7a5c30'
  g.beginPath()
  g.ellipse(70 + rng.next() * 30, 152, 24, 12, 0, Math.PI, 0)
  g.fill()
  // glass dimming so it reads as interior, not wallpaper
  g.fillStyle = 'rgba(10,8,5,0.22)'
  g.fillRect(0, 0, 256, 160)
  return c
}

/** dark hay-loft opening: near-black with a faint straw glow at the sill */
function loftCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#171008'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = 'rgba(138,111,51,0.4)'
  g.beginPath()
  g.ellipse(32, 58, 26, 10, 0, 0, Math.PI * 2)
  g.fill()
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = 'rgba(190,160,90,0.35)'
    g.lineWidth = 1
    const x = 8 + rng.next() * 48
    g.beginPath()
    g.moveTo(x, 50 + rng.next() * 10)
    g.lineTo(x + (rng.next() - 0.5) * 10, 58 + rng.next() * 5)
    g.stroke()
  }
  return c
}

// ---- the stable ---------------------------------------------------------------

/** Rustic timber stable, ~5.4 x 4.0 footprint, 3.2 to the ridge. Open front
 * (+z) with two stall openings and a closed plank door, gabled shingle roof
 * with visible beams, a straw mound in the right stall and a dark loft window
 * in the gable. 5 draw calls. */
export function buildStable(seed: number): Group {
  const rng = mulberry32(seed)
  const group = new Group()
  const W = 5.4
  const D = 4.0
  const WALL = 2.2 // wall-plate height; gable rises 1.0 above it → 3.2 ridge
  const RISE = 1.0

  const plankMat = new MeshStandardMaterial({ map: toTexture(stablePlankCanvas(rng), true), roughness: 0.9 })
  const shingleMat = new MeshStandardMaterial({
    map: toTexture(shingleCanvas(rng, ['#6d5034', '#7a5c3c', '#64482e', '#836543']), true),
    roughness: 0.95,
  })
  const timberMat = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#62452a'), true), roughness: 0.95 })
  const strawMat = new MeshStandardMaterial({ map: toTexture(strawCanvas(rng), true), roughness: 1 })
  const loftMat = new MeshStandardMaterial({ map: toTexture(loftCanvas(rng)), roughness: 1 })

  // -- plank shell (walls 0.14 thick, centers inset half a thickness) ------------
  const planks: BufferGeometry[] = []
  planks.push(uvScale(box(W, WALL, 0.14, 0, WALL / 2, -D / 2 + 0.07), W / TILE, WALL / TILE)) // back
  planks.push(uvScale(box(0.14, WALL, D, -W / 2 + 0.07, WALL / 2, 0), D / TILE, WALL / TILE)) // left
  planks.push(uvScale(box(0.14, WALL, D, W / 2 - 0.07, WALL / 2, 0), D / TILE, WALL / TILE)) // right
  // front: the left bay x[-2.7,-0.9] is a REAL doorway now (the walk-in
  // stable) — two narrow strips flank a 1.0-wide opening at x=-1.8
  for (const dx of [-2.5, -1.1]) planks.push(uvScale(box(0.4, 1.95, 0.14, dx, 0.975, D / 2 - 0.07), 0.4 / TILE, 1.95 / TILE))
  planks.push(uvScale(box(1.0, 0.25, 0.14, -1.8, 1.825, D / 2 - 0.07), 1.0 / TILE, 0.3)) // doorway header
  planks.push(uvScale(box(W, 0.25, 0.14, 0, 2.075, D / 2 - 0.07), W / TILE, 0.4)) // header band over openings
  const gable = gablePrism(W, RISE, D)
  gable.translate(0, WALL, 0)
  planks.push(uvScale(gable, W / TILE, RISE / TILE))
  planks.push(uvScale(box(W - 0.1, 0.08, D - 0.1, 0, 0.04, 0), W / TILE, D / TILE)) // plank floor
  // stall dividers under the front posts, running back into the building
  for (const sx of [-0.9, 0.9]) planks.push(uvScale(box(0.1, 1.4, 2.6, sx, 0.7, -0.6), 2.6 / TILE, 1))
  const plankMesh = fuse(planks, plankMat)
  if (plankMesh) group.add(plankMesh)

  // -- structural timber ---------------------------------------------------------
  const timber: BufferGeometry[] = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) timber.push(box(0.2, 2.3, 0.2, sx * 2.62, 1.15, sz * 1.92))
  for (const sx of [-0.9, 0.9]) timber.push(box(0.16, 1.95, 0.16, sx, 0.975, D / 2 - 0.07)) // stall posts
  timber.push(box(W + 0.1, 0.14, 0.18, 0, 1.88, 1.95)) // lintel across the openings
  for (const tz of [-1.0, 0.7]) timber.push(uvScale(box(W - 0.1, 0.12, 0.12, 0, 2.14, tz), W / TILE, 1)) // tie beams
  timber.push(uvScale(box(0.14, 0.12, D + 0.5, 0, WALL + RISE, 0), 1, D / TILE)) // ridge beam
  // the old plank door, re-baked PARKED OPEN against the doorway's west
  // post — the stable is a walk-in now, and an open door says so from
  // across the farm (no live pivot: openings are forever)
  const leaf = new BoxGeometry(1.0, 1.7, 0.08)
  leaf.translate(0.5, 0, 0) // hinge at the left edge
  leaf.rotateY(-1.45)
  leaf.translate(-2.32, 0.86, 2.04)
  timber.push(uvScale(leaf, 0.8, 1.4))
  // loft window frame on the front gable face (face sits at z = 2.0)
  timber.push(box(0.62, 0.07, 0.07, 0, 2.86, D / 2))
  timber.push(box(0.62, 0.07, 0.07, 0, 2.38, D / 2))
  for (const sx of [-0.31, 0.31]) timber.push(box(0.07, 0.55, 0.07, sx, 2.62, D / 2))
  const timberMesh = fuse(timber, timberMat)
  if (timberMesh) group.add(timberMesh)

  // -- shingle roof: two slabs riding the gable slope, overhanging all round -----
  const shingles: BufferGeometry[] = []
  const slope = Math.hypot(W / 2, RISE) // 2.88 along the pitch
  const pitch = Math.atan2(RISE, W / 2)
  for (const s of [-1, 1]) {
    const slab = new BoxGeometry(slope + 0.45, 0.1, D + 0.6)
    uvTranspose(slab)
    uvScale(slab, (D + 0.6) / 1.2, (slope + 0.45) / 1.2)
    slab.rotateZ(-s * pitch)
    // centered on the slope midpoint, nudged up so the top face clears the prism
    slab.translate((s * W) / 4, WALL + RISE / 2 + 0.03, 0)
    shingles.push(slab)
  }
  const roofMesh = fuse(shingles, shingleMat)
  if (roofMesh) group.add(roofMesh)

  // -- straw mound in the right stall ---------------------------------------------
  const straw: BufferGeometry[] = []
  const mound = new SphereGeometry(0.62, 9, 7)
  mound.scale(1, 0.55, 1)
  mound.translate(1.8, 0.27, -0.9)
  straw.push(uvScale(mound, 2, 1))
  const tuft = new SphereGeometry(0.4, 8, 6)
  tuft.scale(1, 0.5, 1)
  tuft.translate(2.2, 0.16, -0.35)
  straw.push(uvScale(tuft, 1.5, 1))
  const strawMesh = fuse(straw, strawMat)
  if (strawMesh) group.add(strawMesh)

  // -- the dark loft opening, slightly proud of the gable so it never z-fights ----
  const loft = new Mesh(new BoxGeometry(0.5, 0.5, 0.05), loftMat)
  loft.position.set(0, 2.62, D / 2 - 0.01)
  loft.castShadow = false
  loft.receiveShadow = true
  group.add(loft)

  // -- doorway recess: a dim plane just inside, so the opening reads deep ----
  const recess = new Mesh(new BoxGeometry(1.04, 1.74, 0.05), loftMat)
  recess.position.set(-1.8, 0.87, D / 2 - 0.18)
  recess.castShadow = false
  recess.receiveShadow = true
  group.add(recess)

  return group
}

// ---- the greenhouse -------------------------------------------------------------

/** White-framed greenhouse, ~4.8 x 3.4 footprint, 2.8 to the ridge. Slim
 * painted frame, full glass walls + gabled glass roof (owner glass recipe,
 * castShadow off), a door on +z, ridge bar, and a dark soil bed inside with
 * a low timber edging. 4 draw calls. */
export function buildGreenhouse(seed: number): Group {
  const rng = mulberry32(seed)
  const group = new Group()
  const W = 4.8
  const D = 3.4
  const WALL = 1.7 // eave height; glass gable rises 1.1 above → 2.8 ridge
  const RISE = 1.1
  const hx = W / 2
  const hz = D / 2

  const frameMat = new MeshStandardMaterial({ map: toTexture(framePaintCanvas(rng), true), roughness: 0.5, metalness: 0.1 })
  const soilMat = new MeshStandardMaterial({ map: toTexture(soilCanvas(rng), true), roughness: 1 })
  const edgeMat = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#5d432a'), true), roughness: 0.95 })

  // -- frame: every member centered ON its glass plane so panes meet flush --------
  const frame: BufferGeometry[] = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame.push(box(0.09, WALL, 0.09, sx * hx, WALL / 2, sz * hz))
  for (const mx of [-1.6, -0.8, 0.8, 1.6]) for (const sz of [-1, 1]) frame.push(box(0.07, WALL, 0.07, mx, WALL / 2, sz * hz))
  for (const mz of [-0.85, 0, 0.85]) for (const sx of [-1, 1]) frame.push(box(0.07, WALL, 0.07, sx * hx, WALL / 2, mz))
  // kick boards (low base wall); the front pair leaves the door gap at x ±0.48
  frame.push(box(1.92, 0.28, 0.07, -1.44, 0.14, hz))
  frame.push(box(1.92, 0.28, 0.07, 1.44, 0.14, hz))
  frame.push(box(W, 0.28, 0.07, 0, 0.14, -hz))
  for (const sx of [-1, 1]) frame.push(box(0.07, 0.28, D, sx * hx, 0.14, 0))
  // top plates
  for (const sz of [-1, 1]) frame.push(box(W + 0.16, 0.08, 0.09, 0, WALL, sz * hz))
  for (const sx of [-1, 1]) frame.push(box(0.09, 0.08, D, sx * hx, WALL, 0))
  // gable rafters + ridge bar + roof glazing bars
  const pitch = Math.atan2(RISE, hx)
  const rafterLen = Math.hypot(hx, RISE)
  for (const sz of [-1, 1]) {
    for (const s of [-1, 1]) {
      const r = new BoxGeometry(rafterLen + 0.1, 0.07, 0.07)
      r.rotateZ(-s * pitch)
      r.translate((s * hx) / 2, WALL + RISE / 2, sz * hz)
      frame.push(r)
    }
  }
  frame.push(box(0.09, 0.1, D + 0.5, 0, WALL + RISE, 0)) // ridge bar
  for (const s of [-1, 1]) {
    for (const bz of [-0.85, 0, 0.85]) {
      const bar = new BoxGeometry(rafterLen, 0.06, 0.06)
      bar.rotateZ(-s * pitch)
      bar.translate((s * hx) / 2, WALL + RISE / 2, bz)
      frame.push(bar)
    }
  }
  // door on +z: posts, header, and a closed leaf sitting proud of the wall plane
  for (const sx of [-1, 1]) frame.push(box(0.08, 1.65, 0.1, sx * 0.48, 0.825, hz))
  frame.push(box(1.06, 0.08, 0.1, 0, 1.66, hz))
  for (const sx of [-1, 1]) frame.push(box(0.06, 1.6, 0.08, sx * 0.4, 0.8, hz + 0.04))
  frame.push(box(0.86, 0.06, 0.08, 0, 1.57, hz + 0.04))
  frame.push(box(0.86, 0.06, 0.08, 0, 0.85, hz + 0.04))
  frame.push(box(0.86, 0.18, 0.08, 0, 0.12, hz + 0.04))
  frame.push(box(0.04, 0.12, 0.04, 0.32, 0.85, hz + 0.09)) // handle
  const frameMesh = fuse(frame, frameMat)
  if (frameMesh) group.add(frameMesh)

  // -- glass: one merged transparent mesh, never casting shadows ------------------
  const glass: BufferGeometry[] = []
  const wallPane = (w: number, h: number): PlaneGeometry => new PlaneGeometry(w, h)
  const back = wallPane(W, 1.42) // walls glazed from kick board (0.28) to plate (1.7)
  back.rotateY(Math.PI)
  back.translate(0, 0.99, -hz)
  glass.push(back)
  for (const s of [-1, 1]) {
    const side = wallPane(D, 1.42)
    side.rotateY((s * Math.PI) / 2)
    side.translate(s * hx, 0.99, 0)
    glass.push(side)
  }
  for (const s of [-1, 1]) {
    const front = wallPane(1.92, 1.42)
    front.translate(s * 1.44, 0.99, hz)
    glass.push(front)
  }
  const doorPane = wallPane(0.7, 1.25)
  doorPane.translate(0, 0.88, hz + 0.045)
  glass.push(doorPane)
  const gFront = gableTri(W, RISE)
  gFront.translate(0, WALL, hz)
  glass.push(gFront)
  const gBack = gableTri(W, RISE)
  gBack.rotateY(Math.PI)
  gBack.translate(0, WALL, -hz)
  glass.push(gBack)
  for (const s of [-1, 1]) {
    const roof = new PlaneGeometry(rafterLen, D + 0.1)
    roof.rotateX(-Math.PI / 2)
    roof.rotateZ(-s * pitch)
    roof.translate((s * hx) / 2, WALL + RISE / 2, 0)
    glass.push(roof)
  }
  const glassMesh = fuse(glass, glassMaterial(), false, false)
  if (glassMesh) group.add(glassMesh)

  // -- interior soil bed (set back to leave a walkway inside the door) ------------
  const soil = uvScale(box(3.6, 0.12, 2.3, 0, 0.06, -0.25), 3, 2)
  const soilMesh = fuse([soil], soilMat, false, true)
  if (soilMesh) group.add(soilMesh)
  const edging: BufferGeometry[] = []
  for (const sz of [-1, 1]) edging.push(uvScale(box(3.76, 0.14, 0.08, 0, 0.07, -0.25 + sz * 1.19), 3, 1))
  for (const sx of [-1, 1]) edging.push(uvScale(box(0.08, 0.14, 2.46, sx * 1.88, 0.07, -0.25), 2, 1))
  const edgeMesh = fuse(edging, edgeMat)
  if (edgeMesh) group.add(edgeMesh)

  return group
}

// ---- the farm shop ---------------------------------------------------------------

/** The farm shop, ~4.6 x 3.4 footprint, 3.0 tall. Cream-sided timber-frame
 * with a western false-front parapet (so the wide awning and hanging sign
 * have a real wall to live on), big shopfront window with a produce-shelf
 * interior behind the glass, counter hatch, striped two-pitch awning,
 * hanging FARM SHOP board and produce crates by the door. 7 draw calls. */
export function buildShop(seed: number): Group {
  const rng = mulberry32(seed)
  const group = new Group()
  const W = 4.6
  const D = 3.4
  const WALL = 2.1 // wall height; roof rises 0.9 behind the 3.0-tall parapet
  const RISE = 0.9
  const hz = D / 2 // front wall plane z = 1.7

  const sidingMat = new MeshStandardMaterial({ map: toTexture(sidingCanvas(rng), true), roughness: 0.85 })
  const roofMat = new MeshStandardMaterial({
    map: toTexture(shingleCanvas(rng, ['#5d5a52', '#6a675e', '#52504a', '#757166']), true),
    roughness: 0.95,
  })
  const trimMat = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#7a4a2c'), true), roughness: 0.9 })
  const awningMat = new MeshStandardMaterial({ map: toTexture(awningCanvas(rng)), roughness: 0.9, side: DoubleSide })
  const signMat = new MeshStandardMaterial({ map: toTexture(signCanvas(rng)), roughness: 0.85 })
  const shelfMat = new MeshStandardMaterial({ map: toTexture(shelfCanvas(rng)), roughness: 1 })

  // -- siding shell: body + gable + false-front parapet ----------------------------
  const siding: BufferGeometry[] = []
  siding.push(uvScale(box(W, WALL, D, 0, WALL / 2, 0), W / TILE, WALL / TILE))
  const gable = gablePrism(W, RISE, D)
  gable.translate(0, WALL, 0)
  siding.push(uvScale(gable, W / TILE, RISE / TILE))
  // parapet face sits 0.02 proud of the wall so it never z-fights the gable
  siding.push(uvScale(box(W, 0.9, 0.12, 0, 2.55, hz - 0.04), W / TILE, 0.9 / TILE))
  const sidingMesh = fuse(siding, sidingMat)
  if (sidingMesh) group.add(sidingMesh)

  // -- roof: shingle slabs stop just shy of the parapet, overhang the back ---------
  const roof: BufferGeometry[] = []
  const slope = Math.hypot(W / 2, RISE)
  const pitch = Math.atan2(RISE, W / 2)
  for (const s of [-1, 1]) {
    const slab = new BoxGeometry(slope + 0.45, 0.1, 3.58)
    uvTranspose(slab)
    uvScale(slab, 3.58 / 1.2, (slope + 0.45) / 1.2)
    slab.rotateZ(-s * pitch)
    slab.translate((s * W) / 4, WALL + RISE / 2 + 0.03, -0.21)
    roof.push(slab)
  }
  roof.push(box(0.16, 0.1, 3.58, 0, WALL + RISE, -0.21)) // ridge cap
  const roofMesh = fuse(roof, roofMat)
  if (roofMesh) group.add(roofMesh)

  // -- trim, openings, counter, crates, sign bracket --------------------------------
  // window: 1.9 x 0.95 centered at (-0.85, 1.5); door: 0.95 wide at x 1.3
  const trim: BufferGeometry[] = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) trim.push(box(0.12, WALL, 0.12, sx * 2.28, WALL / 2, sz * 1.68))
  trim.push(box(W + 0.1, 0.18, D + 0.1, 0, 0.09, 0)) // plinth skirt
  trim.push(box(W + 0.12, 0.1, 0.2, 0, 3.0, hz - 0.04)) // parapet cap
  for (const sx of [-1, 1]) trim.push(box(0.12, 0.9, 0.1, sx * 2.24, 2.55, hz - 0.02)) // parapet corners
  // window frame (proud of the wall plane at z 1.7) + cross mullions + sill
  trim.push(box(2.06, 0.1, 0.08, -0.85, 2.02, hz + 0.04))
  trim.push(box(2.06, 0.12, 0.12, -0.85, 0.98, hz + 0.06))
  for (const sx of [-1, 1]) trim.push(box(0.1, 1.0, 0.08, -0.85 + sx * 0.98, 1.5, hz + 0.04))
  trim.push(box(0.06, 1.0, 0.06, -0.85, 1.5, hz + 0.03))
  trim.push(box(1.9, 0.06, 0.06, -0.85, 1.5, hz + 0.03))
  // counter hatch under the window with two angled brackets
  trim.push(uvScale(box(1.9, 0.07, 0.4, -0.85, 0.92, hz + 0.16), 1.6, 1))
  for (const bx of [-1.55, -0.15]) {
    const bracket = new BoxGeometry(0.05, 0.32, 0.05)
    bracket.rotateX(-0.6)
    bracket.translate(bx, 0.78, hz + 0.09)
    trim.push(bracket)
  }
  // door + battens + handle + frame
  trim.push(uvScale(box(0.95, 1.9, 0.07, 1.3, 0.95, hz + 0.02), 0.8, 1.5))
  for (const by of [0.5, 1.45]) trim.push(box(0.87, 0.1, 0.04, 1.3, by, hz + 0.06))
  trim.push(box(0.05, 0.14, 0.05, 1.0, 1.0, hz + 0.08))
  for (const sx of [-1, 1]) trim.push(box(0.1, 2.0, 0.09, 1.3 + sx * 0.52, 1.0, hz + 0.02))
  trim.push(box(1.14, 0.1, 0.09, 1.3, 2.0, hz + 0.02))
  // sign bracket arm out of the parapet, with two drop links
  trim.push(box(0.07, 0.07, 1.15, 0, 2.7, hz + 0.495))
  for (const sx of [-1, 1]) trim.push(box(0.03, 0.16, 0.03, sx * 0.32, 2.585, hz + 0.96))
  // produce crates by the door (one square, one turned)
  trim.push(uvScale(box(0.4, 0.34, 0.4, 1.95, 0.17, 2.0), 1, 0.6))
  for (const sz of [-1, 1]) trim.push(box(0.42, 0.05, 0.05, 1.95, 0.36, 2.0 + sz * 0.175))
  const crateB = new BoxGeometry(0.34, 0.28, 0.34)
  crateB.rotateY(0.5)
  crateB.translate(2.24, 0.14, 1.55)
  trim.push(crateB)
  const trimMesh = fuse(trim, trimMat)
  if (trimMesh) group.add(trimMesh)

  // -- shopfront glass + the produce shelves dimly visible behind it ----------------
  const shelf = new Mesh(new PlaneGeometry(1.84, 0.92), shelfMat)
  shelf.position.set(-0.85, 1.5, hz + 0.008)
  shelf.castShadow = false
  group.add(shelf)
  const windowPane = new PlaneGeometry(1.86, 0.96)
  windowPane.translate(-0.85, 1.5, hz + 0.02)
  const glassMesh = fuse([windowPane], glassMaterial(), false, false)
  if (glassMesh) group.add(glassMesh)

  // -- striped two-pitch awning: steep top pitch, shallow skirt, hanging valance ----
  const awning: BufferGeometry[] = []
  const pitchPlane = (width: number, len: number, t: number, yTop: number, zTop: number): PlaneGeometry => {
    const p = new PlaneGeometry(width, len)
    // rotX(-PI/2 + t) keeps the wall-side edge high; center sits half-way down
    p.rotateX(-Math.PI / 2 + t)
    p.translate(0, yTop - (len / 2) * Math.sin(t), zTop + (len / 2) * Math.cos(t))
    return p
  }
  const aTop = pitchPlane(4.3, 0.5, 0.62, 2.42, hz + 0.02) // ends at y 2.13, z 2.127
  awning.push(aTop)
  const aSkirt = pitchPlane(4.3, 0.48, 0.32, 2.13, 2.127) // ends at y 1.98, z 2.583
  awning.push(aSkirt)
  const valance = new PlaneGeometry(4.3, 0.22)
  valance.translate(0, 1.87, 2.583)
  awning.push(valance)
  const awningMesh = fuse(awning, awningMat, true, false)
  if (awningMesh) group.add(awningMesh)

  // -- the hanging FARM SHOP board, swinging clear of the awning's outer edge -------
  const sign = new Mesh(new BoxGeometry(0.95, 0.5, 0.05), signMat)
  sign.position.set(0, 2.255, hz + 0.98)
  sign.castShadow = true
  group.add(sign)

  return group
}

// ---- construction scaffold --------------------------------------------------------

/** Wooden scaffolding ring slightly larger than a w x d footprint, split into
 * THREE build stages so the construction cutscene can raise it piece by piece
 * and then dismantle it at the reveal:
 *   stages[0] — corner + midpoint posts (standing from the first hammer hit)
 *   stages[1] — level-1 walkway planks + the diagonal braces
 *   stages[2] — level-2 walkway planks + top cap rails
 * Stages [1] and [2] start at scaleY 0.01 (squashed to the ground); the scene
 * pops each one up on the work beats. All timber canvas-textured (house art
 * rule), geometry merged per stage — 4 draw calls total. */
export function buildScaffoldStaged(w: number, d: number, seed: number): { root: Group; stages: Group[] } {
  const rng = mulberry32(seed)
  const root = new Group()
  const hx = w / 2 + 0.35 // ring stands 0.35 outside the footprint
  const hz = d / 2 + 0.35
  const postMat = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#74552f'), true), roughness: 1 })
  const plankMat = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#96743f'), true), roughness: 0.95 })

  // -- stage 0: posts at corners + midpoints, each with its own height and lean -----
  const posts: BufferGeometry[] = []
  const spots: Array<[number, number]> = [
    [-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz],
    [0, -hz], [0, hz], [-hx, 0], [hx, 0],
  ]
  for (const [px, pz] of spots) {
    const h = 2.35 + rng.next() * 0.3
    const p = new CylinderGeometry(0.055, 0.07, h, 7)
    p.rotateX((rng.next() - 0.5) * 0.05)
    p.rotateZ((rng.next() - 0.5) * 0.05)
    p.translate(px, h / 2 - 0.02, pz) // sunk 0.02 so leaning posts never float
    posts.push(p)
  }
  const stage0 = new Group()
  const postMesh = fuse(posts, postMat)
  if (postMesh) stage0.add(postMesh)

  // -- stage 1: level-1 frame + diagonal braces (corner-to-mid, proud of planks) ----
  const braceZ = (x0: number, x1: number, zLine: number): BufferGeometry => {
    const len = Math.hypot(x1 - x0, 1.5)
    const b = new BoxGeometry(0.09, len, 0.035)
    b.rotateZ(-Math.atan2(x1 - x0, 1.5))
    b.translate((x0 + x1) / 2, (0.3 + 1.8) / 2, zLine + Math.sign(zLine) * 0.19)
    return b
  }
  const braceX = (z0: number, z1: number, xLine: number): BufferGeometry => {
    const len = Math.hypot(z1 - z0, 1.5)
    const b = new BoxGeometry(0.035, len, 0.09)
    b.rotateX(Math.atan2(z1 - z0, 1.5))
    b.translate(xLine + Math.sign(xLine) * 0.19, (0.3 + 1.8) / 2, (z0 + z1) / 2)
    return b
  }
  const braces: BufferGeometry[] = []
  for (const sz of [-1, 1]) {
    const flip = rng.next() > 0.5 ? 1 : -1
    braces.push(braceZ(flip * -hx, 0, sz * hz))
  }
  for (const sx of [-1, 1]) {
    const flip = rng.next() > 0.5 ? 1 : -1
    braces.push(braceX(flip * -hz, 0, sx * hx))
  }
  // plank walkway rings at the two heights, slightly jittered like hand-laid boards
  const walkway = (y: number): BufferGeometry[] => {
    const ps: BufferGeometry[] = []
    for (const sz of [-1, 1]) {
      const len = hx * 2 + 0.5
      const p = new BoxGeometry(len, 0.045, 0.3)
      uvScale(p, len / 0.9, 1)
      p.rotateY((rng.next() - 0.5) * 0.03)
      p.translate((rng.next() - 0.5) * 0.12, y + (rng.next() - 0.5) * 0.04, sz * hz)
      ps.push(p)
    }
    for (const sx of [-1, 1]) {
      const len = hz * 2 + 0.5
      const p = new BoxGeometry(0.3, 0.045, len)
      uvScale(p, 1, len / 0.9)
      p.rotateY((rng.next() - 0.5) * 0.03)
      p.translate(sx * hx, y + (rng.next() - 0.5) * 0.04, (rng.next() - 0.5) * 0.12)
      ps.push(p)
    }
    return ps
  }
  const stage1 = new Group()
  const braceMesh = fuse(braces, postMat)
  if (braceMesh) stage1.add(braceMesh)
  const lvl1Mesh = fuse(walkway(0.95), plankMat)
  if (lvl1Mesh) stage1.add(lvl1Mesh)

  // -- stage 2: level-2 walkway + thin top cap rails along the post tops ------------
  const lvl2: BufferGeometry[] = walkway(1.85)
  for (const sz of [-1, 1]) {
    const cap = new BoxGeometry(hx * 2 + 0.34, 0.05, 0.07)
    uvScale(cap, (hx * 2 + 0.34) / 0.9, 1)
    cap.translate((rng.next() - 0.5) * 0.06, 2.32 + (rng.next() - 0.5) * 0.05, sz * hz)
    lvl2.push(cap)
  }
  for (const sx of [-1, 1]) {
    const cap = new BoxGeometry(0.07, 0.05, hz * 2 + 0.34)
    uvScale(cap, 1, (hz * 2 + 0.34) / 0.9)
    cap.translate(sx * hx, 2.32 + (rng.next() - 0.5) * 0.05, (rng.next() - 0.5) * 0.06)
    lvl2.push(cap)
  }
  const stage2 = new Group()
  const lvl2Mesh = fuse(lvl2, plankMat)
  if (lvl2Mesh) stage2.add(lvl2Mesh)

  // later stages start squashed flat — the cutscene raises them on the beats
  stage1.scale.y = 0.01
  stage2.scale.y = 0.01
  root.add(stage0, stage1, stage2)
  return { root, stages: [stage0, stage1, stage2] }
}

/** fully-built scaffold (all stages up) — kept for non-staged callers */
export function buildScaffold(w: number, d: number, seed: number): Group {
  const { root, stages } = buildScaffoldStaged(w, d, seed)
  for (const s of stages) s.scale.y = 1
  return root
}
