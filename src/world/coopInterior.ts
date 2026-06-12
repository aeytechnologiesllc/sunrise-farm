/** The HENHOUSE — the coop's walk-in interior (owner: "life size, walk
 * inside, real animations, never feels like standing in an asset").
 * Same off-world trick as the greenhouse/dinner sets: a little shed outside,
 * a warm plank hall in here. The full shell is built ONCE; the east wing and
 * the long wing wait behind BOARDED partitions that visibly open when bought
 * (no live geometry rebuilds — visible locked space sells the upgrade).
 *
 * What's alive in here: the named nesting boxes along the north wall (each
 * hen's plaque, her egg appearing in the straw), real procedural hens
 * ambling and pecking the floor, lantern light flickering, dust motes in
 * the window shafts, straw everywhere. Opaque walls mean the world's sun
 * never reaches in — the lighting is the art. */
import gsap from 'gsap'
import {
  AdditiveBlending,
  Box3,
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
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { HEN_CAPACITY } from '../game/henhouse'
import { mulberry32, type Rng } from '../game/rng'
import { tint } from './assets'
import { buildHen } from './Chicken'
import { assertSpawnScale, henScaleFor, SCALE } from './scale'
import { makeCanvas, toTexture, woodCanvas } from './textures'

export const COOP_ANCHOR = new Vector3(120, 0, -120)

/** base hall x-extent; each wing adds 7 more to the east */
const BASE_HALF = 7
const WING_W = 7
const ROOM_D = 9
const WALL_H = 3.0
const RIDGE_H = 4.4
const DOOR_HALF = 0.95
/** nesting boxes march along the north wall, one per possible hen */
const BOX_STEP = 2.05
const BOX_X0 = -5.8
const BOX_Z = -ROOM_D / 2 + 0.65

/** straw-littered plank floor */
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
  // scattered straw
  for (let i = 0; i < 260; i++) {
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

/** straw pile fill for nesting boxes */
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

/** a hen's name plaque above her box */
function plaqueCanvas(name: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 40)
  g.fillStyle = '#6b4d2e'
  g.fillRect(0, 0, 128, 40)
  g.fillStyle = '#8a6a44'
  g.fillRect(3, 3, 122, 34)
  g.fillStyle = '#fff3d8'
  g.font = "bold 19px 'Trebuchet MS', sans-serif"
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(name, 64, 21)
  return c
}

interface InteriorHen {
  group: Group
  rig: ReturnType<typeof buildHen>['rig']
  tx: number
  tz: number
  timer: number
  pecking: number
  phase: number
}

export class CoopInterior {
  readonly spawnPos: Vector3
  readonly exitPos: Vector3
  /** world positions of every nesting box mouth (collection anchors) */
  readonly boxPositions: Vector3[] = []
  /** the buy-a-hen crate and the wing boards (interaction anchors) */
  readonly cratePos: Vector3
  readonly wingBoardPos: Vector3[] = []
  /** opaque walls — registered in OCCLUDERS only while inside */
  readonly shell: Mesh[] = []

  private readonly root = new Group()
  private readonly lamps: PointLight[] = []
  private readonly lampHeads: Mesh[] = []
  private boards: Group[] = []
  private eggs: Mesh[] = []
  private plaques: Mesh[] = []
  private plaqueFor: string[] = []
  private hens: InteriorHen[] = []
  private henRng = mulberry32(0xfeed5)
  private tier = 0
  private motes: Points | null = null
  private t = 0

  constructor(scene: Scene) {
    const rng = mulberry32(0xc0091)
    const ax = COOP_ANCHOR.x
    const az = COOP_ANCHOR.z
    this.root.position.copy(COOP_ANCHOR)
    scene.add(this.root)

    const fullHalfE = BASE_HALF + WING_W * 2 // east extent of the full shell
    const hd = ROOM_D / 2

    this.spawnPos = new Vector3(ax, 0, az + hd - 3.0)
    this.exitPos = new Vector3(ax, 0, az + hd - 0.4)
    this.cratePos = new Vector3(ax + 3.4, 0, az + hd - 1.6)
    this.wingBoardPos = [
      new Vector3(ax + BASE_HALF - 0.4, 0, az),
      new Vector3(ax + BASE_HALF + WING_W - 0.4, 0, az),
    ]
    for (let i = 0; i < HEN_CAPACITY[HEN_CAPACITY.length - 1]; i++) {
      this.boxPositions.push(new Vector3(ax + BOX_X0 + i * BOX_STEP, 0, az + BOX_Z + 0.55))
    }

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

    // ---- floor -----------------------------------------------------------
    const floorTex = toTexture(strawFloorCanvas(rng), true)
    floorTex.repeat.set(9, 3)
    const floor = new PlaneGeometry(fullHalfE + BASE_HALF + 1, ROOM_D + 0.6)
    floor.rotateX(-Math.PI / 2)
    floor.translate((fullHalfE - BASE_HALF) / 2, 0.01, 0)
    bake([floor], new MeshStandardMaterial({ map: floorTex, roughness: 1 }))

    // ---- plank walls + gabled ceiling (the full shell, wings included) ----
    const plank = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#7a5a38'), true), roughness: 0.95 })
    const darkPlank = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#5d4329'), true), roughness: 0.95 })
    const walls: BufferGeometry[] = []
    const W = fullHalfE + BASE_HALF // full width
    const cx = (fullHalfE - BASE_HALF) / 2 // shell center x (local)
    box(walls, W, WALL_H, 0.24, cx, WALL_H / 2, -hd) // north
    box(walls, 0.24, WALL_H, ROOM_D, -BASE_HALF, WALL_H / 2, 0) // west
    box(walls, 0.24, WALL_H, ROOM_D, fullHalfE, WALL_H / 2, 0) // east end
    // south wall with the door gap + window cutouts (windows are just
    // emissive shaft planes — the wall stays solid behind the glow)
    const segW = (W - DOOR_HALF * 2) / 2
    box(walls, segW, WALL_H, 0.24, -BASE_HALF + segW / 2, WALL_H / 2, hd)
    box(walls, W - segW - DOOR_HALF * 2, WALL_H, 0.24, DOOR_HALF + (W - segW - DOOR_HALF * 2) / 2, WALL_H / 2, hd)
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
      const r = new BoxGeometry(W, 0.18, slope)
      r.rotateX(s * pitch)
      r.translate(cx, (WALL_H + RIDGE_H) / 2, (s * hd) / 2)
      walls.push(r)
    }
    for (const s of [-1, 1]) {
      // gable end triangles (как quads — opaque, dark)
      const gg = new BoxGeometry(0.22, RIDGE_H - WALL_H, ROOM_D)
      gg.translate(s > 0 ? fullHalfE : -BASE_HALF, WALL_H + (RIDGE_H - WALL_H) / 2, 0)
      walls.push(gg)
    }
    bake(walls, plank, true)

    // rafters + ridge beam
    const beams: BufferGeometry[] = []
    box(beams, W, 0.16, 0.16, cx, RIDGE_H - 0.1, 0)
    for (let x = -BASE_HALF + 2; x < fullHalfE; x += 3.5) {
      for (const s of [-1, 1]) {
        const r = new BoxGeometry(0.12, 0.12, slope)
        r.rotateX(s * pitch)
        r.translate(x, (WALL_H + RIDGE_H) / 2, (s * hd) / 2)
        beams.push(r)
      }
    }
    bake(beams, darkPlank)

    // ---- nesting boxes along the north wall (one per possible hen) -------
    const strawMat = new MeshStandardMaterial({ map: toTexture(strawCanvas(rng), true), roughness: 1 })
    const cubbies: BufferGeometry[] = []
    const strawFills: BufferGeometry[] = []
    for (let i = 0; i < this.boxPositions.length; i++) {
      const bx = BOX_X0 + i * BOX_STEP
      const bz = BOX_Z
      box(cubbies, 1.5, 0.12, 1.1, bx, 0.06, bz) // base
      box(cubbies, 1.5, 0.7, 0.1, bx, 0.47, bz - 0.5) // back
      box(cubbies, 0.1, 0.62, 1.06, bx - 0.7, 0.43, bz) // sides
      box(cubbies, 0.1, 0.62, 1.06, bx + 0.7, 0.43, bz)
      box(cubbies, 1.5, 0.1, 1.16, bx, 0.82, bz) // lid
      box(cubbies, 1.5, 0.1, 0.1, bx, 0.17, bz + 0.52) // lip
      const straw = new BoxGeometry(1.3, 0.1, 0.9)
      straw.translate(bx, 0.17, bz)
      strawFills.push(straw)
    }
    bake(cubbies, darkPlank)
    bake(strawFills, strawMat)

    // eggs (hidden until their box is ready) + name plaques (set later)
    const eggMat = new MeshStandardMaterial({ color: '#fff6e4', roughness: 0.5 })
    for (let i = 0; i < this.boxPositions.length; i++) {
      const e = new Mesh(new SphereGeometry(0.13, 10, 8), eggMat)
      e.scale.set(1, 1.25, 1)
      e.position.set(BOX_X0 + i * BOX_STEP + 0.15, 0.3, BOX_Z + 0.1)
      e.visible = false
      this.root.add(e)
      this.eggs.push(e)
      const pl = new Mesh(new PlaneGeometry(0.9, 0.28), new MeshBasicMaterial({ transparent: true }))
      pl.position.set(BOX_X0 + i * BOX_STEP, 1.05, BOX_Z - 0.38)
      pl.visible = false
      this.root.add(pl)
      this.plaques.push(pl)
      this.plaqueFor.push('')
    }

    // ---- roosts, trough, hay bin, the buy-crate ---------------------------
    const props: BufferGeometry[] = []
    for (const [rx, rh] of [[-5.6, 0.7], [-4.2, 1.0], [-2.8, 0.7]] as Array<[number, number]>) {
      const bar = new BoxGeometry(0.09, 0.09, 5.4)
      bar.rotateY(Math.PI / 2)
      bar.translate(rx + 2.6, rh, hd - 2.2)
      props.push(bar)
      for (const e of [-2.6, 2.6]) box(props, 0.09, rh, 0.09, rx + 2.6 + e, rh / 2, hd - 2.2)
    }
    box(props, 2.2, 0.3, 0.5, -2.0, 0.18, 0.6) // feed trough
    box(props, 0.9, 0.8, 0.9, -BASE_HALF + 0.85, 0.4, -hd + 1.4, 0.3) // hay bin
    box(props, 0.85, 0.6, 0.85, this.cratePos.x - ax, 0.3, this.cratePos.z - az, 0.2) // the hen crate
    bake(props, plank)

    // ---- boarded wing partitions (open on purchase) ------------------------
    for (let w = 0; w < 2; w++) {
      const px = BASE_HALF + w * WING_W
      const wallG: BufferGeometry[] = []
      // partition wall above + beside a doorway opening
      box(wallG, 0.18, WALL_H - 2.1, 2.2, px, 2.1 + (WALL_H - 2.1) / 2, 0)
      box(wallG, 0.18, WALL_H, (ROOM_D - 2.2) / 2, px, WALL_H / 2, -(2.2 / 2 + (ROOM_D - 2.2) / 4))
      box(wallG, 0.18, WALL_H, (ROOM_D - 2.2) / 2, px, WALL_H / 2, 2.2 / 2 + (ROOM_D - 2.2) / 4)
      bake(wallG, plank, true)
      // the boards across the doorway — these come OFF when the wing opens
      const boardsG = new Group()
      const boardMat = new MeshStandardMaterial({ map: toTexture(woodCanvas(rng, '#8a6a42'), true), roughness: 1 })
      for (let b = 0; b < 4; b++) {
        const bd = new Mesh(new BoxGeometry(0.12, 0.3, 2.3), boardMat)
        bd.position.set(px, 0.5 + b * 0.55, 0)
        bd.rotation.x = (rng.next() - 0.5) * 0.18
        boardsG.add(bd)
      }
      this.root.add(boardsG)
      this.boards.push(boardsG)
    }

    // ---- light shafts + motes + lanterns (the opaque-room art pass) -------
    const shaftMat = new MeshBasicMaterial({
      color: '#ffe9b8',
      transparent: true,
      opacity: 0.13,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    })
    for (const sx of [-4, 1, 6, 12, 18]) {
      const shaft = new Mesh(new PlaneGeometry(1.4, 2.9), shaftMat)
      shaft.position.set(sx, 1.65, hd - 1.3)
      shaft.rotation.x = 0.5
      this.root.add(shaft)
    }
    const moteN = 60
    const motePos = new Float32Array(moteN * 3)
    for (let i = 0; i < moteN; i++) {
      motePos[i * 3] = -BASE_HALF + Math.random() * W
      motePos[i * 3 + 1] = 0.4 + Math.random() * 2.4
      motePos[i * 3 + 2] = -hd + Math.random() * ROOM_D
    }
    const moteGeo = new BufferGeometry()
    moteGeo.setAttribute('position', new BufferAttribute(motePos, 3))
    this.motes = new Points(
      moteGeo,
      new PointsMaterial({ color: '#ffe9b8', size: 0.035, transparent: true, opacity: 0.65, depthWrite: false }),
    )
    this.root.add(this.motes)

    const lampGlow = new MeshBasicMaterial({ color: '#ffd9a0' })
    for (const lx of [-3, 4, 11, 18]) {
      const head = new Mesh(new CylinderGeometry(0.12, 0.16, 0.22, 8), lampGlow)
      head.position.set(lx, RIDGE_H - 0.55, 0)
      this.root.add(head)
      this.lampHeads.push(head)
      const wire = new Mesh(new CylinderGeometry(0.012, 0.012, 0.45, 4), darkPlank)
      wire.position.set(lx, RIDGE_H - 0.27, 0)
      this.root.add(wire)
      const l = new PointLight('#ffc98a', 0, 11, 1.5)
      l.position.set(lx, RIDGE_H - 0.7, 0)
      this.root.add(l)
      this.lamps.push(l)
    }

    this.root.visible = false
  }

  /** player walk bounds for the CURRENT tier (wings unlock eastward) */
  boundsForTier(tier: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
    const ax = COOP_ANCHOR.x
    const az = COOP_ANCHOR.z
    return {
      minX: ax - BASE_HALF + 0.55,
      maxX: ax + BASE_HALF + WING_W * Math.max(0, Math.min(2, tier)) - 0.55,
      minZ: az - ROOM_D / 2 + 0.55,
      maxZ: az + ROOM_D / 2 - 0.3,
    }
  }

  /** sync the room to the flock: boards off for owned wings, plaques named,
   * eggs shown for ready boxes, hen headcount matched */
  sync(flock: { hens: Array<{ seed: number; name: string }>; tier: number; boxes: Array<{ ready: boolean }> }): void {
    this.tier = flock.tier
    for (let w = 0; w < this.boards.length; w++) this.boards[w].visible = flock.tier <= w
    for (let i = 0; i < this.plaques.length; i++) {
      const hen = flock.hens[i]
      this.plaques[i].visible = !!hen
      if (hen && this.plaqueFor[i] !== hen.name) {
        this.plaqueFor[i] = hen.name
        const mat = this.plaques[i].material as MeshBasicMaterial
        mat.map?.dispose()
        mat.map = toTexture(plaqueCanvas(hen.name))
        mat.needsUpdate = true
      }
      this.eggs[i].visible = !!flock.boxes[i]?.ready
    }
    // hen headcount follows the flock
    while (this.hens.length < flock.hens.length) this.addHen(flock.hens[this.hens.length].seed)
    while (this.hens.length > flock.hens.length) {
      const h = this.hens.pop()!
      this.root.remove(h.group)
    }
  }

  private addHen(seed: number): void {
    const rng = mulberry32(seed)
    const { group, rig } = buildHen()
    // measure at scale 1, tint, THEN size — the repo's hen scale contract
    // (shin-high birds; rng draw order pinned by tests/scale.test.ts)
    const built = new Box3().setFromObject(group).getSize(new Vector3()).y
    tint(group, (rng.next() - 0.5) * 0.08, (rng.next() - 0.5) * 0.12)
    const s = henScaleFor(rng, built)
    assertSpawnScale('henhouse hen', built * s, SCALE.hen.min, SCALE.hen.max)
    group.scale.setScalar(s)
    const b = this.localWander(rng)
    group.position.set(b.x, 0, b.z)
    group.rotation.y = rng.next() * Math.PI * 2
    this.root.add(group)
    this.hens.push({ group, rig, tx: b.x, tz: b.z, timer: 1 + rng.next() * 3, pecking: 0, phase: rng.next() * 9 })
  }

  private localWander(rng: { next(): number }): { x: number; z: number } {
    const maxX = BASE_HALF + WING_W * this.tier - 1.2
    return {
      x: -BASE_HALF + 1.2 + rng.next() * (maxX + BASE_HALF - 2.4),
      z: -ROOM_D / 2 + 2.0 + rng.next() * (ROOM_D - 3.4),
    }
  }

  /** the wing-opening ceremony: the doorway boards fly off one by one.
   * Boards re-parent to the room root first so sync() hiding their group
   * can't cut the flight short. */
  blowBoards(wing: number): void {
    const g = this.boards[wing]
    if (!g) return
    for (const bd of [...g.children]) {
      g.remove(bd)
      this.root.add(bd) // same coordinate space — the group sits at origin
      const dx = (this.henRng.next() - 0.5) * 2.4
      gsap.to(bd.position, { x: bd.position.x + dx, y: bd.position.y + 1.2 + this.henRng.next(), z: bd.position.z + (this.henRng.next() - 0.5) * 2.4, duration: 0.55, ease: 'power2.out' })
      gsap.to(bd.rotation, { x: (this.henRng.next() - 0.5) * 5, z: (this.henRng.next() - 0.5) * 5, duration: 0.55 })
      gsap.to(bd.position, {
        y: 0.06,
        duration: 0.35,
        delay: 0.55,
        ease: 'power2.in',
        onComplete: () => {
          // settle as floor clutter for a beat, then gone
          gsap.delayedCall(2.5, () => {
            this.root.remove(bd)
          })
        },
      })
    }
  }

  /** scatter feed at the player's feet: the whole flock rushes the spot */
  scatterAt(wx: number, wz: number): void {
    const maxX = BASE_HALF + WING_W * this.tier - 0.8
    for (const h of this.hens) {
      const lx = wx - COOP_ANCHOR.x + (this.henRng.next() - 0.5) * 1.8
      const lz = wz - COOP_ANCHOR.z + (this.henRng.next() - 0.5) * 1.8
      h.tx = Math.max(-BASE_HALF + 0.8, Math.min(maxX, lx))
      h.tz = Math.max(-ROOM_D / 2 + 0.8, Math.min(ROOM_D / 2 - 0.6, lz))
      h.pecking = 0
      h.timer = 0.1 + this.henRng.next() * 0.4
    }
  }

  setActive(on: boolean): void {
    this.root.visible = on
    for (const l of this.lamps) l.intensity = on ? 1.0 : 0
  }

  get active(): boolean {
    return this.root.visible
  }

  /** hens amble + peck; lanterns flicker; motes drift — the room breathes */
  update(dt: number): void {
    if (!this.root.visible) return
    this.t += dt
    for (const h of this.hens) {
      if (h.pecking > 0) {
        h.pecking -= dt
        // head-bob peck: pitch the whole hen forward in little dips
        h.group.rotation.x = Math.max(0, Math.sin(this.t * 9 + h.phase)) * 0.38
        if (h.pecking <= 0) h.group.rotation.x = 0
        continue
      }
      const dx = h.tx - h.group.position.x
      const dz = h.tz - h.group.position.z
      const d = Math.hypot(dx, dz)
      if (d < 0.15) {
        h.timer -= dt
        if (h.timer <= 0) {
          if (this.henRng.next() < 0.55) {
            h.pecking = 1.2 + this.henRng.next() * 1.6
            h.timer = 0.5
          } else {
            const b = this.localWander(this.henRng)
            h.tx = b.x
            h.tz = b.z
            h.timer = 1.5 + this.henRng.next() * 3.5
          }
        }
      } else {
        const sp = 0.45 * dt
        h.group.position.x += (dx / d) * Math.min(sp, d)
        h.group.position.z += (dz / d) * Math.min(sp, d)
        h.group.rotation.y = Math.atan2(dx, dz)
        // little waddle bob while walking
        h.group.position.y = Math.abs(Math.sin(this.t * 10 + h.phase)) * 0.035
      }
    }
    for (let i = 0; i < this.lamps.length; i++) {
      const flicker = 1.0 + Math.sin(this.t * 7 + i * 2.1) * 0.06 + Math.sin(this.t * 13 + i) * 0.04
      this.lamps[i].intensity = flicker
    }
    if (this.motes) this.motes.rotation.y = Math.sin(this.t * 0.05) * 0.18
  }
}
