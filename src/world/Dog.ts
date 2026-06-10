/** Farm-dog companion + guide (Quaternius animated Shiba, CC0).
 * NO hopping anywhere — locomotion is smooth walk/trot with crossfades and
 * damped turns. Guide behavior: trot to the thing she wants you to see,
 * SIT facing it, look back at the player, wag her tail in little bursts and
 * give one soft bark. Off duty she shadows the player and runs a cozy idle
 * cycle: stand → sniff → sit → lie → look around. Sit/lie are procedural
 * pose blends (pitch around the rear paws + settle) layered over the clips;
 * tail wag and head look-back are additive quaternion twists applied after
 * the mixer so they ride on top of any animation.
 * Pure suggestion — input and camera never lock. */
import {
  AnimationAction,
  AnimationMixer,
  Group,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
  type AnimationClip,
} from 'three'
import { mulberry32, type Rng } from '../game/rng'
import { tint, type Assets } from './assets'
import { assertSpawnScale, DOG_SHOULDER_OF_HEIGHT, dogScaleForHeight, measuredHeight, SCALE } from './scale'

/** knee-high dog speeds: she shadows a walking farmer comfortably and breaks
 * into a believable little gallop to keep up with a run */
const WALK_SPEED = 2.0
const TROT_SPEED = 4.4
/** beyond this distance she breaks into a trot */
const TROT_DIST = 5.5
const TURN_RATE = 9
const ARRIVE_R = 0.3
/** loose follow: stay within this of the player when off duty */
const FOLLOW_FAR = 4.6
const FOLLOW_NEAR = 2.3
const FADE = 0.25
/** foot-lock: ground speed (u/s) covered by each clip at timeScale 1 PER
 * UNIT of model scale — measured at the old 0.42 build (2.3 and 5.0 u/s),
 * so refs shrink with the dog and her little legs cycle faster, no slide */
const WALK_REF_PER_SCALE = 2.3 / 0.42
const TROT_REF_PER_SCALE = 5.0 / 0.42
/** rear-paw pivot offset in MODEL units (0.55 world at the old 0.42 scale) */
const REAR_PIVOT_MODEL = 0.55 / 0.42

type IdlePose = 'stand' | 'sniff' | 'look' | 'sit' | 'lie'
const IDLE_CYCLE: IdlePose[] = ['stand', 'sniff', 'sit', 'look', 'lie', 'stand', 'sit']

function suffixAction(mixer: AnimationMixer, root: Group, clips: AnimationClip[], suffix: string): AnimationAction | null {
  const clip = clips.find((c) => c.name.toLowerCase().endsWith(suffix.toLowerCase()))
  return clip ? mixer.clipAction(clip, root) : null
}

const UP = new Vector3(0, 1, 0)
const RIGHT = new Vector3(1, 0, 0)

export class DogView {
  readonly group = new Group()
  /** soft "ruff" — wired to Sfx by main; rate-limited here */
  onBark: (() => void) | null = null

  private dog: Group
  private sitPivot = new Group()
  private mixer: AnimationMixer
  private idle: AnimationAction | null
  private walk: AnimationAction | null
  private trot: AnimationAction | null
  private sniff: AnimationAction | null
  private look: AnimationAction | null
  private current: AnimationAction | null = null

  private rng: Rng
  private heading = 0
  private speed = 0
  private dest: Vector3 | null = null
  private pointTarget: Vector3 | null = null
  private herdPoint: Vector3 | null = null
  private fetchState: 'none' | 'out' | 'back' = 'none'
  /** fired when she reaches the stick / drops it at the player's feet */
  onFetchPickup: (() => void) | null = null
  onFetchDone: (() => void) | null = null
  private guideSettled = false
  private playerPos = new Vector3()

  // pose blending (0..1 weights, eased in frame())
  private sitW = 0
  private lieW = 0
  private wantSit = 0
  private wantLie = 0

