/** The flock — Quaternius animated sheep (CC0) living in the wooden pen.
 * Off-mission they graze: amble to a spot, nibble (Idle_Eating), repeat.
 * HERDING MISSION: some sheep slip out the pen gate and scatter across the
 * meadow. Loose sheep graze until the player or Rex gets close, then FLEE
 * away from the threat with a gentle bias toward the pen gate — so standing
 * on the far side pushes them home. Walls are honest: sheep never clip
 * through the picket ring or the pen rails (gate gaps excluded).
 * Pure-suggestion design: nothing locks, missions just pay when done. */
import {
  AnimationAction,
  AnimationMixer,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Vector3,
  type AnimationClip,
} from 'three'
import { fenceFor, PEN } from '../game/expansion'
import { blockByEdges, type FenceSets } from '../game/fence'
import { type PenRect } from '../game/layout'
import { mulberry32, type Rng } from '../game/rng'
import { type Assets } from './assets'
import { WORLD_BOUNDS } from './scenery'
import { assertSpawnScale, measuredHeight, SCALE, sheepScaleFor } from './scale'

const GRAZE_SPEED = 0.7
const ESCAPE_SPEED = 1.6
const FLEE_SPEED = 2.7
const FLEE_R = 3.2
const TURN_RATE = 7
/** where escapees wander to (jittered per mission).
 * tiers 0-2: the pen sits outside the picket ring, so sheep scatter into the
 * open WEST meadow (no ring walls on the way). tier 3 fences the pasture in,
 * so the flock raids the YARD instead ("sheep in the crops!"). */
/** scatter offsets from the PEN CENTER (the pen is a movable now): the west
 * meadow raid at the authored spot, reproduced exactly at the default pen */
const SCATTER_NEAR: Array<[number, number]> = [
  [-5.2, 1.2],
  [-4.7, -4.8],
  [-0.7, 6.7],
]
/** the tier-3 yard raid stays absolute — "sheep in the crops!" */
const SCATTER_YARD: Array<[number, number]> = [
  [-5.5, 8.0],
  [-2.5, -6.5],
  [3.0, -2.0],
]

/** everything the flock derives from wherever its pen stands today */
interface PenGeom {
  rect: PenRect
  gateOut: Vector3
  gateIn: Vector3
  cornerN: Vector3
  cornerS: Vector3
  westN: Vector3
  westS: Vector3
  scatterNear: Vector3[]
}

function penGeometry(rect: PenRect): PenGeom {
  const gateMid = (rect.gate.z0 + rect.gate.z1) / 2
  const cx = (rect.x0 + rect.x1) / 2
  const cz = (rect.z0 + rect.z1) / 2
  return {
    rect,
    gateOut: new Vector3(rect.x1 + 0.7, 0, gateMid),
    gateIn: new Vector3(rect.x1 - 0.8, 0, gateMid),
    cornerN: new Vector3(rect.x1 + 0.9, 0, rect.z1 + 1.2),
    cornerS: new Vector3(rect.x1 + 0.9, 0, rect.z0 - 1.2),
    westN: new Vector3(rect.x0 - 1.0, 0, rect.z1 + 1.2),
    westS: new Vector3(rect.x0 - 1.0, 0, rect.z0 - 1.2),
    scatterNear: SCATTER_NEAR.map(([dx, dz]) => new Vector3(cx + dx, 0, cz + dz)),
  }
}

/** the authored pen as a PenRect (the flock's default until main binds one) */
const DEFAULT_PEN: PenRect = { x0: PEN.x0, z0: PEN.z0, x1: PEN.x1, z1: PEN.z1, gate: { z0: PEN.gate.z0, z1: PEN.gate.z1 } }

interface WallGate {
  /** 'z' = gate span along z on a wall x=line; 'x' = span along x on z=line */
  axis: 'x' | 'z'
  line: number
  c0: number
  c1: number
}

type Mode = 'penned' | 'escaping' | 'loose' | 'homing'

