/** The hen. Both bundled GLB chickens read as blobs at gameplay distance
 * (Hen.glb is a stack of gray boxes; Chicken.glb's mesh is literally named
 * "Chicken_Blob" — a big head with no body), so Henrietta is sculpted from
 * primitives with a real hen silhouette: plump round body, distinct HEAD on
 * a neck, orange beak, red comb + wattle, tail-feather fan, folded wing
 * bumps, two legs with feet. Baby-schema kept per docs/design.md: oversized
 * head, big sparkly eyes.
 * Procedural life: breathing, blinks, idle head bob + glances, peck cycles,
 * occasional wing flutters, and short ambles around the nest — leg swing is
 * stride-matched to ground speed so she never slides.
 * Crate-arrival ceremony stays a sim-time state machine (never timeout-
 * gated): crate thuds down, waits for the player, lid opens, she pops out
 * and scurries to the nest. */
import gsap from 'gsap'
import {
  AnimationMixer,
  Box3,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import { mulberry32, type Rng } from '../game/rng'
import type { Assets } from './assets'
import { assertSpawnScale, henScaleFor, SCALE } from './scale'

type Phase = 'hidden' | 'crateDrop' | 'crateWait' | 'opening' | 'popOut' | 'walking' | 'home'
type Pose = 'idle' | 'walk' | 'peck'

/** hen ambling speed around the nest (u/s) — shin-high bird, little steps */
const WANDER_SPEED = 0.3
/** excited scurry from the crate to the nest */
const CEREMONY_SPEED = 1.2
const TURN_RATE = 7
const ARRIVE_R = 0.08
/** wander ring around the nest: clears the nest torus, stays in pet range */
const WANDER_MIN_R = 0.5
const WANDER_MAX_R = 1.05
/** ground covered by one full leg cycle (two steps) per unit of hen scale —
 * 2 steps x swing arc of the 0.23u sculpt leg; keeps her stride-matched */
const STRIDE_PER_SCALE = 0.52
/** cap the leg cycle so the ceremony scurry reads excited, not blurred */
const MAX_STRIDE_RATE = 30

interface HenRig {
  /** squash/stretch + bob + waddle (everything but world position/yaw) */
  root: Group
  /** pivot at the top of the neck — bob, peck, glances */
  head: Group
  wingL: Group
  wingR: Group
  legL: Group
  legR: Group
  /** black eyeballs, y-scaled for blinks */
  eyes: Mesh[]
}

export class ChickenView {
  readonly group = new Group()
  readonly nestPos: Vector3
  readonly headAnchor = new Vector3()
  private hen: Group
  private rig: HenRig
  private rng: Rng
  private crate: Group | null = null
  private crateMixer: AnimationMixer | null = null
  private egg: Group | null = null
  private nest: Mesh
  private phase: Phase = 'hidden'
  private phaseT = 0
  private cratePos: Vector3
  private onOpen: (() => void) | null = null
  private onReady: (() => void) | null = null

  // locomotion (fixed-step)
  private heading = 0
  private dest: Vector3 | null = null
  private moveSpeed = WANDER_SPEED
  private wanderTimer = 3

  // procedural animation state (frame-rate)
  private pose: Pose = 'idle'
  private walkPhase = 0
  private peckPhase = 0
  private peckLeft = 0
  private blinkTimer = 3
  private blinkLeft = 0
  private flutterTimer = 6
  private flutterEnv = 0
  private flutterPhase = 0
  private glanceTimer = 2
  private glanceY = 0
  private ackLeft = 0
  private ackYaw = 0

  constructor(private assets: Assets, private scene: Scene, nestPos: Vector3, cratePos: Vector3, seed: number) {
    this.nestPos = nestPos.clone()
    this.cratePos = cratePos.clone()

    const { group: hen, rig, mats } = buildHen()
    this.hen = hen
    this.rig = rig
    // measure the sculpt at scale 1 BEFORE hiding it — the SCALE table speaks
    // in world height, the sculpt is ~0.95u tall, henScale closes the gap
    const built = new Box3().setFromObject(hen).getSize(new Vector3()).y

    // seeded per-animal variation: tint + size, stable across sessions
    this.rng = mulberry32(seed)
    const hue = (this.rng.next() - 0.5) * 0.08
    const light = (this.rng.next() - 0.5) * 0.12
    for (const m of mats) m.color.offsetHSL(hue, 0, light)
    this.henScale = henScaleFor(this.rng, built)
    assertSpawnScale('hen', built * this.henScale, SCALE.hen.min, SCALE.hen.max)

    this.hen.scale.setScalar(0.001)
    this.group.add(this.hen)
    this.group.position.copy(cratePos)
    scene.add(this.group)

    // hen-sized nest ring beside her
    this.nest = new Mesh(
      new TorusGeometry(0.2, 0.085, 8, 14),
      new MeshStandardMaterial({ color: '#b78a4e', roughness: 1 }),
    )
    this.nest.rotation.x = Math.PI / 2
    this.nest.position.copy(nestPos).setY(0.065)
    this.nest.castShadow = true
    this.nest.scale.setScalar(0.001)
    scene.add(this.nest)
  }

  private henScale = 1

  get visible(): boolean {
    return (
      this.phase !== 'hidden' && this.phase !== 'crateDrop' && this.phase !== 'crateWait' && this.phase !== 'opening'
    )
  }

  get settled(): boolean {
    return this.phase === 'home'
  }

  get ceremonyActive(): boolean {
    return this.phase !== 'hidden' && this.phase !== 'home' && this.phase !== 'crateWait'
  }

  /** a crate has landed and is waiting for the player to walk up to it */
  get cratePending(): boolean {
    return this.phase === 'crateWait'
  }

  /** where the dropped crate sits (proximity checks) */
  get crateWorldPos(): Vector3 {
    return this.cratePos
  }

  /** step 1 (after first harvest): the crate thuds down… and waits.
   * Walking up to it is what opens it — go-to-it grammar. */
  dropCrate(): void {
    if (this.phase !== 'hidden') return
    this.phase = 'crateDrop'
    this.phaseT = 0
    this.crate = this.assets.spawn('chest')
    this.crate.position.copy(this.cratePos).setY(7)
    this.crate.scale.setScalar(2)
    this.scene.add(this.crate)
    this.crateMixer = new AnimationMixer(this.crate)
    gsap.to(this.crate.position, { y: 0, duration: 0.7, ease: 'bounce.out' })
  }

  /** step 2 (player reached the crate): lid opens, hen pops out, ceremony
   * continues on the sim-time state machine. */
  beginOpen(onOpen: () => void, onReady: () => void): void {
    if (this.phase !== 'crateWait') return
    this.onOpen = onOpen
    this.onReady = onReady
    this.phase = 'opening'
    this.phaseT = 0
    const clips = this.assets.clips('chest')
    const open = clips.find((c) => c.name.toLowerCase() === 'open')
    if (open && this.crate && this.crateMixer) {
      const a = this.crateMixer.clipAction(open, this.crate)
      a.setLoop(LoopOnce, 1)
      a.clampWhenFinished = true
      a.play()
    }
    this.onOpen?.()
  }

  /** instantly settle (loading a save where she already lives here) */
  settle(): void {
    this.phase = 'home'
    this.group.position.copy(this.nestPos).add(new Vector3(0.45, 0, 0.15))
    this.hen.scale.setScalar(this.henScale)
    this.nest.scale.setScalar(1)
    this.group.rotation.y = this.heading = -0.8
  }

  /** sim-time ceremony driver + nest-side wandering */
  update(dt: number): void {
    if (this.phase === 'hidden') return
    this.phaseT += dt
    if (this.phase === 'crateDrop' && this.phaseT >= 1.0) {
      this.phase = 'crateWait'
      this.phaseT = 0
    } else if (this.phase === 'opening' && this.phaseT >= 0.9) {
      this.phase = 'popOut'
      this.phaseT = 0
      gsap.to(this.hen.scale, {
        x: this.henScale,
        y: this.henScale,
        z: this.henScale,
        duration: 0.5,
        ease: 'back.out(2.2)',
      })
      gsap.to(this.group.position, { y: 0.45, duration: 0.3, ease: 'power2.out', yoyo: true, repeat: 1 })
      gsap.to(this.nest.scale, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'back.out(2)', delay: 0.3 })
    } else if (this.phase === 'popOut' && this.phaseT >= 0.9) {
      this.phase = 'walking'
      this.phaseT = 0
      this.dest = this.nestPos.clone().add(new Vector3(0.45, 0, 0.15))
      this.moveSpeed = CEREMONY_SPEED
      this.flutterEnv = 1 // wings out — she's excited to see her nest
    } else if (this.phase === 'walking') {
      if (this.locomote(dt)) {
        this.phase = 'home'
        this.wanderTimer = 3
        this.turnEase(-0.8, 1)
        if (this.crate) {
          const crate = this.crate
          gsap.to(crate.scale, {
            x: 0.01,
            y: 0.01,
            z: 0.01,
            duration: 0.4,
            delay: 0.5,
            ease: 'back.in(1.7)',
            onComplete: () => this.scene.remove(crate),
          })
          this.crate = null
        }
        this.onReady?.()
      }
    } else if (this.phase === 'home') {
      if (this.pose === 'peck') return // busy eating — stay put
      if (this.dest) {
        if (this.locomote(dt)) this.wanderTimer = 4 + this.rng.next() * 8
        return
      }
      this.wanderTimer -= dt
      if (this.wanderTimer <= 0) {
        if (this.rng.next() < 0.3) {
          // sometimes just peck at the grass where she stands
          this.pose = 'peck'
          this.peckLeft = 1.4 + this.rng.next() * 0.8
          this.peckPhase = 0
          this.wanderTimer = 4 + this.rng.next() * 8
        } else {
          // amble a few steps to a new spot around the nest
          const a = this.rng.next() * Math.PI * 2
          const r = WANDER_MIN_R + this.rng.next() * (WANDER_MAX_R - WANDER_MIN_R)
          this.dest = this.nestPos.clone().add(new Vector3(Math.sin(a) * r, 0, Math.cos(a) * r))
          this.moveSpeed = WANDER_SPEED
        }
      }
    }
  }

  /** smooth-turn + step toward dest; true when arrived */
  private locomote(dt: number): boolean {
    if (!this.dest) return true
    const to = this.dest.clone().sub(this.group.position).setY(0)
    const d = to.length()
    if (d < ARRIVE_R) {
      this.dest = null
      this.pose = 'idle'
      return true
    }
    this.pose = 'walk'
    this.turnEase(Math.atan2(to.x, to.z), dt)
    const step = Math.min(d, this.moveSpeed * dt)
    this.group.position.add(to.normalize().multiplyScalar(step))
    return false
  }

  private turnEase(want: number, dt: number): void {
    let d = want - this.heading
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    this.heading += d * Math.min(1, TURN_RATE * dt)
    this.group.rotation.y = this.heading
  }

  /** render-rate: crate mixer/pulse + all procedural hen animation */
  frame(dt: number, t: number): void {
    this.crateMixer?.update(dt)
    if (this.phase === 'crateWait' && this.crate) {
      const s = 2 + Math.sin(t * 3.4) * 0.05
      this.crate.scale.set(s, 2 - Math.sin(t * 3.4) * 0.04, s)
    }
    if (!this.visible) return
    const r = this.rig
    const ease = (k: number): number => Math.min(1, k * dt)

    // peck countdown
    if (this.pose === 'peck') {
      this.peckLeft -= dt
      if (this.peckLeft <= 0) this.pose = 'idle'
    }

    // blinks
    this.blinkTimer -= dt
    if (this.blinkTimer <= 0) {
      this.blinkLeft = 0.11
      this.blinkTimer = 2.2 + this.rng.next() * 3.6
    }
    this.blinkLeft = Math.max(0, this.blinkLeft - dt)
    for (const e of r.eyes) e.scale.y = this.blinkLeft > 0 ? 0.15 : 1

    // occasional wing flutter while idling at home (and on pet/ceremony)
    if (this.phase === 'home' && this.pose === 'idle') {
      this.flutterTimer -= dt
      if (this.flutterTimer <= 0) {
        this.flutterEnv = 1
        this.flutterTimer = 8 + this.rng.next() * 10
      }
    }
    this.flutterEnv *= Math.pow(0.4, dt) // ~1.1s burst
    this.flutterPhase += dt * 24
    const flap = (Math.sin(this.flutterPhase) * 0.5 + 0.5) * this.flutterEnv
    r.wingL.rotation.z = -0.06 - flap * 1.1
    r.wingR.rotation.z = 0.06 + flap * 1.1

    if (this.pose === 'walk') {
      // stride-matched gait: leg cycle covers exactly the ground passing
      // under her at the CURRENT size (no sliding at any scale)
      const stride = STRIDE_PER_SCALE * this.henScale
      this.walkPhase += dt * Math.min(MAX_STRIDE_RATE, (this.moveSpeed / stride) * Math.PI * 2)
      const s = Math.sin(this.walkPhase)
      r.legL.rotation.x = s * 0.6
      r.legR.rotation.x = -s * 0.6
      r.root.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.03
      r.root.rotation.z = s * 0.06 // waddle
      r.root.rotation.x += (0.06 - r.root.rotation.x) * ease(8)
      // the classic hen head-pump, twice per stride
      r.head.rotation.x += (0.1 + Math.sin(this.walkPhase * 2) * 0.12 - r.head.rotation.x) * ease(12)
      r.head.rotation.y += (0 - r.head.rotation.y) * ease(8)
    } else if (this.pose === 'peck') {
      // quick downward jabs at the ground
      this.peckPhase += dt * 7.5
      const down = Math.max(0, Math.sin(this.peckPhase))
      r.head.rotation.x += (0.3 + down * 1.0 - r.head.rotation.x) * ease(20)
      r.root.rotation.x += (0.1 + down * 0.1 - r.root.rotation.x) * ease(14)
      r.head.rotation.y += (0 - r.head.rotation.y) * ease(10)
      this.settleLegs(dt)
    } else {
      // idle: breathe, gentle head bob, curious glances
      this.glanceTimer -= dt
      if (this.glanceTimer <= 0) {
        this.glanceY = (this.rng.next() - 0.5) * 1.1
        this.glanceTimer = 2.4 + this.rng.next() * 3.6
      }
      const lookY = this.ackLeft > 0 ? this.ackYaw : this.glanceY
      r.head.rotation.x += (Math.sin(t * 1.9) * 0.06 - r.head.rotation.x) * ease(6)
      r.head.rotation.y += (lookY - r.head.rotation.y) * ease(this.ackLeft > 0 ? 10 : 4)
      r.root.rotation.x += (0 - r.root.rotation.x) * ease(6)
      r.root.rotation.z += (0 - r.root.rotation.z) * ease(6)
      r.root.position.y += (0 - r.root.position.y) * ease(8)
      this.settleLegs(dt)
    }
    this.ackLeft = Math.max(0, this.ackLeft - dt)

    // breathing squash/stretch, slightly flattened during flutters
    const breathe = 1 + Math.sin(t * 2.6) * 0.012 - this.flutterEnv * 0.04
    r.root.scale.set(1, breathe, 1)
  }

  private settleLegs(dt: number): void {
    const k = Math.min(1, 8 * dt)
    this.rig.legL.rotation.x *= 1 - k
    this.rig.legR.rotation.x *= 1 - k
  }

  /** feeding visual: stop and peck the ground for a few seconds */
  eat(_now: number): void {
    this.pose = 'peck'
    this.peckPhase = 0
    this.peckLeft = 3.2
    this.dest = null
  }

  /** tap/pet response: look toward the camera, flutter, happy hop */
  acknowledge(camPos: Vector3): void {
    let d = Math.atan2(camPos.x - this.group.position.x, camPos.z - this.group.position.z) - this.heading
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    this.ackYaw = Math.max(-1.1, Math.min(1.1, d))
    this.ackLeft = 1.4
    this.flutterEnv = 1
    gsap.fromTo(this.group.position, { y: 0 }, { y: 0.18, duration: 0.16, yoyo: true, repeat: 1, ease: 'power1.out' })
  }

  showEgg(golden: boolean): void {
    if (this.egg) return
    this.egg = this.assets.spawn('egg', true)
    this.egg.scale.setScalar(0.01)
    this.egg.position.copy(this.nestPos).setY(0.1)
    this.scene.add(this.egg)
    // hen-proportioned egg (the GLB is 0.165u tall at scale 1)
    gsap.to(this.egg.scale, { x: 0.9, y: 0.9, z: 0.9, duration: 0.5, ease: 'back.out(2.6)' })
    void golden
  }

  collectEggFx(): void {
    if (!this.egg) return
    const egg = this.egg
    this.egg = null
    gsap.to(egg.position, { y: 1.1, duration: 0.45, ease: 'power2.out' })
    gsap.to(egg.scale, {
      x: 0.01,
      y: 0.01,
      z: 0.01,
      delay: 0.35,
      duration: 0.3,
      ease: 'power2.in',
      onComplete: () => this.scene.remove(egg),
    })
  }

  get hasEggShown(): boolean {
    return this.egg !== null
  }

  /** everything that should route a tap to the chicken (hen, nest, egg) */
  hitRoots(): import('three').Object3D[] {
    const roots: import('three').Object3D[] = [this.group, this.nest]
    if (this.egg) roots.push(this.egg)
    return roots
  }

  /** anchor for the floating name tag — just above her comb */
  tagWorldPos(): Vector3 {
    return this.headAnchor.copy(this.group.position).add(new Vector3(0, 0.55, 0))
  }
}

