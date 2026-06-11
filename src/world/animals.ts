/** Paddock grazers — horse, cow and goat herds living inside fenced rects.
 * Same skinned-GLB recipe as the sheep flock (Sheep.ts): SkeletonUtils clones
 * via assets.spawnSkinned, one AnimationMixer per animal, suffix-matched clips
 * (Quaternius rigs prefix clip names with the armature path). Behavior is
 * deliberately calm: pick a spot inside the paddock every 4-9s, amble over at
 * grazing pace, then put the head down and eat. When the player wanders close
 * they stop and turn to watch — that tiny acknowledgement is what makes them
 * feel alive and pettable. Deterministic: every roll (placement, size, tint,
 * timers, destinations) comes from one mulberry32 stream seeded at
 * construction; no global random anywhere. */
import {
  AnimationAction,
  AnimationMixer,
  Group,
  Scene,
  Vector3,
  type AnimationClip,
} from 'three'
import { mulberry32, type Rng } from '../game/rng'
import { tint, type Assets, type ModelKey } from './assets'
import { assertSpawnScale, measuredHeight } from './scale'
import { dressSheep } from './sheepLook'

export type GrazerKind = 'horse' | 'cow' | 'goat'

/** axis-aligned paddock footprint a herd is confined to */
export interface PaddockRect {
  x0: number
  z0: number
  x1: number
  z1: number
}

const GRAZE_SPEED = 0.7
/** scripted delivery gallop */
const RUN_SPEED = 4.6
const TURN_RATE = 6
/** player distance that flips a grazer into watch-the-farmer mode */
const CURIOUS_R = 2.6
/** destinations stay this far inside the paddock so bodies never kiss rails */
const MARGIN = 0.5
const ARRIVE_R = 0.25

/** LOCAL height bands (world units, head-to-toe) — the Phase 1 scale ladder
 * extended sideways: the horse towers over the 1.6u farmer, the cow is
 * roughly eye level, the goat lands between sheep and dog. `spread` is the
 * seeded per-animal variety (fraction of target). */
const BAND: Record<GrazerKind, { target: number; spread: number }> = {
  horse: { target: 1.75, spread: 0.05 },
  cow: { target: 1.45, spread: 0.05 },
  goat: { target: 0.8, spread: 0.08 },
}

/** per-kind tint half-ranges (hueShift, lightness) so a herd reads as
 * individuals — cows get the widest lightness swing (patchy hides), horses
 * lean on hue (bay/chestnut drift). Goats additionally SET a warm tan `base`
 * coat first: they reuse the sheep GLB whose material is pure white, and
 * offsetting the hue of white is a no-op — without a saturated base a goat
 * can only ever read as a dirty gray sheep. The tan multiplies the atlas, so
 * fleece turns tan, face/legs turn dark brown, and the hue/light variety
 * finally becomes visible (tan-to-brown drift per animal). */
const VARIETY: Record<GrazerKind, { hue: number; light: number; base?: { h: number; s: number; l: number } }> = {
  horse: { hue: 0.03, light: 0.08 },
  cow: { hue: 0.015, light: 0.12 },
  goat: { hue: 0.04, light: 0.08, base: { h: 0.08, s: 0.55, l: 0.72 } },
}

/** grazer kinds double as their asset-registry keys ('horse' / 'cow' / 'goat'
 * in MODEL_URLS). The cast keeps this module compiling independently of
 * assets.ts (owned elsewhere) and is a no-op once those keys exist there. */
function modelKey(kind: GrazerKind): ModelKey {
  return kind as string as ModelKey
}

/** clip lookup by name SUFFIX — Quaternius exports clips as
 * 'Armature|Armature|Idle' etc., and the families differ in prefix only.
 * Same approach as Sheep.ts. */
function suffixAction(mixer: AnimationMixer, root: Group, clips: AnimationClip[], suffix: string): AnimationAction | null {
  const clip = clips.find((c) => c.name.toLowerCase().endsWith(suffix.toLowerCase()))
  return clip ? mixer.clipAction(clip, root) : null
}

interface GrazerUnit {
  kind: GrazerKind
  group: Group
  mixer: AnimationMixer
  idle: AnimationAction | null
  eat: AnimationAction | null
  walk: AnimationAction | null
  current: AnimationAction | null
  rect: PaddockRect
  dest: Vector3 | null
  heading: number
  speed: number
  grazeTimer: number
  gallop: AnimationAction | null
  /** scripted run (paid delivery): out along points, hold offstage, back */
  run: { points: Vector3[]; back: Vector3[]; holdT: number; phase: 'out' | 'hold' | 'back' } | null
}

