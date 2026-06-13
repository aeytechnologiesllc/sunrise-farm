/** MILLBROOK — the town that grows east of the farm, on both sides of the
 * road past the town gate. Pure living SCENERY: the player never walks here,
 * so there is no nav and no collision — everything is tuned to read
 * beautifully from 15-30u away. Four staged acts (bakery → cottages →
 * school → works) pop in as the story builds them, the morning bus rolls in
 * with the day's customers, kids take recess in the schoolyard and the wool
 * mill breathes supper-smoke on shift. House rules hold all the way out
 * here: every surface canvas-painted (no flat-color blobs), statics merged
 * per material per act (24 draws fully built), characters are tinted
 * Quaternius rigs ticked at 2Hz with summed dt, zero PointLights (MeshBasic
 * glow heads — the town is far, fake glow reads fine), zero allocations in
 * update(), and every roll flows from mulberry32(0x70b11). */
import gsap from 'gsap'
import {
  AnimationAction,
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
  SphereGeometry,
  type AnimationClip,
  type Scene,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ROAD_Z } from '../game/geo'
import { mulberry32, type Rng } from '../game/rng'
import type { Assets, ModelKey } from './assets'
import { normalizeHeight } from './scale'
import { makeCanvas, toTexture, woodCanvas } from './textures'

type ActId = 'bakery' | 'cottages' | 'school' | 'works' | 'cafe' | 'square' | 'station'
const ACTS: ActId[] = ['bakery', 'cottages', 'school', 'works', 'cafe', 'square', 'station']

/** meters of wall per texture tile — same board scale as the farm buildings */
const TILE = 1.4

// ---- the town plan (world coords; road runs east-west at z = ROAD_Z) ---------
/** stage pivots — each act's group sits here so the reveal pop grows the
 * whole block out of its own ground, not out of the world origin */
const P_BAKERY: [number, number] = [26.8, 9.4]
const P_COTTAGES: [number, number] = [34.6, 8.5]
const P_SCHOOL: [number, number] = [31.8, 14.8]
const P_WORKS: [number, number] = [40.6, 12.4]
const P_CAFE: [number, number] = [46.0, 8.0]
const P_SQUARE: [number, number] = [37.5, 15.5]
const P_STATION: [number, number] = [50.5, 11.0]
/** where the bus noses to a stop, beside Rosie's */
const BUS_STOP_X = 26.8
const BUS_Z = ROAD_Z + 0.2
/** passengers fade out here — just shy of the farm, "becoming" customers */
const PAX_GONE_X = 21.5
const PAX_FADE_X = 22.6
/** schoolyard wander rect, LOCAL to the school stage pivot */
const KID_X0 = 0.2
const KID_X1 = 3.3
const KID_Z0 = -0.9
const KID_Z1 = 0.9
/** mill-yard wander rect, LOCAL to the works stage pivot */
const WORKER_X0 = -1.8
const WORKER_X1 = 1.6
const WORKER_Z0 = -0.3
const WORKER_Z1 = 1.2
/** south road-shoulder wander rect for the always-on strollers (world coords,
 * in front of the bakery and cottages — x 26..36, z 9..10) */
const STROLLER_X0 = 26.0
const STROLLER_X1 = 36.0
const STROLLER_Z0 = 9.0
const STROLLER_Z1 = 10.0
/** mill chimney mouth, LOCAL to the works stage pivot (smoke is born here) */
const SMOKE_AT: [number, number, number] = [-2.9, 6.05, 3.8]
/** train parked X (offstage east, just beyond the station) */
const TRAIN_PARK_X = 62.0
/** train stop X — engine nose rests at the platform end */
const TRAIN_STOP_X = 50.5
/** train Z — centre of the tracks (runs east from the station) */
const TRAIN_Z = ROAD_Z + 2.0
/** ground speed covered by the family Walk clip at timeScale 1 for a 1.6u
 * adult — same foot-lock measurement as Customer.ts */
const WALK_REF = 2.2
const FADE = 0.25
const TURN_RATE = 8

// ---- geometry helpers (the buildings.ts vocabulary) ---------------------------

/** merge a pile of geometries into one shadowed mesh (1 draw call) */
function fuse(
  geos: BufferGeometry[],
  material: MeshStandardMaterial | MeshBasicMaterial,
  cast = true,
  receive = true,
): Mesh | null {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g))
  const merged = mergeGeometries(parts)
  // free the source geometries (incl. the toNonIndexed copies) — they are spent
  // once merged; town stages build once at boot but the geos still strand RAM
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== geos[i]) parts[i].dispose() // the toNonIndexed copy
    geos[i].dispose()
  }
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

/** remap a geometry's 0..1 uvs into a sub-rect of an atlas canvas
 * (canvas pixel coords, y-down; flipY textures invert v here) */
function uvRegion(
  geo: BufferGeometry,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  sw: number,
  sh: number,
): BufferGeometry {
  const uv = geo.getAttribute('uv')
  const u0 = x0 / sw
  const u1 = x1 / sw
  const v0 = 1 - y1 / sh
  const v1 = 1 - y0 / sh
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0))
  return geo
}

/** axis-aligned gable prism (apex along z, base on y=0, centered) */
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
  tri(-hw, 0, hd, 0, 0, hw, 0, hd, 1, 0, 0, h, hd, 0.5, 1)
  tri(hw, 0, -hd, 0, 0, -hw, 0, -hd, 1, 0, 0, h, -hd, 0.5, 1)
  tri(-hw, 0, hd, 1, 0, 0, h, hd, 1, 1, 0, h, -hd, 0, 1)
  tri(-hw, 0, hd, 1, 0, 0, h, -hd, 0, 1, -hw, 0, -hd, 0, 0)
  tri(hw, 0, hd, 1, 0, hw, 0, -hd, 0, 0, 0, h, -hd, 0, 1)
  tri(hw, 0, hd, 1, 0, 0, h, -hd, 0, 1, 0, h, hd, 1, 1)
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geo.computeVertexNormals()
  return geo
}

/** awning/canopy pitch plane — wall-side edge stays high (buildShop recipe) */
function pitchPlane(width: number, len: number, t: number, yTop: number, zTop: number): PlaneGeometry {
  const p = new PlaneGeometry(width, len)
  p.rotateX(-Math.PI / 2 + t)
  p.translate(0, yTop - (len / 2) * Math.sin(t), zTop + (len / 2) * Math.cos(t))
  return p
}

/** yaw + place a building's local-frame geometry onto its lot */
function moveGeos(geos: BufferGeometry[], x: number, z: number, yaw = 0): BufferGeometry[] {
  for (const g of geos) {
    if (yaw !== 0) g.rotateY(yaw)
    g.translate(x, 0, z)
  }
  return geos
}

// ---- painted canvases ----------------------------------------------------------

/** warm cream plaster: mottled wash, trowel arcs, speckle — never one flat tone */
function plasterCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 128)
  g.fillStyle = '#efe4cb'
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 22; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,250,236,0.16)' : 'rgba(186,164,124,0.12)'
    g.beginPath()
    g.arc(rng.next() * 128, rng.next() * 128, 8 + rng.next() * 18, 0, Math.PI * 2)
    g.fill()
  }
  // trowel sweeps, wrapped so the tile seams stay invisible
  for (let i = 0; i < 26; i++) {
    const x = rng.next() * 128
    const y = rng.next() * 128
    const r = 10 + rng.next() * 16
    const a0 = rng.next() * Math.PI * 2
    g.strokeStyle = rng.next() > 0.5 ? 'rgba(206,188,150,0.22)' : 'rgba(255,252,240,0.2)'
    g.lineWidth = 1.2 + rng.next() * 1.6
    for (const [ox, oy] of [[0, 0], [-128, 0], [128, 0], [0, -128], [0, 128]]) {
      g.beginPath()
      g.arc(x + ox, y + oy, r, a0, a0 + 1.6 + rng.next() * 1.2)
      g.stroke()
    }
  }
  for (let i = 0; i < 70; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(150,128,92,0.12)' : 'rgba(255,255,250,0.18)'
    g.fillRect(rng.next() * 128, rng.next() * 128, 1.6, 1.6)
  }
  return c
}

/** horizontal clapboard siding in any paint scheme — 8 boards per tile with
 * lit top edges, gap shadows and faint grain (the farm shop's recipe) */
function clapboardCanvas(rng: Rng, base: string, grain: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 256)
  g.fillStyle = base
  g.fillRect(0, 0, 256, 256)
  for (let b = 0; b < 8; b++) {
    const y0 = b * 32
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,250,238,0.09)' : 'rgba(40,28,16,0.07)'
    g.fillRect(0, y0, 256, 32)
    g.fillStyle = 'rgba(255,252,242,0.4)'
    g.fillRect(0, y0 + 1, 256, 1.5)
    g.fillStyle = 'rgba(34,22,12,0.4)'
    g.fillRect(0, y0 + 29.5, 256, 2.5)
    for (let i = 0; i < 11; i++) {
      const gy = y0 + 5 + rng.next() * 23
      const x = rng.next() * 256
      const len = 24 + rng.next() * 70
      g.strokeStyle = grain
      g.lineWidth = 0.8
      for (const ox of [-256, 0, 256]) {
        g.beginPath()
        g.moveTo(x + ox, gy)
        g.quadraticCurveTo(x + ox + len / 2, gy + (rng.next() - 0.5) * 2.5, x + ox + len, gy)
        g.stroke()
      }
    }
    if (rng.next() > 0.6) {
      g.fillStyle = 'rgba(30,20,10,0.4)'
      g.beginPath()
      g.arc(20 + rng.next() * 216, y0 + 10 + rng.next() * 14, 1.5, 0, Math.PI * 2)
      g.fill()
    }
  }
  return c
}

/** staggered shingle rows with per-shingle tone, gaps, row shadows, moss */
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
        g.fillStyle = 'rgba(18,12,6,0.5)'
        g.fillRect(x0 + ox - 1.5, y0, 3, 32)
        g.fillRect(x0 + ox, y0 + 29, 40, 3)
        g.fillStyle = tones[Math.floor(rng.next() * tones.length)]
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.30)'
    g.fillRect(0, y0, 256, 5)
  }
  for (let i = 0; i < 110; i++) {
    const t = rng.next()
    g.fillStyle = t > 0.7 ? 'rgba(126,138,92,0.18)' : t > 0.35 ? 'rgba(220,210,190,0.10)' : 'rgba(20,14,8,0.16)'
    g.fillRect(rng.next() * 256, rng.next() * 256, 2, 2)
  }
  return c
}

/** warm brick courses with mortar joints, tone shifts and weather speckle */
function brickCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 128)
  g.fillStyle = '#c4b49a'
  g.fillRect(0, 0, 128, 128)
  const tones = ['#9a4f33', '#a35a3a', '#8f4a30', '#a96443', '#94553b']
  for (let r = 0; r < 8; r++) {
    const y0 = r * 16
    const off = (r % 2) * 16
    for (let i = -1; i < 5; i++) {
      const x0 = i * 32 + off
      g.fillStyle = tones[Math.floor(rng.next() * tones.length)]
      for (const ox of [-128, 0, 128]) {
        g.fillRect(x0 + ox + 1.5, y0 + 1.5, 29, 13)
        // lit top edge + sooty base per brick
        g.fillStyle = 'rgba(255,220,180,0.14)'
        g.fillRect(x0 + ox + 1.5, y0 + 1.5, 29, 2)
        g.fillStyle = 'rgba(40,18,10,0.25)'
        g.fillRect(x0 + ox + 1.5, y0 + 12, 29, 2.5)
        g.fillStyle = tones[Math.floor(rng.next() * tones.length)]
      }
    }
  }
  for (let i = 0; i < 80; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(50,26,14,0.18)' : 'rgba(235,220,195,0.14)'
    g.fillRect(rng.next() * 128, rng.next() * 128, 1.6, 1.6)
  }
  return c
}

/** awning fabric atlas — three palettes stacked in 64px bands so every
 * canopy in town shares ONE material: rose/cream (Rosie's), red/white
 * (the butcher), green/cream (market stalls). Weave lines + sun-fade. */
function stripesCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 192)
  const bands: Array<[string, string]> = [
    ['#e0526e', '#f5f0e0'],
    ['#c84444', '#f4efe6'],
    ['#4f7d56', '#efe9d2'],
  ]
  for (let b = 0; b < 3; b++) {
    const [a, bg] = bands[b]
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? bg : a
      g.fillRect(i * 32, b * 64, 32, 64)
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.045)'
  for (let y = 0; y < 192; y += 4) g.fillRect(0, y, 256, 1)
  for (let i = 0; i < 170; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(60,30,30,0.05)'
    g.fillRect(rng.next() * 256, rng.next() * 192, 2, 2)
  }
  return c
}

/** white painted trim: subtle streaks + scuffs so it never reads flat */
function whitePaintCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#f3f2ec'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = 'rgba(186,184,170,0.22)'
    g.lineWidth = 0.8 + rng.next()
    const x = rng.next() * 64
    g.beginPath()
    g.moveTo(x, rng.next() * 20)
    g.lineTo(x + (rng.next() - 0.5) * 4, 30 + rng.next() * 34)
    g.stroke()
  }
  for (let i = 0; i < 12; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(150,148,136,0.14)' : 'rgba(255,255,255,0.4)'
    g.fillRect(rng.next() * 64, rng.next() * 64, 2, 2)
  }
  return c
}

/** the painted-detail atlas (MeshStandard): ROSIE'S board, the MILLBROOK bus
 * sign, bread crust, drystone, crate slats, produce tops, bus tires —
 * one material so signs/bread/stone/crates cost a single draw per act */
function paintedAtlasCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 256)
  // -- ROSIE'S hanging board (0,0)-(160,64): wood grain, cream border, bun crest
  g.fillStyle = '#5d4226'
  g.fillRect(0, 0, 160, 64)
  for (let i = 0; i < 26; i++) {
    const y = rng.next() * 64
    g.strokeStyle = rng.next() > 0.5 ? 'rgba(118,88,50,0.45)' : 'rgba(52,34,16,0.45)'
    g.lineWidth = 0.8 + rng.next()
    g.beginPath()
    g.moveTo(0, y)
    g.quadraticCurveTo(80, y + (rng.next() - 0.5) * 5, 160, y)
    g.stroke()
  }
  g.strokeStyle = '#f4e8c8'
  g.lineWidth = 5
  g.strokeRect(3, 3, 154, 58)
  // little golden bun with a flour dust highlight
  g.fillStyle = '#d8a04f'
  g.beginPath()
  g.ellipse(80, 15, 10, 7, 0, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(120,70,20,0.8)'
  g.lineWidth = 1.4
  g.beginPath()
  g.moveTo(73, 15)
  g.quadraticCurveTo(80, 11, 87, 15)
  g.stroke()
  g.fillStyle = 'rgba(255,244,214,0.65)'
  g.beginPath()
  g.ellipse(76, 12, 3.2, 1.7, -0.4, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#f7edd2'
  g.font = '800 26px Trebuchet MS, sans-serif'
  g.textAlign = 'center'
  g.fillText("ROSIE'S", 80, 52)
  // -- MILLBROOK bus sign (160,0)-(256,64): cream plate, green border, bus glyph
  g.fillStyle = '#f4e9cf'
  g.fillRect(160, 0, 96, 64)
  g.strokeStyle = '#3f6b54'
  g.lineWidth = 4
  g.strokeRect(163, 3, 90, 58)
  g.fillStyle = '#3f6b54'
  g.font = '800 13px Trebuchet MS, sans-serif'
  g.fillText('MILLBROOK', 208, 22)
  g.font = '800 12px Trebuchet MS, sans-serif'
  g.fillText('BUS', 208, 56)
  // tiny bus glyph between the words
  g.fillStyle = '#b9442f'
  g.fillRect(190, 28, 36, 13)
  g.fillStyle = '#cfe4ee'
  for (const wx of [193, 201, 209, 217]) g.fillRect(wx, 30.5, 6, 5)
  g.fillStyle = '#2c2a28'
  g.beginPath()
  g.arc(198, 42, 3, 0, Math.PI * 2)
  g.arc(219, 42, 3, 0, Math.PI * 2)
  g.fill()
  // -- bread crust (0,72)-(96,160): golden radial, slashes, flour dust
  const crust = g.createRadialGradient(48, 112, 6, 48, 116, 56)
  crust.addColorStop(0, '#d99c55')
  crust.addColorStop(0.6, '#b97a38')
  crust.addColorStop(1, '#8a5526')
  g.fillStyle = crust
  g.fillRect(0, 72, 96, 88)
  g.strokeStyle = 'rgba(80,44,16,0.75)'
  g.lineWidth = 3
  for (const sx of [-18, 0, 18]) {
    g.beginPath()
    g.moveTo(34 + sx, 92)
    g.quadraticCurveTo(46 + sx, 112, 58 + sx, 138)
    g.stroke()
  }
  for (let i = 0; i < 36; i++) {
    g.fillStyle = rng.next() > 0.4 ? 'rgba(246,232,200,0.35)' : 'rgba(96,52,20,0.3)'
    g.fillRect(rng.next() * 96, 72 + rng.next() * 88, 1.8, 1.8)
  }
  // -- drystone (96,64)-(256,160): packed stones over dark joints
  g.fillStyle = '#544f47'
  g.fillRect(96, 64, 160, 96)
  const stoneTones = ['#8d867b', '#9a948a', '#7e776c', '#a39a8a', '#888376']
  for (let r = 0; r < 4; r++) {
    let x = 96 + rng.next() * 8
    while (x < 252) {
      const w = 18 + rng.next() * 22
      const y = 66 + r * 24 + (rng.next() - 0.5) * 3
      g.fillStyle = stoneTones[Math.floor(rng.next() * stoneTones.length)]
      g.beginPath()
      g.ellipse(x + w / 2, y + 11, w / 2, 10.5, (rng.next() - 0.5) * 0.2, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(255,250,238,0.16)'
      g.beginPath()
      g.ellipse(x + w / 2, y + 7, w / 2.6, 4, 0, 0, Math.PI * 2)
      g.fill()
      x += w + 3
    }
  }
  // -- crate slats (0,160)-(96,256)
  g.fillStyle = '#241a10'
  g.fillRect(0, 160, 96, 96)
  for (let s = 0; s < 3; s++) {
    const y0 = 164 + s * 31
    g.fillStyle = s % 2 ? '#9a7745' : '#8a6a3c'
    g.fillRect(2, y0, 92, 25)
    g.strokeStyle = 'rgba(60,40,18,0.5)'
    g.lineWidth = 1
    for (let i = 0; i < 6; i++) {
      const gy = y0 + 3 + rng.next() * 19
      g.beginPath()
      g.moveTo(4, gy)
      g.quadraticCurveTo(48, gy + (rng.next() - 0.5) * 3, 92, gy)
      g.stroke()
    }
  }
  g.fillStyle = '#6e5430'
  g.fillRect(0, 160, 7, 96)
  g.fillRect(89, 160, 7, 96)
  // -- produce tops (96,160)-(192,256): apples + greens heaped in a crate
  g.fillStyle = '#1d1409'
  g.fillRect(96, 160, 96, 96)
  for (let i = 0; i < 30; i++) {
    const t = rng.next()
    g.fillStyle = t > 0.62 ? '#bf4a32' : t > 0.3 ? '#a93b2c' : '#c9893a'
    g.beginPath()
    g.arc(106 + rng.next() * 76, 170 + rng.next() * 76, 5.5 + rng.next() * 3.5, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = 'rgba(255,236,200,0.4)'
    g.beginPath()
    g.arc(104 + rng.next() * 76, 168 + rng.next() * 76, 1.4, 0, Math.PI * 2)
    g.fill()
  }
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = 'rgba(86,128,62,0.85)'
    g.lineWidth = 2
    const x = 102 + rng.next() * 82
    const y = 168 + rng.next() * 80
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + (rng.next() - 0.5) * 9, y - 5 - rng.next() * 5)
    g.stroke()
  }
  // -- bus tire (192,160)-(256,256): dark disc, hub, bolts
  g.fillStyle = '#1f1d1b'
  g.fillRect(192, 160, 64, 96)
  g.fillStyle = '#2c2a28'
  g.beginPath()
  g.ellipse(224, 208, 29, 44, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#4a463f'
  g.beginPath()
  g.ellipse(224, 208, 13, 20, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#181614'
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    g.beginPath()
    g.arc(224 + Math.cos(a) * 8, 208 + Math.sin(a) * 13, 1.8, 0, Math.PI * 2)
    g.fill()
  }
  return c
}

/** the glow atlas (MeshBasic, alphaTest cutout): lamplit window (homestead
 * recipe), lamp-head glow, flower clumps, the school bell, bus windows */
function glowAtlasCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 256)
  // -- lamplit window (0,0)-(96,120): warm radial + curtains + dark frame
  const glow = g.createRadialGradient(48, 76, 6, 48, 70, 84)
  glow.addColorStop(0, '#ffeec6')
  glow.addColorStop(0.45, '#f7b35a')
  glow.addColorStop(1, '#b96a20')
  g.fillStyle = glow
  g.fillRect(0, 0, 96, 120)
  g.fillStyle = 'rgba(255, 240, 214, 0.42)'
  g.beginPath()
  g.moveTo(6, 6)
  g.lineTo(30, 6)
  g.quadraticCurveTo(20, 64, 13, 114)
  g.lineTo(6, 114)
  g.closePath()
  g.fill()
  g.beginPath()
  g.moveTo(90, 6)
  g.lineTo(66, 6)
  g.quadraticCurveTo(76, 64, 83, 114)
  g.lineTo(90, 114)
  g.closePath()
  g.fill()
  g.fillStyle = 'rgba(255, 240, 214, 0.3)'
  g.fillRect(6, 6, 84, 12)
  g.fillStyle = '#33261b'
  g.fillRect(0, 0, 96, 7)
  g.fillRect(0, 113, 96, 7)
  g.fillRect(0, 0, 7, 120)
  g.fillRect(89, 0, 7, 120)
  g.fillRect(45, 0, 6, 120)
  g.fillRect(0, 55, 96, 6)
  // -- lamp head (96,0)-(160,64): bright warm core fading to amber
  const lamp = g.createRadialGradient(128, 32, 3, 128, 32, 34)
  lamp.addColorStop(0, '#fff6d8')
  lamp.addColorStop(0.55, '#f3a93c')
  lamp.addColorStop(1, '#c47714')
  g.fillStyle = lamp
  g.fillRect(96, 0, 64, 64)
  // -- flower clump (160,0)-(256,96): cutout card, transparent bg
  for (let i = 0; i < 16; i++) {
    g.strokeStyle = 'rgba(74,116,52,0.95)'
    g.lineWidth = 2
    const x = 172 + rng.next() * 72
    g.beginPath()
    g.moveTo(x, 92)
    g.quadraticCurveTo(x + (rng.next() - 0.5) * 10, 70, x + (rng.next() - 0.5) * 14, 46 + rng.next() * 20)
    g.stroke()
  }
  const petals = ['#e06a8a', '#d8484f', '#e8b54a', '#c95fb8']
  for (let i = 0; i < 22; i++) {
    const x = 170 + rng.next() * 76
    const y = 24 + rng.next() * 48
    const tone = petals[Math.floor(rng.next() * petals.length)]
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2 + rng.next()
      g.fillStyle = tone
      g.beginPath()
      g.ellipse(x + Math.cos(a) * 3.2, y + Math.sin(a) * 3.2, 2.6, 1.8, a, 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = '#f5e29a'
    g.beginPath()
    g.arc(x, y, 1.7, 0, Math.PI * 2)
    g.fill()
  }
  // -- school bell (96,64)-(160,128): brass silhouette on transparent
  g.fillStyle = '#c9972f'
  g.beginPath()
  g.moveTo(112, 112)
  g.quadraticCurveTo(112, 78, 128, 74)
  g.quadraticCurveTo(144, 78, 144, 112)
  g.closePath()
  g.fill()
  g.fillStyle = '#a87a1e'
  g.fillRect(108, 110, 40, 5)
  g.fillStyle = '#c9972f'
  g.fillRect(124, 68, 8, 7)
  g.fillStyle = '#7a5a14'
  g.beginPath()
  g.arc(128, 119, 3.5, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(241,210,122,0.9)'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(117, 102)
  g.quadraticCurveTo(116, 84, 125, 78)
  g.stroke()
  // -- bus windows (0,128)-(256,192): pale glass strip with pane mullions
  const sky = g.createLinearGradient(0, 128, 0, 192)
  sky.addColorStop(0, '#cfe4ee')
  sky.addColorStop(1, '#9fc4d8')
  g.fillStyle = sky
  g.fillRect(0, 128, 256, 192 - 128)
  g.fillStyle = '#3a4248'
  for (let x = 0; x <= 256; x += 36) g.fillRect(x - 2, 128, 4, 64)
  g.fillRect(0, 128, 256, 4)
  g.fillRect(0, 188, 256, 4)
  g.strokeStyle = 'rgba(255,255,255,0.4)'
  g.lineWidth = 3
  for (let i = 0; i < 6; i++) {
    const x = rng.next() * 256
    g.beginPath()
    g.moveTo(x, 186)
    g.lineTo(x + 16, 134)
    g.stroke()
  }
  return c
}

/** the friendly bus coat: warm red, cream roof band, panel seams, rivets */
function busBodyCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 128)
  g.fillStyle = '#b9442f'
  g.fillRect(0, 0, 256, 128)
  g.fillStyle = '#f1e6cc'
  g.fillRect(0, 6, 256, 30)
  g.fillStyle = '#7d2a1c'
  g.fillRect(0, 34, 256, 3)
  g.fillRect(0, 108, 256, 20)
  // panel seams + rivets
  g.strokeStyle = 'rgba(60,16,8,0.35)'
  g.lineWidth = 1.5
  for (let x = 42; x < 256; x += 42) {
    g.beginPath()
    g.moveTo(x, 37)
    g.lineTo(x, 108)
    g.stroke()
    for (let y = 44; y < 104; y += 16) {
      g.fillStyle = 'rgba(255,220,200,0.3)'
      g.beginPath()
      g.arc(x + 4, y, 1.4, 0, Math.PI * 2)
      g.fill()
    }
  }
  // soft top-light so the coachwork reads curved
  const sheen = g.createLinearGradient(0, 0, 0, 128)
  sheen.addColorStop(0, 'rgba(255,255,255,0.22)')
  sheen.addColorStop(0.4, 'rgba(255,255,255,0)')
  sheen.addColorStop(1, 'rgba(30,8,4,0.22)')
  g.fillStyle = sheen
  g.fillRect(0, 0, 256, 128)
  for (let i = 0; i < 40; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,235,215,0.08)' : 'rgba(40,10,6,0.08)'
    g.fillRect(rng.next() * 256, rng.next() * 128, 2, 2)
  }
  return c
}

/** dark wrought-iron / rail metal: cold grey with subtle oxidation streaks */
function ironCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#2a2a2c'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 18; i++) {
    g.strokeStyle = rng.next() > 0.5 ? 'rgba(80,82,88,0.3)' : 'rgba(16,14,12,0.35)'
    g.lineWidth = 0.8 + rng.next()
    const x = rng.next() * 64
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x + (rng.next() - 0.5) * 6, 64)
    g.stroke()
  }
  for (let i = 0; i < 24; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(120,118,110,0.14)' : 'rgba(10,8,6,0.18)'
    g.fillRect(rng.next() * 64, rng.next() * 64, 1.5, 1.5)
  }
  return c
}

/** painted sign atlas for the new acts — four signs stacked:
 *  COFFEE (0,0)-(256,64): warm-board + coffee ring + copper letters
 *  MAYPOLE flag stripe (0,64)-(256,128): broad red/white/blue vertical bars
 *  MILLBROOK STATION clock face (0,128)-(256,192): cream disc, numerals, hands
 *  sleeper wood (0,192)-(256,256): dark timber cross-grain, bolt heads */
function signAtlasCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 256)

  // -- COFFEE sign (0,0)-(256,64) --------------------------------------------------
  g.fillStyle = '#4a3018'
  g.fillRect(0, 0, 256, 64)
  for (let i = 0; i < 20; i++) {
    const y = rng.next() * 64
    g.strokeStyle = 'rgba(86,60,28,0.5)'
    g.lineWidth = 0.8 + rng.next()
    g.beginPath()
    g.moveTo(0, y)
    g.quadraticCurveTo(128, y + (rng.next() - 0.5) * 6, 256, y)
    g.stroke()
  }
  g.strokeStyle = '#c8a46a'
  g.lineWidth = 4
  g.strokeRect(3, 3, 250, 58)
  // copper-coloured steam curl above the cup
  g.strokeStyle = '#b07830'
  g.lineWidth = 2.5
  g.beginPath()
  g.moveTo(94, 28)
  g.quadraticCurveTo(88, 16, 98, 10)
  g.stroke()
  g.beginPath()
  g.moveTo(106, 26)
  g.quadraticCurveTo(100, 14, 110, 8)
  g.stroke()
  // tiny cup silhouette
  g.fillStyle = '#c8a46a'
  g.fillRect(86, 30, 28, 16)
  g.fillRect(82, 44, 36, 4)
  g.fillStyle = '#4a3018'
  const cof = g.createRadialGradient(100, 38, 2, 100, 38, 12)
  cof.addColorStop(0, '#2a1a08')
  cof.addColorStop(1, '#7a4e22')
  g.fillStyle = cof
  g.fillRect(88, 32, 24, 12)
  g.fillStyle = '#d4b080'
  g.font = '800 28px Trebuchet MS, sans-serif'
  g.textAlign = 'center'
  g.fillText('COFFEE', 168, 44)

  // -- maypole stripe band (0,64)-(256,128): vertical bars red/white/blue/white/red
  const barW = 256 / 5
  const barColors = ['#c84444', '#f4efe6', '#3a5fa8', '#f4efe6', '#c84444']
  for (let i = 0; i < 5; i++) {
    g.fillStyle = barColors[i]
    g.fillRect(i * barW, 64, barW, 64)
  }
  // horizontal weave lines
  g.fillStyle = 'rgba(0,0,0,0.045)'
  for (let y = 64; y < 128; y += 5) g.fillRect(0, y, 256, 1)
  for (let i = 0; i < 60; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(20,10,10,0.05)'
    g.fillRect(rng.next() * 256, 64 + rng.next() * 64, 2, 2)
  }

  // -- clock face (0,128)-(256,192): cream disc on slate ---
  g.fillStyle = '#4a5058'
  g.fillRect(0, 128, 256, 64)
  g.fillStyle = '#f0ead8'
  g.beginPath()
  g.arc(128, 160, 26, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = '#2c2a24'
  g.lineWidth = 2.5
  g.stroke()
  g.fillStyle = '#2c2a24'
  g.font = 'bold 10px Trebuchet MS, sans-serif'
  g.textAlign = 'center'
  g.fillText('12', 128, 140)
  g.fillText('3', 153, 163)
  g.fillText('6', 128, 184)
  g.fillText('9', 103, 163)
  // clock hands: hour (10:10 pose) + minute
  g.strokeStyle = '#1a1816'
  g.lineWidth = 2.5
  g.beginPath()
  g.moveTo(128, 160)
  g.lineTo(128 + Math.cos(-Math.PI * 0.5 + Math.PI * 2 * (10 / 12)) * 14,
           160 + Math.sin(-Math.PI * 0.5 + Math.PI * 2 * (10 / 12)) * 14)
  g.stroke()
  g.lineWidth = 1.8
  g.beginPath()
  g.moveTo(128, 160)
  g.lineTo(128 + Math.cos(-Math.PI * 0.5 + Math.PI * 2 * (2 / 60)) * 20,
           160 + Math.sin(-Math.PI * 0.5 + Math.PI * 2 * (2 / 60)) * 20)
  g.stroke()
  g.fillStyle = '#c8392b'
  g.beginPath()
  g.arc(128, 160, 2, 0, Math.PI * 2)
  g.fill()

  // -- sleeper wood (0,192)-(256,256): dark oak cross-grain ---
  g.fillStyle = '#3a2a18'
  g.fillRect(0, 192, 256, 64)
  for (let i = 0; i < 22; i++) {
    const x = rng.next() * 256
    const y = 192 + rng.next() * 64
    g.strokeStyle = rng.next() > 0.5 ? 'rgba(76,54,28,0.5)' : 'rgba(18,10,4,0.4)'
    g.lineWidth = 0.8 + rng.next()
    g.beginPath()
    g.moveTo(0, y)
    g.quadraticCurveTo(x, y + (rng.next() - 0.5) * 5, 256, y + (rng.next() - 0.5) * 3)
    g.stroke()
  }
  // bolt heads at rail-fastening spots
  for (const bx of [20, 120, 220]) {
    g.fillStyle = '#5a5248'
    g.beginPath()
    g.arc(bx, 224, 4, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = 'rgba(255,240,200,0.2)'
    g.beginPath()
    g.arc(bx - 1, 223, 1.5, 0, Math.PI * 2)
    g.fill()
  }
  return c
}

// ---- skinned-rig helpers --------------------------------------------------------

/** suffix-matched clip lookup — same matcher as Customer.ts */
function act(mixer: AnimationMixer, root: Group, clips: AnimationClip[], name: string): AnimationAction | null {
  const clip = clips.find((c) => c.name.toLowerCase() === name || c.name.toLowerCase().endsWith(`|${name}`))
  return clip ? mixer.clipAction(clip, root) : null
}

/** lerp the outfit toward a tint (skin/hair/eyes stay theirs); collect every
 * standard material so the bus passengers can fade out alloc-free later.
 * spawnSkinned() already clones materials per rig, so the lerp is safe. */
function tintRig(model: Group, tint: Color, k: number, mats: MeshStandardMaterial[]): void {
  model.traverse((o) => {
    if (!(o instanceof Mesh)) return
    const list = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of list) {
      if (!(m instanceof MeshStandardMaterial)) continue
      mats.push(m)
      const n = m.name.toLowerCase()
      if (n === 'eye' || n.startsWith('skin') || n === 'hair' || n === 'eyebrows' || n === 'moustache') continue
      m.color.lerp(tint, k)
    }
  })
}

/** one townsperson: rig + 2Hz mixer + a tiny number-only wander machine */
interface Walker {
  group: Group
  mixer: AnimationMixer | null
  idle: AnimationAction | null
  walk: AnimationAction | null
  current: AnimationAction | null
  mats: MeshStandardMaterial[]
  /** banked animation time — mixers tick at 2Hz with summed dt (Sheep.ts) */
  accum: number
  /** wander/pax state: 0 idle|dormant, 1 walking|door-pause, 2.. pax phases */
  mode: number
  timer: number
  tx: number
  tz: number
  heading: number
  speed: number
  height: number
  fadeK: number
}

interface Puff {
  mesh: Mesh
  mat: MeshBasicMaterial
  t: number
  speed: number
  sway: number
  driftX: number
  driftZ: number
}

/** passenger phases (Walker.mode while aboard the bus run) */
const PAX_DORMANT = 0
const PAX_DOOR = 1
const PAX_WALK = 2
const PAX_FADING = 3
const PAX_DONE = 4

// ---- the town -------------------------------------------------------------------

export class TownSet {
  private readonly assets: Assets
  private readonly root = new Group()
  private readonly stages: Record<ActId, Group>
  private readonly shown = new Set<ActId>()
  /** runtime stream for wander timers/targets — derived from the town seed */
  private readonly rng: Rng

  // shared materials (textures painted once, reused across acts)
  private readonly woodMat: MeshStandardMaterial
  /** cold rail/canopy metal — shared by the station AND the train */
  private readonly ironMat: MeshStandardMaterial
  private readonly whiteMat: MeshStandardMaterial
  private readonly brickMat: MeshStandardMaterial
  private readonly stripeMat: MeshStandardMaterial
  private readonly paintedMat: MeshStandardMaterial
  private readonly glowMat: MeshBasicMaterial

  // the bus + its riders
  private readonly bus: Group
  private readonly pax: Walker[] = []
  private busActive = false
  private busParked = false

  // the train (station act)
  private trainGroup: Group | null = null
  private trainActive = false

  // schoolyard + mill crews (lazy-spawned)
  private readonly kids: Walker[] = []
  private readonly workers: Walker[] = []
  private readonly kidsGroup: Group
  private readonly workersGroup: Group
  private recessOn = false
  private shiftOn = false

  // always-on ambient strollers (bakery/cottages road shoulder)
  private readonly strollers: Walker[] = []
  private readonly strollersGroup: Group
  private strollersOn = false

  // mill smoke (the homestead supper-smoke pattern)
  private readonly smoke: Group
  private readonly puffs: Puff[] = []
  private smokeTime = 0

  constructor(scene: Scene, assets: Assets) {
    this.assets = assets
    const rng = mulberry32(0x70b11)

    this.woodMat = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#6f5234'), true), roughness: 0.95 })
    this.ironMat = new MeshStandardMaterial({ map: toTexture(ironCanvas(rng)), roughness: 0.6, metalness: 0.35 })
    this.whiteMat = new MeshStandardMaterial({ map: toTexture(whitePaintCanvas(rng), true), roughness: 0.6 })
    this.brickMat = new MeshStandardMaterial({ map: toTexture(brickCanvas(rng), true), roughness: 0.92 })
    this.stripeMat = new MeshStandardMaterial({ map: toTexture(stripesCanvas(rng)), roughness: 0.9, side: DoubleSide })
    this.paintedMat = new MeshStandardMaterial({ map: toTexture(paintedAtlasCanvas(rng)), roughness: 0.85 })
    this.glowMat = new MeshBasicMaterial({ map: toTexture(glowAtlasCanvas(rng)), alphaTest: 0.3, side: DoubleSide })

    this.stages = {
      bakery: this.buildBakeryStage(rng),
      cottages: this.buildCottagesStage(rng),
      school: this.buildSchoolStage(rng),
      works: this.buildWorksStage(rng),
      cafe: this.buildCafeStage(rng),
      square: this.buildSquareStage(rng),
      station: this.buildStationStage(rng),
    }
    for (const id of ACTS) {
      this.stages[id].visible = false
      this.root.add(this.stages[id])
    }

    // crews live inside their act's stage so reveal/visibility gates them too
    this.kidsGroup = new Group()
    this.kidsGroup.visible = false
    this.stages.school.add(this.kidsGroup)
    this.workersGroup = new Group()
    this.workersGroup.visible = false
    this.stages.works.add(this.workersGroup)

    // strollers live directly on root so they walk regardless of act visibility
    this.strollersGroup = new Group()
    this.strollersGroup.visible = false
    this.root.add(this.strollersGroup)

    // mill smoke: four looping puffs staggered up the wisp (homestead recipe)
    this.smoke = new Group()
    this.smoke.position.set(SMOKE_AT[0], SMOKE_AT[1], SMOKE_AT[2])
    this.smoke.visible = false
    for (let i = 0; i < 4; i++) {
      const mat = new MeshBasicMaterial({ color: '#9c968e', transparent: true, opacity: 0, depthWrite: false })
      const mesh = new Mesh(new SphereGeometry(0.11 + i * 0.016, 8, 6), mat)
      this.smoke.add(mesh)
      this.puffs.push({
        mesh,
        mat,
        t: (i + rng.next() * 0.6) / 4,
        speed: 1 / (3.0 + rng.next() * 1.0),
        sway: rng.next() * Math.PI * 2,
        driftX: (rng.next() - 0.5) * 0.7,
        driftZ: (rng.next() - 0.5) * 0.4,
      })
    }
    this.stages.works.add(this.smoke)

    this.bus = this.buildBus(rng)
    this.bus.visible = false
    this.bus.position.set(50, 0, BUS_Z)
    this.bus.rotation.y = Math.PI
    this.root.add(this.bus)

    // train lives on root so it slides independently of the station stage
    const train = this.buildTrain(rng)
    train.visible = false
    train.position.set(TRAIN_PARK_X, 0, TRAIN_Z)
    this.root.add(train)
    this.trainGroup = train

    // runtime rolls (wander timers, targets) — derived from the same seed
    this.rng = mulberry32(Math.floor(rng.next() * 0xffffffff))
    scene.add(this.root)
  }

  // ---- public API ----------------------------------------------------------------

  /** show an act's buildings — back.out pop for live builds, instant for
   * boot restore. Idempotent: repeat calls (any pop flag) are no-ops. */
  reveal(id: ActId, pop: boolean): void {
    if (this.shown.has(id)) return
    this.shown.add(id)
    const g = this.stages[id]
    g.visible = true
    if (!pop) return
    gsap.killTweensOf(g.scale)
    g.scale.set(0.6, 0.01, 0.6)
    gsap.to(g.scale, { x: 1, y: 1, z: 1, duration: 0.7, ease: 'back.out(1.4)' })
  }

  /** the morning bus: in from offstage east, ease to a stop at Rosie's, two
   * riders step down and walk west to the town gate (becoming the day's
   * customers), then the bus loops around and parks offstage. ~21s, gsap on
   * the bus + update() on the riders; self-cleaning; no-op while running. */
  busRun(): void {
    if (this.busActive) return
    this.busActive = true
    this.busParked = false
    this.ensurePax()
    const bus = this.bus
    bus.visible = true
    bus.position.set(50, 0, BUS_Z)
    bus.rotation.y = Math.PI // nose west
    gsap.killTweensOf(bus.position)
    gsap.killTweensOf(bus.rotation)
    const tl = gsap.timeline({
      onComplete: () => {
        this.busParked = true
        bus.visible = false
      },
    })
    tl.to(bus.position, { x: BUS_STOP_X, duration: 5.5, ease: 'power2.out' })
    tl.call(() => this.deployPax())
    // ~4s of doors-open dwell while the riders step down, then a little
    // loop-around (nose swings through south) and away east, parking offstage
    tl.to(bus.rotation, { y: Math.PI * 2, duration: 2.4, ease: 'power1.inOut' }, '+=4')
    tl.to(bus.position, { x: BUS_STOP_X + 2.6, z: ROAD_Z + 1.7, duration: 2.4, ease: 'power1.inOut' }, '<')
    tl.to(bus.position, { x: 50, z: BUS_Z + 0.2, duration: 7.5, ease: 'power1.in' })
  }

  /** the afternoon train: slides in from offstage east, eases to a stop at
   * the station platform, dwells while travellers (static) stand, then eases
   * back out east and parks offstage. ~16s, mirrors busRun() exactly.
   * Idempotent — no-op while already running. */
  trainRun(): void {
    if (this.trainActive || !this.trainGroup) return
    this.trainActive = true
    const train = this.trainGroup
    train.visible = true
    train.position.set(TRAIN_PARK_X, 0, TRAIN_Z)
    gsap.killTweensOf(train.position)
    const tl = gsap.timeline({
      onComplete: () => {
        train.visible = false
        this.trainActive = false
      },
    })
    // roll in from the east (high X → low stop X), ease to rest at the platform
    tl.to(train.position, { x: TRAIN_STOP_X, duration: 5.0, ease: 'power2.out' })
    // dwell at the platform — static travellers on the platform stand witness
    tl.to(train.position, { x: TRAIN_STOP_X, duration: 4.5, ease: 'none' })
    // ease out east and park offstage
    tl.to(train.position, { x: TRAIN_PARK_X, duration: 6.5, ease: 'power1.in' })
  }

