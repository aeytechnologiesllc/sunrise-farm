/** THE STABLE — Hazel's house, the walk-in horse barn (owner: same rule as
 * the henhouse — life size, walk inside, a real animal, never "standing in
 * an asset"). Same off-world trick as the coop/greenhouse sets: a barn shell
 * outside, this warm plank room far away at STABLE_ANCHOR. The whole room is
 * built ONCE as merged per-material bakes; sync() never rebuilds geometry,
 * it only flips visibility between three truths — Hazel home (the skinned
 * GLB idling and eating in her stall), Hazel out on a delivery (a note hung
 * on the rail + hoofprints leading to the door), or no horse yet (fresh
 * straw, a waiting halter, a hopeful little sign that sells the purchase).
 *
 * Opaque walls mean the world's sun never reaches in — lantern flicker,
 * south-window light shafts and drifting motes ARE the lighting. Every roll
 * comes from mulberry32: zero Math.random, the bake is identical every boot. */
import {
  AdditiveBlending,
  AnimationMixer,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
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
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, type Rng } from '../game/rng'
import type { Assets } from './assets'
import { assertSpawnScale, measuredHeight } from './scale'
import { makeCanvas, toTexture, woodCanvas } from './textures'

export const STABLE_ANCHOR = new Vector3(-120, 0, -120)

const ROOM_W = 14
const ROOM_D = 9
const WALL_H = 3.2
const RIDGE_H = 5.0
const DOOR_HALF = 0.95
const HALF_W = ROOM_W / 2
/** Hazel's stall: NW quadrant, rails on the south + west runs, gate east */
const STALL = { x0: -5.6, x1: -1.2, z0: -4.5, z1: -0.8 }
const RAIL_H = 1.1
/** the scale ladder, extended: a horse towers over the 1.6u farmer */
const HORSE_H = 1.75

/** straw-littered plank floor — the coop's recipe with a working barn's
 * extra mess: more loose hay, plus dark hoof scuffs ground into the wood */
function strawFloorCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(192, 192)
  g.fillStyle = '#8a6a44'
  g.fillRect(0, 0, 192, 192)
  // plank seams
  for (let y = 0; y < 192; y += 24) {
    g.fillStyle = 'rgba(60,40,20,0.35)'
    g.fillRect(0, y, 192, 2)
    for (let i = 0; i < 3; i++) {
      g.fillStyle = `rgba(120,90,55,${0.2 + rng.next() * 0.2})`
      g.fillRect(rng.next() * 192, y + 3, 30 + rng.next() * 50, 18)
    }
  }
  // hoof scuffs: dark crescents stamped under the straw layer
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = `rgba(52,36,20,${0.2 + rng.next() * 0.2})`
    g.lineWidth = 3 + rng.next() * 2.5
    const x = rng.next() * 192
    const y = rng.next() * 192
    const a = rng.next() * Math.PI * 2
    g.beginPath()
    g.arc(x, y, 5 + rng.next() * 4, a, a + Math.PI * 1.3)
    g.stroke()
  }
  // scattered straw — a horse drags far more of it around than hens do
  for (let i = 0; i < 400; i++) {
    g.strokeStyle = `hsl(${44 + rng.next() * 12} ${50 + rng.next() * 25}% ${52 + rng.next() * 22}%)`
    g.lineWidth = 1.4
    const x = rng.next() * 192
    const y = rng.next() * 192
    const a = rng.next() * Math.PI
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + Math.cos(a) * (5 + rng.next() * 9), y + Math.sin(a) * (5 + rng.next() * 9))
    g.stroke()
  }
  return c
}

/** straw fill for bales and the fresh bedding mound */
function strawCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#c9a45a'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 120; i++) {
    g.strokeStyle = `hsl(${42 + rng.next() * 14} ${55 + rng.next() * 25}% ${48 + rng.next() * 26}%)`
    g.lineWidth = 1.2
    const x = rng.next() * 64
    const y = rng.next() * 64
    const a = rng.next() * Math.PI
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + Math.cos(a) * (4 + rng.next() * 7), y + Math.sin(a) * (4 + rng.next() * 7))
    g.stroke()
  }
  return c
}

