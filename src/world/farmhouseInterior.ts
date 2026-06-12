/** The FAMILY FARMHOUSE — the home's walk-in interior by DAY (owner: walk in
 * and the family is just *living* — wife at the counter, the kid by the toy
 * chest, stew warming on the hearth). Same off-world trick as the henhouse:
 * a little house outside, a real room in here. Plaster-and-timber walls under
 * a flat joisted ceiling, a graystone hearth with a kettle on its swing arm,
 * the kitchen window painted with the sunny farm it pretends to look out on,
 * a patchwork quilt in the bedroom nook and a rocking horse for Hazel.
 *
 * What's alive in here: two skinned family members on suffix-matched Idle
 * clips (mixers tick only while the room is visible), three flame quads and
 * a candle flickering on seeded-incommensurate sines, dust motes drifting in
 * the south window shafts. Opaque walls mean the world's sun never reaches
 * in — the hearth and the table lantern are the art.
 *
 * BUDGET — every static material is ONE merged mesh: floor + shell +
 * dark wood + warm wood + graystone + soot + iron + copper + glaze/bread +
 * windows + curtains + quilt + braided rug + shafts + ember = 15 merged
 * draws, plus 4 small flame sprites, doorway glow, lantern head, motes,
 * 2 skinned people and exactly 2 PointLights (0 while inactive, root hidden).
 * All randomness is one mulberry32 stream — ZERO Math.random. update()
 * allocates nothing. */
import {
  AdditiveBlending,
  AnimationMixer,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type AnimationAction,
  type AnimationClip,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, type Rng } from '../game/rng'
import type { Assets } from './assets'
import { normalizeHeight } from './scale'
import { makeCanvas, toTexture, woodCanvas } from './textures'

export const FARMHOUSE_ANCHOR = new Vector3(-150, 0, 0)

const ROOM_W = 9
const ROOM_D = 7
const WALL_H = 2.9
const DOOR_HALF = 0.9
/** hearth center z on the west wall */
const FP_Z = -0.4
/** family table center + top size, room-local (interior.ts proportions) */
const TABLE = { x: 1.6, z: 0.45, w: 1.9, d: 1.05 }
const TABLE_H = 0.76
const SEAT_TOP = 0.42
const FIRE_BASE_INTENSITY = 2.2
const WIFE_H = 1.5
const KID_H = 0.95
/** the kid reads as their own little person: every material cloned, then
 * nudged toward this peachy warmth (the wife's materials stay untouched) */
const KID_TINT = new Color('#ffd9b0')

// ---- canvases (house art rule: no flat-color blobs, ever) -------------------

/** honey plank floor with a worn path — years of boots door -> table ->
 * kitchen, sanded pale down the middle */
function plankFloorCanvas(rng: Rng): HTMLCanvasElement {
  const W = 256
  const H = 192
  const { c, g } = makeCanvas(W, H)
  g.fillStyle = '#a8814f'
  g.fillRect(0, 0, W, H)
  for (let y = 0; y < H; y += 16) {
    // plank seam
    g.fillStyle = 'rgba(70,45,20,0.5)'
    g.fillRect(0, y, W, 2)
    // butt joints, staggered per course
    for (let j = 0; j < 3; j++) {
      g.fillRect(rng.next() * W, y + 2, 2, 14)
    }
    // long grain strokes
    for (let i = 0; i < 14; i++) {
      const gy = y + 4 + rng.next() * 11
      const x = rng.next() * W
      const len = 18 + rng.next() * 60
      const tone = rng.next()
      g.strokeStyle = tone > 0.55 ? 'rgba(200,160,104,0.4)' : 'rgba(110,76,38,0.38)'
      g.lineWidth = 0.8 + rng.next() * 1.1
      g.beginPath()
      g.moveTo(x, gy)
      g.quadraticCurveTo(x + len / 2, gy + (rng.next() - 0.5) * 3, x + len, gy)
      g.stroke()
    }
    if (rng.next() > 0.5) {
      g.fillStyle = 'rgba(80,52,24,0.6)'
      g.beginPath()
      g.ellipse(10 + rng.next() * (W - 20), y + 5 + rng.next() * 8, 2.5 + rng.next() * 2, 1.6 + rng.next(), 0, 0, Math.PI * 2)
      g.fill()
    }
  }
  // the worn path: soft pale pools along a door->center->kitchen curve
  // (canvas bottom = the +z door wall, canvas top = the kitchen)
  const wear = (x: number, y: number, r: number): void => {
    const grad = g.createRadialGradient(x, y, 1, x, y, r)
    grad.addColorStop(0, 'rgba(232,210,172,0.16)')
    grad.addColorStop(1, 'rgba(232,210,172,0)')
    g.fillStyle = grad
    g.fillRect(x - r, y - r, r * 2, r * 2)
  }
  for (let i = 0; i <= 12; i++) {
    const k = i / 12
    const x = (1 - k) * (1 - k) * 128 + 2 * k * (1 - k) * 118 + k * k * 70
    const y = (1 - k) * (1 - k) * 186 + 2 * k * (1 - k) * 116 + k * k * 18
    wear(x + (rng.next() - 0.5) * 10, y + (rng.next() - 0.5) * 8, 15 + rng.next() * 9)
  }
  wear(36, 96, 20) // hearthside
  wear(176, 104, 18) // around the table
  return c
}

/** cream plaster between dark timber studs (studs at 0/64/128 so it tiles) */
function plasterCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 128)
  g.fillStyle = '#eee1c4'
  g.fillRect(0, 0, 128, 128)
  // trowel mottling
  for (let i = 0; i < 170; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,250,238,0.12)' : 'rgba(150,128,96,0.08)'
    g.beginPath()
    g.ellipse(rng.next() * 128, rng.next() * 128, 2 + rng.next() * 6, 1 + rng.next() * 3, rng.next() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  // hairline cracks wandering down from the studs
  for (let i = 0; i < 4; i++) {
    g.strokeStyle = 'rgba(120,98,70,0.25)'
    g.lineWidth = 0.8
    let x = rng.next() * 128
    let y = rng.next() * 64
    g.beginPath()
    g.moveTo(x, y)
    for (let s = 0; s < 4; s++) {
      x += (rng.next() - 0.5) * 16
      y += 6 + rng.next() * 10
      g.lineTo(x, y)
    }
    g.stroke()
  }
  const stud = (x0: number): void => {
    g.fillStyle = '#4f3a26'
    g.fillRect(x0 - 5, 0, 10, 128)
    g.strokeStyle = 'rgba(30,18,8,0.5)'
    for (let i = 0; i < 6; i++) {
      g.lineWidth = 0.8 + rng.next()
      const gx = x0 - 4 + rng.next() * 8
      g.beginPath()
      g.moveTo(gx, 0)
      g.lineTo(gx + (rng.next() - 0.5) * 3, 128)
      g.stroke()
    }
    g.fillStyle = 'rgba(255,235,200,0.10)'
    g.fillRect(x0 - 5, 0, 2, 128)
  }
  stud(0)
  stud(64)
  stud(128)
  return c
}