interface SheepUnit {
  group: Group
  mixer: AnimationMixer
  idle: AnimationAction | null
  eat: AnimationAction | null
  walk: AnimationAction | null
  run: AnimationAction | null
  current: AnimationAction | null
  mode: Mode
  dest: Vector3 | null
  waypoints: Vector3[]
  heading: number
  speed: number
  grazeTimer: number
  baaTimer: number
  prev: { x: number; z: number }
  modelScale: number
  /** seconds spent shoving a fence — give up and graze past the threshold */
  blockedFor: number
}

function suffixAction(mixer: AnimationMixer, root: Group, clips: AnimationClip[], suffix: string): AnimationAction | null {
  const clip = clips.find((c) => c.name.toLowerCase().endsWith(suffix.toLowerCase()))
  return clip ? mixer.clipAction(clip, root) : null
}

export class Flock {
  readonly sheep: SheepUnit[] = []
  /** fires once per sheep that makes it home during a mission */
  onSheepHome: ((left: number) => void) | null = null
  /** fires when the last loose sheep is penned (count = how many escaped) */
  onAllHome: ((count: number) => void) | null = null
  /** ambient + event baas (main rate-limits/picks volume) */
  onBaa: ((at: Vector3) => void) | null = null

  private rng: Rng
  private escaped = 0
  private tier = 0
  private geo: PenGeom = penGeometry(DEFAULT_PEN)
  private fences: FenceSets | null = null

  constructor(private assets: Assets, private scene: Scene, count: number, seed: number) {
    this.rng = mulberry32(seed)
    for (let i = 0; i < count; i++) this.addSheep()
  }

  /** the pen moved: re-derive every waypoint and carry the penned sheep
   * along (their whole world is the pen). Loose sheep stay loose where
   * they are — the mission lock in main means none exist during a move. */
  setPen(rect: PenRect): void {
    const dx = (rect.x0 + rect.x1) / 2 - (this.geo.rect.x0 + this.geo.rect.x1) / 2
    const dz = (rect.z0 + rect.z1) / 2 - (this.geo.rect.z0 + this.geo.rect.z1) / 2
    this.geo = penGeometry(rect)
    for (const u of this.sheep) {
      if (u.mode !== 'penned') continue
      u.group.position.x += dx
      u.group.position.z += dz
      u.prev.x = u.group.position.x
      u.prev.z = u.group.position.z
      if (u.dest) {
        u.dest.x += dx
        u.dest.z += dz
      }
    }
  }

  private insidePen(x: number, z: number, pad: number): boolean {
    const r = this.geo.rect
    return x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad
  }