/** worked leather for the tack wall — saddle-brown with pale stitch runs */
function leatherCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#7a4a28'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 60; i++) {
    const tone = rng.next()
    g.fillStyle = tone > 0.5 ? 'rgba(140,92,52,0.3)' : 'rgba(88,50,24,0.3)'
    g.beginPath()
    g.arc(rng.next() * 64, rng.next() * 64, 2 + rng.next() * 5, 0, Math.PI * 2)
    g.fill()
  }
  g.strokeStyle = 'rgba(238,214,168,0.55)'
  g.lineWidth = 1.2
  g.setLineDash([3, 3])
  for (const y of [9, 32, 55]) {
    g.beginPath()
    g.moveTo(2, y)
    g.lineTo(62, y)
    g.stroke()
  }
  g.setLineDash([])
  return c
}

/** speckled oats — the open barrel tops in the feed corner */
function oatsCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#c8a35e'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 150; i++) {
    const tone = rng.next()
    g.fillStyle = tone > 0.6 ? '#e3c887' : tone > 0.3 ? '#a9824a' : '#8d6a3a'
    g.beginPath()
    g.ellipse(rng.next() * 64, rng.next() * 64, 1.4 + rng.next() * 1.2, 2.4 + rng.next() * 1.6, rng.next() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  return c
}

/** Hazel's name plaque — the coop pattern sized up for a horse's door */
function plaqueCanvas(name: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(160, 44)
  g.fillStyle = '#6b4d2e'
  g.fillRect(0, 0, 160, 44)
  g.fillStyle = '#8a6a44'
  g.fillRect(3, 3, 154, 38)
  g.fillStyle = '#fff3d8'
  g.font = "bold 22px 'Trebuchet MS', sans-serif"
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(name, 80, 23)
  return c
}

/** little plank notice — big lines, optional smaller line underneath */
function signCanvas(lines: string[], small?: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 96)
  g.fillStyle = '#6b4d2e'
  g.fillRect(0, 0, 128, 96)
  g.fillStyle = '#8a6a44'
  g.fillRect(3, 3, 122, 90)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#fff3d8'
  g.font = "bold 18px 'Trebuchet MS', sans-serif"
  const y0 = small ? 24 : 48 - (lines.length - 1) * 11
  for (let i = 0; i < lines.length; i++) g.fillText(lines[i], 64, y0 + i * 22)
  if (small) {
    g.fillStyle = '#e8d6ae'
    g.font = "italic 13px 'Trebuchet MS', sans-serif"
    g.fillText(small, 64, 78)
  }
  return c
}

/** four hoofprints fading toward the door — she went THAT way */
function hoofprintsCanvas(): HTMLCanvasElement {
  const { c, g } = makeCanvas(48, 128)
  for (let k = 0; k < 4; k++) {
    g.strokeStyle = `rgba(58,40,22,${0.5 - k * 0.11})`
    g.lineWidth = 5
    const cx = k % 2 === 0 ? 15 : 33 // walking gait, left-right-left
    const cy = 110 - k * 30
    g.beginPath()
    g.arc(cx, cy, 9, Math.PI * 0.85, Math.PI * 2.15)
    g.stroke()
  }
  return c
}

export class StableInterior {
  readonly spawnPos: Vector3
  readonly exitPos: Vector3
  /** opaque walls — registered in OCCLUDERS only while inside */
  readonly shell: Mesh[] = []
  /** player walk bounds (one room, no wings — a flat rect, not a tier fn) */
  readonly bounds = {
    minX: STABLE_ANCHOR.x - HALF_W + 0.55,
    maxX: STABLE_ANCHOR.x + HALF_W - 0.55,
    minZ: STABLE_ANCHOR.z - ROOM_D / 2 + 0.55,
    maxZ: STABLE_ANCHOR.z + ROOM_D / 2 - 0.3,
  }

  private readonly root = new Group()
  private readonly lamps: PointLight[] = []
  private readonly horse: Group
  private readonly mixer: AnimationMixer
  private readonly idleAct: AnimationAction | null
  private readonly eatAct: AnimationAction | null
  private current: AnimationAction | null = null
  /** her own seeded clock — idle/eat alternation survives reloads unchanged */
  private readonly horseRng = mulberry32(0x4a2e1)
  private animT: number
  private readonly awayNote = new Group()
  private readonly noHorseYet = new Group()
  private motes: Points | null = null
  private t = 0