/** graystone hearth courses with mortar lines (cool stone, warm room) */
function graystoneCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 128)
  g.fillStyle = '#55504a' // mortar
  g.fillRect(0, 0, 128, 128)
  const tones = ['#8d8a82', '#7b776e', '#989486', '#6f6b62', '#878378', '#828071']
  for (let row = 0; row < 6; row++) {
    const y = row * 22
    let x = row % 2 === 0 ? 0 : -16
    while (x < 128) {
      const w = 24 + rng.next() * 18
      g.fillStyle = tones[Math.floor(rng.next() * tones.length)]
      g.fillRect(x + 2, y + 2, w - 3, 19)
      // a lit top edge so each stone reads round, not painted-on
      g.fillStyle = 'rgba(255,250,240,0.10)'
      g.fillRect(x + 2, y + 2, w - 3, 3)
      g.fillStyle = 'rgba(10,8,6,0.22)'
      g.fillRect(x + 2, y + 18, w - 3, 3)
      x += w
    }
  }
  for (let i = 0; i < 240; i++) {
    const t = rng.next()
    g.fillStyle = t > 0.5 ? 'rgba(255,255,250,0.08)' : 'rgba(10,8,4,0.14)'
    g.fillRect(rng.next() * 128, rng.next() * 128, 1 + rng.next() * 1.6, 1 + rng.next() * 1.4)
  }
  return c
}

/** sooted firebox interior — near-black, ash flecks, ember warmth at the base */
function sootCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#16110e'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 120; i++) {
    const t = rng.next()
    g.fillStyle = t > 0.62 ? 'rgba(130,120,108,0.16)' : 'rgba(0,0,0,0.3)'
    g.fillRect(rng.next() * 64, rng.next() * 64, 1 + rng.next() * 1.8, 1 + rng.next())
  }
  const glow = g.createRadialGradient(32, 62, 2, 32, 60, 30)
  glow.addColorStop(0, 'rgba(255,140,50,0.32)')
  glow.addColorStop(1, 'rgba(255,140,50,0)')
  g.fillStyle = glow
  g.fillRect(0, 8, 64, 56)
  return c
}

/** flame tongues over an ember pool — the hearth quads sample the full
 * canvas, the ember plane just the bottom strip (additive, transparent) */
function fireCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 96)
  const ember = g.createRadialGradient(32, 90, 2, 32, 88, 30)
  ember.addColorStop(0, 'rgba(255,150,52,0.9)')
  ember.addColorStop(0.5, 'rgba(255,100,30,0.42)')
  ember.addColorStop(1, 'rgba(255,80,20,0)')
  g.fillStyle = ember
  g.fillRect(0, 58, 64, 38)
  const tongue = (cx: number, w: number, h: number, hot: number): void => {
    const tipX = cx + (rng.next() - 0.5) * 10
    const grad = g.createLinearGradient(0, 92, 0, 92 - h)
    grad.addColorStop(0, `rgba(255,247,216,${0.92 * hot})`)
    grad.addColorStop(0.35, `rgba(255,210,119,${0.85 * hot})`)
    grad.addColorStop(0.7, `rgba(255,150,54,${0.6 * hot})`)
    grad.addColorStop(0.9, `rgba(255,90,20,${0.28 * hot})`)
    grad.addColorStop(1, 'rgba(255,70,10,0)')
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(cx - w, 92)
    g.quadraticCurveTo(cx - w * 1.1, 92 - h * 0.45, tipX, 92 - h)
    g.quadraticCurveTo(cx + w * 1.1, 92 - h * 0.45, cx + w, 92)
    g.closePath()
    g.fill()
  }
  tongue(16, 9, 42 + rng.next() * 10, 0.72)
  tongue(46, 9, 50 + rng.next() * 12, 0.82)
  tongue(31, 11, 70 + rng.next() * 12, 1)
  return c
}

/** the kitchen window by day: sunny painterly farm view — blue sky, a soft
 * sun, cloud puffs, green hills, a golden field strip, a painted cross-frame.
 * Unlit material so it shines against the plaster like real daylight. */
function farmViewCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(112, 128)
  const sky = g.createLinearGradient(0, 0, 0, 80)
  sky.addColorStop(0, '#8ecbee')
  sky.addColorStop(1, '#d6ecf8')
  g.fillStyle = sky
  g.fillRect(0, 0, 112, 80)
  // sun, upper-right pane
  const halo = g.createRadialGradient(82, 26, 2, 82, 26, 22)
  halo.addColorStop(0, 'rgba(255,246,200,0.85)')
  halo.addColorStop(1, 'rgba(255,246,200,0)')
  g.fillStyle = halo
  g.fillRect(58, 2, 54, 50)
  g.fillStyle = '#fff6d0'
  g.beginPath()
  g.arc(82, 26, 8, 0, Math.PI * 2)
  g.fill()
  // cloud puffs: clustered soft ellipses
  for (let i = 0; i < 4; i++) {
    const cx = 14 + rng.next() * 80
    const cy = 14 + rng.next() * 34
    g.fillStyle = 'rgba(255,255,255,0.85)'
    for (let p = 0; p < 5; p++) {
      g.beginPath()
      g.ellipse(cx + (rng.next() - 0.5) * 18, cy + (rng.next() - 0.5) * 5, 5 + rng.next() * 6, 3 + rng.next() * 2.5, 0, 0, Math.PI * 2)
      g.fill()
    }
  }
  // far hills, a golden field strip, the near meadow
  g.fillStyle = '#9ac178'
  g.beginPath()
  g.moveTo(0, 74)
  g.quadraticCurveTo(30, 60, 62, 70)
  g.quadraticCurveTo(90, 78, 112, 68)
  g.lineTo(112, 128)
  g.lineTo(0, 128)
  g.closePath()
  g.fill()
  g.fillStyle = '#d2b25e'
  g.beginPath()
  g.moveTo(0, 88)
  g.quadraticCurveTo(40, 80, 112, 86)
  g.lineTo(112, 100)
  g.quadraticCurveTo(50, 96, 0, 102)
  g.closePath()
  g.fill()
  g.fillStyle = '#76a851'
  g.beginPath()
  g.moveTo(0, 102)
  g.quadraticCurveTo(50, 96, 112, 100)
  g.lineTo(112, 128)
  g.lineTo(0, 128)
  g.closePath()
  g.fill()
  // hedgerow trees along the hill line + a tiny fence in the meadow
  for (let i = 0; i < 5; i++) {
    const tx = 8 + rng.next() * 96
    const ty = 68 + rng.next() * 10
    g.fillStyle = '#4e7a38'
    g.beginPath()
    g.ellipse(tx, ty, 3.5 + rng.next() * 3, 4.5 + rng.next() * 3, 0, 0, Math.PI * 2)
    g.fill()
  }
  g.strokeStyle = '#7a5a38'
  g.lineWidth = 1.2
  for (let i = 0; i < 6; i++) {
    const fx = 10 + i * 18 + rng.next() * 4
    g.beginPath()
    g.moveTo(fx, 108)
    g.lineTo(fx, 116)
    g.stroke()
  }
  g.beginPath()
  g.moveTo(4, 110)
  g.lineTo(108, 110)
  g.stroke()
  // glass sheen
  g.fillStyle = 'rgba(255,255,255,0.08)'
  g.beginPath()
  g.moveTo(12, 120)
  g.lineTo(44, 10)
  g.lineTo(60, 10)
  g.lineTo(28, 120)
  g.closePath()
  g.fill()
  // painted frame + mullions
  g.fillStyle = '#7a5a38'
  g.fillRect(0, 0, 112, 8)
  g.fillRect(0, 120, 112, 8)
  g.fillRect(0, 0, 8, 128)
  g.fillRect(104, 0, 8, 128)
  g.fillRect(53, 0, 6, 128)
  g.fillRect(0, 61, 112, 6)
  return c
}

/** cream curtain with vertical fold shading and a tea-dyed hem */
function curtainCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(80, 128)
  g.fillStyle = '#f2e7cd'
  g.fillRect(0, 0, 80, 128)
  for (let x = 0; x < 80; x++) {
    const k = Math.sin((x / 80) * Math.PI * 4.6 + 1.1)
    g.fillStyle = k > 0 ? `rgba(255,252,240,${0.18 * k})` : `rgba(120,96,60,${-0.16 * k})`
    g.fillRect(x, 0, 1, 128)
  }
  for (let i = 0; i < 150; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,250,238,0.12)' : 'rgba(140,112,72,0.10)'
    g.fillRect(rng.next() * 80, rng.next() * 128, 1.4, 1)
  }
  g.fillStyle = '#d9c08e'
  g.fillRect(0, 120, 80, 4)
  g.fillStyle = 'rgba(110,84,46,0.4)'
  g.fillRect(0, 124, 80, 4)
  return c
}

/** brushed copper for the hanging pans — '#b87333' base, heat bloom low,
 * a polished highlight band high */
function copperCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#b87333'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 90; i++) {
    const x = rng.next() * 64
    const y = rng.next() * 64
    const len = 8 + rng.next() * 22
    g.strokeStyle = rng.next() > 0.5 ? 'rgba(255,180,120,0.20)' : 'rgba(90,40,16,0.22)'
    g.lineWidth = 0.8 + rng.next() * 1.2
    for (const ox of [-64, 0, 64]) {
      g.beginPath()
      g.moveTo(x + ox, y)
      g.lineTo(x + ox + len, y + (rng.next() - 0.5) * 2)
      g.stroke()
    }
  }
  const bloom = g.createLinearGradient(0, 40, 0, 64)
  bloom.addColorStop(0, 'rgba(120,50,60,0)')
  bloom.addColorStop(1, 'rgba(120,50,60,0.25)')
  g.fillStyle = bloom
  g.fillRect(0, 40, 64, 24)
  g.fillStyle = 'rgba(255,220,180,0.18)'
  g.fillRect(0, 14, 64, 5)
  return c
}

/** blackened cast iron — the stove, its pipe, the kettle, the swing arm */
function ironCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#3a3633'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 130; i++) {
    const t = rng.next()
    g.fillStyle = t > 0.6 ? 'rgba(120,112,104,0.14)' : 'rgba(0,0,0,0.22)'
    g.fillRect(rng.next() * 64, rng.next() * 64, 1 + rng.next() * 2, 1 + rng.next())
  }
  // faint scratches that catch the firelight
  g.strokeStyle = 'rgba(150,140,128,0.16)'
  for (let i = 0; i < 14; i++) {
    g.lineWidth = 0.7 + rng.next() * 0.6
    const x = rng.next() * 64
    const y = rng.next() * 64
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + (rng.next() - 0.5) * 18, y + (rng.next() - 0.5) * 6)
    g.stroke()
  }
  return c
}

/** one sheet, two foods: cream glazed crockery (top 2/3, sage + madder
 * bands) and golden bread crust (bottom 1/3) — the loaf remaps its UVs into
 * the crust strip so the whole tableware set stays one draw */
function wareCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 96)
  // glaze field
  g.fillStyle = '#ece2cb'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = '#7c9468'
  g.fillRect(0, 20, 64, 7)
  g.fillStyle = '#b5604a'
  g.fillRect(0, 34, 64, 3)
  for (let i = 0; i < 80; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,255,245,0.18)' : 'rgba(110,90,60,0.10)'
    g.fillRect(rng.next() * 64, rng.next() * 64, 1.4, 1.2)
  }
  // bread crust
  g.fillStyle = '#c98c4f'
  g.fillRect(0, 64, 64, 32)
  const crustTop = g.createLinearGradient(0, 64, 0, 78)
  crustTop.addColorStop(0, 'rgba(226,178,114,0.85)')
  crustTop.addColorStop(1, 'rgba(226,178,114,0)')
  g.fillStyle = crustTop
  g.fillRect(0, 64, 64, 14)
  g.strokeStyle = 'rgba(245,224,180,0.6)'
  g.lineWidth = 1.6
  for (const sx of [12, 30, 48]) {
    g.beginPath()
    g.moveTo(sx, 68)
    g.lineTo(sx + 8, 90)
    g.stroke()
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,240,210,0.2)' : 'rgba(120,70,30,0.18)'
    g.fillRect(rng.next() * 64, 64 + rng.next() * 32, 1.2, 1)
  }
  return c
}