  // idle behavior cycle
  private idlePose: IdlePose = 'stand'
  private idleStep = 0
  private idleTimer = 3

  // tail wag + bark scheduling
  private wagPhase = 0
  private wagEnv = 0
  private wagTimer = 2
  private barkCooldown = 0

  // additive head look-back
  private headBone: Object3D | null = null
  private tailBones: Object3D[] = []
  private lookBackW = 0
  private tmpQ = new Quaternion()

  /** final uniform model scale (drives pose offsets + foot-lock refs) */
  private modelScale: number

  constructor(assets: Assets, scene: Scene, home: Vector3) {
    this.dog = assets.spawnSkinned('dog')
    tint(this.dog, 0.01, 0.02)
    // SCALE-table sizing: put the SHOULDER at knee height on the farmer.
    // Tiny seeded variety keeps her an individual but stays inside the band.
    this.rng = mulberry32(777)
    const rawH = measuredHeight(this.dog)
    const s = dogScaleForHeight(rawH) * (0.97 + this.rng.next() * 0.06)
    this.modelScale = s
    this.dog.scale.setScalar(s)
    assertSpawnScale('dog (shoulder)', rawH * DOG_SHOULDER_OF_HEIGHT * s, SCALE.dog.min, SCALE.dog.max)
    // sit pivot sits at the rear paws so pitching up reads as "sits down"
    this.sitPivot.position.set(0, 0, -REAR_PIVOT_MODEL * s)
    this.dog.position.set(0, 0, REAR_PIVOT_MODEL * s)
    this.sitPivot.add(this.dog)
    this.group.add(this.sitPivot)
    this.group.position.copy(home)
    this.group.rotation.y = this.heading = Math.PI * 0.8
    scene.add(this.group)
    this.mixer = new AnimationMixer(this.dog)
    const clips = assets.clips('dog')
    this.idle = suffixAction(this.mixer, this.dog, clips, 'Idle')
    this.walk = suffixAction(this.mixer, this.dog, clips, 'Walk')
    this.trot = suffixAction(this.mixer, this.dog, clips, 'Gallop')
    this.sniff = suffixAction(this.mixer, this.dog, clips, 'Idle_2_HeadLow')
    this.look = suffixAction(this.mixer, this.dog, clips, 'Idle_2')
    this.idle?.play()
    this.current = this.idle
    this.headBone = this.dog.getObjectByName('Head') ?? null
    for (const n of ['Tail1', 'Tail2', 'Tail3']) {
      const b = this.dog.getObjectByName(n)
      if (b) this.tailBones.push(b)
    }
  }

  /** stick fetch: gallop out, grab it, bring it back. Returns false if she's
   * busy working (herding outranks play). */
  fetch(point: Vector3): boolean {
    if (this.herdPoint || this.fetchState !== 'none') return false
    this.pointTarget = null
    this.guideSettled = false
    this.fetchState = 'out'
    this.dest = point.clone().setY(0)
    return true
  }

  get fetching(): boolean {
    return this.fetchState !== 'none'
  }

  /** point near `target`, or null to fall back to shadowing the player */
  guideTo(target: Vector3 | null): void {
    if (this.herdPoint || this.fetchState !== 'none') return // work/play outranks guiding
    if (target) {
      if (this.pointTarget && this.pointTarget.distanceTo(target) < 0.5) return
      const side = target.x > this.group.position.x ? -1.6 : 1.6
      this.dest = target.clone().add(new Vector3(side, 0, 1.4)).setY(0)
      this.pointTarget = target.clone()
      this.guideSettled = false
    } else if (this.pointTarget) {
      this.pointTarget = null
      this.guideSettled = false
      this.dest = null
    }
  }