  constructor(scene: Scene, assets: Assets) {
    const rng = mulberry32(0x57ab1e)
    const ax = STABLE_ANCHOR.x
    const az = STABLE_ANCHOR.z
    const hd = ROOM_D / 2
    this.root.position.copy(STABLE_ANCHOR)
    scene.add(this.root)

    this.spawnPos = new Vector3(ax, 0, az + hd - 3.0)
    this.exitPos = new Vector3(ax, 0, az + hd - 0.4)

    const bake = (geos: BufferGeometry[], mat: MeshStandardMaterial, occlude = false): Mesh | null => {
      const merged = mergeGeometries(geos)
      if (!merged) return null
      const m = new Mesh(merged, mat)
      m.receiveShadow = false
      m.castShadow = false
      this.root.add(m)
      if (occlude) this.shell.push(m)
      return m
    }
    const box = (geos: BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): void => {
      const g = new BoxGeometry(w, h, d)
      if (ry) g.rotateY(ry)
      g.translate(x, y, z)
      geos.push(g)
    }

    // ---- materials (one canvas each; '#6a4f30' family per the barn brief) --
    const plank = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#6a4f30'), true), roughness: 0.95 })
    const darkPlank = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#543c22'), true), roughness: 0.95 })
    const railWood = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#62452a'), true), roughness: 0.95 })
    const propWood = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#75573a'), true), roughness: 0.95 })
    const strawMat = new MeshStandardMaterial({ map: toTexture(strawCanvas(rng), true), roughness: 1 })
    const leather = new MeshStandardMaterial({ map: toTexture(leatherCanvas(rng), true), roughness: 0.85 })
    const oats = new MeshStandardMaterial({ map: toTexture(oatsCanvas(rng), true), roughness: 1 })

    // ---- floor -----------------------------------------------------------
    const floorTex = toTexture(strawFloorCanvas(rng), true)
    floorTex.repeat.set(6, 3)
    const floor = new PlaneGeometry(ROOM_W + 1, ROOM_D + 0.6)
    floor.rotateX(-Math.PI / 2)
    floor.translate(0, 0.01, 0)
    bake([floor], new MeshStandardMaterial({ map: floorTex, roughness: 1 }))

    // ---- plank walls + gabled ceiling --------------------------------------
    const walls: BufferGeometry[] = []
    box(walls, ROOM_W, WALL_H, 0.24, 0, WALL_H / 2, -hd) // north
    box(walls, 0.24, WALL_H, ROOM_D, -HALF_W, WALL_H / 2, 0) // west
    box(walls, 0.24, WALL_H, ROOM_D, HALF_W, WALL_H / 2, 0) // east
    // south wall splits around the door gap (windows are shaft planes only —
    // the wall stays solid behind the glow, same trick as the coop)
    const segW = (ROOM_W - DOOR_HALF * 2) / 2
    box(walls, segW, WALL_H, 0.24, -HALF_W + segW / 2, WALL_H / 2, hd)
    box(walls, segW, WALL_H, 0.24, HALF_W - segW / 2, WALL_H / 2, hd)
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
    // gable roof planes (interior ceiling)
    const slope = Math.hypot(hd, RIDGE_H - WALL_H)
    const pitch = Math.atan2(RIDGE_H - WALL_H, hd)
    for (const s of [-1, 1]) {
      const r = new BoxGeometry(ROOM_W, 0.18, slope)
      r.rotateX(s * pitch)
      r.translate(0, (WALL_H + RIDGE_H) / 2, (s * hd) / 2)
      walls.push(r)
    }
    for (const s of [-1, 1]) {
      // gable end triangles (boxes-as-quads — opaque, dark)
      const gg = new BoxGeometry(0.22, RIDGE_H - WALL_H, ROOM_D)
      gg.translate(s * HALF_W, WALL_H + (RIDGE_H - WALL_H) / 2, 0)
      walls.push(gg)
    }
    bake(walls, plank, true)

    // ---- rafters, ridge, lamp wires, pitchfork tines (the dark accents) ----
    const dark: BufferGeometry[] = []
    box(dark, ROOM_W, 0.16, 0.16, 0, RIDGE_H - 0.1, 0)
    for (let x = -HALF_W + 2; x < HALF_W; x += 3.5) {
      for (const s of [-1, 1]) {
        const r = new BoxGeometry(0.12, 0.12, slope)
        r.rotateX(s * pitch)
        r.translate(x, (WALL_H + RIDGE_H) / 2, (s * hd) / 2)
        dark.push(r)
      }
    }
    for (const [lx, lz] of [[-2.5, -1], [2.5, 1]]) {
      const wire = new CylinderGeometry(0.012, 0.012, 0.9, 4)
      wire.translate(lx, 4.1, lz)
      dark.push(wire)
    }
    for (const dz of [-0.08, 0, 0.08]) {
      const tine = new BoxGeometry(0.022, 0.34, 0.022)
      tine.rotateZ(-0.22)
      tine.translate(6.72, 1.9, 1.1 + dz)
      dark.push(tine)
    }
    bake(dark, darkPlank)

    // ---- Hazel's stall: timber rails, gate open to the aisle on the east ---
    const rails: BufferGeometry[] = []
    const railRunW = STALL.z1 - STALL.z0
    const railRunS = STALL.x1 - STALL.x0
    // posts every ~1.1u along the west + south runs (east stays open: the gate)
    for (let k = 0; k <= 3; k++) box(rails, 0.12, RAIL_H, 0.12, STALL.x0, RAIL_H / 2, STALL.z0 + 0.1 + (k * (railRunW - 0.1)) / 3)
    for (let k = 1; k <= 4; k++) box(rails, 0.12, RAIL_H, 0.12, STALL.x0 + (k * railRunS) / 4, RAIL_H / 2, STALL.z1)
    for (const ry of [0.52, 0.98]) {
      box(rails, 0.08, 0.1, railRunW, STALL.x0, ry, (STALL.z0 + STALL.z1) / 2)
      box(rails, railRunS, 0.1, 0.08, (STALL.x0 + STALL.x1) / 2, ry, STALL.z1)
    }
    bake(rails, railWood)

    // her name on the wall above the stall — the coop's plaque, horse-sized
    const plaque = new Mesh(
      new PlaneGeometry(1.15, 0.32),
      new MeshBasicMaterial({ map: toTexture(plaqueCanvas('HAZEL')) }),
    )
    plaque.position.set(-3.4, 1.9, -hd + 0.14)
    this.root.add(plaque)

    // ---- loft over the north third + ladder + barrels + pitchfork handle ---
    const props: BufferGeometry[] = []
    box(props, ROOM_W - 0.3, 0.1, 3.0, 0, 2.45, -3.0) // loft floor (z < -1.5)
    for (const px of [-4.5, 0, 4.5]) box(props, 0.14, 2.45, 0.14, px, 1.225, -1.55)
    // ladder leaning on the loft edge: 2 rails + 6 rungs, tilted as one unit
    const lean = (geo: BufferGeometry, dx: number, dy: number): void => {
      geo.translate(dx, dy, 0)
      geo.rotateX(-0.28)
      geo.translate(1.5, 0.05, -0.78)
      props.push(geo)
    }
    for (const dx of [-0.25, 0.25]) lean(new BoxGeometry(0.06, 2.6, 0.06), dx, 1.3)
    for (let k = 0; k < 6; k++) lean(new BoxGeometry(0.56, 0.05, 0.05), 0, 0.35 + k * 0.4)
    // feed corner SE: two oat barrels + a leaning pitchfork handle
    for (const [bx, bz] of [[5.8, 3.4], [4.55, 3.65]]) {
      const body = new CylinderGeometry(0.42, 0.46, 0.85, 10)
      body.translate(bx, 0.43, bz)
      props.push(body)
    }
    const handle = new CylinderGeometry(0.024, 0.024, 1.75, 6)
    handle.rotateZ(-0.22)
    handle.translate(6.5, 0.9, 1.1)
    props.push(handle)
    bake(props, propWood)

    // open barrel tops — the oats themselves, one merged draw
    const oatTops: BufferGeometry[] = []
    for (const [bx, bz] of [[5.8, 3.4], [4.55, 3.65]]) {
      const top = new CylinderGeometry(0.35, 0.35, 0.08, 10)
      top.translate(bx, 0.84, bz)
      oatTops.push(top)
    }
    bake(oatTops, oats)

    // ---- straw: 4 loft bales + the 3-bale stack by the feed corner ---------
    const bales: BufferGeometry[] = []
    box(bales, 0.95, 0.5, 0.6, -5.5, 2.75, -3.6, 0.2)
    box(bales, 0.95, 0.5, 0.6, -4.4, 2.75, -3.3, -0.15)
    box(bales, 0.95, 0.5, 0.6, -4.9, 3.26, -3.5, 0.4)
    box(bales, 0.95, 0.5, 0.6, 3.8, 2.75, -3.8, -0.3)
    box(bales, 0.95, 0.5, 0.6, 6.25, 0.25, 2.1, 0.08)
    box(bales, 0.95, 0.5, 0.6, 6.2, 0.25, 1.4, -0.12)
    box(bales, 0.95, 0.5, 0.6, 6.22, 0.76, 1.75, 0.15)
    bake(bales, strawMat)

    // ---- tack wall (east): saddle on its stand, bridles, brushes, rope -----
    const tack: BufferGeometry[] = []
    box(tack, 0.5, 0.1, 0.2, 6.6, 1.22, -0.5) // wall stand
    box(tack, 0.55, 0.13, 0.34, 6.6, 1.33, -0.5) // saddle seat
    for (const s of [-1, 1]) {
      const flap = new BoxGeometry(0.5, 0.34, 0.06)
      flap.rotateX(s * 0.45)
      flap.translate(6.6, 1.18, -0.5 + s * 0.22)
      tack.push(flap)
    }
    for (const bz of [0.35, 0.85]) {
      const loop = new TorusGeometry(0.12, 0.022, 6, 12)
      loop.rotateY(Math.PI / 2)
      loop.translate(6.84, 1.62, bz)
      tack.push(loop)
    }
    box(tack, 0.55, 0.05, 0.22, 6.7, 1.02, 1.5) // brush shelf
    box(tack, 0.2, 0.09, 0.11, 6.62, 1.09, 1.43, 0.3)
    box(tack, 0.2, 0.09, 0.11, 6.74, 1.09, 1.58, -0.2)
    const rope = new TorusGeometry(0.17, 0.05, 8, 12)
    rope.rotateY(Math.PI / 2)
    rope.translate(6.82, 1.5, 2.1)
    tack.push(rope)
    bake(tack, leather)

    // ---- light shafts + motes + lanterns (the opaque-room art pass) --------
    const shaftGeos: BufferGeometry[] = []
    for (const sx of [-4, 0.5, 5]) {
      const p = new PlaneGeometry(1.4, 2.9)
      p.rotateX(0.5)
      p.translate(sx, 1.65, hd - 1.3)
      shaftGeos.push(p)
    }
    const shaftMerged = mergeGeometries(shaftGeos)
    if (shaftMerged) {
      this.root.add(new Mesh(shaftMerged, new MeshBasicMaterial({
        color: '#ffe9b8',
        transparent: true,
        opacity: 0.13,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      })))
    }
    const moteN = 40
    const motePos = new Float32Array(moteN * 3)
    for (let i = 0; i < moteN; i++) {
      motePos[i * 3] = -6.5 + rng.next() * 13
      motePos[i * 3 + 1] = 0.4 + rng.next() * 2.4
      motePos[i * 3 + 2] = -4 + rng.next() * 8
    }
    const moteGeo = new BufferGeometry()
    moteGeo.setAttribute('position', new BufferAttribute(motePos, 3))
    this.motes = new Points(
      moteGeo,
      new PointsMaterial({ color: '#ffe9b8', size: 0.035, transparent: true, opacity: 0.65, depthWrite: false }),
    )
    this.root.add(this.motes)

    const headGeos: BufferGeometry[] = []
    for (const [lx, , lz] of [[-2.5, 3.4, -1], [2.5, 3.4, 1]]) {
      const head = new CylinderGeometry(0.12, 0.16, 0.22, 8)
      head.translate(lx, 3.55, lz)
      headGeos.push(head)
      const l = new PointLight('#ffc98a', 0, 10, 1.5)
      l.position.set(lx, 3.4, lz)
      this.root.add(l)
      this.lamps.push(l)
    }
    const headMerged = mergeGeometries(headGeos)
    if (headMerged) this.root.add(new Mesh(headMerged, new MeshBasicMaterial({ color: '#ffd9a0' })))

    // ---- THE HORSE — Hazel herself, sized against the Phase 1 ladder -------
    this.horse = assets.spawnSkinned('horse')
    const rawH = measuredHeight(this.horse)
    const hs = HORSE_H / rawH
    this.horse.scale.setScalar(hs)
    assertSpawnScale('stable horse', rawH * hs, HORSE_H * 0.95, HORSE_H * 1.05)
    this.horse.position.set(-3.4, 0, -2.6)
    this.horse.rotation.y = 2.4 // facing the aisle, ready to greet
    this.root.add(this.horse)
    this.mixer = new AnimationMixer(this.horse)
    // suffix match — Quaternius prefixes clip names with the armature path
    const clips = assets.clips('horse')
    const act = (suffix: string): AnimationAction | null => {
      const clip = clips.find((cl) => cl.name.toLowerCase().endsWith(suffix))
      return clip ? this.mixer.clipAction(clip, this.horse) : null
    }
    this.idleAct = act('idle')
    this.eatAct = act('eating')
    this.current = this.idleAct
    this.current?.play()
    this.animT = 6 + this.horseRng.next() * 8

    // ---- away note: sign on the rail + hoofprints toward the door ----------
    const awayBoard = new Mesh(new BoxGeometry(0.6, 0.46, 0.05), propWood)
    awayBoard.position.set(-2.4, 0.8, STALL.z1 + 0.06)
    const awayText = new Mesh(
      new PlaneGeometry(0.52, 0.39),
      new MeshBasicMaterial({ map: toTexture(signCanvas(['Out on a', 'delivery'], 'back soon')) }),
    )
    awayText.position.set(-2.4, 0.8, STALL.z1 + 0.09)
    const prints = new Mesh(
      new PlaneGeometry(0.55, 1.5),
      new MeshBasicMaterial({ map: toTexture(hoofprintsCanvas()), transparent: true, depthWrite: false }),
    )
    prints.rotation.x = -Math.PI / 2
    prints.rotation.z = -0.3
    prints.position.set(-0.7, 0.02, 0.6)
    this.awayNote.add(awayBoard, awayText, prints)
    this.root.add(this.awayNote)

    // ---- no horse yet: fresh bedding, a waiting halter, a hopeful sign ------
    const mound = new Mesh(new SphereGeometry(0.6, 10, 8), strawMat)
    mound.scale.set(1, 0.42, 1)
    mound.position.set(-3.4, 0.06, -2.6)
    const halterLoop = new Mesh(new TorusGeometry(0.13, 0.022, 6, 12), leather)
    halterLoop.position.set(-4.8, 1.5, -hd + 0.16)
    const strapV = new Mesh(new BoxGeometry(0.04, 0.3, 0.02), leather)
    strapV.position.set(-4.8, 1.72, -hd + 0.15)
    const strapH = new Mesh(new BoxGeometry(0.22, 0.04, 0.02), leather)
    strapH.position.set(-4.8, 1.5, -hd + 0.17)
    const hopeBoard = new Mesh(new BoxGeometry(0.62, 0.5, 0.05), propWood)
    hopeBoard.rotation.x = -0.18
    hopeBoard.position.set(-2.9, 0.46, STALL.z1 + 0.1)
    const hopeText = new Mesh(
      new PlaneGeometry(0.54, 0.43),
      new MeshBasicMaterial({ map: toTexture(signCanvas(['A horse would', 'love it here'])) }),
    )
    hopeText.rotation.x = -0.18
    hopeText.position.set(-2.9, 0.465, STALL.z1 + 0.135)
    this.noHorseYet.add(mound, halterLoop, strapV, strapH, hopeBoard, hopeText)
    this.root.add(this.noHorseYet)

    this.sync({ horseOwned: false, horseHome: false })
    this.root.visible = false
  }