/** the PATCHWORK QUILT — a 6x5 grid of warm patches, every patch hemmed in
 * hand stitches, every fill/fleck drawn off the seeded stream */
function quiltCanvas(rng: Rng): HTMLCanvasElement {
  const COLS = 6
  const ROWS = 5
  const P = 32
  const { c, g } = makeCanvas(COLS * P, ROWS * P)
  const patches = ['#b5523c', '#c98a4b', '#d9b06a', '#9c6b3f', '#c25e50', '#a8784e', '#8e4f38', '#d39a58', '#b87a52']
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = col * P
      const y = row * P
      g.fillStyle = patches[Math.floor(rng.next() * patches.length)]
      g.fillRect(x, y, P, P)
      // soft fabric shading: a lit top edge, a settled bottom
      g.fillStyle = 'rgba(255,240,220,0.14)'
      g.fillRect(x + 1, y + 1, P - 2, 4)
      g.fillStyle = 'rgba(60,30,16,0.16)'
      g.fillRect(x + 1, y + P - 5, P - 2, 4)
      for (let i = 0; i < 14; i++) {
        g.fillStyle = rng.next() > 0.5 ? 'rgba(255,245,228,0.10)' : 'rgba(50,26,14,0.10)'
        g.fillRect(x + rng.next() * P, y + rng.next() * P, 1.6, 1)
      }
      // hand stitches around every patch
      g.strokeStyle = 'rgba(255,248,232,0.8)'
      g.lineWidth = 1.2
      g.setLineDash([3, 3])
      g.strokeRect(x + 2.5, y + 2.5, P - 5, P - 5)
      g.setLineDash([])
    }
  }
  return c
}

/** braided oval rug for the kids corner — warm rings, alpha-cutout outside,
 * alternating braid ticks so the bands read as rope, not paint */
function braidedRugCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(160, 112)
  const bands = ['#c2703f', '#a8784e', '#d9a05c', '#8e5a36', '#c98a4b', '#b5604a', '#caa269']
  // center patch first so the innermost ring has cloth behind it
  g.fillStyle = bands[6]
  g.beginPath()
  g.ellipse(80, 56, 18, 12, 0, 0, Math.PI * 2)
  g.fill()
  for (let i = 8; i >= 0; i--) {
    const rx = 76 - i * 7.2
    const ry = 52 - i * 4.9
    if (rx <= 4 || ry <= 3) continue
    g.strokeStyle = bands[i % bands.length]
    g.lineWidth = 7.8
    g.beginPath()
    g.ellipse(80, 56, rx, ry, 0, 0, Math.PI * 2)
    g.stroke()
  }
  // braid ticks, slant alternating with each ring's parity
  g.lineWidth = 1.3
  for (let i = 0; i < 240; i++) {
    const a = rng.next() * Math.PI * 2
    const k = 0.18 + rng.next() * 0.8
    const x = 80 + Math.cos(a) * 76 * k
    const y = 56 + Math.sin(a) * 52 * k
    const s = rng.next() > 0.5 ? 1 : -1
    g.strokeStyle = rng.next() > 0.6 ? 'rgba(255,240,214,0.30)' : 'rgba(40,24,12,0.32)'
    g.beginPath()
    g.moveTo(x - 1.5 * s, y - 1.5)
    g.lineTo(x + 1.5 * s, y + 1.5)
    g.stroke()
  }
  return c
}

// ---- small geometry helpers --------------------------------------------------

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

/** squeeze a geometry's UVs into a sub-rectangle of its texture sheet */
function remapUV(geo: BufferGeometry, u0: number, v0: number, u1: number, v1: number): void {
  const uv = geo.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0))
}

/** a flame card standing on its baseline (so scale.y licks upward) */
function flameQuad(w: number, h: number, ry: number): PlaneGeometry {
  const q = new PlaneGeometry(w, h)
  q.translate(0, h / 2, 0)
  if (ry !== 0) q.rotateY(ry)
  return q
}

/** suffix-matched clip lookup, the Customer.ts way — Quaternius clips load
 * as 'CharacterArmature|Idle', so match the tail after the pipe */
function idleAction(mixer: AnimationMixer, root: Group, clips: AnimationClip[]): AnimationAction | null {
  const clip = clips.find((c) => c.name.toLowerCase() === 'idle' || c.name.toLowerCase().endsWith('|idle'))
  return clip ? mixer.clipAction(clip, root) : null
}

// ---- the room -----------------------------------------------------------------