// ---- procedural hen ---------------------------------------------------------

/** Sculpt the hen from primitives, ~0.95u tall at scale 1, facing +z.
 * World size is normalized against the SCALE table in the constructor.
 * Returns the unique materials so seeded tint is applied exactly once each.
 * (exported for tests/scale.test.ts) */
export function buildHen(): { group: Group; rig: HenRig; mats: MeshStandardMaterial[] } {
  const feather = new MeshStandardMaterial({ color: '#f3ead8', roughness: 0.95 })
  const featherDark = new MeshStandardMaterial({ color: '#d9c5a0', roughness: 0.95 })
  const red = new MeshStandardMaterial({ color: '#d6453c', roughness: 0.85 })
  const orange = new MeshStandardMaterial({ color: '#e8973b', roughness: 0.8 })
  const eyeBlack = new MeshStandardMaterial({ color: '#26211d', roughness: 0.4 })
  const eyeShine = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 })
  const mats = [feather, featherDark, red, orange, eyeBlack, eyeShine]

  const group = new Group()
  const root = new Group()
  group.add(root)

  const mk = (geo: SphereGeometry | CylinderGeometry | ConeGeometry, mat: MeshStandardMaterial): Mesh => {
    const m = new Mesh(geo, mat)
    m.castShadow = true
    return m
  }

  // plump body: breast low and forward, rear raised
  const body = mk(new SphereGeometry(0.3, 18, 14), feather)
  body.position.set(0, 0.42, -0.02)
  body.scale.set(0.95, 0.88, 1.18)
  body.rotation.x = -0.22
  root.add(body)

  // tail-feather fan: four flattened lobes, fanned and pitched up
  for (let i = 0; i < 4; i++) {
    const a = (i - 1.5) * 0.34
    const f = mk(new SphereGeometry(0.09, 10, 8), i % 2 ? featherDark : feather)
    f.position.set(Math.sin(a) * 0.13, 0.6, -0.34 - Math.cos(a) * 0.04)
    f.scale.set(0.45, 1.9, 0.9)
    f.rotation.set(0.8, 0, -Math.sin(a) * 0.55)
    root.add(f)
  }

  // folded wing bumps (pivots at the shoulder so flutters swing outward)
  const wingGeo = new SphereGeometry(0.16, 12, 10)
  const wingL = new Group()
  wingL.position.set(0.23, 0.52, 0)
  const wL = mk(wingGeo, featherDark)
  wL.position.set(0.03, -0.1, 0)
  wL.scale.set(0.5, 0.85, 1.25)
  wingL.add(wL)
  root.add(wingL)
  const wingR = new Group()
  wingR.position.set(-0.23, 0.52, 0)
  const wR = mk(wingGeo, featherDark)
  wR.position.set(-0.03, -0.1, 0)
  wR.scale.set(0.5, 0.85, 1.25)
  wingR.add(wR)
  root.add(wingR)

  // neck up to a big baby-schema head
  const neck = mk(new CylinderGeometry(0.08, 0.105, 0.2, 10), feather)
  neck.position.set(0, 0.64, 0.17)
  neck.rotation.x = 0.22
  root.add(neck)

  const head = new Group()
  head.position.set(0, 0.76, 0.2)
  root.add(head)
  const skull = mk(new SphereGeometry(0.165, 16, 12), feather)
  skull.position.y = 0.04
  head.add(skull)

  const eyes: Mesh[] = []
  for (const side of [1, -1]) {
    const eye = mk(new SphereGeometry(0.047, 10, 8), eyeBlack)
    eye.position.set(0.105 * side, 0.07, 0.115)
    head.add(eye)
    eyes.push(eye)
    const shine = mk(new SphereGeometry(0.016, 6, 6), eyeShine)
    shine.position.set(0.115 * side, 0.095, 0.145)
    head.add(shine)
  }

  const beak = mk(new ConeGeometry(0.052, 0.12, 8), orange)
  beak.rotation.x = Math.PI / 2
  beak.position.set(0, 0.015, 0.24)
  head.add(beak)

  // comb: three red lobes along the crown
  for (let i = 0; i < 3; i++) {
    const lobe = mk(new SphereGeometry(i === 1 ? 0.062 : 0.05, 8, 8), red)
    lobe.position.set(0, 0.2 + (i === 1 ? 0.022 : 0), 0.06 - i * 0.075)
    lobe.scale.set(0.45, 1, 0.85)
    head.add(lobe)
  }
  // wattle under the beak
  for (const side of [1, -1]) {
    const w = mk(new SphereGeometry(0.03, 8, 8), red)
    w.position.set(0.026 * side, -0.07, 0.16)
    w.scale.set(0.7, 1.4, 0.7)
    head.add(w)
  }

  // two legs with feet (pivots at the hip for the walk swing)
  const legL = buildLeg(mk, orange)
  legL.position.set(0.1, 0.3, 0.02)
  root.add(legL)
  const legR = buildLeg(mk, orange)
  legR.position.set(-0.1, 0.3, 0.02)
  root.add(legR)

  return { group, rig: { root, head, wingL, wingR, legL, legR, eyes }, mats }
}

function buildLeg(
  mk: (geo: SphereGeometry | CylinderGeometry | ConeGeometry, mat: MeshStandardMaterial) => Mesh,
  orange: MeshStandardMaterial,
): Group {
  const leg = new Group()
  const shin = mk(new CylinderGeometry(0.024, 0.024, 0.18, 8), orange)
  shin.position.y = -0.12
  leg.add(shin)
  const foot = mk(new SphereGeometry(0.05, 8, 8), orange)
  foot.position.set(0, -0.21, 0.035)
  foot.scale.set(1.2, 0.35, 1.8)
  leg.add(foot)
  return leg
}