  /** flip the room between its three truths — pure visibility, no rebuilds */
  sync(opts: { horseOwned: boolean; horseHome: boolean }): void {
    this.horse.visible = opts.horseOwned && opts.horseHome
    this.awayNote.visible = opts.horseOwned && !opts.horseHome
    this.noHorseYet.visible = !opts.horseOwned
  }

  setActive(on: boolean): void {
    this.root.visible = on
    for (const l of this.lamps) l.intensity = on ? 1.0 : 0
  }

  get active(): boolean {
    return this.root.visible
  }

  /** Hazel grazes and daydreams; lanterns flicker; motes drift. Zero allocs —
   * the mixer only spends cycles while the set is actually on stage. */
  update(dt: number): void {
    if (!this.root.visible) return
    this.t += dt
    if (this.horse.visible) {
      this.mixer.update(dt)
      this.animT -= dt
      if (this.animT <= 0 && this.idleAct && this.eatAct) {
        const next = this.current === this.idleAct ? this.eatAct : this.idleAct
        next.reset().fadeIn(0.4).play()
        this.current?.fadeOut(0.4)
        this.current = next
        this.animT = 6 + this.horseRng.next() * 8
      }
    }
    for (let i = 0; i < this.lamps.length; i++) {
      const flicker = 1.0 + Math.sin(this.t * 7 + i * 2.1) * 0.06 + Math.sin(this.t * 13 + i) * 0.04
      this.lamps[i].intensity = flicker
    }
    if (this.motes) this.motes.rotation.y = Math.sin(this.t * 0.05) * 0.18
  }
}