  /** kids out in the schoolyard (three of them, wandering on seeded timers) */
  setRecess(on: boolean): void {
    if (on === this.recessOn) return
    this.recessOn = on
    if (on && this.kids.length === 0) this.ensureKids()
    this.kidsGroup.visible = on
  }

  /** the works on shift: mill chimney smokes, two workers idle the yard */
  setShift(on: boolean): void {
    if (on === this.shiftOn) return
    this.shiftOn = on
    if (on && this.workers.length === 0) this.ensureWorkers()
    this.workersGroup.visible = on
    this.smoke.visible = on
    if (!on) for (const p of this.puffs) p.mat.opacity = 0
  }

  /** ambient strollers on the south road shoulder (bakery + cottages frontage);
   * idempotent — call setStrollers(true) once the cottages act is built */
  setStrollers(on: boolean): void {
    if (on === this.strollersOn) return
    this.strollersOn = on
    if (on && this.strollers.length === 0) this.ensureStrollers()
    this.strollersGroup.visible = on
  }

  /** zero-alloc per-frame tick: riders walk, kids/workers wander, smoke
   * curls; every mixer banks dt and ticks at 2Hz (the rigs are 25u+ out) */
  update(dt: number): void {
    if (this.busActive) this.updateBusRun(dt)
    if (this.recessOn && this.stages.school.visible) {
      for (let i = 0; i < this.kids.length; i++) {
        const k = this.kids[i]
        this.wander(k, dt, KID_X0, KID_X1, KID_Z0, KID_Z1, 1.5, 3.5)
        this.tickMixer(k, dt)
      }
    }
    if (this.shiftOn && this.stages.works.visible) {
      for (let i = 0; i < this.workers.length; i++) {
        const w = this.workers[i]
        this.wander(w, dt, WORKER_X0, WORKER_X1, WORKER_Z0, WORKER_Z1, 4.5, 5.5)
        this.tickMixer(w, dt)
      }
      this.updateSmoke(dt)
    }
    if (this.strollersOn) {
      for (let i = 0; i < this.strollers.length; i++) {
        const s = this.strollers[i]
        this.wander(s, dt, STROLLER_X0, STROLLER_X1, STROLLER_Z0, STROLLER_Z1, 3.5, 5.0)
        this.tickMixer(s, dt)
      }
    }
  }

  // ---- bus riders ------------------------------------------------------------------

  private ensurePax(): void {
    if (this.pax.length) return
    const looks: Array<[ModelKey, number, string]> = [
      ['customerA', 1.48, '#7e8fb8'],
      ['customerB', 1.53, '#b88a5e'],
    ]
    for (const [key, h, tint] of looks) {
      const w = this.makeWalker(key, h, tint, 0.18, this.root)
      w.group.visible = false
      this.pax.push(w)
    }
  }

  private deployPax(): void {
    for (let i = 0; i < this.pax.length; i++) {
      const p = this.pax[i]
      // restore from any previous day's fade, step out the curb-side door
      for (let m = 0; m < p.mats.length; m++) {
        p.mats[m].transparent = false
        p.mats[m].opacity = 1
      }
      p.group.visible = true
      p.group.position.set(26.35 + i * 0.55, 0, 10.5 + i * 0.35)
      p.heading = p.group.rotation.y = -Math.PI / 2 // facing west, toward the farm
      p.tx = PAX_GONE_X - 0.1
      p.tz = 10.7 + i * 0.35
      p.mode = PAX_DOOR
      p.timer = 0.5 + i * 0.9
      p.fadeK = 1
      this.playClip(p, p.idle, 1)
    }
  }

  private updateBusRun(dt: number): void {
    let busy = false
    for (let i = 0; i < this.pax.length; i++) {
      const p = this.pax[i]
      if (p.mode === PAX_DOOR) {
        busy = true
        p.timer -= dt
        if (p.timer <= 0) p.mode = PAX_WALK
      } else if (p.mode === PAX_WALK || p.mode === PAX_FADING) {
        busy = true
        const arrived = this.stepTo(p, dt)
        if (p.mode === PAX_WALK && p.group.position.x < PAX_FADE_X) {
          p.mode = PAX_FADING
          for (let m = 0; m < p.mats.length; m++) p.mats[m].transparent = true
        }
        if (p.mode === PAX_FADING) {
          p.fadeK -= dt / 0.8
          const k = p.fadeK > 0 ? p.fadeK : 0
          for (let m = 0; m < p.mats.length; m++) p.mats[m].opacity = k
          if (k === 0 || arrived) {
            p.mode = PAX_DONE
            p.group.visible = false
          }
        } else if (arrived) {
          p.mode = PAX_DONE
          p.group.visible = false
        }
      }
      if (p.mode !== PAX_DORMANT && p.mode !== PAX_DONE) this.tickMixer(p, dt)
    }
    // self-clean: the run ends once the bus parked and both riders are gone
    if (this.busParked && !busy) {
      this.busActive = false
      for (let i = 0; i < this.pax.length; i++) this.pax[i].mode = PAX_DORMANT
    }
  }

  // ---- crews -----------------------------------------------------------------------

  private ensureKids(): void {
    const tints = ['#e09a52', '#cf6d5a', '#d8b766']
    for (let i = 0; i < 3; i++) {
      // small folk: 0.92..1.04, each lerped ~0.22 toward its own warm tint
      const h = 0.92 + this.rng.next() * 0.12
      const k = this.makeWalker('customerC', h, tints[i], 0.22, this.kidsGroup)
      k.speed = 0.9 + this.rng.next() * 0.3
      k.group.position.set(
        KID_X0 + this.rng.next() * (KID_X1 - KID_X0),
        0,
        KID_Z0 + this.rng.next() * (KID_Z1 - KID_Z0),
      )
      k.heading = k.group.rotation.y = this.rng.next() * Math.PI * 2
      k.timer = this.rng.next() * 2
      this.playClip(k, k.idle, 1)
      this.kids.push(k)
    }
  }

  private ensureWorkers(): void {
    const tints = ['#5d6b8a', '#8a6f46']
    for (let i = 0; i < 2; i++) {
      const w = this.makeWalker('customerB', 1.5 + i * 0.03, tints[i], 0.25, this.workersGroup)
      w.speed = 1.05
      w.group.position.set(WORKER_X0 + 0.6 + i * 2.2, 0, WORKER_Z0 + 0.4 + i * 0.5)
      w.heading = w.group.rotation.y = this.rng.next() * Math.PI * 2
      w.timer = 1 + this.rng.next() * 4
      this.playClip(w, w.idle, 1)
      this.workers.push(w)
    }
  }

  private ensureStrollers(): void {
    // slightly different shirt tones from the existing palette — soft slate and warm tan
    const tints = ['#7a8fa6', '#c49a6c']
    for (let i = 0; i < 2; i++) {
      const s = this.makeWalker('customerA', 1.52 + i * 0.04, tints[i], 0.22, this.strollersGroup)
      s.speed = 0.9 // calm walk — these are leisure strollers, not mill workers
      s.group.position.set(STROLLER_X0 + 2.0 + i * 4.5, 0, STROLLER_Z0 + this.rng.next() * (STROLLER_Z1 - STROLLER_Z0))
      s.heading = s.group.rotation.y = this.rng.next() * Math.PI * 2
      s.timer = 2 + this.rng.next() * 4
      this.playClip(s, s.idle, 1)
      this.strollers.push(s)
    }
  }

  private makeWalker(key: ModelKey, height: number, tint: string, tintK: number, parent: Group): Walker {
    let model: Group
    let mixer: AnimationMixer | null = null
    let idle: AnimationAction | null = null
    let walk: AnimationAction | null = null
    const mats: MeshStandardMaterial[] = []
    try {
      model = this.assets.spawnSkinned(key)
      const clips = this.assets.clips(key)
      mixer = new AnimationMixer(model)
      idle = act(mixer, model, clips, 'idle')
      walk = act(mixer, model, clips, 'walk')
      normalizeHeight(model, height)
      tintRig(model, new Color(tint), tintK, mats)
      if (idle) {
        idle.play()
        // de-sync clones so the schoolyard never sways in lockstep
        idle.time = this.rng.next() * idle.getClip().duration
      }
    } catch {
      model = new Group()
    }
    const group = new Group()
    group.add(model)
    parent.add(group)
    return {
      group,
      mixer,
      idle,
      walk,
      current: idle,
      mats,
      accum: this.rng.next() * 0.5,
      mode: 0,
      timer: 0,
      tx: 0,
      tz: 0,
      heading: 0,
      speed: 1.5,
      height,
      fadeK: 1,
    }
  }

  /** foot-lock: clip ground coverage scales with body height (Customer.ts) */
  private walkScale(w: Walker): number {
    const ref = WALK_REF * (w.height / 1.6)
    return Math.min(1.8, Math.max(0.5, w.speed / ref))
  }

  private playClip(w: Walker, next: AnimationAction | null, timeScale: number): void {
    if (!next) return
    next.timeScale = timeScale
    if (next === w.current) return
    next.reset().play()
    if (w.current) w.current.crossFadeTo(next, FADE, false)
    w.current = next
  }

  /** step toward (tx,tz) with a damped heading turn; true when arrived */
  private stepTo(w: Walker, dt: number): boolean {
    const dx = w.tx - w.group.position.x
    const dz = w.tz - w.group.position.z
    const d = Math.hypot(dx, dz)
    if (d < 0.1) return true
    this.playClip(w, w.walk, this.walkScale(w))
    const step = Math.min(d, w.speed * dt)
    w.group.position.x += (dx / d) * step
    w.group.position.z += (dz / d) * step
    let turn = Math.atan2(dx, dz) - w.heading
    while (turn > Math.PI) turn -= Math.PI * 2
    while (turn < -Math.PI) turn += Math.PI * 2
    w.heading += turn * Math.min(1, TURN_RATE * dt)
    w.group.rotation.y = w.heading
    return false
  }

  /** idle-then-stroll inside a rect on seeded timers (numbers only, no alloc) */
  private wander(
    w: Walker,
    dt: number,
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    idleMin: number,
    idleVar: number,
  ): void {
    if (w.mode === 0) {
      this.playClip(w, w.idle, 1)
      w.timer -= dt
      if (w.timer <= 0) {
        w.tx = x0 + this.rng.next() * (x1 - x0)
        w.tz = z0 + this.rng.next() * (z1 - z0)
        w.mode = 1
      }
    } else if (this.stepTo(w, dt)) {
      w.mode = 0
      w.timer = idleMin + this.rng.next() * idleVar
    }
  }

  /** distant rigs animate at 2Hz with SUMMED time (no pose drift) — Sheep.ts */
  private tickMixer(w: Walker, dt: number): void {
    if (!w.mixer) return
    w.accum += dt
    if (w.accum < 0.5) return
    w.mixer.update(w.accum)
    w.accum = 0
  }

