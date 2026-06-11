/** The WALKABLE greenhouse interior — an off-world glass set (same trick as
 * the dinner room in interior.ts): from outside the greenhouse looks like a
 * garden shed, but stepping through its door fades the player onto this set,
 * a cathedral 26x16 glasshouse where EIGHT raised beds live as real planters
 * you walk between (owner: "once you enter, it needs to feel huge — a whole
 * building"). Daylight is the WORLD's light pouring through the panes; the
 * farm reads as hazy distance through the glass.
 * Perf: merged statics per material (~12 draws), root hidden until entered.
 * House art rule: every surface canvas-painted — no flat-color blobs. */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Scene,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, type Rng } from '../game/rng'
import { makeCanvas, toTexture, woodCanvas } from './textures'

/** far off the playable farm, inside the 240u sky dome, away from the
 * dinner set at (120,0,120) */
export const GH_ANCHOR = new Vector3(-120, 0, 120)

const ROOM_W = 26
const ROOM_D = 16
const KNEE_H = 0.6
const WALL_H = 4.0
const RIDGE_H = 6.2
/** door gap centered on the south wall (+z) — spawn/exit side */
const DOOR_HALF = 1.1
/** a human door inside the tall glass wall (frame + header height) */
const DOOR_H = 2.3
/** structural rhythm: posts/rafters every bay along the long walls */
const BAY = ROOM_W / 8
const ZBAY = ROOM_D / 4