export class Grazers {
  private rng: Rng
  private units: GrazerUnit[] = []

  constructor(private assets: Assets, private scene: Scene, seed: number) {
    this.rng = mulberry32(seed)
  }

  /** spawn `count` animals of `kind` scattered through `rect`; they live
   * (graze, wander, watch the player) inside that rect from then on */
  add(kind: GrazerKind, rect: { x0: number; z0: number; x1: number; z1: number }, count: number): void {
    for (let i = 0; i < count; i++) this.spawn(kind, rect)
  }

  /** gameplay step (fixed dt): scripted runs outrank curiosity outranks graze */
  update(dt: number, playerPos: Vector3): void {
    for (const u of this.units) {
      if (u.run) {
        this.runStep(u, dt)
        continue
      }
      const toPlayer = playerPos.clone().sub(u.group.position).setY(0)
      if (toPlayer.length() < CURIOUS_R) this.watch(u, dt, toPlayer)
      else this.graze(u, dt)
    }
  }

  /** render step (raw frame dt): advance the animation mixers */
  frame(dt: number): void {
    for (const u of this.units) u.mixer.update(dt)
  }

  /** live positions of every grazer (references, not copies) */
  positions(): Vector3[] {
    return this.units.map((u) => u.group.position)
  }

  /** how many of a kind live here (milk pay scales on this) */
  count(kind: GrazerKind): number {
    return this.units.filter((u) => u.kind === kind).length
  }

  // ---- internals -------------------------------------------------------------

  private spawn(kind: GrazerKind, rect: PaddockRect): void {
    const g = this.assets.spawnSkinned(modelKey(kind))
    const band = BAND[kind]
    const min = band.target * (1 - band.spread)
    const max = band.target * (1 + band.spread)
    const rawH = measuredHeight(g)
    const h = min + this.rng.next() * (max - min)
    const s = h / rawH
    g.scale.setScalar(s)
    assertSpawnScale(kind, rawH * s, min, max)
    const v = VARIETY[kind]
    tint(g, (this.rng.next() - 0.5) * v.hue, (this.rng.next() - 0.5) * v.light)
    // goats ride the box-bodied sheep rig — bone-puppet dressing hides the
    // boxy GLB meshes and hangs hand-built tan parts on the animated bones
    // (after sizing, so the scale band still holds; the tint above only ever
    // touched the now-hidden materials on goats)
    if (kind === 'goat') dressSheep(g, Math.floor(this.rng.next() * 0xffffffff), 'goat')
    g.position.copy(this.spotIn(rect))
    const heading = this.rng.next() * Math.PI * 2
    g.rotation.y = heading
    this.scene.add(g)
    const mixer = new AnimationMixer(g)
    const clips = this.assets.clips(modelKey(kind))
    const unit: GrazerUnit = {
      kind,
      group: g,
      mixer,
      idle: suffixAction(mixer, g, clips, 'Idle'),
      // suffix 'Eating' matches the horse/cow 'Eating' clip AND the goat's
      // sheep-family 'Idle_Eating' — one suffix serves all three rigs
      eat: suffixAction(mixer, g, clips, 'Eating'),
      walk: suffixAction(mixer, g, clips, 'Walk'),
      current: null,
      rect,
      dest: null,
      heading,
      speed: 0,
      // staggered first wander so a freshly added herd doesn't move in sync
      grazeTimer: 1 + this.rng.next() * 4,
      gallop: suffixAction(mixer, g, clips, 'Gallop') ?? suffixAction(mixer, g, clips, 'Run'),
      run: null,
    }
    const first = unit.eat ?? unit.idle
    first?.play()
    unit.current = first
    this.units.push(unit)
  }

  /** send the first animal of `kind` on a scripted run: gallop out along
   * `via`, vanish offstage ("in town") for `holdS`, then gallop home.
   * Returns false if no such animal exists or she's already out. */
  sendRun(kind: GrazerKind, via: Vector3[], holdS: number): boolean {
    const u = this.units.find((x) => x.kind === kind)
    if (!u || u.run) return false
    u.run = {
      points: via.map((p) => p.clone().setY(0)),
      back: [...via].reverse().map((p) => p.clone().setY(0)),
      holdT: holdS,
      phase: 'out',
    }
    u.dest = u.run.points.shift() ?? null
    return true
  }