  addSheep(): void {
    const g = this.assets.spawnSkinned('sheep')
    const rawH = measuredHeight(g)
    const s = sheepScaleFor(this.rng, rawH)
    g.scale.setScalar(s)
    assertSpawnScale('sheep', rawH * s, SCALE.sheep.min, SCALE.sheep.max)
    // SheepAlt.glb is a proper rounded sheep — no puppet dressing needed.
    // Its FBX2glTF materials ship metallic; force matte wool + a touch of
    // per-sheep warmth so the flock isn't carbon copies.
    g.traverse((o) => {
      if (o instanceof Mesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) {
          if (m instanceof MeshStandardMaterial) {
            m.metalness = 0
            m.roughness = 1
            // only the white wool shifts; the black face/legs stay black
            if (m.color.r > 0.5) m.color.offsetHSL(0.02, 0.04, -0.02 + this.rng.next() * 0.04)
          }
        }
      }
    })
    const r = this.geo.rect
    const x = r.x0 + 0.9 + this.rng.next() * (r.x1 - r.x0 - 1.8)
    const z = r.z0 + 0.9 + this.rng.next() * (r.z1 - r.z0 - 1.8)
    g.position.set(x, 0, z)
    const heading = this.rng.next() * Math.PI * 2
    g.rotation.y = heading
    this.scene.add(g)
    const mixer = new AnimationMixer(g)
    const clips = this.assets.clips('sheep')
    const unit: SheepUnit = {
      group: g,
      mixer,
      idle: suffixAction(mixer, g, clips, 'Idle'),
      eat: suffixAction(mixer, g, clips, 'Idle_Eating'),
      walk: suffixAction(mixer, g, clips, 'Walk'),
      run: suffixAction(mixer, g, clips, 'Run'),
      current: null,
      mode: 'penned',
      dest: null,
      waypoints: [],
      heading,
      speed: 0,
      grazeTimer: 1 + this.rng.next() * 4,
      baaTimer: 6 + this.rng.next() * 18,
      prev: { x, z },
      modelScale: s,
      blockedFor: 0,
    }
    unit.idle?.play()
    unit.current = unit.idle
    this.sheep.push(unit)
  }

  get missionActive(): boolean {
    return this.sheep.some((s) => s.mode !== 'penned')
  }

  get looseCount(): number {
    return this.sheep.filter((s) => s.mode !== 'penned').length
  }

  loosePositions(): Vector3[] {
    return this.sheep.filter((s) => s.mode !== 'penned').map((s) => s.group.position)
  }

  /** kick off a mission: k sheep bolt out the gate to scatter spots */
  startEscape(k: number, tier: number): number {
    this.tier = tier
    const penned = this.sheep.filter((s) => s.mode === 'penned')
    const n = Math.min(k, penned.length)
    const g = this.geo
    const spots = tier >= 3 ? SCATTER_YARD.map(([x, z]) => new Vector3(x, 0, z)) : g.scatterNear
    for (let i = 0; i < n; i++) {
      const u = penned[i]
      const spot = spots[Math.floor(this.rng.next() * spots.length)]
      const target = new Vector3(
        spot.x + (this.rng.next() - 0.5) * 3,
        0,
        spot.z + (this.rng.next() - 0.5) * 3,
      )
      u.mode = 'escaping'
      u.waypoints = [g.gateIn.clone(), g.gateOut.clone()]
      // pen-bound runaways lane around the rails (corner, then the west lane)
      const north = target.z >= (g.rect.z0 + g.rect.z1) / 2
      if (target.x < g.rect.x1 + 1) u.waypoints.push((north ? g.cornerN : g.cornerS).clone())
      if (target.x < g.rect.x0 - 0.5) u.waypoints.push((north ? g.westN : g.westS).clone())
      u.waypoints.push(target)
      u.dest = u.waypoints.shift()!
      this.onBaa?.(u.group.position)
    }
    this.escaped = n
    return n
  }

  /** where a fleeing sheep should be funneled next: around the pen corner if
   * she's west of the pen, otherwise straight at the gate mouth */
  private funnelPoint(p: Vector3): Vector3 {
    // funnel chain: around the pen (west lane → corner) — every hop moves
    // toward the gate, so it terminates. The old picket-ring corner hints
    // remain as gentle routing flavor where the DEFAULT ring once stood.
    const g = this.geo
    const north = p.z >= (g.rect.z0 + g.rect.z1) / 2
    // the +0.2 covers wall-huggers pressed against the west rails, so corner
    // deadlocks resolve by sliding west into the lane first
    if (p.x < g.rect.x0 + 0.2) return north ? g.westN : g.westS
    if (p.x < g.rect.x1 + 0.4) return north ? g.cornerN : g.cornerS
    const f = fenceFor(this.tier)
    if (p.z > f.maxZ - 0.1 && p.x > f.minX - 0.4) return new Vector3(f.minX - 0.9, 0, f.maxZ + 0.9)
    if (p.z < f.minZ + 0.1 && p.x > f.minX - 0.4) return new Vector3(f.minX - 0.9, 0, f.minZ - 0.9)
    return g.gateOut
  }

  update(dt: number, playerPos: Vector3, dogPos: Vector3, tier = 0, fences: FenceSets | null = null): void {
    this.tier = tier
    this.fences = fences
    for (const u of this.sheep) {
      u.baaTimer -= dt
      if (u.baaTimer <= 0) {
        u.baaTimer = 8 + this.rng.next() * 20
        this.onBaa?.(u.group.position)
      }
      switch (u.mode) {
        case 'penned': {
          const r = this.geo.rect
          this.graze(u, dt, r.x0 + 0.8, r.x1 - 0.8, r.z0 + 0.8, r.z1 - 0.8)
          break
        }
        case 'escaping':
          if (this.walkTo(u, dt, ESCAPE_SPEED)) {
            if (u.waypoints.length) u.dest = u.waypoints.shift()!
            else {
              u.mode = 'loose'
              u.dest = null
            }
          }
          break
        case 'loose':
          this.loose(u, dt, playerPos, dogPos)
          break
        case 'homing':
          if (this.walkTo(u, dt, ESCAPE_SPEED)) {
            if (u.waypoints.length) {
              u.dest = u.waypoints.shift()!
            } else {
              // she's actually INSIDE now (last waypoint is past the gate)
              u.mode = 'penned'
              u.dest = null
              const left = this.looseCount
              this.onSheepHome?.(left)
              this.onBaa?.(u.group.position)
              if (left === 0) this.onAllHome?.(this.escaped)
            }
          }
          break
      }
      this.move(u, dt)
    }
  }

  frame(dt: number): void {
    for (const u of this.sheep) u.mixer.update(dt)
  }

  // ---- behaviors ------------------------------------------------------------

  private graze(u: SheepUnit, dt: number, x0: number, x1: number, z0: number, z1: number): void {
    if (u.dest) {
      if (this.walkTo(u, dt, GRAZE_SPEED)) u.dest = null
      return
    }
    u.grazeTimer -= dt
    this.play(u, u.eat ?? u.idle, 1)
    u.speed = 0
    if (u.grazeTimer <= 0) {
      u.grazeTimer = 3.5 + this.rng.next() * 5.5
      u.dest = new Vector3(x0 + this.rng.next() * (x1 - x0), 0, z0 + this.rng.next() * (z1 - z0))
    }
  }

  private loose(u: SheepUnit, dt: number, playerPos: Vector3, dogPos: Vector3): void {
    const p = u.group.position
    const dPlayer = p.distanceTo(playerPos)
    const dDog = p.distanceTo(dogPos)
    const threat = dPlayer < dDog ? playerPos : dogPos
    const dThreat = Math.min(dPlayer, dDog)
    const funnel = this.funnelPoint(p)
    if (dThreat < FLEE_R) {
      const away = p.clone().sub(threat).setY(0).normalize()
      const toGate = funnel.clone().sub(p).setY(0).normalize()
      let dir = away.multiplyScalar(0.72).add(toGate.multiplyScalar(0.28)).normalize()
      // never flee INTO the pen rails — fall back to the pure funnel route
      const probe = p.clone().add(dir.clone().multiplyScalar(1.2))
      if (this.insidePen(probe.x, probe.z, 0.35)) dir = funnel.clone().sub(p).setY(0).normalize()
      u.dest = p.clone().add(dir.multiplyScalar(2.2))
      u.dest.x = Math.max(WORLD_BOUNDS.minX + 1, Math.min(WORLD_BOUNDS.maxX - 1, u.dest.x))
      u.dest.z = Math.max(WORLD_BOUNDS.minZ + 1, Math.min(WORLD_BOUNDS.maxZ - 1, u.dest.z))
      this.walkTo(u, dt, FLEE_SPEED)
      // once she's at the gate mouth she gives in and trots home
      if (p.distanceTo(this.geo.gateOut) < 2.2) {
        u.mode = 'homing'
        u.waypoints = [this.geo.gateIn.clone().add(new Vector3(-(0.5 + this.rng.next()), 0, (this.rng.next() - 0.5) * 1.5))]
        u.dest = this.geo.gateOut.clone()
      }
      return
    }
    // unbothered: graze loosely around wherever she is
    this.graze(u, dt, p.x - 2.2, p.x + 2.2, p.z - 2.2, p.z + 2.2)
  }

  /** returns true when arrived */
  private walkTo(u: SheepUnit, dt: number, speed: number): boolean {
    if (!u.dest) return true
    const to = u.dest.clone().sub(u.group.position).setY(0)
    const d = to.length()
    if (d < 0.25) {
      u.speed = 0
      return true
    }
    u.speed += (speed - u.speed) * Math.min(1, 5 * dt)
    const want = Math.atan2(to.x, to.z)
    let dh = want - u.heading
    while (dh > Math.PI) dh -= Math.PI * 2
    while (dh < -Math.PI) dh += Math.PI * 2
    u.heading += dh * Math.min(1, TURN_RATE * dt)
    u.group.rotation.y = u.heading
    const step = Math.min(d, u.speed * dt)
    u.group.position.add(to.normalize().multiplyScalar(step))
    // anim: run when fleeing, walk otherwise; timeScale rides ground speed
    if (u.speed > 2.0) this.play(u, u.run ?? u.walk, Math.min(1.8, u.speed / 2.4))
    else this.play(u, u.walk ?? u.idle, Math.max(0.7, u.speed / 0.9))
    return false
  }

  /** wall honesty: cancel any crossing of the pen rails, except through the
   * gate. The PICKET RING is the player's now (an edge-set they can redraw
   * or demolish — see game/fence.ts), so the old invisible tier-rect wall is
   * gone; sheep learn to respect player fences in Phase 3. */
  private move(u: SheepUnit, dt: number): void {
    const p = u.group.position
    const r = this.geo.rect
    blockRect(u.prev, p, r.x0, r.x1, r.z0, r.z1, [
      { axis: 'z', line: r.x1, c0: r.gate.z0, c1: r.gate.z1 },
    ])
    // player fences are real to sheep now (gates pass — sheep use them
    // politely). A blocked traveler re-routes through the funnel; one who
    // has been shoving a fence for seconds GIVES UP and grazes where she
    // stands — no sheep ever grinds forever, the mission stays pushable,
    // and demolition remains the player's escape hatch for true mazes.
    if (this.fences && blockByEdges(u.prev, p, this.fences)) {
      if (u.mode === 'escaping' || u.mode === 'homing') {
        u.blockedFor += dt
        if (u.blockedFor > 3.5) {
          u.dest = null
          u.waypoints = []
          u.blockedFor = 0
          if (this.insidePen(p.x, p.z, 0)) {
            // she gave up INSIDE the pen — that counts as home
            u.mode = 'penned'
            const left = this.looseCount
            this.onSheepHome?.(left)
            if (left === 0) this.onAllHome?.(this.escaped)
          } else {
            u.mode = 'loose'
          }
        } else {
          u.dest = this.funnelPoint(p)
        }
      }
    } else {
      u.blockedFor = 0
    }
    u.prev.x = p.x
    u.prev.z = p.z
  }

  private play(u: SheepUnit, next: AnimationAction | null, timeScale: number): void {
    if (!next) return
    next.timeScale = timeScale
    if (next === u.current) return
    next.reset().play()
    if (u.current) u.current.crossFadeTo(next, 0.22, false)
    u.current = next
  }
}

/** cancel rect-boundary crossings except through listed gate spans */
function blockRect(
  prev: { x: number; z: number },
  p: Vector3,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  gates: WallGate[],
): void {
  const inX = Math.max(prev.x, p.x) > minX - 0.2 && Math.min(prev.x, p.x) < maxX + 0.2
  const inZ = Math.max(prev.z, p.z) > minZ - 0.2 && Math.min(prev.z, p.z) < maxZ + 0.2
  for (const line of [minZ, maxZ]) {
    if (inX && (prev.z - line) * (p.z - line) < 0) {
      const open = gates.some((g) => g.axis === 'x' && Math.abs(g.line - line) < 0.01 && p.x > g.c0 && p.x < g.c1)
      if (!open) p.z = prev.z
    }
  }
  for (const line of [minX, maxX]) {
    if (inZ && (prev.x - line) * (p.x - line) < 0) {
      const open = gates.some((g) => g.axis === 'z' && Math.abs(g.line - line) < 0.01 && p.z > g.c0 && p.z < g.c1)
      if (!open) p.x = prev.x
    }
  }
}