export class FarmhouseInterior {
  readonly spawnPos: Vector3
  readonly exitPos: Vector3
  /** where the wife and kid stand (proximity-chat anchors), world space */
  readonly wifePos: Vector3
  readonly kidPos: Vector3
  /** opaque walls — registered in OCCLUDERS only while inside */
  readonly shell: Mesh[] = []
  /** player walk bounds (one room, no wings) */
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number }

  private readonly root = new Group()
  private readonly fireLight: PointLight
  private readonly tableLight: PointLight
  /** hearth tongues + the bedside candle, all flicker-scaled in update */
  private readonly flames: Mesh[] = []
  private readonly motes: Points
  private readonly wifeMixer: AnimationMixer
  private readonly kidMixer: AnimationMixer
  private t = 0

  constructor(scene: Scene, assets: Assets) {
    const rng = mulberry32(0xfa3057)
    const ax = FARMHOUSE_ANCHOR.x
    const az = FARMHOUSE_ANCHOR.z
    const hw = ROOM_W / 2
    const hd = ROOM_D / 2
    this.root.position.copy(FARMHOUSE_ANCHOR)
    scene.add(this.root)

    this.spawnPos = new Vector3(ax, 0, az + hd - 2.6)
    this.exitPos = new Vector3(ax, 0, az + hd - 0.4)
    this.bounds = {
      minX: ax - hw + 0.55,
      maxX: ax + hw - 0.55,
      minZ: az - hd + 0.55,
      maxZ: az + hd - 0.3,
    }

    const bake = (geos: BufferGeometry[], mat: MeshStandardMaterial | MeshBasicMaterial, occlude = false): Mesh | null => {
      const merged = mergeGeometries(geos)
      if (!merged) return null
      const m = new Mesh(merged, mat)
      m.receiveShadow = false
      m.castShadow = false
      this.root.add(m)
      if (occlude) this.shell.push(m)
      return m
    }

    // ---- floor -----------------------------------------------------------
    const floor = new PlaneGeometry(ROOM_W + 0.6, ROOM_D + 0.5)
    floor.rotateX(-Math.PI / 2)
    floor.translate(0, 0.01, 0)
    bake([floor], new MeshStandardMaterial({ map: toTexture(plankFloorCanvas(rng)), roughness: 0.9 }))

    // ---- plaster shell: four walls + the flat ceiling (one occluding bake) --
    const wallTex = toTexture(plasterCanvas(rng), true)
    wallTex.repeat.set(3, 1)
    const plaster = new MeshStandardMaterial({ map: wallTex, roughness: 0.96 })
    const walls: BufferGeometry[] = []
    box(walls, ROOM_W, WALL_H, 0.24, 0, WALL_H / 2, -hd) // north
    box(walls, 0.24, WALL_H, ROOM_D, -hw, WALL_H / 2, 0) // west (hearth wall)
    box(walls, 0.24, WALL_H, ROOM_D, hw, WALL_H / 2, 0) // east
    // south wall splits around the door gap
    const segW = hw - DOOR_HALF
    for (const s of [-1, 1]) box(walls, segW, WALL_H, 0.24, s * (DOOR_HALF + segW / 2), WALL_H / 2, hd)
    // the flat joisted ceiling: plaster plane at WALL_H...
    box(walls, ROOM_W, 0.16, ROOM_D, 0, WALL_H + 0.08, 0)
    bake(walls, plaster, true)
    // the doorway itself gets a DRAW-NOTHING occluder pane: the camera's
    // pull-in ray must never slip out through the open door and film the
    // room from outside its own walls (the player teleports, never walks
    // through this plane — it blocks light rays, not feet)
    const pane = new Mesh(
      new PlaneGeometry(DOOR_HALF * 2, WALL_H),
      new MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: DoubleSide }),
    )
    pane.position.set(0, WALL_H / 2, hd)
    this.root.add(pane)
    this.shell.push(pane)
    // warm daylight just beyond the opening — inside an opaque room the
    // far plane pulls in (the world outside isn't drawn), so the doorway
    // shows sunshine instead of void
    const glow = new Mesh(
      new PlaneGeometry(DOOR_HALF * 2 + 0.8, WALL_H + 0.4),
      new MeshBasicMaterial({ color: '#ffeec4', side: DoubleSide }),
    )
    glow.position.set(0, WALL_H / 2, hd + 0.45)
    this.root.add(glow)

    // ---- material buckets the whole room shares ----------------------------
    const wood: BufferGeometry[] = [] // warm furniture plank
    const dark: BufferGeometry[] = [] // joists, chest, logs, rails
    const stone: BufferGeometry[] = []
    const soot: BufferGeometry[] = []
    const iron: BufferGeometry[] = []
    const copper: BufferGeometry[] = []
    const ware: BufferGeometry[] = [] // crockery (the loaf joins remapped)
    const curtains: BufferGeometry[] = []
    const views: BufferGeometry[] = []

    // ...crossed by exposed dark joists every 1.4u, running east-west
    for (const jz of [-2.8, -1.4, 0, 1.4, 2.8]) box(dark, ROOM_W, 0.18, 0.16, 0, WALL_H - 0.09, jz)

    // ---- HEARTH, west wall ---------------------------------------------------
    // graystone surround: base slab, two columns, lintel, chimney breast
    box(stone, 0.85, 0.06, 2.2, -hw + 0.46, 0.03, FP_Z)
    for (const s of [-1, 1]) box(stone, 0.5, 1.0, 0.42, -hw + 0.27, 0.5, FP_Z + s * 0.66)
    box(stone, 0.5, 0.4, 1.74, -hw + 0.27, 1.28, FP_Z)
    box(stone, 0.42, WALL_H - 1.48, 1.1, -hw + 0.23, (WALL_H + 1.48) / 2, FP_Z)
    // mantel shelf
    box(wood, 0.55, 0.07, 1.9, -hw + 0.28, 1.55, FP_Z)
    // sooted firebox: back panel faces the room, side cheeks face inward
    const sootBack = new PlaneGeometry(0.94, 1.04)
    sootBack.rotateY(Math.PI / 2)
    sootBack.translate(-hw + 0.08, 0.56, FP_Z)
    soot.push(sootBack)
    for (const s of [-1, 1]) {
      const cheek = new PlaneGeometry(0.44, 1.04)
      if (s > 0) cheek.rotateY(Math.PI)
      cheek.translate(-hw + 0.26, 0.56, FP_Z + s * 0.44)
      soot.push(cheek)
    }
    // the fire: three painted tongues + an ember bed, all additive
    const fireMat = new MeshBasicMaterial({
      map: toTexture(fireCanvas(rng)),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    })
    const tongues: Array<[number, number, number, number]> = [
      [0.42, 0.5, Math.PI / 2 + 0.45, -0.18],
      [0.5, 0.62, Math.PI / 2, 0],
      [0.44, 0.54, Math.PI / 2 - 0.4, 0.17],
    ]
    for (const [w, h, ry, dz] of tongues) {
      const f = new Mesh(flameQuad(w, h, ry), fireMat)
      f.position.set(-hw + 0.3, 0.07, FP_Z + dz)
      f.renderOrder = 2
      this.root.add(f)
      this.flames.push(f)
    }
    const ember = new PlaneGeometry(0.55, 0.32)
    remapUV(ember, 0.15, 0, 0.85, 0.22)
    ember.rotateX(-Math.PI / 2)
    const emberMesh = new Mesh(ember, fireMat)
    emberMesh.position.set(-hw + 0.28, 0.075, FP_Z)
    emberMesh.renderOrder = 2
    this.root.add(emberMesh)
    // the hearth light: one warm point, flickered on two incommensurate sines
    this.fireLight = new PointLight('#ff9a4a', 0, 7, 2)
    this.fireLight.position.set(-hw + 0.75, 0.7, FP_Z)
    this.root.add(this.fireLight)
    // the kettle on its swing arm, hung over the tongues
    cyl(iron, 0.022, 0.025, 1.3, -hw + 0.3, 0.65, FP_Z + 0.4, 8) // post
    const arm = new CylinderGeometry(0.018, 0.018, 0.5, 8)
    arm.rotateX(Math.PI / 2)
    arm.translate(-hw + 0.3, 1.2, FP_Z + 0.18)
    iron.push(arm)
    cyl(iron, 0.012, 0.012, 0.12, -hw + 0.3, 1.13, FP_Z, 6) // hook link
    cyl(iron, 0.1, 0.13, 0.18, -hw + 0.3, 0.91, FP_Z) // kettle body
    cyl(iron, 0.025, 0.032, 0.045, -hw + 0.3, 1.02, FP_Z, 8) // lid knob
    const spout = new CylinderGeometry(0.018, 0.032, 0.16, 7)
    spout.rotateX(1.05)
    spout.translate(-hw + 0.3, 0.94, FP_Z - 0.14)
    iron.push(spout)
    const handle = new TorusGeometry(0.09, 0.013, 6, 10, Math.PI)
    handle.rotateY(Math.PI / 2)
    handle.translate(-hw + 0.3, 0.99, FP_Z)
    iron.push(handle)
    // two stacked log boxes waiting their turn
    box(dark, 0.42, 0.16, 0.85, -hw + 0.55, 0.09, FP_Z + 1.35, 0.15)
    box(dark, 0.38, 0.16, 0.8, -hw + 0.57, 0.25, FP_Z + 1.33, -0.1)

    // ---- KITCHEN, north wall ------------------------------------------------
    // the counter: plank top over cabinet boxes
    box(wood, 3.2, 0.06, 0.72, -1.0, 0.93, -hd + 0.4)
    for (const cx of [-2.05, -1.0, 0.05]) box(wood, 0.98, 0.9, 0.6, cx, 0.45, -hd + 0.38)
    // crockery stacks on the counter (glaze sheet, upper region)
    cyl(ware, 0.09, 0.09, 0.07, -2.35, 0.995, -hd + 0.32) // plate stack
    cyl(ware, 0.07, 0.082, 0.13, -2.05, 1.025, -hd + 0.28) // jug
    cyl(ware, 0.06, 0.07, 0.11, 0.1, 1.015, -hd + 0.3)
    cyl(ware, 0.075, 0.085, 0.09, 0.34, 1.005, -hd + 0.36)
    // the basin, with the sunny window above it
    cyl(ware, 0.21, 0.17, 0.15, -1.0, 1.035, -hd + 0.38, 14)
    const kitchenWin = new PlaneGeometry(1.05, 0.95)
    kitchenWin.translate(-1.0, 1.78, -hd + 0.13)
    views.push(kitchenWin)
    for (const s of [-1, 1]) {
      const panel = new PlaneGeometry(0.42, 1.26)
      panel.rotateY(-s * 0.18)
      panel.translate(-1.0 + s * 0.72, 1.72, -hd + 0.18)
      curtains.push(panel)
    }
    // three copper pans on a rail over the counter
    box(dark, 1.6, 0.05, 0.05, -2.0, 2.05, -hd + 0.18)
    for (const px of [-2.5, -2.0, -1.5]) {
      const pan = new CylinderGeometry(0.15, 0.15, 0.045, 14)
      pan.rotateX(Math.PI / 2)
      pan.translate(px, 1.78, -hd + 0.2)
      copper.push(pan)
      box(copper, 0.04, 0.16, 0.018, px, 1.99, -hd + 0.2)
    }
    // the wood stove: dark iron box, door, stovepipe up through the ceiling
    box(iron, 0.72, 0.78, 0.62, 1.9, 0.5, -hd + 0.45)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(iron, 0.06, 0.11, 0.06, 1.9 + sx * 0.3, 0.055, -hd + 0.45 + sz * 0.24)
    box(iron, 0.36, 0.36, 0.05, 1.9, 0.5, -hd + 0.78)
    box(iron, 0.12, 0.03, 0.03, 1.9, 0.5, -hd + 0.81)
    cyl(iron, 0.085, 0.085, 2.06, 1.9, 1.92, -hd + 0.45, 10)

    // ---- FAMILY TABLE, center-east (interior.ts proportions, own geometry) --
    box(wood, TABLE.w + 0.08, 0.07, TABLE.d + 0.08, TABLE.x, TABLE_H - 0.035, TABLE.z)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(wood, 0.09, TABLE_H - 0.07, 0.09, TABLE.x + sx * (TABLE.w / 2 - 0.14), (TABLE_H - 0.07) / 2, TABLE.z + sz * (TABLE.d / 2 - 0.14))
      }
      box(wood, TABLE.w - 0.5, 0.09, 0.05, TABLE.x, TABLE_H - 0.13, TABLE.z + sx * (TABLE.d / 2 - 0.12))
    }
    const chair = (cx: number, cz: number, ry: number): void => {
      const part = (w: number, h: number, d: number, lx: number, ly: number, lz: number): void => {
        const g = new BoxGeometry(w, h, d)
        g.translate(lx, ly, lz)
        g.rotateY(ry)
        g.translate(cx, 0, cz)
        wood.push(g)
      }
      part(0.46, 0.05, 0.44, 0, SEAT_TOP - 0.025, 0)
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) part(0.05, SEAT_TOP - 0.05, 0.05, sx * 0.19, (SEAT_TOP - 0.05) / 2, sz * 0.17)
        part(0.05, 0.6, 0.05, sx * 0.19, SEAT_TOP + 0.3, -0.195)
      }
      part(0.37, 0.08, 0.035, 0, SEAT_TOP + 0.5, -0.195)
      part(0.37, 0.07, 0.035, 0, SEAT_TOP + 0.3, -0.195)
    }
    chair(TABLE.x - 0.35, TABLE.z - (TABLE.d / 2 + 0.2), 0)
    chair(TABLE.x + 0.35, TABLE.z - (TABLE.d / 2 + 0.2), 0)
    chair(TABLE.x + TABLE.w / 2 + 0.2, TABLE.z, -Math.PI / 2)
    // the bench along the south side
    box(wood, 1.5, 0.05, 0.34, TABLE.x, SEAT_TOP, TABLE.z + TABLE.d / 2 + 0.25)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(wood, 0.07, SEAT_TOP - 0.025, 0.07, TABLE.x + sx * 0.6, (SEAT_TOP - 0.025) / 2, TABLE.z + TABLE.d / 2 + 0.25 + sz * 0.1)
    // three bowls + the bread board with its loaf
    for (const [bx, bz] of [[-0.35, -0.27], [0.35, -0.27], [0, 0.33]] as Array<[number, number]>) {
      cyl(ware, 0.085, 0.06, 0.055, TABLE.x + bx, TABLE_H + 0.028, TABLE.z + bz)
    }
    box(wood, 0.42, 0.025, 0.28, TABLE.x, TABLE_H + 0.013, TABLE.z)
    const loaf = new SphereGeometry(0.11, 9, 7)
    loaf.scale(1.35, 0.72, 0.78)
    remapUV(loaf, 0.02, 0.02, 0.98, 0.31) // the crust strip of the ware sheet
    loaf.translate(TABLE.x, TABLE_H + 0.095, TABLE.z)

    // ---- KIDS CORNER, north-east ---------------------------------------------
    // the braided rug
    const rug = new PlaneGeometry(1.5, 1.2)
    rug.rotateX(-Math.PI / 2)
    rug.translate(3.1, 0.012, -2.0)
    bake([rug], new MeshStandardMaterial({ map: toTexture(braidedRugCanvas(rng)), roughness: 1, alphaTest: 0.5 }))
    // the toy chest, lid ajar against the wall
    box(dark, 0.62, 0.05, 0.42, 3.8, 0.06, -hd + 0.4)
    for (const s of [-1, 1]) {
      box(dark, 0.62, 0.34, 0.05, 3.8, 0.25, -hd + 0.4 + s * 0.185)
      box(dark, 0.05, 0.34, 0.37, 3.8 + s * 0.285, 0.25, -hd + 0.4)
    }
    const lid = new BoxGeometry(0.64, 0.045, 0.44)
    lid.rotateX(-0.85)
    lid.translate(3.8, 0.52, -hd + 0.22)
    dark.push(lid)
    // the rocking horse — boxes + torus arcs, a wink at Hazel (~0.5u tall)
    const horse: BufferGeometry[] = []
    for (const s of [-1, 1]) {
      const rocker = new TorusGeometry(0.28, 0.02, 6, 14, 1.7)
      rocker.rotateZ(-Math.PI / 2 - 0.85) // arc cradles the floor
      rocker.translate(0, 0.3, s * 0.09)
      horse.push(rocker)
    }
    for (const sx of [-1, 1]) {
      box(horse, 0.2, 0.02, 0.04, sx * 0.2, 0.115, 0) // cross slats
      for (const sz of [-1, 1]) box(horse, 0.035, 0.24, 0.035, sx * 0.17, 0.21, sz * 0.09) // legs
    }
    box(horse, 0.36, 0.13, 0.16, 0, 0.37, 0) // body
    const neck = new BoxGeometry(0.07, 0.2, 0.1)
    neck.rotateZ(-0.35)
    neck.translate(0.17, 0.47, 0)
    horse.push(neck)
    const head = new BoxGeometry(0.13, 0.08, 0.08)
    head.rotateZ(-0.2)
    head.translate(0.24, 0.55, 0)
    horse.push(head)
    box(horse, 0.025, 0.05, 0.03, 0.21, 0.6, 0) // ear
    const peg = new CylinderGeometry(0.012, 0.012, 0.16, 6)
    peg.rotateX(Math.PI / 2)
    peg.translate(0.13, 0.5, 0)
    horse.push(peg)
    const tail = new BoxGeometry(0.05, 0.14, 0.03)
    tail.rotateZ(0.5)
    tail.translate(-0.2, 0.42, 0)
    horse.push(tail)
    for (const g of horse) {
      g.rotateY(0.6)
      g.translate(3.0, 0, -2.0)
      wood.push(g)
    }

    // ---- BEDROOM NOOK, south-west, behind the half-wall -----------------------
    box(wood, 0.12, 1.6, 2.2, -2.45, 0.8, hd - 1.1)
    box(wood, 0.2, 0.05, 2.3, -2.45, 1.62, hd - 1.1) // cap rail
    // the bed: posts, boards, rails...
    const BED = { x: -3.72, z: 2.4 }
    for (const [pz, ph] of [[3.3, 0.75], [1.5, 0.42]] as Array<[number, number]>) {
      for (const s of [-1, 1]) box(wood, 0.08, ph, 0.08, BED.x + s * 0.46, ph / 2, pz)
    }
    box(wood, 0.95, 0.55, 0.07, BED.x, 0.45, 3.32) // headboard
    box(wood, 0.95, 0.32, 0.06, BED.x, 0.3, 1.48) // footboard
    for (const s of [-1, 1]) box(wood, 0.06, 0.16, 1.8, BED.x + s * 0.475, 0.3, BED.z)
    // ...and the patchwork quilt tucked over the mattress
    const quiltGeo = new BoxGeometry(0.93, 0.24, 1.78)
    quiltGeo.translate(BED.x, 0.42, BED.z)
    bake([quiltGeo], new MeshStandardMaterial({ map: toTexture(quiltCanvas(rng)), roughness: 1 }))
    box(curtains, 0.66, 0.12, 0.34, BED.x, 0.6, 3.05) // pillow (cream linen)
    // side table with a candle (the 4th flicker flame)
    box(wood, 0.32, 0.44, 0.32, -2.85, 0.22, 3.18)
    box(curtains, 0.07, 0.13, 0.07, -2.85, 0.505, 3.18) // wax stub
    const candle = new Mesh(flameQuad(0.05, 0.1, 0.6), fireMat)
    candle.position.set(-2.85, 0.57, 3.18)
    candle.renderOrder = 2
    this.root.add(candle)
    this.flames.push(candle)

    // ---- merge the set --------------------------------------------------------
    // (the lantern wire joins the dark bake; its glowing head hangs below)
    const wire = new CylinderGeometry(0.012, 0.012, 0.45, 4)
    wire.translate(TABLE.x, 2.66, TABLE.z)
    dark.push(wire)
    bake(wood, new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#8a6a44'), true), roughness: 0.9 }))
    bake(dark, new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#4d3826'), true), roughness: 0.95 }))
    bake(stone, new MeshStandardMaterial({ map: toTexture(graystoneCanvas(rng), true), roughness: 0.98 }))
    bake(soot, new MeshStandardMaterial({ map: toTexture(sootCanvas(rng)), roughness: 1 }))
    bake(iron, new MeshStandardMaterial({ map: toTexture(ironCanvas(rng), true), roughness: 0.6, metalness: 0.4 }))
    bake(copper, new MeshStandardMaterial({ map: toTexture(copperCanvas(rng), true), roughness: 0.45, metalness: 0.5 }))
    for (const g of ware) remapUV(g, 0.02, 0.37, 0.98, 0.97) // glaze region
    ware.push(loaf)
    bake(ware, new MeshStandardMaterial({ map: toTexture(wareCanvas(rng)), roughness: 0.5 }))
    bake(curtains, new MeshStandardMaterial({ map: toTexture(curtainCanvas(rng)), roughness: 1, side: DoubleSide }))

    // ---- the south windows: same sunny view, shafts pouring through -----------
    for (const wx of [-3.4, 2.8]) {
      const w = new PlaneGeometry(0.95, 0.9)
      w.rotateY(Math.PI)
      w.translate(wx, 1.75, hd - 0.13)
      views.push(w)
    }
    bake(views, new MeshBasicMaterial({ map: toTexture(farmViewCanvas(rng)) }))
    const shafts: BufferGeometry[] = []
    for (const sx of [-3.4, 2.8]) {
      const shaft = new PlaneGeometry(1.2, 2.7)
      shaft.rotateX(0.5)
      shaft.translate(sx, 1.6, hd - 1.2)
      shafts.push(shaft)
    }
    bake(shafts, new MeshBasicMaterial({
      color: '#ffe9b8',
      transparent: true,
      opacity: 0.13,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }))
    // seeded dust motes drifting in the light
    const moteN = 40
    const motePos = new Float32Array(moteN * 3)
    for (let i = 0; i < moteN; i++) {
      motePos[i * 3] = -hw + 0.5 + rng.next() * (ROOM_W - 1)
      motePos[i * 3 + 1] = 0.3 + rng.next() * 2.2
      motePos[i * 3 + 2] = -hd + 0.5 + rng.next() * (ROOM_D - 1)
    }
    const moteGeo = new BufferGeometry()
    moteGeo.setAttribute('position', new BufferAttribute(motePos, 3))
    this.motes = new Points(
      moteGeo,
      new PointsMaterial({ color: '#ffe9b8', size: 0.035, transparent: true, opacity: 0.65, depthWrite: false }),
    )
    this.root.add(this.motes)

    // ---- the lantern over the table (the room's second and last light) --------
    const lanternHead = new Mesh(new CylinderGeometry(0.12, 0.16, 0.22, 8), new MeshBasicMaterial({ color: '#ffd9a0' }))
    lanternHead.position.set(TABLE.x, 2.32, TABLE.z)
    this.root.add(lanternHead)
    this.tableLight = new PointLight('#ffc98a', 0, 9, 1.5)
    this.tableLight.position.set(TABLE.x, 2.18, TABLE.z)
    this.root.add(this.tableLight)

    // ---- THE FAMILY BY DAY -----------------------------------------------------
    const clips = assets.clips('customerC')
    // the wife stands at the counter, mid-chore
    const wifeG = assets.spawnSkinned('customerC')
    normalizeHeight(wifeG, WIFE_H)
    wifeG.position.set(-0.6, 0, -2.5)
    wifeG.rotation.y = Math.PI // facing the counter
    this.root.add(wifeG)
    this.wifeMixer = new AnimationMixer(wifeG)
    const wifeIdle = idleAction(this.wifeMixer, wifeG, clips)
    if (wifeIdle) {
      wifeIdle.play()
      wifeIdle.time = rng.next() * wifeIdle.getClip().duration
    }
    this.wifePos = new Vector3(ax - 0.6, 0, az - 2.5)
    // the kid hovers by the toy corner, idling a touch quicker (kids do)
    const kidG = assets.spawnSkinned('customerC')
    normalizeHeight(kidG, KID_H)
    kidG.position.set(2.45, 0, -1.35)
    kidG.rotation.y = 2.44 // facing the rocking horse
    // clone every material before tinting so the wife's stay untouched
    kidG.traverse((o) => {
      if (!(o instanceof Mesh)) return
      const tinted = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
        const clone = m.clone()
        if (clone instanceof MeshStandardMaterial) clone.color.lerp(KID_TINT, 0.22)
        return clone
      })
      o.material = Array.isArray(o.material) ? tinted : tinted[0]
    })
    this.root.add(kidG)
    this.kidMixer = new AnimationMixer(kidG)
    const kidIdle = idleAction(this.kidMixer, kidG, clips)
    if (kidIdle) {
      kidIdle.timeScale = 1.15
      kidIdle.play()
      kidIdle.time = rng.next() * kidIdle.getClip().duration
    }
    this.kidPos = new Vector3(ax + 2.45, 0, az - 1.35)

    this.root.visible = false
  }

  setActive(on: boolean): void {
    this.root.visible = on
    this.fireLight.intensity = on ? FIRE_BASE_INTENSITY : 0
    this.tableLight.intensity = on ? 0.9 : 0
  }

  get active(): boolean {
    return this.root.visible
  }

  /** flames lick, the hearth light breathes, motes drift, the family idles —
   * zero allocations, and the mixers tick only while the room is visible */
  update(dt: number): void {
    if (!this.root.visible) return
    this.t += dt
    const t = this.t
    this.wifeMixer.update(dt)
    this.kidMixer.update(dt)
    // hearth flicker: ±12%, two incommensurate sines (never strobes)
    const n = Math.sin(t * 7.3) * 0.6 + Math.sin(t * 11.9 + 2.1) * 0.4
    this.fireLight.intensity = FIRE_BASE_INTENSITY * (1 + 0.12 * n)
    for (let i = 0; i < this.flames.length; i++) {
      this.flames[i].scale.y = 1 + Math.sin(t * 9 + i) * 0.12
    }
    this.motes.rotation.y = Math.sin(t * 0.05) * 0.18
  }
}