  /** HERDING: sprint to flanking points behind loose sheep (main re-feeds the
   * point as the sheep moves); null ends the mission posture */
  herdTo(p: Vector3 | null): void {
    if (p) {
      this.pointTarget = null
      this.guideSettled = false
      this.fetchState = 'none' // work over play

      if (!this.herdPoint || this.herdPoint.distanceTo(p) > 0.4) {
        this.herdPoint = p.clone()
        this.dest = p.clone().setY(0)
      }
    } else if (this.herdPoint) {
      this.herdPoint = null
      this.dest = null
    }
  }

  /** fixed-step: destination choice, smooth locomotion, behavior timers */
  update(dt: number, playerPos: Vector3): void {
    this.playerPos.copy(playerPos)
    this.barkCooldown = Math.max(0, this.barkCooldown - dt)

    // bringing the stick back: chase the player's current spot
    if (this.fetchState === 'back') {
      this.dest = playerPos.clone().setY(0)
      if (this.group.position.distanceTo(playerPos) < 1.4) {
        this.fetchState = 'none'
        this.dest = null
        this.wagEnv = 1
        this.onFetchDone?.()
      }
    }

    // off duty: shadow the player loosely
    if (!this.pointTarget && !this.herdPoint && this.fetchState === 'none') {
      const d = this.group.position.distanceTo(playerPos)
      if (!this.dest && d > FOLLOW_FAR) {
        const side = this.rng.next() > 0.5 ? 1 : -1
        const dir = this.group.position.clone().sub(playerPos).setY(0).normalize()
        if (dir.lengthSq() < 0.5) dir.set(1, 0, 0)
        this.dest = playerPos
          .clone()
          .add(dir.multiplyScalar(FOLLOW_NEAR))
          .add(new Vector3(-dir.z * 0.6 * side, 0, dir.x * 0.6 * side))
      }
      if (this.dest && this.dest.distanceTo(playerPos) > FOLLOW_FAR + 1.5) this.dest = null // stale spot
    }

    // locomotion toward dest
    if (this.dest) {
      const to = this.dest.clone().sub(this.group.position).setY(0)
      const d = to.length()
      if (d < ARRIVE_R) {
        this.dest = null
        this.speed = 0
        this.arrive()
      } else {
        this.wantSit = 0
        this.wantLie = 0
        const targetSpeed = d > TROT_DIST ? TROT_SPEED : WALK_SPEED
        this.speed += (targetSpeed - this.speed) * Math.min(1, 6 * dt)
        const step = Math.min(d, this.speed * dt)
        this.turnToward(Math.atan2(to.x, to.z), dt)
        this.group.position.add(to.normalize().multiplyScalar(step))
        // foot-lock: clip refs scale with the model so small legs cycle faster
        const walkRef = WALK_REF_PER_SCALE * this.modelScale
        const trotRef = TROT_REF_PER_SCALE * this.modelScale
        if (this.speed > WALK_SPEED + 0.6 && this.trot) this.swap(this.trot, Math.min(2.2, this.speed / trotRef))
        else this.swap(this.walk, Math.min(2.2, Math.max(0.7, this.speed / walkRef)))
      }
    } else {
      this.speed = 0
      if (this.herdPoint) {
        // on station: stay sharp, face the work, the occasional working bark
        this.turnToward(yawTo(this.group.position, this.herdPoint), dt)
        this.wantSit = 0
        this.wantLie = 0
        this.swap(this.idle, 1.15)
        if (this.barkCooldown <= 0) {
          this.barkCooldown = 4.5
          this.onBark?.()
          this.wagEnv = 1
        }
      } else if (this.pointTarget) {
        // settled at the guide spot: face the thing, sit, wag, one soft bark
        this.turnToward(yawTo(this.group.position, this.pointTarget), dt)
      } else {
        this.idleCycle(dt)
      }
    }

    // tail-wag bursts (always while guiding, occasionally off duty)
    this.wagTimer -= dt
    if (this.wagTimer <= 0) {
      this.wagEnv = 1
      this.wagTimer = this.pointTarget ? 2.5 + this.rng.next() * 2.5 : 5 + this.rng.next() * 6
    }
  }