  private updateSmoke(dt: number): void {
    this.smokeTime += dt
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i]
      p.t += dt * p.speed
      if (p.t >= 1) p.t -= 1
      const t = p.t
      p.mesh.position.set(
        p.driftX * t + Math.sin(this.smokeTime * 1.6 + p.sway) * 0.07 * t,
        t * 2.1,
        p.driftZ * t,
      )
      p.mesh.scale.setScalar(0.6 + 1.9 * t)
      p.mat.opacity = 0.4 * (1 - t) * Math.min(1, t * 6)
    }
  }

  // ---- act builders -----------------------------------------------------------------
  // Each act is one Group pivoted at its block center; every material in the
  // act fuses to ONE mesh offset by -pivot, so the reveal pop grows the whole
  // block out of its own ground. All lot coords below are WORLD coords.

  private addFused(
    stage: Group,
    px: number,
    pz: number,
    geos: BufferGeometry[],
    mat: MeshStandardMaterial | MeshBasicMaterial,
    cast = true,
  ): void {
    if (!geos.length) return
    const m = fuse(geos, mat, cast)
    if (!m) return
    m.position.set(-px, 0, -pz)
    stage.add(m)
  }

  /** ROSIE'S at [27.5, 8.6] facing the road (+z), the bus stop at [25.0, 9.4],
   * plus the always-on road dressing: 3 lamp posts + a drystone fragment.
   * 7 draws: plaster, roof, wood, brick, awning, painted atlas, glow atlas. */
  private buildBakeryStage(rng: Rng): Group {
    const stage = new Group()
    const [px, pz] = P_BAKERY
    stage.position.set(px, 0, pz)
    const plasterMat = new MeshStandardMaterial({ map: toTexture(plasterCanvas(rng), true), roughness: 0.9 })
    const roofMat = new MeshStandardMaterial({
      map: toTexture(shingleCanvas(rng, ['#7a4a33', '#86553c', '#6e412c', '#925f44']), true),
      roughness: 0.95,
    })

    const plaster: BufferGeometry[] = []
    const roof: BufferGeometry[] = []
    const wood: BufferGeometry[] = []
    const brick: BufferGeometry[] = []
    const stripe: BufferGeometry[] = []
    const painted: BufferGeometry[] = []
    const glow: BufferGeometry[] = []

    // -- the bakery shell (local frame, front +z) ---------------------------------
    {
      const W = 5.0
      const D = 4.2
      const WALL = 2.4
      const RISE = 1.0
      const hz = D / 2
      const b: BufferGeometry[] = []
      b.push(uvScale(box(W, WALL, D, 0, WALL / 2, 0), W / TILE, WALL / TILE))
      const gable = gablePrism(W, RISE, D)
      gable.translate(0, WALL, 0)
      b.push(uvScale(gable, W / TILE, RISE / TILE))
      plaster.push(...moveGeos(b, 27.5, 8.6))

      const r: BufferGeometry[] = []
      const slope = Math.hypot(W / 2, RISE)
      const pitch = Math.atan2(RISE, W / 2)
      for (const s of [-1, 1]) {
        const slab = new BoxGeometry(slope + 0.4, 0.09, D + 0.5)
        uvTranspose(slab)
        uvScale(slab, (D + 0.5) / 1.2, (slope + 0.4) / 1.2)
        slab.rotateZ(-s * pitch)
        slab.translate((s * W) / 4, WALL + RISE / 2 + 0.03, 0)
        r.push(slab)
      }
      r.push(uvScale(box(0.16, 0.1, D + 0.5, 0, WALL + RISE + 0.02, 0), 1, 3))
      roof.push(...moveGeos(r, 27.5, 8.6))

      // warm brick chimney riding the east slope
      const ch: BufferGeometry[] = []
      ch.push(uvScale(box(0.46, 2.0, 0.46, 1.6, 3.05, -0.9), 0.6, 2.5))
      ch.push(uvScale(box(0.58, 0.12, 0.58, 1.6, 4.11, -0.9), 0.7, 0.16))
      brick.push(...moveGeos(ch, 27.5, 8.6))

      // trim: door (west bay), shopfront window + deep sill, awning + sign ironmongery
      const t: BufferGeometry[] = []
      t.push(uvScale(box(0.95, 1.9, 0.07, -1.7, 0.95, hz + 0.02), 0.8, 1.5))
      for (const by of [0.5, 1.4]) t.push(box(0.85, 0.09, 0.04, -1.7, by, hz + 0.06))
      for (const sx of [-1, 1]) t.push(box(0.1, 2.0, 0.09, -1.7 + sx * 0.52, 1.0, hz + 0.02))
      t.push(box(1.14, 0.1, 0.09, -1.7, 2.0, hz + 0.02))
      // window: 1.6 x 0.9 centered (0.55, 1.5)
      t.push(box(1.78, 0.09, 0.08, 0.55, 1.99, hz + 0.04))
      t.push(box(1.78, 0.11, 0.12, 0.55, 1.01, hz + 0.05))
      for (const sx of [-1, 1]) t.push(box(0.09, 0.95, 0.08, 0.55 + sx * 0.84, 1.5, hz + 0.04))
      t.push(box(0.05, 0.95, 0.05, 0.55, 1.5, hz + 0.03))
      // the bread sill, proud of the wall under the glass
      t.push(uvScale(box(1.7, 0.07, 0.36, 0.55, 0.97, hz + 0.18), 1.4, 1))
      for (const bx of [-0.1, 1.2]) {
        const bracket = new BoxGeometry(0.05, 0.3, 0.05)
        bracket.rotateX(-0.6)
        bracket.translate(bx, 0.84, hz + 0.1)
        t.push(bracket)
      }
      // hanging-sign bracket just under the eave + drop links
      t.push(box(0.05, 0.05, 0.85, -1.7, 2.32, hz + 0.4))
      for (const sx of [-1, 1]) t.push(box(0.025, 0.14, 0.025, -1.7 + sx * 0.3, 2.23, hz + 0.72))
      wood.push(...moveGeos(t, 27.5, 8.6))

      // striped awning over the shopfront (Rosie band of the stripe atlas)
      const aw: BufferGeometry[] = []
      const aTop = pitchPlane(3.1, 0.55, 0.6, 2.32, hz + 0.02)
      aTop.translate(0.55, 0, 0)
      aw.push(uvRegion(aTop, 0, 0, 256, 64, 256, 192))
      const valance = new PlaneGeometry(3.1, 0.18)
      valance.translate(0.55, 1.93, hz + 0.475)
      aw.push(uvRegion(valance, 0, 6, 256, 40, 256, 192))
      stripe.push(...moveGeos(aw, 27.5, 8.6))

      // the ROSIE'S board swinging under its bracket
      const p: BufferGeometry[] = []
      p.push(uvRegion(box(0.92, 0.42, 0.05, -1.7, 1.96, hz + 0.72), 0, 0, 160, 64, 256, 256))
      // two loaves cooling on the sill (squashed spheres in crust)
      for (const bx of [0.2, 0.82]) {
        const loaf = new SphereGeometry(0.15, 9, 7)
        loaf.scale(1.25, 0.6, 0.85)
        loaf.translate(bx, 1.1, hz + 0.18)
        p.push(uvRegion(loaf, 0, 72, 96, 160, 256, 256))
      }
      painted.push(...moveGeos(p, 27.5, 8.6))

      // lamplit windows: the shopfront glass + a small gable-room window
      const gl: BufferGeometry[] = []
      const front = new PlaneGeometry(1.56, 0.86)
      front.translate(0.55, 1.5, hz + 0.025)
      gl.push(uvRegion(front, 0, 0, 96, 120, 256, 256))
      const attic = new PlaneGeometry(0.5, 0.6)
      attic.translate(0, 2.85, hz + 0.02)
      gl.push(uvRegion(attic, 0, 0, 96, 120, 256, 256))
      glow.push(...moveGeos(gl, 27.5, 8.6))
    }

    // -- the bus stop beside it at [25.0, 9.4] --------------------------------------
    {
      const t: BufferGeometry[] = []
      // bench: legs, two seat planks, a tilted back plank
      for (const sx of [-0.5, 0.5]) for (const sz of [-0.1, 0.12]) t.push(box(0.06, 0.42, 0.06, sx, 0.21, sz))
      for (const sz of [-0.1, 0.1]) t.push(uvScale(box(1.2, 0.05, 0.17, 0, 0.44, sz), 1.3, 0.3))
      const back = new BoxGeometry(1.2, 0.3, 0.04)
      back.rotateX(-0.16)
      back.translate(0, 0.72, -0.17)
      t.push(uvScale(back, 1.3, 0.4))
      // the sign pole
      const pole = new CylinderGeometry(0.035, 0.05, 2.0, 8)
      pole.translate(-0.95, 1.0, 0.1)
      t.push(uvScale(pole, 1, 1.5))
      wood.push(...moveGeos(t, 25.0, 9.4))
      // painted MILLBROOK bus plate atop the pole
      const p: BufferGeometry[] = []
      p.push(uvRegion(box(0.52, 0.34, 0.04, -0.95, 1.85, 0.12), 160, 0, 256, 64, 256, 256))
      painted.push(...moveGeos(p, 25.0, 9.4))
    }

    // -- road dressing (lives with the first act): lamps + a drystone run -----------
    for (const [lx, lz] of [
      [26.2, 12.8],
      [32.5, 9.1],
      [38.8, 12.8],
    ]) {
      const post = new CylinderGeometry(0.05, 0.065, 2.5, 8)
      post.translate(lx, 1.25, lz)
      wood.push(uvScale(post, 1, 1.8))
      const head = box(0.2, 0.22, 0.2, lx, 2.62, lz)
      glow.push(uvRegion(head, 96, 0, 160, 64, 256, 256))
      wood.push(box(0.26, 0.05, 0.26, lx, 2.76, lz))
    }
    painted.push(uvRegion(box(2.5, 0.46, 0.34, 30.6, 0.23, 9.9), 96, 64, 256, 160, 256, 256))
    painted.push(uvRegion(box(1.1, 0.36, 0.3, 32.5, 0.18, 9.95), 96, 64, 256, 160, 256, 256))

    this.addFused(stage, px, pz, plaster, plasterMat)
    this.addFused(stage, px, pz, roof, roofMat)
    this.addFused(stage, px, pz, wood, this.woodMat)
    this.addFused(stage, px, pz, brick, this.brickMat)
    this.addFused(stage, px, pz, stripe, this.stripeMat)
    this.addFused(stage, px, pz, painted, this.paintedMat)
    this.addFused(stage, px, pz, glow, this.glowMat, false)
    return stage
  }

  /** two snug cottages at [33.0, 8.4] and [36.2, 8.6] (yaws +0.1 / -0.1),
   * warm-cream and pale-sage, roof tones split across ONE duo canvas.
   * 5 draws: cream walls, sage walls, roofs, wood, glow. */
  private buildCottagesStage(rng: Rng): Group {
    const stage = new Group()
    const [px, pz] = P_COTTAGES
    stage.position.set(px, 0, pz)
    const creamMat = new MeshStandardMaterial({
      map: toTexture(clapboardCanvas(rng, '#ece1c4', 'rgba(176,156,116,0.20)'), true),
      roughness: 0.85,
    })
    const sageMat = new MeshStandardMaterial({
      map: toTexture(clapboardCanvas(rng, '#ccd6ba', 'rgba(128,142,106,0.22)'), true),
      roughness: 0.85,
    })
    // both roofs on one canvas: warm-brown rows up top, slate-green rows below
    const duo = makeCanvas(256, 512)
    duo.g.drawImage(shingleCanvas(rng, ['#6d5034', '#7a5c3c', '#64482e', '#836543']), 0, 0)
    duo.g.drawImage(shingleCanvas(rng, ['#5a665c', '#66736a', '#4f5a52', '#727f74']), 0, 256)
    const roofMat = new MeshStandardMaterial({ map: toTexture(duo.c), roughness: 0.95 })

    const cream: BufferGeometry[] = []
    const sage: BufferGeometry[] = []
    const roofs: BufferGeometry[] = []
    const wood: BufferGeometry[] = []
    const glow: BufferGeometry[] = []

    const lots: Array<{ x: number; z: number; yaw: number; flip: number; walls: BufferGeometry[]; ry0: number }> = [
      { x: 33.0, z: 8.4, yaw: 0.1, flip: 1, walls: cream, ry0: 0 },
      { x: 36.2, z: 8.6, yaw: -0.1, flip: -1, walls: sage, ry0: 256 },
    ]
    const W = 3.6
    const D = 3.2
    const WALL = 2.0
    const RISE = 0.9
    const hz = D / 2
    const slope = Math.hypot(W / 2, RISE)
    const pitch = Math.atan2(RISE, W / 2)
    for (const lot of lots) {
      const f = lot.flip
      const b: BufferGeometry[] = []
      b.push(uvScale(box(W, WALL, D, 0, WALL / 2, 0), W / TILE, WALL / TILE))
      const gable = gablePrism(W, RISE, D)
      gable.translate(0, WALL, 0)
      b.push(uvScale(gable, W / TILE, RISE / TILE))
      lot.walls.push(...moveGeos(b, lot.x, lot.z, lot.yaw))

      const r: BufferGeometry[] = []
      for (const s of [-1, 1]) {
        const slab = new BoxGeometry(slope + 0.35, 0.08, D + 0.45)
        uvTranspose(slab)
        slab.rotateZ(-s * pitch)
        slab.translate((s * W) / 4, WALL + RISE / 2 + 0.03, 0)
        r.push(uvRegion(slab, 0, lot.ry0, 256, lot.ry0 + 256, 256, 512))
      }
      r.push(uvRegion(box(0.14, 0.09, D + 0.45, 0, WALL + RISE + 0.02, 0), 0, lot.ry0 + 8, 256, lot.ry0 + 48, 256, 512))
      roofs.push(...moveGeos(r, lot.x, lot.z, lot.yaw))

      // door + window trim + a tiny 4-picket front fence + flower stems' planter
      const t: BufferGeometry[] = []
      t.push(uvScale(box(0.8, 1.7, 0.07, f * -0.85, 0.85, hz + 0.02), 0.7, 1.4))
      for (const by of [0.45, 1.25]) t.push(box(0.72, 0.08, 0.04, f * -0.85, by, hz + 0.06))
      for (const sx of [-1, 1]) t.push(box(0.09, 1.8, 0.08, f * -0.85 + sx * 0.46, 0.9, hz + 0.02))
      t.push(box(1.0, 0.09, 0.08, f * -0.85, 1.8, hz + 0.02))
      // window frame
      t.push(box(0.9, 0.08, 0.07, f * 0.85, 1.78, hz + 0.04))
      t.push(box(0.9, 0.1, 0.11, f * 0.85, 0.92, hz + 0.05))
      for (const sx of [-1, 1]) t.push(box(0.08, 0.85, 0.07, f * 0.85 + sx * 0.42, 1.35, hz + 0.04))
      // fence: a rail + four pickets guarding the flower spot
      t.push(box(1.35, 0.05, 0.04, f * 0.7, 0.3, hz + 0.85))
      for (let i = 0; i < 4; i++) t.push(box(0.05, 0.44, 0.025, f * (0.18 + i * 0.38), 0.22, hz + 0.85))
      wood.push(...moveGeos(t, lot.x, lot.z, lot.yaw))

      // warm window + flower clump cards by the step
      const gl: BufferGeometry[] = []
      const win = new PlaneGeometry(0.74, 0.76)
      win.translate(f * 0.85, 1.35, hz + 0.03)
      gl.push(uvRegion(win, 0, 0, 96, 120, 256, 256))
      for (const a of [0.35, 1.92]) {
        const card = new PlaneGeometry(0.55, 0.46)
        card.rotateY(a)
        card.translate(f * 0.62, 0.23, hz + 0.6)
        gl.push(uvRegion(card, 160, 0, 256, 96, 256, 256))
      }
      glow.push(...moveGeos(gl, lot.x, lot.z, lot.yaw))
    }

    this.addFused(stage, px, pz, cream, creamMat)
    this.addFused(stage, px, pz, sage, sageMat)
    this.addFused(stage, px, pz, roofs, roofMat)
    this.addFused(stage, px, pz, wood, this.woodMat)
    this.addFused(stage, px, pz, glow, this.glowMat, false)
    return stage
  }

  /** the one-room schoolhouse at [28.5, 14.6] facing the road (north, -z),
   * red-ochre + white trim + bell cupola, with the fenced schoolyard and
   * swing frame at x 31.5..35.5, z 13.4..16.2.
   * 5 draws: walls, roof, white trim+pickets, swing wood, glow. */
  private buildSchoolStage(rng: Rng): Group {
    const stage = new Group()
    const [px, pz] = P_SCHOOL
    stage.position.set(px, 0, pz)
    const redMat = new MeshStandardMaterial({
      map: toTexture(clapboardCanvas(rng, '#a8402f', 'rgba(60,18,10,0.3)'), true),
      roughness: 0.9,
    })
    const roofMat = new MeshStandardMaterial({
      map: toTexture(shingleCanvas(rng, ['#5d5a52', '#6a675e', '#52504a', '#757166']), true),
      roughness: 0.95,
    })

    const walls: BufferGeometry[] = []
    const roof: BufferGeometry[] = []
    const white: BufferGeometry[] = []
    const wood: BufferGeometry[] = []
    const glow: BufferGeometry[] = []

    // -- the schoolhouse (local frame front +z, then yawed π to face the road)
    {
      const W = 6.0
      const D = 4.6
      const WALL = 2.6
      const RISE = 1.2
      const hz = D / 2
      const b: BufferGeometry[] = []
      b.push(uvScale(box(W, WALL, D, 0, WALL / 2, 0), W / TILE, WALL / TILE))
      const gable = gablePrism(W, RISE, D)
      gable.translate(0, WALL, 0)
      b.push(uvScale(gable, W / TILE, RISE / TILE))
      walls.push(...moveGeos(b, 28.5, 14.6, Math.PI))

      const r: BufferGeometry[] = []
      const slope = Math.hypot(W / 2, RISE)
      const pitch = Math.atan2(RISE, W / 2)
      for (const s of [-1, 1]) {
        const slab = new BoxGeometry(slope + 0.45, 0.1, D + 0.55)
        uvTranspose(slab)
        uvScale(slab, (D + 0.55) / 1.2, (slope + 0.45) / 1.2)
        slab.rotateZ(-s * pitch)
        slab.translate((s * W) / 4, WALL + RISE / 2 + 0.03, 0)
        r.push(slab)
      }
      // bell cupola cap rides the ridge
      const cap = gablePrism(1.05, 0.42, 1.05)
      cap.translate(0, 4.42, 0)
      r.push(uvScale(cap, 1, 0.5))
      roof.push(...moveGeos(r, 28.5, 14.6, Math.PI))

      const t: BufferGeometry[] = []
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.push(box(0.14, WALL, 0.14, sx * (W / 2 - 0.07), WALL / 2, sz * (hz - 0.07)))
      // double-door frame + header + small porch step
      for (const sx of [-1, 1]) t.push(box(0.11, 2.1, 0.1, sx * 0.62, 1.05, hz + 0.02))
      t.push(box(1.35, 0.11, 0.1, 0, 2.1, hz + 0.02))
      t.push(box(1.5, 0.12, 0.5, 0, 0.06, hz + 0.3))
      // window trim, two each side of the door
      for (const wx of [-1.9, 1.9]) {
        t.push(box(0.84, 0.07, 0.08, wx, 2.0, hz + 0.04))
        t.push(box(0.84, 0.09, 0.1, wx, 1.0, hz + 0.05))
        for (const sx of [-1, 1]) t.push(box(0.07, 1.0, 0.08, wx + sx * 0.39, 1.5, hz + 0.04))
      }
      // cupola: white base ring + four posts under the shingle cap
      t.push(box(0.95, 0.1, 0.95, 0, 3.82, 0))
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.push(box(0.08, 0.55, 0.08, sx * 0.4, 4.15, sz * 0.4))
      white.push(...moveGeos(t, 28.5, 14.6, Math.PI))

      // the double door itself in painted plank
      const d: BufferGeometry[] = []
      for (const sx of [-1, 1]) d.push(uvScale(box(0.55, 2.0, 0.07, sx * 0.29, 1.0, hz + 0.01), 0.5, 1.6))
      wood.push(...moveGeos(d, 28.5, 14.6, Math.PI))

      // lamplit windows + the brass bell card hanging in the cupola
      const gl: BufferGeometry[] = []
      for (const wx of [-1.9, 1.9]) {
        const win = new PlaneGeometry(0.7, 0.92)
        win.translate(wx, 1.5, hz + 0.03)
        gl.push(uvRegion(win, 0, 0, 96, 120, 256, 256))
      }
      for (const a of [0, Math.PI / 2]) {
        const bell = new PlaneGeometry(0.3, 0.34)
        bell.rotateY(a)
        bell.translate(0, 4.1, 0)
        gl.push(uvRegion(bell, 96, 64, 160, 128, 256, 256))
      }
      glow.push(...moveGeos(gl, 28.5, 14.6, Math.PI))
    }

    // -- the schoolyard (world coords): low pickets + the swing frame ---------------
    {
      const X0 = 31.5
      const X1 = 35.5
      const Z0 = 13.4
      const Z1 = 16.2
      const t: BufferGeometry[] = []
      const rail = (x0: number, z0: number, x1: number, z1: number): void => {
        const len = Math.hypot(x1 - x0, z1 - z0)
        const r = new BoxGeometry(len, 0.05, 0.04)
        r.rotateY(-Math.atan2(z1 - z0, x1 - x0))
        r.translate((x0 + x1) / 2, 0.32, (z0 + z1) / 2)
        t.push(r)
      }
      rail(X0, Z0, X1, Z0)
      rail(X0, Z1, X1, Z1)
      rail(X1, Z0, X1, Z1)
      rail(X0, Z0, X0, Z0 + 0.8) // west side leaves a kid-sized gap
      rail(X0, Z1 - 1.2, X0, Z1)
      for (let i = 0; i <= 8; i++) {
        t.push(box(0.05, 0.46, 0.025, X0 + i * 0.5, 0.23, Z0))
        t.push(box(0.05, 0.46, 0.025, X0 + i * 0.5, 0.23, Z1))
      }
      for (let i = 1; i < 6; i++) t.push(box(0.025, 0.46, 0.05, X1, 0.23, Z0 + i * 0.47))
      t.push(box(0.025, 0.46, 0.05, X0, 0.23, Z0 + 0.45))
      t.push(box(0.025, 0.46, 0.05, X0, 0.23, Z1 - 0.6))
      white.push(...t)

      // swing frame: two posts, a crossbar, two rope-and-seat swings
      const s: BufferGeometry[] = []
      for (const sx2 of [33.35, 34.75]) s.push(box(0.09, 2.0, 0.09, sx2, 1.0, 15.5))
      s.push(box(1.56, 0.08, 0.08, 34.05, 1.98, 15.5))
      for (const swx of [33.75, 34.38]) {
        for (const rx of [-0.12, 0.12]) {
          const rope = new CylinderGeometry(0.012, 0.012, 1.26, 5)
          rope.translate(swx + rx, 1.32, 15.5)
          s.push(rope)
        }
        s.push(box(0.32, 0.04, 0.15, swx, 0.68, 15.5))
      }
      wood.push(...s)
    }

    this.addFused(stage, px, pz, walls, redMat)
    this.addFused(stage, px, pz, roof, roofMat)
    this.addFused(stage, px, pz, white, this.whiteMat)
    this.addFused(stage, px, pz, wood, this.woodMat)
    this.addFused(stage, px, pz, glow, this.glowMat, false)
    return stage
  }

  /** the wool mill at [40.5, 14.8] (tall timber, big brick chimney, decorative
   * water wheel) + the little market square at [38.5..42.5, 9.0..9.5]: a
   * butcher stall and two market stalls under striped canopies with crates.
   * 7 draws: timber, roof, wood, brick, canopies, crates, glow. */
  private buildWorksStage(rng: Rng): Group {
    const stage = new Group()
    const [px, pz] = P_WORKS
    stage.position.set(px, 0, pz)
    const timberMat = new MeshStandardMaterial({
      map: toTexture(clapboardCanvas(rng, '#7b5a38', 'rgba(48,32,16,0.32)'), true),
      roughness: 0.92,
    })
    const roofMat = new MeshStandardMaterial({
      map: toTexture(shingleCanvas(rng, ['#4f463c', '#5a5046', '#453d34', '#665b4e']), true),
      roughness: 0.95,
    })

    const timber: BufferGeometry[] = []
    const roof: BufferGeometry[] = []
    const wood: BufferGeometry[] = []
    const brick: BufferGeometry[] = []
    const stripe: BufferGeometry[] = []
    const painted: BufferGeometry[] = []
    const glow: BufferGeometry[] = []

    // -- the mill (local frame front +z, yawed π so it faces the road) --------------
    {
      const W = 7.5
      const D = 5.0
      const WALL = 3.4
      const RISE = 1.4
      const hz = D / 2
      const b: BufferGeometry[] = []
      b.push(uvScale(box(W, WALL, D, 0, WALL / 2, 0), W / TILE, WALL / TILE))
      const gable = gablePrism(W, RISE, D)
      gable.translate(0, WALL, 0)
      b.push(uvScale(gable, W / TILE, RISE / TILE))
      timber.push(...moveGeos(b, 40.5, 14.8, Math.PI))

      const r: BufferGeometry[] = []
      const slope = Math.hypot(W / 2, RISE)
      const pitch = Math.atan2(RISE, W / 2)
      for (const s of [-1, 1]) {
        const slab = new BoxGeometry(slope + 0.5, 0.11, D + 0.6)
        uvTranspose(slab)
        uvScale(slab, (D + 0.6) / 1.2, (slope + 0.5) / 1.2)
        slab.rotateZ(-s * pitch)
        slab.translate((s * W) / 4, WALL + RISE / 2 + 0.03, 0)
        r.push(slab)
      }
      r.push(uvScale(box(0.18, 0.11, D + 0.6, 0, WALL + RISE + 0.02, 0), 1, 4))
      roof.push(...moveGeos(r, 40.5, 14.8, Math.PI))

      // the big chimney — local +x so it lands WEST of the ridge in world,
      // exactly under SMOKE_AT (the shift smoke is born at its mouth)
      const ch: BufferGeometry[] = []
      ch.push(uvScale(box(0.62, 3.2, 0.62, 2.8, 4.4, -1.4), 0.8, 4))
      ch.push(uvScale(box(0.78, 0.14, 0.78, 2.8, 6.05, -1.4), 1, 0.18))
      brick.push(...moveGeos(ch, 40.5, 14.8, Math.PI))

      const t: BufferGeometry[] = []
      // corner posts + big double doors + hoist door up in the gable
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.push(box(0.18, WALL + 0.1, 0.18, sx * (W / 2 - 0.02), (WALL + 0.1) / 2, sz * (hz - 0.02)))
      for (const sx of [-1, 1]) t.push(uvScale(box(0.85, 2.3, 0.08, sx * 0.45, 1.15, hz + 0.02), 0.7, 1.8))
      t.push(box(2.0, 0.12, 0.1, 0, 2.36, hz + 0.02))
      t.push(uvScale(box(0.8, 0.95, 0.07, 0, 3.65, hz + 0.01), 0.7, 0.8))
      t.push(box(0.96, 0.09, 0.09, 0, 4.18, hz + 0.03))
      // the decorative water wheel on the side: rim disc + spokes + paddles + axle
      const wheel = new CylinderGeometry(1.18, 1.18, 0.14, 14)
      wheel.rotateZ(Math.PI / 2)
      wheel.translate(W / 2 + 0.22, 1.25, 0.4)
      t.push(uvScale(wheel, 2.5, 2.5))
      for (let i = 0; i < 4; i++) {
        const spoke = new BoxGeometry(0.07, 2.5, 0.11)
        spoke.rotateX((i / 4) * Math.PI)
        spoke.translate(W / 2 + 0.34, 1.25, 0.4)
        t.push(spoke)
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const paddle = new BoxGeometry(0.3, 0.3, 0.07)
        paddle.rotateX(a)
        paddle.translate(W / 2 + 0.28, 1.25 + Math.cos(a) * 1.24, 0.4 + Math.sin(a) * 1.24)
        t.push(paddle)
      }
      const axle = new CylinderGeometry(0.09, 0.09, 0.6, 8)
      axle.rotateZ(Math.PI / 2)
      axle.translate(W / 2 + 0.1, 1.25, 0.4)
      t.push(axle)
      wood.push(...moveGeos(t, 40.5, 14.8, Math.PI))

      // worklit windows flanking the doors + one in the gable
      const gl: BufferGeometry[] = []
      for (const wx of [-2.4, 2.4]) {
        const win = new PlaneGeometry(0.8, 1.0)
        win.translate(wx, 1.9, hz + 0.04)
        gl.push(uvRegion(win, 0, 0, 96, 120, 256, 256))
      }
      const top = new PlaneGeometry(0.55, 0.62)
      top.translate(-1.6, 3.4, hz + 0.04)
      gl.push(uvRegion(top, 0, 0, 96, 120, 256, 256))
      glow.push(...moveGeos(gl, 40.5, 14.8, Math.PI))
    }

    // -- the market square north of the road: butcher + two produce stalls ----------
    const stalls: Array<{ x: number; z: number; yaw: number; band: number }> = [
      { x: 38.8, z: 9.15, yaw: 0.06, band: 64 }, // the butcher, red/white
      { x: 40.7, z: 9.4, yaw: -0.05, band: 128 }, // market green/cream
      { x: 42.3, z: 9.1, yaw: 0.09, band: 128 },
    ]
    for (const st of stalls) {
      const t: BufferGeometry[] = []
      for (const sx of [-0.72, 0.72]) {
        t.push(box(0.07, 1.6, 0.07, sx, 0.8, 0.36)) // front posts
        t.push(box(0.07, 1.85, 0.07, sx, 0.925, -0.36)) // taller back posts
      }
      t.push(uvScale(box(1.56, 0.09, 0.78, 0, 0.84, 0), 1.3, 0.6))
      t.push(uvScale(box(1.56, 0.5, 0.05, 0, 0.56, 0.38), 1.3, 0.4))
      wood.push(...moveGeos(t, st.x, st.z, st.yaw))

      const canopy = pitchPlane(1.7, 1.05, 0.3, 1.95, -0.5)
      stripe.push(...moveGeos([uvRegion(canopy, 0, st.band, 256, st.band + 64, 256, 192)], st.x, st.z, st.yaw))

      // painted produce crates: slat sides + a heaped top, one up one down
      const p: BufferGeometry[] = []
      p.push(uvRegion(box(0.44, 0.3, 0.44, -0.32, 1.04, -0.02), 0, 160, 96, 256, 256, 256))
      const lidA = new PlaneGeometry(0.4, 0.4)
      lidA.rotateX(-Math.PI / 2)
      lidA.translate(-0.32, 1.195, -0.02)
      p.push(uvRegion(lidA, 96, 160, 192, 256, 256, 256))
      const crateB = new BoxGeometry(0.4, 0.28, 0.4)
      crateB.rotateY(0.4)
      crateB.translate(0.62, 0.14, 0.62)
      p.push(uvRegion(crateB, 0, 160, 96, 256, 256, 256))
      painted.push(...moveGeos(p, st.x, st.z, st.yaw))
    }

    this.addFused(stage, px, pz, timber, timberMat)
    this.addFused(stage, px, pz, roof, roofMat)
    this.addFused(stage, px, pz, wood, this.woodMat)
    this.addFused(stage, px, pz, brick, this.brickMat)
    this.addFused(stage, px, pz, stripe, this.stripeMat)
    this.addFused(stage, px, pz, painted, this.paintedMat)
    this.addFused(stage, px, pz, glow, this.glowMat, false)
    return stage
  }

  /** The Copper Kettle — cosy café at [46, 8] on the south road shoulder,
   * east of the works. Timber + plaster shell, chimney, striped awning,
   * two parasol tables with stools, a hanging COFFEE sign, two static patron
   * figures (billboard glow cards). 6 draws: plaster, roof, wood, stripe,
   * sign (signAtlas), glow. */
  private buildCafeStage(rng: Rng): Group {
    const stage = new Group()
    const [px, pz] = P_CAFE
    stage.position.set(px, 0, pz)

    const plasterMat = new MeshStandardMaterial({ map: toTexture(plasterCanvas(rng), true), roughness: 0.9 })
    const roofMat = new MeshStandardMaterial({
      map: toTexture(shingleCanvas(rng, ['#7a4a33', '#88563d', '#6e412c', '#925f44']), true),
      roughness: 0.95,
    })
    const signMat = new MeshStandardMaterial({ map: toTexture(signAtlasCanvas(rng)), roughness: 0.85 })

    const plaster: BufferGeometry[] = []
    const roof: BufferGeometry[] = []
    const wood: BufferGeometry[] = []
    const stripe: BufferGeometry[] = []
    const signGeos: BufferGeometry[] = []
    const glow: BufferGeometry[] = []

    // -- the café shell at [46, 8], front faces +z toward the road ---------------
    {
      const W = 4.4
      const D = 3.6
      const WALL = 2.4
      const RISE = 0.9
      const hz = D / 2
      const CX = 46.0
      const CZ = 8.0

      // walls + plaster gable
      const b: BufferGeometry[] = []
      b.push(uvScale(box(W, WALL, D, 0, WALL / 2, 0), W / TILE, WALL / TILE))
      const gable = gablePrism(W, RISE, D)
      gable.translate(0, WALL, 0)
      b.push(uvScale(gable, W / TILE, RISE / TILE))
      plaster.push(...moveGeos(b, CX, CZ))

      // roof slabs + ridge cap
      const slope = Math.hypot(W / 2, RISE)
      const pitch = Math.atan2(RISE, W / 2)
      const r: BufferGeometry[] = []
      for (const s of [-1, 1]) {
        const slab = new BoxGeometry(slope + 0.38, 0.09, D + 0.48)
        uvTranspose(slab)
        uvScale(slab, (D + 0.48) / 1.2, (slope + 0.38) / 1.2)
        slab.rotateZ(-s * pitch)
        slab.translate((s * W) / 4, WALL + RISE / 2 + 0.03, 0)
        r.push(slab)
      }
      r.push(uvScale(box(0.14, 0.09, D + 0.48, 0, WALL + RISE + 0.02, 0), 1, 3))
      roof.push(...moveGeos(r, CX, CZ))

      // brick chimney on the east end — pushed through brickMat (reused)
      const ch: BufferGeometry[] = []
      ch.push(uvScale(box(0.44, 1.9, 0.44, 1.4, 2.85, -0.7), 0.6, 2.4))
      ch.push(uvScale(box(0.56, 0.11, 0.56, 1.4, 3.81, -0.7), 0.7, 0.14))
      this.addFused(stage, px, pz, moveGeos(ch, CX, CZ), this.brickMat)

      // door frame (west bay), shopfront window (east bay), trim
      const t: BufferGeometry[] = []
      t.push(uvScale(box(0.9, 1.85, 0.07, -1.3, 0.925, hz + 0.02), 0.7, 1.5))
      for (const by of [0.45, 1.35]) t.push(box(0.82, 0.08, 0.04, -1.3, by, hz + 0.06))
      for (const sx of [-1, 1]) t.push(box(0.09, 1.9, 0.08, -1.3 + sx * 0.49, 0.95, hz + 0.02))
      t.push(box(1.08, 0.1, 0.09, -1.3, 1.95, hz + 0.02))
      t.push(box(1.6, 0.08, 0.07, 0.7, 1.92, hz + 0.04))
      t.push(box(1.6, 0.1, 0.11, 0.7, 0.98, hz + 0.05))
      for (const sx of [-1, 1]) t.push(box(0.09, 0.9, 0.07, 0.7 + sx * 0.76, 1.43, hz + 0.04))
      t.push(box(0.06, 0.9, 0.05, 0.7, 1.43, hz + 0.03))
      // hanging-sign bracket
      t.push(box(0.05, 0.05, 0.7, -1.3, 2.28, hz + 0.34))
      for (const sx of [-1, 1]) t.push(box(0.025, 0.13, 0.025, -1.3 + sx * 0.25, 2.2, hz + 0.62))
      // porch step
      t.push(uvScale(box(1.3, 0.1, 0.4, -1.3, 0.05, hz + 0.22), 1.2, 0.3))
      wood.push(...moveGeos(t, CX, CZ))

      // striped awning over the shopfront (rose/cream band of stripe atlas)
      const aw: BufferGeometry[] = []
      const aTop = pitchPlane(3.0, 0.52, 0.58, 2.28, hz + 0.02)
      aTop.translate(0.7, 0, 0)
      aw.push(uvRegion(aTop, 0, 0, 256, 64, 256, 192))
      const valance = new PlaneGeometry(3.0, 0.17)
      valance.translate(0.7, 1.89, hz + 0.45)
      aw.push(uvRegion(valance, 0, 6, 256, 40, 256, 192))
      stripe.push(...moveGeos(aw, CX, CZ))

      // COFFEE hanging sign (signAtlas 0,0)-(256,64)
      signGeos.push(uvRegion(box(1.0, 0.38, 0.05, CX - 1.3, 1.93, CZ + hz + 0.62), 0, 0, 256, 64, 256, 256))

      // warm window glow
      const win = new PlaneGeometry(1.44, 0.86)
      win.translate(CX + 0.7, 1.43, CZ + hz + 0.025)
      glow.push(uvRegion(win, 0, 0, 96, 120, 256, 256))
    }

    // -- two parasol tables out front (south road side) --------------------------
    for (const [tx, tz] of [[44.4, 9.8], [47.0, 9.8]] as [number, number][]) {
      // parasol pole + canopy disc (green/cream band of stripe atlas)
      const pole = new CylinderGeometry(0.025, 0.03, 2.1, 7)
      pole.translate(tx, 1.05, tz)
      wood.push(uvScale(pole, 0.5, 1.5))
      const canopy = new CylinderGeometry(0.8, 0.72, 0.06, 12)
      canopy.translate(tx, 2.05, tz)
      stripe.push(uvRegion(canopy, 0, 128, 256, 192, 256, 192))
      // table top + centre leg
      wood.push(uvScale(box(0.7, 0.05, 0.7, tx, 0.78, tz), 0.7, 0.7))
      const leg = new CylinderGeometry(0.028, 0.028, 0.78, 6)
      leg.translate(tx, 0.39, tz)
      wood.push(uvScale(leg, 0.5, 1))
      // two stools per table (four thin legs each)
      for (const [sx2, sz2] of [[tx - 0.4, tz + 0.4], [tx + 0.4, tz - 0.4]] as [number, number][]) {
        wood.push(uvScale(box(0.28, 0.04, 0.28, sx2, 0.42, sz2), 0.4, 0.4))
        for (const [ox, oz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]] as [number, number][]) {
          const sl = new CylinderGeometry(0.018, 0.018, 0.42, 5)
          sl.translate(sx2 + ox, 0.21, sz2 + oz)
          wood.push(sl)
        }
      }
    }

    // -- two static patron figures (flower-clump glow region as warm silhouettes)
    for (const [fx, fz] of [[44.4, 9.55], [47.0, 9.55]] as [number, number][]) {
      const card = new PlaneGeometry(0.4, 0.55)
      card.translate(fx, 0.55, fz)
      glow.push(uvRegion(card, 160, 0, 256, 96, 256, 256))
    }

    this.addFused(stage, px, pz, plaster, plasterMat)
    this.addFused(stage, px, pz, roof, roofMat)
    this.addFused(stage, px, pz, wood, this.woodMat)
    this.addFused(stage, px, pz, stripe, this.stripeMat)
    this.addFused(stage, px, pz, signGeos, signMat)
    this.addFused(stage, px, pz, glow, this.glowMat, false)
    return stage
  }

  /** Festival Square — village green at [37.5, 15.5] north of the road, east
   * of the school. A central maypole with ribbon strands, bunting strings
   * between corner posts, 2 market stalls (green canopies), a notice board.
   * 5 draws: wood, stripe, sign (maypole/bunting), painted (crates), glow. */
  private buildSquareStage(rng: Rng): Group {
    const stage = new Group()
    const [px, pz] = P_SQUARE
    stage.position.set(px, 0, pz)

    const signMat = new MeshStandardMaterial({ map: toTexture(signAtlasCanvas(rng)), roughness: 0.85 })

    const wood: BufferGeometry[] = []
    const stripe: BufferGeometry[] = []
    const signGeos: BufferGeometry[] = []
    const painted: BufferGeometry[] = []
    const glow: BufferGeometry[] = []

    // -- maypole at [37.5, 15.5] -------------------------------------------------
    {
      const MX = 37.5
      const MZ = 15.5
      // tall striped pole (maypole stripe band 0,64..128 of signAtlas)
      const poleGeo = new CylinderGeometry(0.055, 0.07, 5.0, 10)
      poleGeo.translate(MX, 2.5, MZ)
      signGeos.push(uvRegion(poleGeo, 0, 64, 256, 128, 256, 256))
      // weathervane finial cap
      wood.push(uvScale(box(0.12, 0.12, 0.12, MX, 5.08, MZ), 0.5, 0.5))

      // ribbon strands from pole-top to 8 anchor posts in a ring (radius 1.8)
      const R = 1.8
      const NRIB = 8
      for (let i = 0; i < NRIB; i++) {
        const a = (i / NRIB) * Math.PI * 2
        const gx = MX + Math.cos(a) * R
        const gz = MZ + Math.sin(a) * R
        // small anchor post
        const post2 = new CylinderGeometry(0.025, 0.03, 1.0, 6)
        post2.translate(gx, 0.5, gz)
        wood.push(uvScale(post2, 0.4, 0.8))
        // ribbon plane from pole-top → post-top
        const dy = 1.0 - 5.0
        const dh = Math.hypot(gx - MX, gz - MZ)
        const rLen = Math.hypot(dy, dh)
        const ribbon = new PlaneGeometry(0.045, rLen)
        ribbon.rotateX(-Math.atan2(-dy, dh))
        ribbon.rotateY(-Math.atan2(gz - MZ, gx - MX))
        ribbon.translate((MX + gx) / 2, (5.0 + 1.0) / 2, (MZ + gz) / 2)
        // alternate bar colours from the maypole band
        const u0 = (i % 2) * 128
        stripe.push(uvRegion(ribbon, u0, 64, u0 + 128, 128, 256, 256))
      }
    }

    // -- bunting strings between 4 corner posts (square [35.5..39.5, 14.5..16.5])
    {
      const corners: [number, number][] = [
        [35.5, 14.5], [39.5, 14.5], [39.5, 16.5], [35.5, 16.5],
      ]
      for (const [bx, bz] of corners) {
        const p = new CylinderGeometry(0.03, 0.04, 1.4, 7)
        p.translate(bx, 0.7, bz)
        wood.push(uvScale(p, 0.4, 1.0))
      }
      const pairs: [[number, number], [number, number]][] = [
        [corners[0], corners[1]], [corners[1], corners[2]],
        [corners[2], corners[3]], [corners[3], corners[0]],
      ]
      for (const [[ax, az], [bx, bz]] of pairs) {
        const sLen = Math.hypot(bx - ax, bz - az)
        const nFlags = Math.floor(sLen / 0.55)
        const flagYaw = -Math.atan2(bz - az, bx - ax)
        for (let i = 0; i < nFlags; i++) {
          const t2 = (i + 0.5) / nFlags
          const fx = ax + (bx - ax) * t2
          const fz = az + (bz - az) * t2
          const fy = 1.35 - Math.sin(Math.PI * t2) * 0.1
          const flag = new PlaneGeometry(0.22, 0.28)
          flag.rotateX(-0.35)
          flag.rotateY(flagYaw)
          flag.translate(fx, fy, fz)
          // alternate warm/red/blue flag colours from signAtlas
          const band = i % 3
          if (band === 0) signGeos.push(uvRegion(flag, 0, 0, 256, 64, 256, 256))
          else if (band === 1) signGeos.push(uvRegion(flag, 0, 64, 128, 128, 256, 256))
          else signGeos.push(uvRegion(flag, 128, 64, 256, 128, 256, 256))
        }
      }
    }

    // -- 2 market stalls (green canopies, same recipe as works stalls) ------------
    const stallDefs: Array<{ x: number; z: number; yaw: number }> = [
      { x: 35.8, z: 15.6, yaw: 0.08 },
      { x: 39.2, z: 15.4, yaw: -0.07 },
    ]
    for (const st of stallDefs) {
      const t: BufferGeometry[] = []
      for (const sx of [-0.68, 0.68]) {
        t.push(box(0.07, 1.5, 0.07, sx, 0.75, 0.33))
        t.push(box(0.07, 1.75, 0.07, sx, 0.875, -0.33))
      }
      t.push(uvScale(box(1.48, 0.09, 0.72, 0, 0.8, 0), 1.3, 0.6))
      t.push(uvScale(box(1.48, 0.46, 0.05, 0, 0.52, 0.35), 1.3, 0.4))
      wood.push(...moveGeos(t, st.x, st.z, st.yaw))

      const canopy = pitchPlane(1.6, 1.0, 0.28, 1.85, -0.46)
      stripe.push(...moveGeos([uvRegion(canopy, 0, 128, 256, 192, 256, 192)], st.x, st.z, st.yaw))

      // produce crates (reuse paintedMat)
      const p: BufferGeometry[] = []
      p.push(uvRegion(box(0.42, 0.28, 0.42, -0.3, 1.0, 0.0), 0, 160, 96, 256, 256, 256))
      const lid = new PlaneGeometry(0.38, 0.38)
      lid.rotateX(-Math.PI / 2)
      lid.translate(-0.3, 1.15, 0.0)
      p.push(uvRegion(lid, 96, 160, 192, 256, 256, 256))
      painted.push(...moveGeos(p, st.x, st.z, st.yaw))
    }

    // -- notice board at [37.5, 14.5] -------------------------------------------
    {
      const NX = 37.5
      const NZ = 14.5
      for (const ox of [-0.28, 0.28]) {
        const p = new CylinderGeometry(0.03, 0.04, 1.1, 7)
        p.translate(NX + ox, 0.55, NZ)
        wood.push(uvScale(p, 0.4, 0.8))
      }
      // board face: warm window-glow region reads as pinned paper in the distance
      glow.push(uvRegion(box(0.64, 0.5, 0.06, NX, 1.0, NZ), 0, 0, 96, 120, 256, 256))
      // board surround trim
      wood.push(box(0.72, 0.58, 0.04, NX, 1.0, NZ + 0.05))
    }

    this.addFused(stage, px, pz, wood, this.woodMat)
    this.addFused(stage, px, pz, stripe, this.stripeMat)
    this.addFused(stage, px, pz, signGeos, signMat)
    this.addFused(stage, px, pz, painted, this.paintedMat)
    this.addFused(stage, px, pz, glow, this.glowMat, false)
    return stage
  }

  /** Millbrook Station — station house with a clock, a canopy on iron posts
   * over the platform, a short length of track running east, and two static
   * traveller figures. The movable train is separate (buildTrain / trainRun).
   * 6 draws: plaster (house), roof, wood (platform/posts/trim), iron (rails +
   * canopy posts), sign (clock face + sleepers), glow (windows + figures). */
  private buildStationStage(rng: Rng): Group {
    const stage = new Group()
    const [px, pz] = P_STATION
    stage.position.set(px, 0, pz)

    const plasterMat = new MeshStandardMaterial({ map: toTexture(plasterCanvas(rng), true), roughness: 0.9 })
    const roofMat = new MeshStandardMaterial({
      map: toTexture(shingleCanvas(rng, ['#5a5450', '#686260', '#4e4c48', '#747068']), true),
      roughness: 0.95,
    })
    // new: dark iron for rails and canopy posts
    const ironMat = this.ironMat // shared station+train metal (built once in ctor)
    const signMat = new MeshStandardMaterial({ map: toTexture(signAtlasCanvas(rng)), roughness: 0.85 })

    const plaster: BufferGeometry[] = []
    const roof: BufferGeometry[] = []
    const wood: BufferGeometry[] = []
    const iron: BufferGeometry[] = []
    const signGeos: BufferGeometry[] = []
    const glow: BufferGeometry[] = []

    // -- station house at [50.0, 12.2], front faces +z (toward road) -------------
    {
      const HX = 50.0
      const HZ = 12.2
      const W = 3.8
      const D = 3.2
      const WALL = 2.4
      const RISE = 0.9
      const hz = D / 2

      const b: BufferGeometry[] = []
      b.push(uvScale(box(W, WALL, D, 0, WALL / 2, 0), W / TILE, WALL / TILE))
      const gable = gablePrism(W, RISE, D)
      gable.translate(0, WALL, 0)
      b.push(uvScale(gable, W / TILE, RISE / TILE))
      plaster.push(...moveGeos(b, HX, HZ))

      const slope = Math.hypot(W / 2, RISE)
      const pitch = Math.atan2(RISE, W / 2)
      const r: BufferGeometry[] = []
      for (const s of [-1, 1]) {
        const slab = new BoxGeometry(slope + 0.36, 0.09, D + 0.46)
        uvTranspose(slab)
        uvScale(slab, (D + 0.46) / 1.2, (slope + 0.36) / 1.2)
        slab.rotateZ(-s * pitch)
        slab.translate((s * W) / 4, WALL + RISE / 2 + 0.03, 0)
        r.push(slab)
      }
      r.push(uvScale(box(0.14, 0.08, D + 0.46, 0, WALL + RISE + 0.02, 0), 1, 3))
      roof.push(...moveGeos(r, HX, HZ))

      // door frame (west bay), window frame (east bay), trim
      const t: BufferGeometry[] = []
      t.push(uvScale(box(0.85, 1.8, 0.07, -0.8, 0.9, hz + 0.02), 0.7, 1.5))
      for (const by of [0.42, 1.32]) t.push(box(0.78, 0.08, 0.04, -0.8, by, hz + 0.06))
      for (const sx of [-1, 1]) t.push(box(0.09, 1.85, 0.08, -0.8 + sx * 0.47, 0.925, hz + 0.02))
      t.push(box(1.04, 0.1, 0.09, -0.8, 1.9, hz + 0.02))
      t.push(box(1.2, 0.08, 0.07, 0.8, 1.8, hz + 0.04))
      t.push(box(1.2, 0.1, 0.11, 0.8, 0.98, hz + 0.05))
      for (const sx of [-1, 1]) t.push(box(0.09, 0.8, 0.07, 0.8 + sx * 0.56, 1.38, hz + 0.04))
      wood.push(...moveGeos(t, HX, HZ))

      // clock face above the door on the gable (signAtlas 0,128)-(256,192)
      const clockFace = new PlaneGeometry(0.72, 0.36)
      clockFace.translate(HX, WALL + RISE * 0.55, HZ + hz + 0.02)
      signGeos.push(uvRegion(clockFace, 0, 128, 256, 192, 256, 256))

      // warm window glow (right-bay window)
      const win = new PlaneGeometry(1.0, 0.76)
      win.translate(HX + 0.8, 1.38, HZ + hz + 0.025)
      glow.push(uvRegion(win, 0, 0, 96, 120, 256, 256))
    }

    // -- platform + canopy: x [47.5..54.5], z [10.0..10.8] ----------------------
    {
      const PX0 = 47.5; const PX1 = 54.5
      const PZ0 = 10.0; const PZ1 = 10.8
      const PCX = (PX0 + PX1) / 2; const PCZ = (PZ0 + PZ1) / 2
      const PLenX = PX1 - PX0; const PLenZ = PZ1 - PZ0
      const POST_Y = 2.0

      // platform deck + front fascia
      wood.push(uvScale(box(PLenX, 0.12, PLenZ, PCX, 0.06, PCZ), PLenX / TILE, PLenZ / TILE))
      wood.push(uvScale(box(PLenX, 0.18, 0.05, PCX, 0.15, PZ0 - 0.025), PLenX / TILE, 0.2))

      // 4 iron canopy posts
      for (const [posX, posZ] of [
        [PX0 + 0.6, PZ0 + 0.15], [PX0 + 0.6, PZ1 - 0.15],
        [PX1 - 0.6, PZ0 + 0.15], [PX1 - 0.6, PZ1 - 0.15],
      ] as [number, number][]) {
        const p = new CylinderGeometry(0.04, 0.05, POST_Y, 8)
        p.translate(posX, POST_Y / 2 + 0.12, posZ)
        iron.push(uvScale(p, 0.6, 1.5))
      }
      // canopy slab + front fascia
      const canopySlabF = new BoxGeometry(PLenX + 0.4, 0.07, PLenZ * 0.6)
      canopySlabF.translate(PCX, POST_Y + 0.14, PCZ - PLenZ * 0.2)
      wood.push(uvScale(canopySlabF, PLenX / TILE, 0.6))
      wood.push(uvScale(box(PLenX + 0.4, 0.22, 0.05, PCX, POST_Y + 0.05, PZ0 - 0.3), PLenX / TILE, 0.2))
    }

    // -- track: two rails + sleepers x [47..58] (world), z = TRAIN_Z ------------
    {
      const TRACK_X0 = 47.0; const TRACK_X1 = 58.0
      const TRACK_LEN = TRACK_X1 - TRACK_X0
      const TCX = (TRACK_X0 + TRACK_X1) / 2
      const GAUGE = 0.62

      for (const sz of [-GAUGE / 2, GAUGE / 2]) {
        const rail = new BoxGeometry(TRACK_LEN, 0.07, 0.08)
        rail.translate(TCX, 0.07, TRAIN_Z + sz)
        iron.push(uvRegion(rail, 0, 0, 256, 32, 256, 256))
      }
      const nSleepers = Math.floor(TRACK_LEN / 0.6)
      for (let i = 0; i <= nSleepers; i++) {
        const sx = TRACK_X0 + i * (TRACK_LEN / nSleepers)
        const sl = new BoxGeometry(0.12, 0.06, GAUGE + 0.28)
        sl.translate(sx, 0.03, TRAIN_Z)
        signGeos.push(uvRegion(sl, 0, 192, 256, 256, 256, 256))
      }
    }

    // -- 2 static traveller figures (cross-billboard glow cards) -----------------
    for (const [fx, fz] of [[49.2, 10.3], [51.8, 10.35]] as [number, number][]) {
      for (const ry of [0, Math.PI / 2]) {
        const card = new PlaneGeometry(0.38, 0.7)
        card.rotateY(ry)
        card.translate(fx, 0.47, fz)
        glow.push(uvRegion(card, 160, 0, 256, 96, 256, 256))
      }
    }

    this.addFused(stage, px, pz, plaster, plasterMat)
    this.addFused(stage, px, pz, roof, roofMat)
    this.addFused(stage, px, pz, wood, this.woodMat)
    this.addFused(stage, px, pz, iron, ironMat)
    this.addFused(stage, px, pz, signGeos, signMat)
    this.addFused(stage, px, pz, glow, this.glowMat, false)
    return stage
  }

  /** the movable train (lives on root, animated by trainRun). Engine with a
   * boiler, funnel and dome + one coupled carriage; nose points -x so rolling
   * in from high X brakes westward to the platform stop. 2 draws: body
   * (dark slate clapboard), metal (wheels — reuse ironMat). */
  private buildTrain(rng: Rng): Group {
    const g = new Group()
    // dark slate body paint — new material, different from any building
    const bodyMat = new MeshStandardMaterial({
      map: toTexture(clapboardCanvas(rng, '#2e3638', 'rgba(14,16,18,0.4)'), true),
      roughness: 0.75,
    })
    const ironMat = this.ironMat // shared station+train metal (built once in ctor)

    const body: BufferGeometry[] = []
    const metal: BufferGeometry[] = []

    // -- engine at local [0, 0] (nose in -x direction) ---------------------------
    {
      // boiler cylinder
      const boiler = new CylinderGeometry(0.42, 0.42, 1.6, 12)
      boiler.rotateZ(Math.PI / 2)
      boiler.translate(-0.4, 0.72, 0)
      body.push(uvScale(boiler, 2.5, 1.5))
      // cab box
      body.push(uvScale(box(1.2, 0.9, 0.88, 0.55, 0.7, 0), 1.0, 0.7))
      // cab roof
      body.push(uvScale(box(1.25, 0.09, 1.0, 0.55, 1.18, 0), 1.0, 0.9))
      // front buffer beam (nose at -x)
      body.push(box(0.08, 0.6, 0.9, -1.3, 0.3, 0))
      // funnel / chimney stack
      const funnel = new CylinderGeometry(0.09, 0.07, 0.5, 9)
      funnel.translate(-1.0, 1.25, 0)
      body.push(uvScale(funnel, 0.6, 0.5))
      const funnelCap = new CylinderGeometry(0.12, 0.09, 0.09, 9)
      funnelCap.translate(-1.0, 1.52, 0)
      body.push(funnelCap)
      // boiler dome
      const dome = new CylinderGeometry(0.14, 0.14, 0.24, 9)
      dome.translate(-0.2, 1.16, 0)
      body.push(uvScale(dome, 0.5, 0.3))
    }

    // -- carriage coupled east of the engine (local x offset +2.2) ---------------
    {
      const CX = 2.2
      body.push(uvScale(box(1.9, 0.7, 0.8, CX, 0.72, 0), 1.6, 0.6))
      body.push(uvScale(box(1.95, 0.09, 0.88, CX, 1.1, 0), 1.6, 0.7))
      // coupling link
      body.push(box(0.22, 0.06, 0.06, CX - 0.96, 0.38, 0))
    }

    // -- wheels: 4 drive wheels (engine) + 4 small wheels (carriage) -------------
    for (const [wx, wz] of [
      [-0.6, -0.44], [-0.6, 0.44], [0.35, -0.44], [0.35, 0.44],
    ] as [number, number][]) {
      const w = new CylinderGeometry(0.26, 0.26, 0.1, 10)
      w.rotateX(Math.PI / 2)
      w.translate(wx, 0.26, wz)
      metal.push(uvScale(w, 1, 1))
    }
    for (const [wx, wz] of [
      [1.6, -0.38], [1.6, 0.38], [2.8, -0.38], [2.8, 0.38],
    ] as [number, number][]) {
      const w = new CylinderGeometry(0.2, 0.2, 0.1, 9)
      w.rotateX(Math.PI / 2)
      w.translate(wx, 0.2, wz)
      metal.push(uvScale(w, 1, 1))
    }

    const bodyMesh = fuse(body, bodyMat)
    if (bodyMesh) { bodyMesh.castShadow = true; g.add(bodyMesh) }
    const metalMesh = fuse(metal, ironMat)
    if (metalMesh) { metalMesh.castShadow = true; g.add(metalMesh) }
    return g
  }

  /** the friendly town bus: warm-red coachwork with a cream band, a strip of
   * pale windows, four dark wheels, headlights. Nose points +x at yaw 0;
   * it lives offstage at x=50 between runs. 3 draws. */
  private buildBus(rng: Rng): Group {
    const g = new Group()
    const bodyMat = new MeshStandardMaterial({ map: toTexture(busBodyCanvas(rng)), roughness: 0.55 })
    const body: BufferGeometry[] = []
    body.push(box(3.6, 1.06, 1.4, 0, 0.86, 0))
    body.push(box(3.3, 0.36, 1.28, 0, 1.54, 0))
    for (const sx of [-1, 1]) body.push(box(0.1, 0.16, 1.44, sx * 1.78, 0.42, 0))
    const bodyMesh = fuse(body, bodyMat)
    if (bodyMesh) g.add(bodyMesh)

    const glow: BufferGeometry[] = []
    glow.push(uvRegion(box(2.65, 0.42, 1.43, -0.18, 1.16, 0), 0, 128, 256, 192, 256, 256))
    glow.push(uvRegion(box(0.06, 0.4, 1.06, 1.74, 1.14, 0), 0, 128, 256, 192, 256, 256)) // windshield
    for (const sz of [-1, 1]) glow.push(uvRegion(box(0.05, 0.13, 0.18, 1.81, 0.6, sz * 0.45), 96, 0, 160, 64, 256, 256))
    const glowMesh = fuse(glow, this.glowMat, false, false)
    if (glowMesh) g.add(glowMesh)

    const wheels: BufferGeometry[] = []
    for (const sx of [-1.12, 1.12]) {
      for (const sz of [-0.64, 0.64]) {
        const wheel = new CylinderGeometry(0.28, 0.28, 0.16, 10)
        wheel.rotateX(Math.PI / 2)
        wheel.translate(sx, 0.28, sz)
        wheels.push(uvRegion(wheel, 192, 160, 256, 256, 256, 256))
      }
    }
    const wheelMesh = fuse(wheels, this.paintedMat)
    if (wheelMesh) g.add(wheelMesh)
    return g
  }
}