  /** true while the first animal of `kind` is out on a run */
  isRunning(kind: GrazerKind): boolean {
    return this.units.some((x) => x.kind === kind && x.run !== null)
  }

  /** scripted-run step: gallop the chain, hide offstage, gallop home */
  private runStep(u: GrazerUnit, dt: number): void {
    const r = u.run!
    if (r.phase === 'hold') {
      r.holdT -= dt
      if (r.holdT <= 0) {
        r.phase = 'back'
        u.group.visible = true
        u.dest = r.back.shift() ?? null
      }
      return
    }
    if (this.walkTo(u, dt, RUN_SPEED, u.gallop)) {
      const queue = r.phase === 'out' ? r.points : r.back
      u.dest = queue.shift() ?? null
      if (!u.dest) {
        if (r.phase === 'out') {
          r.phase = 'hold'
          u.group.visible = false // she's off down the road, in town
        } else {
          u.run = null // home again — back to grazing
          u.grazeTimer = 2
        }
      }
    }
  }

  /** head down and nibble; every 4-9s pick a fresh spot in the paddock */
  private graze(u: GrazerUnit, dt: number): void {
    if (u.dest) {
      if (this.walkTo(u, dt)) u.dest = null
      return
    }
    u.speed = 0
    this.play(u, u.eat ?? u.idle, 1)
    u.grazeTimer -= dt
    if (u.grazeTimer <= 0) {
      u.grazeTimer = 4 + this.rng.next() * 5
      u.dest = this.spotIn(u.rect)
    }
  }

  /** player-curiosity: freeze in place, swing the body around to face the
   * farmer and hold Idle (head up) until they leave; any pending wander
   * destination survives, so life resumes where it left off */
  private watch(u: GrazerUnit, dt: number, toPlayer: Vector3): void {
    u.speed = 0
    if (toPlayer.lengthSq() > 1e-6) this.turnToward(u, Math.atan2(toPlayer.x, toPlayer.z), dt)
    this.play(u, u.idle ?? u.eat, 1)
  }

  /** returns true when arrived; eases speed and heading like Sheep.walkTo,
   * anim timeScale rides the actual ground speed */
  private walkTo(u: GrazerUnit, dt: number, speed = GRAZE_SPEED, anim?: AnimationAction | null): boolean {
    if (!u.dest) return true
    const to = u.dest.clone().sub(u.group.position).setY(0)
    const d = to.length()
    if (d < ARRIVE_R) {
      u.speed = 0
      return true
    }
    u.speed += (speed - u.speed) * Math.min(1, 5 * dt)
    this.turnToward(u, Math.atan2(to.x, to.z), dt)
    const step = Math.min(d, u.speed * dt)
    u.group.position.add(to.normalize().multiplyScalar(step))
    this.play(u, anim ?? u.walk ?? u.idle, Math.max(0.7, u.speed / speed))
    return false
  }

  private turnToward(u: GrazerUnit, want: number, dt: number): void {
    let dh = want - u.heading
    while (dh > Math.PI) dh -= Math.PI * 2
    while (dh < -Math.PI) dh += Math.PI * 2
    u.heading += dh * Math.min(1, TURN_RATE * dt)
    u.group.rotation.y = u.heading
  }

  /** seeded point pulled MARGIN in from every rail; degenerate (too-narrow)
   * spans collapse to their midline instead of inverting */
  private spotIn(rect: PaddockRect): Vector3 {
    return new Vector3(this.spanAt(rect.x0, rect.x1), 0, this.spanAt(rect.z0, rect.z1))
  }

  private spanAt(a: number, b: number): number {
    const lo = Math.min(a, b) + MARGIN
    const hi = Math.max(a, b) - MARGIN
    return hi > lo ? lo + this.rng.next() * (hi - lo) : (lo + hi) / 2
  }

  private play(u: GrazerUnit, next: AnimationAction | null, timeScale: number): void {
    if (!next) return
    next.timeScale = timeScale
    if (next === u.current) return
    next.reset().play()
    if (u.current) u.current.crossFadeTo(next, 0.22, false)
    u.current = next
  }
}