  private arrive(): void {
    if (this.fetchState === 'out') {
      this.fetchState = 'back'
      this.wagEnv = 1
      this.onFetchPickup?.()
      return
    }
    if (this.pointTarget && !this.guideSettled) {
      this.guideSettled = true
      this.wantSit = 1
      this.wantLie = 0
      this.wagEnv = 1
      if (this.barkCooldown <= 0) {
        this.barkCooldown = 7
        this.onBark?.()
      }
    }
  }

  /** cozy off-duty cycle near the player: stand → sniff → sit → lie → look */
  private idleCycle(dt: number): void {
    this.idleTimer -= dt
    if (this.idleTimer <= 0) {
      this.idleStep = (this.idleStep + 1) % IDLE_CYCLE.length
      this.idlePose = IDLE_CYCLE[this.idleStep]
      this.idleTimer = 3.5 + this.rng.next() * 4
    }
    const pose = this.idlePose
    this.wantSit = pose === 'sit' ? 1 : 0
    this.wantLie = pose === 'lie' ? 1 : 0
    if (pose === 'sniff' && this.sniff) this.swap(this.sniff, 1)
    else if (pose === 'look' && this.look) this.swap(this.look, 1)
    else this.swap(this.idle, pose === 'lie' ? 0.55 : 1)
  }

  private turnToward(want: number, dt: number): void {
    let d = want - this.heading
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    this.heading += d * Math.min(1, TURN_RATE * dt)
    this.group.rotation.y = this.heading
  }

  /** frame-rate: clip mixing + procedural pose/wag/look-back layers */
  frame(dt: number): void {
    if (this.pointTarget && this.guideSettled) {
      this.wantSit = 1
      this.swap(this.idle, 1)
    }
    this.mixer.update(dt)

    // sit / lie pose blends (pitch around rear paws + settle into the grass)
    // — y offsets tuned at the old 0.42 build, scaled to the real model size
    const k = this.modelScale / 0.42
    this.sitW += (this.wantSit - this.sitW) * Math.min(1, 5 * dt)
    this.lieW += (this.wantLie - this.lieW) * Math.min(1, 4 * dt)
    this.sitPivot.rotation.x = -0.52 * this.sitW + 0.06 * this.lieW
    this.sitPivot.position.y = (-0.02 * this.sitW - 0.17 * this.lieW) * k

    // look back at the player while pointing something out (head additive)
    const wantLook = this.pointTarget && this.guideSettled ? 1 : 0
    this.lookBackW += (wantLook - this.lookBackW) * Math.min(1, 4 * dt)
    if (this.headBone && this.lookBackW > 0.01) {
      const toPlayer = yawTo(this.group.position, this.playerPos)
      let d = toPlayer - this.heading
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      const turn = Math.max(-1.0, Math.min(1.0, d)) * this.lookBackW
      this.headBone.quaternion.multiply(this.tmpQ.setFromAxisAngle(UP, turn * 0.7))
      // lift the chin a touch — she's checking in with you
      this.headBone.quaternion.multiply(this.tmpQ.setFromAxisAngle(RIGHT, -0.12 * this.lookBackW))
    }

    // tail wag: enveloped sin bursts, amplitude grows along the chain
    if (this.wagEnv > 0.01) {
      this.wagEnv *= Math.pow(0.45, dt) // ~1.2s burst
      this.wagPhase += dt * 16
      this.tailBones.forEach((b, i) => {
        const amp = this.wagEnv * (0.18 + i * 0.16)
        b.quaternion.multiply(this.tmpQ.setFromAxisAngle(UP, Math.sin(this.wagPhase - i * 0.7) * amp))
      })
    }
  }

  private swap(next: AnimationAction | null, timeScale = 1): void {
    if (!next) return
    next.timeScale = timeScale
    if (next === this.current) return
    next.reset().play()
    if (this.current) this.current.crossFadeTo(next, FADE, false)
    this.current = next
  }
}

function yawTo(from: Vector3, to: Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z)
}