/** warm stone pavers with moss seams */
function paverCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(160, 160)
  g.fillStyle = '#8d8273'
  g.fillRect(0, 0, 160, 160)
  const tones = ['#9a8f7e', '#a39885', '#8a7f6e', '#948a76', '#9f9480']
  for (let row = 0; row < 5; row++) {
    let x = row % 2 === 0 ? 0 : -16
    while (x < 160) {
      const w = 28 + rng.next() * 14
      g.fillStyle = tones[Math.floor(rng.next() * tones.length)]
      g.fillRect(x + 2, row * 32 + 2, w - 4, 28)
      x += w
    }
  }
  // moss creeping into the seams
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(96,118,62,${0.1 + rng.next() * 0.2})`
    g.fillRect(rng.next() * 160, rng.next() * 160, 2 + rng.next() * 5, 1 + rng.next() * 2)
  }
  for (let i = 0; i < 160; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,245,225,0.07)' : 'rgba(30,24,16,0.1)'
    g.fillRect(rng.next() * 160, rng.next() * 160, 1.5, 1.5)
  }
  return c
}

/** sun-washed brick for the knee wall */
function brickCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 64)
  g.fillStyle = '#9c6a4e'
  g.fillRect(0, 0, 128, 64)
  const tones = ['#a87456', '#93624a', '#b07c5c', '#8d5d45']
  for (let row = 0; row < 4; row++) {
    let x = row % 2 === 0 ? 0 : -14
    while (x < 128) {
      g.fillStyle = tones[Math.floor(rng.next() * tones.length)]
      g.fillRect(x + 1, row * 16 + 1, 26, 14)
      x += 28
    }
  }
  for (let i = 0; i < 70; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,235,210,0.08)' : 'rgba(40,20,10,0.12)'
    g.fillRect(rng.next() * 128, rng.next() * 64, 2, 2)
  }
  return c
}

/** terracotta with a fired-clay gradient band */
function clayCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  const grad = g.createLinearGradient(0, 0, 0, 64)
  grad.addColorStop(0, '#c07a52')
  grad.addColorStop(0.5, '#b06a44')
  grad.addColorStop(1, '#9a5a3a')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 60; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(255,225,200,0.1)' : 'rgba(60,25,10,0.12)'
    g.fillRect(rng.next() * 64, rng.next() * 64, 1.5, 1.5)
  }
  return c
}

/** dark watered loam for the bed fill — clods, stones, a damp sheen */
function loamCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(96, 96)
  g.fillStyle = '#4c3826'
  g.fillRect(0, 0, 96, 96)
  for (let i = 0; i < 130; i++) {
    const t = rng.next()
    g.fillStyle = t > 0.66 ? '#5a4430' : t > 0.33 ? '#42301f' : '#52402c'
    g.beginPath()
    g.ellipse(rng.next() * 96, rng.next() * 96, 2 + rng.next() * 5, 1.5 + rng.next() * 3, rng.next() * 3, 0, Math.PI * 2)
    g.fill()
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = rng.next() > 0.5 ? 'rgba(220,205,180,0.16)' : 'rgba(20,12,6,0.22)'
    g.fillRect(rng.next() * 96, rng.next() * 96, 1.5, 1.5)
  }
  return c
}

/** painted leaf clusters on transparent ground — alphaTest cutout cards (the
 * same technique as the tree canopies; reads as foliage, never a blob) */
function leafCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(96, 96)
  g.clearRect(0, 0, 96, 96)
  for (let i = 0; i < 46; i++) {
    const x = 12 + rng.next() * 72
    const y = 12 + rng.next() * 72
    const r = 5 + rng.next() * 7
    const hue = 96 + rng.next() * 28
    const lit = 26 + rng.next() * 16
    g.fillStyle = `hsl(${hue} 42% ${lit}%)`
    g.beginPath()
    g.ellipse(x, y, r, r * (0.5 + rng.next() * 0.3), rng.next() * Math.PI, 0, Math.PI * 2)
    g.fill()
    // a midrib line so each leaf reads as a leaf
    g.strokeStyle = `hsl(${hue} 36% ${lit - 9}%)`
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(x - r * 0.7, y)
    g.lineTo(x + r * 0.7, y)
    g.stroke()
  }
  return c
}

function box(geos: BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): void {
  const g = new BoxGeometry(w, h, d)
  if (ry !== 0) g.rotateY(ry)
  g.translate(x, y, z)
  geos.push(g)
}

export class GreenhouseInterior {
  /** just inside the door — the player lands here on entry */
  readonly spawnPos: Vector3
  /** walking back to this point (the doorway) leaves the greenhouse */
  readonly exitPos: Vector3
  /** the eight planter centers, world coords — main drops its plot views here */
  readonly bedPositions: Vector3[]
  /** player walk bounds while inside (world coords) */
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number }

  /** the building shell (brick + glass) for the camera's occlusion set —
   * the follow camera must pull INSIDE the room, never film through panes */
  readonly shell: Mesh[] = []

  private readonly root = new Group()
  private readonly lampA: PointLight
  private readonly baskets: Group[] = []
  private t = 0

  constructor(scene: Scene) {
    const rng = mulberry32(0x9eeeb)
    const ax = GH_ANCHOR.x
    const az = GH_ANCHOR.z
    this.root.position.copy(GH_ANCHOR)
    scene.add(this.root)

    // spawn far enough in that the follow camera (occlusion floor 2.4u)
    // lands INSIDE the south wall instead of kissing the glass
    this.spawnPos = new Vector3(ax, 0, az + ROOM_D / 2 - 3.0)
    this.exitPos = new Vector3(ax, 0, az + ROOM_D / 2 - 0.4)
    // two rows of four with broad walking aisles — a real market garden
    this.bedPositions = []
    for (const bz of [-3.9, 1.1]) {
      for (const bx of [-8.7, -2.9, 2.9, 8.7]) {
        this.bedPositions.push(new Vector3(ax + bx, 0, az + bz))
      }
    }
    this.bounds = {
      minX: ax - ROOM_W / 2 + 0.55,
      maxX: ax + ROOM_W / 2 - 0.55,
      minZ: az - ROOM_D / 2 + 0.55,
      maxZ: az + ROOM_D / 2 - 0.3,
    }

    const bake = (geos: BufferGeometry[], mat: MeshBasicMaterial | MeshStandardMaterial): Mesh => {
      const merged = mergeGeometries(geos)
      const m = new Mesh(merged ?? new BoxGeometry(0.01, 0.01, 0.01), mat)
      m.castShadow = false
      m.receiveShadow = true
      this.root.add(m)
      return m
    }

    // ---- floor ---------------------------------------------------------------
    const floor = new PlaneGeometry(ROOM_W + 0.6, ROOM_D + 0.6)
    floor.rotateX(-Math.PI / 2)
    floor.translate(0, 0.012, 0)
    const floorTex = toTexture(paverCanvas(rng), true)
    floorTex.repeat.set(3, 2)
    bake([floor], new MeshStandardMaterial({ map: floorTex, roughness: 0.95 }))

    // ---- brick knee wall (door gap on the south side) -------------------------
    const brick: BufferGeometry[] = []
    const hw = ROOM_W / 2
    const hd = ROOM_D / 2
    box(brick, ROOM_W, KNEE_H, 0.24, 0, KNEE_H / 2, -hd) // north
    box(brick, 0.24, KNEE_H, ROOM_D, -hw, KNEE_H / 2, 0) // west
    box(brick, 0.24, KNEE_H, ROOM_D, hw, KNEE_H / 2, 0) // east
    const segW = hw - DOOR_HALF
    box(brick, segW, KNEE_H, 0.24, -(DOOR_HALF + segW / 2), KNEE_H / 2, hd) // south L
    box(brick, segW, KNEE_H, 0.24, DOOR_HALF + segW / 2, KNEE_H / 2, hd) // south R
    const brickTex = toTexture(brickCanvas(rng), true)
    brickTex.repeat.set(6, 1)
    this.shell.push(bake(brick, new MeshStandardMaterial({ map: brickTex, roughness: 0.92 })))

    // ---- white timber mullions + ridge ----------------------------------------
    const white = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#e9e4d4'), true), roughness: 0.8 })
    const frame: BufferGeometry[] = []
    const xPosts: number[] = []
    for (let x = -hw; x <= hw + 0.01; x += BAY) xPosts.push(x)
    const zPosts: number[] = []
    for (let z = -hd; z <= hd + 0.01; z += ZBAY) zPosts.push(z)
    // posts up to the eave (south wall keeps the doorway clear)
    for (const x of xPosts) {
      box(frame, 0.12, WALL_H - KNEE_H, 0.12, x, KNEE_H + (WALL_H - KNEE_H) / 2, -hd)
      if (Math.abs(x) > DOOR_HALF + 0.25) box(frame, 0.12, WALL_H - KNEE_H, 0.12, x, KNEE_H + (WALL_H - KNEE_H) / 2, hd)
    }
    for (const z of zPosts) {
      box(frame, 0.12, WALL_H - KNEE_H, 0.12, -hw, KNEE_H + (WALL_H - KNEE_H) / 2, z)
      box(frame, 0.12, WALL_H - KNEE_H, 0.12, hw, KNEE_H + (WALL_H - KNEE_H) / 2, z)
    }
    // a mid-height rail line ties the tall glass walls together
    for (const s of [-1, 1]) {
      box(frame, ROOM_W, 0.1, 0.1, 0, (KNEE_H + WALL_H) / 2, s * hd)
      box(frame, 0.1, 0.1, ROOM_D, s * hw, (KNEE_H + WALL_H) / 2, 0)
    }
    // eave rails + ridge beam + a human-height door frame in the glass
    box(frame, ROOM_W, 0.14, 0.14, 0, WALL_H, -hd)
    box(frame, ROOM_W, 0.14, 0.14, 0, WALL_H, hd)
    box(frame, 0.14, 0.14, ROOM_D, -hw, WALL_H, 0)
    box(frame, 0.14, 0.14, ROOM_D, hw, WALL_H, 0)
    box(frame, ROOM_W, 0.18, 0.18, 0, RIDGE_H, 0)
    for (const s of [-1, 1]) box(frame, 0.12, DOOR_H + 0.2, 0.12, s * (DOOR_HALF + 0.06), (DOOR_H + 0.2) / 2, hd)
    box(frame, DOOR_HALF * 2 + 0.24, 0.14, 0.14, 0, DOOR_H + 0.08, hd)
    // roof rafters down both slopes, one per bay
    const slope = Math.hypot(hd, RIDGE_H - WALL_H)
    const pitch = Math.atan2(RIDGE_H - WALL_H, hd)
    for (const x of xPosts) {
      for (const s of [-1, 1]) {
        const r = new BoxGeometry(0.11, 0.11, slope)
        r.rotateX(s * pitch)
        r.translate(x, (WALL_H + RIDGE_H) / 2, (s * hd) / 2)
        frame.push(r)
      }
    }
    // purlins along the slopes so the big roof reads structural, not empty
    for (const s of [-1, 1]) {
      for (const t of [0.33, 0.66]) {
        box(frame, ROOM_W, 0.09, 0.09, 0, WALL_H + (RIDGE_H - WALL_H) * t, s * hd * (1 - t))
      }
    }
    bake(frame, white)

    // ---- glass: walls + pitched roof (single transparent bucket) --------------
    const glassMat = new MeshStandardMaterial({
      color: '#d9efe7',
      transparent: true,
      opacity: 0.16,
      roughness: 0.18,
      side: DoubleSide,
      depthWrite: false,
    })
    const glass: BufferGeometry[] = []
    const wallGlassH = WALL_H - KNEE_H
    const gN = new PlaneGeometry(ROOM_W, wallGlassH)
    gN.translate(0, KNEE_H + wallGlassH / 2, -hd)
    glass.push(gN)
    const gS = new PlaneGeometry(ROOM_W, wallGlassH)
    gS.translate(0, KNEE_H + wallGlassH / 2, hd)
    glass.push(gS)
    for (const s of [-1, 1]) {
      const gw = new PlaneGeometry(ROOM_D, wallGlassH)
      gw.rotateY(Math.PI / 2)
      gw.translate(s * hw, KNEE_H + wallGlassH / 2, 0)
      glass.push(gw)
    }
    for (const s of [-1, 1]) {
      const gr = new PlaneGeometry(ROOM_W, slope)
      gr.rotateX(s > 0 ? -(Math.PI / 2 - pitch) : Math.PI / 2 - pitch)
      gr.translate(0, (WALL_H + RIDGE_H) / 2, (s * hd) / 2)
      glass.push(gr)
    }
    // gable triangles read fine as quads at this opacity
    for (const s of [-1, 1]) {
      const gg = new PlaneGeometry(ROOM_W, RIDGE_H - WALL_H)
      gg.translate(0, WALL_H + (RIDGE_H - WALL_H) / 2, s * hd)
      glass.push(gg)
    }
    const glassMesh = new Mesh(mergeGeometries(glass) ?? new PlaneGeometry(1, 1), glassMat)
    glassMesh.renderOrder = 2
    this.root.add(glassMesh)
    this.shell.push(glassMesh)

    // ---- planter bed frames + loam fill (plot views drop INTO these) ----------
    const brown = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#6b4d2e'), true), roughness: 0.9 })
    const wood: BufferGeometry[] = []
    const loam: BufferGeometry[] = []
    for (const b of this.bedPositions) {
      const bx = b.x - ax
      const bz = b.z - az
      for (const s of [-1, 1]) {
        box(wood, 2.3, 0.22, 0.12, bx, 0.11, bz + s * 1.1)
        box(wood, 0.12, 0.22, 2.32, bx + s * 1.1, 0.11, bz)
      }
      const soil = new BoxGeometry(2.1, 0.12, 2.1)
      soil.translate(bx, 0.06, bz)
      loam.push(soil)
    }
    bake(loam, new MeshStandardMaterial({ map: toTexture(loamCanvas(rng), true), roughness: 1 }))
    // potting bench along the west wall + crates + barrels
    box(wood, 0.95, 0.08, 6.4, -hw + 0.78, 0.78, -1.0)
    for (const z of [-4.0, -1.0, 2.0]) for (const s of [-1, 1]) box(wood, 0.08, 0.74, 0.08, -hw + 0.78 + s * 0.38, 0.37, z)
    box(wood, 0.62, 0.62, 0.62, -hw + 0.85, 0.31, 4.4)
    box(wood, 0.5, 0.5, 0.5, -hw + 0.9, 0.25, 5.3, 0.5)
    box(wood, 0.56, 0.56, 0.56, hw - 0.9, 0.28, -hd + 1.2, 0.3)
    bake(wood, brown)

    const barrels: BufferGeometry[] = []
    for (const [px, pz] of [
      [hw - 0.95, hd - 1.6],
      [hw - 0.95, -hd + 2.4],
    ]) {
      const barrel = new CylinderGeometry(0.42, 0.46, 0.78, 12)
      barrel.translate(px, 0.39, pz)
      barrels.push(barrel)
    }
    bake(barrels, brown)

    // ---- terracotta pots on the bench ------------------------------------------
    const clay = new MeshStandardMaterial({ map: toTexture(clayCanvas(rng), true), roughness: 0.85 })
    const pots: BufferGeometry[] = []
    for (let i = 0; i < 9; i++) {
      const p = new CylinderGeometry(0.11, 0.085, 0.2, 10)
      p.translate(-hw + 0.74 + (i % 2) * 0.34, 0.92, -4.3 + i * 0.8)
      pots.push(p)
    }
    bake(pots, clay)

    // ---- greenery: trellis vines on the north knee wall + bench seedlings -----
    const leafMat = new MeshStandardMaterial({
      map: toTexture(leafCanvas(rng)),
      transparent: false,
      alphaTest: 0.45,
      side: DoubleSide,
      roughness: 0.95,
    })
    const leaves: BufferGeometry[] = []
    for (let i = 0; i < 9; i++) {
      const v = new PlaneGeometry(1.4, 1.8 + rng.next() * 0.8)
      v.rotateY((rng.next() - 0.5) * 0.5)
      v.translate(-hw + 1.6 + i * 2.85, KNEE_H + 0.95, -hd + 0.18)
      leaves.push(v)
    }
    for (let i = 0; i < 9; i++) {
      const s = new PlaneGeometry(0.3, 0.34)
      s.rotateY(rng.next() * Math.PI)
      s.translate(-hw + 0.74 + (i % 2) * 0.34, 1.16, -4.3 + i * 0.8)
      leaves.push(s)
    }
    bake(leaves, leafMat)

    // ---- hanging baskets (sway in update) --------------------------------------
    for (const bx of [-10.4, -5.2, 0, 5.2, 10.4]) {
      const g = new Group()
      const wireLen = 2.1 + (bx === 0 ? 0.3 : 0)
      const wire = new Mesh(new CylinderGeometry(0.01, 0.01, wireLen, 4), white)
      wire.position.y = -wireLen / 2
      g.add(wire)
      const pot = new Mesh(new CylinderGeometry(0.18, 0.11, 0.18, 9), clay)
      pot.position.y = -wireLen - 0.06
      g.add(pot)
      for (const a of [0, Math.PI / 2]) {
        const tuft = new Mesh(new PlaneGeometry(0.66, 0.6), leafMat)
        tuft.rotation.y = a
        tuft.position.y = -wireLen + 0.16
        g.add(tuft)
      }
      g.position.set(bx, RIDGE_H - 0.12, 0.1)
      this.root.add(g)
      this.baskets.push(g)
    }

    // ---- evening lamps ----------------------------------------------------------
    const lampGlow = new MeshBasicMaterial({ color: '#ffd9a0' })
    for (const [lx, lz] of [
      [-5.6, -hd + 1.1],
      [5.6, -hd + 1.1],
      [-5.6, hd - 1.3],
      [5.6, hd - 1.3],
    ]) {
      const post = new Mesh(new CylinderGeometry(0.05, 0.06, 1.7, 8), brown)
      post.position.set(lx, 0.85, lz)
      this.root.add(post)
      const head = new Mesh(new BoxGeometry(0.18, 0.2, 0.18), lampGlow)
      head.position.set(lx, 1.78, lz)
      this.root.add(head)
    }
    this.lampA = new PointLight('#ffc98a', 0, 20, 1.4)
    this.lampA.position.set(0, 3.4, -0.6)
    this.root.add(this.lampA)

    this.root.visible = false
  }

  /** show/hide the set + its lamp (the lamp warms evenings under glass) */
  setActive(on: boolean): void {
    this.root.visible = on
    this.lampA.intensity = on ? 1.1 : 0
  }

  get active(): boolean {
    return this.root.visible
  }

  /** hanging baskets sway gently — the set breathes; zero allocations */
  update(dt: number): void {
    if (!this.root.visible) return
    this.t += dt
    for (let i = 0; i < this.baskets.length; i++) {
      this.baskets[i].rotation.x = Math.sin(this.t * 0.8 + i * 1.7) * 0.04
      this.baskets[i].rotation.z = Math.cos(this.t * 0.6 + i * 2.3) * 0.05
    }
  }
}
