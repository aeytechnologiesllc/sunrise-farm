/** The farmer you walk around — a Quaternius animated character (CC0,
 * straw hat + denim overalls, adult proportions) with idle/walk/run clips
 * blended via crossfades. Stick deflection past ~70% breaks into a run
 * (slight speed-up; the camera adds a FOV nudge). Playback rate is tied to
 * ground speed so feet don't slide, the body banks into turns, and a
 * breathing micro-motion keeps the idle alive. Falls back to a procedural
 * articulated farmer if the GLB can't load.
 * Movement is fixed-step + camera-relative; rendering is frame-rate. */
import {
  AnimationAction,
  AnimationMixer,
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  Scene,
  SphereGeometry,
  Vector3,
  type AnimationClip,
} from 'three'
import { tint, type Assets } from './assets'
import { assertSpawnScale, measuredHeight, SCALE } from './scale'

const WALK_SPEED = 3.2
/** re-tuned 2026-06-12: the closer landscape camera makes the same world
 * speed READ faster — the owner felt the run "too fast" only after the
 * zoom-in, so the run eases off rather than the camera backing out */
const RUN_SPEED = 3.8
/** riding Hazel covers ground faster — a brisk canter across the farm */
const RIDE_BOOST = 1.75
/** stick deflection above which the farmer breaks into a run */
const RUN_DEFLECT = 0.7
const TURN_RATE = 11
/** the farmer IS the scale reference — height comes from the SCALE table */
export const FARMER_HEIGHT = SCALE.farmer
/** readability: lift the GLB's vertex-color materials so the farmer never
 * silhouettes dark against grass (owner screenshot note) */
const FARMER_BRIGHTEN = 0.13
/** ground speed (u/s) covered by one clip loop at timeScale 1 — foot-lock */
const WALK_REF_SPEED = 2.2
const RUN_REF_SPEED = 4.6
const FADE = 0.24
/** bank into turns: radians of lean per (rad/s of heading change) */
const LEAN_GAIN = 0.05
const LEAN_MAX = 0.14
type MountPose = 'horse' | 'tractor'
const TRACTOR_FORWARD_SPEED = 4.15
const TRACTOR_REVERSE_SPEED = TRACTOR_FORWARD_SPEED
const TRACTOR_ACCEL = 3.35
const TRACTOR_BRAKE = 5.6
const TRACTOR_DRAG = 3.8
const TRACTOR_TURN_BASE = 0.15
const TRACTOR_TURN_GAIN = 0.22
const TRACTOR_STEER_SMOOTH = 7.2
const HORSE_RIDER_Y_DROP = 0.06
const HORSE_RIDER_X = 0
const HORSE_RIDER_Z = -0.02
const TRACTOR_RIDER_X = 0
const TRACTOR_RIDER_Z = -0.84

function suffixAction(mixer: AnimationMixer, root: Group, clips: AnimationClip[], name: string): AnimationAction | null {
  const clip = clips.find((c) => c.name.toLowerCase() === name || c.name.toLowerCase().endsWith(`|${name}`))
  return clip ? mixer.clipAction(clip, root) : null
}

interface ProceduralRig {
  armL: Group
  armR: Group
  legL: Group
  legR: Group
  body: Group
}

export class PlayerView {
  readonly group = new Group()
  readonly vel = new Vector3()
  /** the TRUE fixed-step position — gameplay, collision and proximity read this
   * via the `pos` getter. group.position is a RENDER-ONLY interpolation between
   * prevPos and logicalPos, so the mesh glides between the 60Hz steps. */
  private readonly logicalPos = new Vector3()
  private readonly prevPos = new Vector3()
  /** current planar speed, units/s */
  speed = 0
  /** stick pushed past the run threshold (camera FOV nudge reads this) */
  running = false

  /** world yaw the farmer is facing (stick throws aim along this) */
  get facing(): number {
    return this.heading
  }

  private model: Group
  private mixer: AnimationMixer | null = null
  private idle: AnimationAction | null = null
  private walk: AnimationAction | null = null
  private run: AnimationAction | null = null
  private gestureA: AnimationAction | null = null
  private current: AnimationAction | null = null
  private gestureUntil = -1
  private heading = 0
  private headingRate = 0
  private lean = 0
  private baseScale = 1
  private rig: ProceduralRig | null = null
  private horseRider: Group
  private horseRiderBaseY = 0
  private tractorRider: Group
  private tractorRiderBaseY = 0
  private swingT = 0
  /** riding: the farmer MODEL lifts onto the saddle (pos stays ground-level so
   * proximity/camera are unaffected) and travels at a canter */
  private mounted = false
  private mountPose: MountPose | null = null
  private rideBoost = 1
  private vehicleSpeed = 0
  private vehicleSteer = 0
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number }

  constructor(assets: Assets, scene: Scene, spawn: Vector3, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    this.bounds = bounds
    let model: Group | null = null
    try {
      model = assets.spawnSkinned('farmer')
      const clips = assets.clips('farmer')
      const mixer = new AnimationMixer(model)
      const idle = suffixAction(mixer, model, clips, 'idle')
      const walk = suffixAction(mixer, model, clips, 'walk')
      if (!idle || !walk) model = null
      else {
        this.mixer = mixer
        this.idle = idle
        this.walk = walk
        this.run = suffixAction(mixer, model, clips, 'run')
        this.gestureA =
          suffixAction(mixer, model, clips, 'interact') ?? suffixAction(mixer, model, clips, 'pick-up')
        // normalize to the SCALE-table reference height regardless of source
        const raw = measuredHeight(model)
        this.baseScale = FARMER_HEIGHT / raw
        model.scale.setScalar(this.baseScale)
        assertSpawnScale('farmer', raw * this.baseScale, FARMER_HEIGHT - 0.01, FARMER_HEIGHT + 0.01)
        tint(model, 0, FARMER_BRIGHTEN)
        idle.play()
        this.current = idle
      }
    } catch {
      model = null
    }
    if (!model) {
      const { group, rig } = buildProceduralFarmer()
      model = group
      this.rig = rig
    }
    this.model = model
    this.horseRider = buildHorseRider()
    this.horseRider.visible = false
    this.tractorRider = buildTractorRider()
    this.tractorRider.visible = false
    this.group.add(model)
    this.group.add(this.horseRider)
    this.group.add(this.tractorRider)
    this.group.position.copy(spawn)
    this.logicalPos.copy(spawn)
    this.prevPos.copy(spawn)
    scene.add(this.group)
  }

  get pos(): Vector3 {
    return this.logicalPos
  }

  /** the RENDER position (interpolated this frame). The camera and the sibling
   * horse/tractor follow THIS so they stay locked to the smoothed farmer mesh
   * rather than the 60Hz logical step. */
  get renderPos(): Vector3 {
    return this.group.position
  }

  /** snapshot the logical position at the START of a fixed step — call once per
   * fixed step, before movement integrates */
  snapshotPrev(): void {
    this.prevPos.copy(this.logicalPos)
  }

  /** commit the render transform: blend prevPos -> logicalPos by the engine's
   * leftover accumulator fraction so the mesh glides between fixed steps. A jump
   * bigger than any real step (>1.5u, ~13x a max horse step) is a teleport —
   * snap, never slide (belt-and-suspenders for any missed teleport reset). */
  renderInterpolated(alpha: number): void {
    const dx = this.logicalPos.x - this.prevPos.x
    const dz = this.logicalPos.z - this.prevPos.z
    if (dx * dx + dz * dz > 2.25) {
      this.prevPos.copy(this.logicalPos)
      this.group.position.set(this.logicalPos.x, this.logicalPos.y, this.logicalPos.z)
      return
    }
    this.group.position.set(this.prevPos.x + dx * alpha, this.logicalPos.y, this.prevPos.z + dz * alpha)
  }

  /** collapse interpolation after a teleport so the next frame shows no slide */
  resetInterp(): void {
    this.prevPos.copy(this.logicalPos)
    this.group.position.copy(this.logicalPos)
  }

  /** cutscene escort: while set, the farmer walks himself here (joystick
   * yields; a skip clears it). Pure presentation — never used for gameplay. */
  private autoTo: Vector3 | null = null

  autoWalkTo(p: Vector3 | null): void {
    this.autoTo = p ? p.clone().setY(0) : null
  }

  /** swap the walkable rectangle (entering/leaving an interior set teleports
   * the farmer AND replaces the world bounds with the room's) */
  setBounds(b: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    this.bounds = b
  }

  get autoWalking(): boolean {
    return this.autoTo !== null
  }

  /** mount/dismount Hazel: lifts the farmer model onto the saddle and lets him
   * canter. The group's position (pos) stays at ground level — only the model
   * child rises — so every proximity check and the camera anchor are unmoved. */
  setMounted(on: boolean, saddleY = 0, pose: MountPose = 'horse'): void {
    this.mounted = on
    this.mountPose = on ? pose : null
    this.rideBoost = on ? RIDE_BOOST : 1
    if (!on || pose !== 'tractor') {
      this.vehicleSpeed = 0
      this.vehicleSteer = 0
    }
    const horsePose = on && pose === 'horse'
    const tractorPose = on && pose === 'tractor'
    this.model.visible = !horsePose && !tractorPose
    this.model.position.set(0, 0, 0)
    this.model.rotation.x = 0

    this.horseRider.visible = horsePose
    this.horseRiderBaseY = saddleY - HORSE_RIDER_Y_DROP
    this.horseRider.position.set(HORSE_RIDER_X, this.horseRiderBaseY, HORSE_RIDER_Z)
    this.horseRider.rotation.set(0, 0, 0)

    this.tractorRider.visible = tractorPose
    this.tractorRiderBaseY = saddleY + 0.06
    this.tractorRider.position.set(TRACTOR_RIDER_X, this.tractorRiderBaseY, TRACTOR_RIDER_Z)
    this.tractorRider.rotation.set(0, 0, 0)
  }

  get isMounted(): boolean {
    return this.mounted
  }

  setFacing(yaw: number): void {
    this.heading = normalizeYaw(yaw)
    this.headingRate = 0
    this.group.rotation.y = this.heading
  }

  get tractorSignedSpeed(): number {
    return this.vehicleSpeed
  }

  get tractorSteer(): number {
    return this.vehicleSteer
  }

  stopTractor(): void {
    this.vehicleSpeed = 0
    this.speed = 0
    this.running = false
    this.vel.set(0, 0, 0)
  }

  bumpTractor(): void {
    this.vehicleSpeed *= 0.22
    if (Math.abs(this.vehicleSpeed) < 0.16) this.vehicleSpeed = 0
    this.speed = Math.abs(this.vehicleSpeed)
    this.running = this.speed > 1.9
    this.vel.set(0, 0, 0)
  }

  tractorDebug(): { speed: number; steer: number; yaw: number; vx: number; vz: number; x: number; z: number } {
    return {
      speed: +this.vehicleSpeed.toFixed(2),
      steer: +this.vehicleSteer.toFixed(2),
      yaw: +this.heading.toFixed(2),
      vx: +this.vel.x.toFixed(2),
      vz: +this.vel.z.toFixed(2),
      x: +this.logicalPos.x.toFixed(2),
      z: +this.logicalPos.z.toFixed(2),
    }
  }

  /** fixed-step: camera-relative input -> velocity -> clamped position.
   * Deflection <= 70% walks (speed scales with deflection); beyond that the
   * farmer breaks into a run. */
  update(dt: number, input: { x: number; y: number }, camYaw: number): void {
    // scripted walks override the stick with a synthetic gentle deflection
    if (this.autoTo) {
      const to = this.autoTo.clone().sub(this.logicalPos).setY(0)
      if (to.length() < 0.22) {
        this.autoTo = null
        input = { x: 0, y: 0 }
      } else {
        // world dir -> stick space: the input->world matrix [[c,-s],[-s,-c]]
        // is its own inverse, so one multiply maps us straight back
        to.normalize()
        const c = Math.cos(camYaw)
        const s = Math.sin(camYaw)
        input = { x: (c * to.x - s * to.z) * 0.55, y: (-s * to.x - c * to.z) * 0.55 }
      }
    }
    const mag = Math.min(1, Math.hypot(input.x, input.y))
    this.running = mag > RUN_DEFLECT
    const speed =
      (this.running
        ? WALK_SPEED + ((mag - RUN_DEFLECT) / (1 - RUN_DEFLECT)) * (RUN_SPEED - WALK_SPEED)
        : (mag / RUN_DEFLECT) * WALK_SPEED) * this.rideBoost
    const fx = -Math.sin(camYaw)
    const fz = -Math.cos(camYaw)
    const rx = Math.cos(camYaw)
    const rz = -Math.sin(camYaw)
    // dir has length == mag; normalize so speed is exactly `speed`
    const dirX = rx * input.x + fx * input.y
    const dirZ = rz * input.x + fz * input.y
    if (mag > 0.02) {
      this.vel.set((dirX / mag) * speed, 0, (dirZ / mag) * speed)
      this.speed = speed
      const p = this.logicalPos
      p.x = Math.min(this.bounds.maxX, Math.max(this.bounds.minX, p.x + this.vel.x * dt))
      p.z = Math.min(this.bounds.maxZ, Math.max(this.bounds.minZ, p.z + this.vel.z * dt))
      const want = Math.atan2(dirX, dirZ)
      let d = want - this.heading
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      const step = d * Math.min(1, TURN_RATE * dt)
      this.headingRate = step / Math.max(dt, 1e-6)
      this.heading += step
      this.group.rotation.y = this.heading
    } else {
      this.vel.set(0, 0, 0)
      this.speed = 0
      this.running = false
      this.headingRate = 0
    }
  }

  updateTractor(dt: number, input: { x: number; y: number }): void {
    const throttleAxis = shapeVehicleAxis(input.y, 0.1)
    const steerAxis = shapeVehicleAxis(input.x, 0.14)
    const throttle = Math.sign(throttleAxis) * Math.min(1, Math.pow(Math.abs(throttleAxis), 0.55) * 1.16)
    const steerTarget = Math.sign(steerAxis) * Math.pow(Math.abs(steerAxis), 0.88)
    const targetSpeed = throttle >= 0 ? throttle * TRACTOR_FORWARD_SPEED : throttle * TRACTOR_REVERSE_SPEED
    const accel =
      throttle === 0
        ? TRACTOR_DRAG
        : Math.abs(targetSpeed) > Math.abs(this.vehicleSpeed)
          ? TRACTOR_ACCEL
          : TRACTOR_BRAKE
    this.vehicleSpeed += (targetSpeed - this.vehicleSpeed) * Math.min(1, accel * dt)
    if (Math.abs(this.vehicleSpeed) < 0.025 && throttle === 0) this.vehicleSpeed = 0
    this.vehicleSteer += (steerTarget - this.vehicleSteer) * Math.min(1, TRACTOR_STEER_SMOOTH * dt)

    const absSpeed = Math.abs(this.vehicleSpeed)
    if (absSpeed > 0.035 && Math.abs(this.vehicleSteer) > 0.02) {
      const reverse = this.vehicleSpeed < 0 ? -1 : 1
      const turnRate = this.vehicleSteer * reverse * (TRACTOR_TURN_BASE + absSpeed * TRACTOR_TURN_GAIN)
      this.heading += turnRate * dt
      while (this.heading > Math.PI) this.heading -= Math.PI * 2
      while (this.heading < -Math.PI) this.heading += Math.PI * 2
      this.group.rotation.y = this.heading
      this.headingRate = turnRate
    } else {
      this.headingRate = 0
    }

    this.vel.set(Math.sin(this.heading) * this.vehicleSpeed, 0, Math.cos(this.heading) * this.vehicleSpeed)
    const p = this.logicalPos
    const nextX = p.x + this.vel.x * dt
    const nextZ = p.z + this.vel.z * dt
    p.x = Math.min(this.bounds.maxX, Math.max(this.bounds.minX, nextX))
    p.z = Math.min(this.bounds.maxZ, Math.max(this.bounds.minZ, nextZ))
    if (p.x !== nextX || p.z !== nextZ) this.bumpTractor()
    this.speed = Math.abs(this.vehicleSpeed)
    this.running = this.speed > 1.9
  }

  /** frame-rate: animation crossfades, foot-locked playback rate, turn lean,
   * breathing idle / procedural limb swing */
  frame(dt: number, t: number): void {
    const moving = this.speed > 0.25
    if (this.mixer) {
      if (this.mounted) {
        // seated on Hazel — the body stays calm; her gait sells the motion
        this.swap(this.idle, 1)
      } else if (t < this.gestureUntil) {
        // one-shot gesture owns the body briefly
      } else if (moving) {
        const fast = this.speed > WALK_SPEED + 0.35 && this.run
        if (fast) this.swap(this.run, clamp(this.speed / RUN_REF_SPEED, 0.75, 1.45))
        else this.swap(this.walk, clamp(this.speed / WALK_REF_SPEED, 0.65, 1.8))
      } else {
        this.swap(this.idle, 1)
      }
      this.mixer.update(dt)
      // bank into turns (presentation-only, on the inner model)
      const wantLean = moving ? clamp(-this.headingRate * LEAN_GAIN * (this.speed / RUN_SPEED), -LEAN_MAX, LEAN_MAX) : 0
      this.lean += (wantLean - this.lean) * Math.min(1, 10 * dt)
      this.model.rotation.z = this.lean
      // breathing micro-motion on top of the idle clip
      const breathe = moving ? 1 : 1 + Math.sin(t * 2.1) * 0.004
      this.model.scale.set(this.baseScale, this.baseScale * breathe, this.baseScale)
    } else if (this.rig) {
      // procedural swing-walk: arms/legs counter-phase, gentle body bob
      this.swingT += dt * (moving ? 9.5 * (this.speed / WALK_SPEED) : 2)
      const amp = moving ? 0.75 : 0.03
      const s = Math.sin(this.swingT)
      this.rig.armL.rotation.x = s * amp
      this.rig.armR.rotation.x = -s * amp
      this.rig.legL.rotation.x = -s * amp
      this.rig.legR.rotation.x = s * amp
      this.rig.body.position.y = moving ? Math.abs(Math.sin(this.swingT)) * 0.05 : Math.sin(t * 1.8) * 0.015
    }
    if (this.mountPose === 'horse') {
      this.horseRider.position.y = this.horseRiderBaseY + Math.sin(t * (moving ? 10 : 2.4)) * (moving ? 0.018 : 0.004)
      this.horseRider.rotation.x = moving ? -0.04 : -0.025
      this.horseRider.rotation.z = this.lean * 0.45
    } else if (this.mountPose === 'tractor') {
      this.tractorRider.position.y = this.tractorRiderBaseY + Math.sin(t * (moving ? 13 : 3.5)) * (moving ? 0.01 : 0.003)
      this.tractorRider.rotation.z = this.lean * 0.35
    }
  }

  /** little pick-up flourish on harvest/serve (skips silently if no clip) */
  gesture(t: number): void {
    if (!this.mixer || !this.gestureA || this.speed > 0.5) return
    this.gestureA.reset()
    this.gestureA.setLoop(LoopOnce, 1)
    this.gestureA.timeScale = 1.7
    this.gestureA.play()
    this.current?.crossFadeTo(this.gestureA, 0.12, false)
    this.current = this.gestureA
    this.gestureUntil = t + (this.gestureA.getClip().duration / 1.7) * 0.85
  }

  private swap(next: AnimationAction | null, timeScale: number): void {
    if (!next) return
    next.timeScale = timeScale
    if (next === this.current) return
    next.reset()
    next.play()
    if (this.current) this.current.crossFadeTo(next, FADE, false)
    this.current = next
  }

  /** anchor for camera focus / fx near the farmer's chest */
  focusPos(): Vector3 {
    return this.group.position.clone().setY(1.0)
  }

  /** kept for symmetry with other views (model swap-out later) */
  get root(): Group {
    return this.model
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function normalizeYaw(yaw: number): number {
  while (yaw > Math.PI) yaw -= Math.PI * 2
  while (yaw < -Math.PI) yaw += Math.PI * 2
  return yaw
}

// ---- procedural fallback farmer -------------------------------------------

function buildProceduralFarmer(): { group: Group; rig: ProceduralRig } {
  const skin = new MeshStandardMaterial({ color: '#f2c79b', roughness: 0.9 })
  const overall = new MeshStandardMaterial({ color: '#4f74b8', roughness: 0.95 })
  const shirt = new MeshStandardMaterial({ color: '#d9543f', roughness: 0.95 })
  const straw = new MeshStandardMaterial({ color: '#e3b95c', roughness: 1 })
  const boot = new MeshStandardMaterial({ color: '#6b4a2b', roughness: 1 })

  const group = new Group()
  const body = new Group()
  group.add(body)

  const mk = (geo: CapsuleGeometry | SphereGeometry | CylinderGeometry, mat: MeshStandardMaterial): Mesh => {
    const m = new Mesh(geo, mat)
    m.castShadow = true
    return m
  }

  // torso: shirt top + overalls bottom
  const torso = mk(new CapsuleGeometry(0.26, 0.34, 4, 10), shirt)
  torso.position.y = 0.85
  body.add(torso)
  const bib = mk(new CapsuleGeometry(0.275, 0.26, 4, 10), overall)
  bib.position.y = 0.74
  body.add(bib)

  // round head + straw hat
  const head = mk(new SphereGeometry(0.24, 14, 12), skin)
  head.position.y = 1.34
  body.add(head)
  const brim = mk(new CylinderGeometry(0.4, 0.42, 0.05, 14), straw)
  brim.position.y = 1.5
  body.add(brim)
  const crown = mk(new CylinderGeometry(0.18, 0.22, 0.16, 12), straw)
  crown.position.y = 1.58
  body.add(crown)

  const limb = (mat: MeshStandardMaterial, len: number, r: number): Group => {
    const pivot = new Group()
    const m = mk(new CapsuleGeometry(r, len, 4, 8), mat)
    m.position.y = -(len / 2 + r)
    pivot.add(m)
    return pivot
  }

  const armL = limb(skin, 0.3, 0.075)
  armL.position.set(0.34, 1.12, 0)
  const armR = limb(skin, 0.3, 0.075)
  armR.position.set(-0.34, 1.12, 0)
  const legL = limb(overall, 0.3, 0.095)
  legL.position.set(0.13, 0.52, 0)
  const legR = limb(overall, 0.3, 0.095)
  legR.position.set(-0.13, 0.52, 0)
  // little boots
  for (const leg of [legL, legR]) {
    const b = mk(new SphereGeometry(0.1, 8, 8), boot)
    b.position.y = -0.48
    b.scale.set(1, 0.7, 1.3)
    leg.add(b)
  }
  body.add(armL, armR, legL, legR)
  return { group, rig: { armL, armR, legL, legR, body } }
}

function buildHorseRider(): Group {
  const skin = new MeshStandardMaterial({ color: '#f2c79b', roughness: 0.9 })
  const overall = new MeshStandardMaterial({ color: '#4f74b8', roughness: 0.95 })
  const shirt = new MeshStandardMaterial({ color: '#d9543f', roughness: 0.95 })
  const straw = new MeshStandardMaterial({ color: '#e3b95c', roughness: 1 })
  const boot = new MeshStandardMaterial({ color: '#5b3d28', roughness: 1 })
  const saddle = new MeshStandardMaterial({ color: '#4b3325', roughness: 0.95 })
  const blanket = new MeshStandardMaterial({ color: '#b84a36', roughness: 0.9 })

  const group = new Group()
  const mk = (geo: BoxGeometry | CapsuleGeometry | SphereGeometry | CylinderGeometry, mat: MeshStandardMaterial): Mesh => {
    const m = new Mesh(geo, mat)
    m.castShadow = true
    return m
  }
  const limb = (mat: MeshStandardMaterial, len: number, r: number): Group => {
    const pivot = new Group()
    const m = mk(new CapsuleGeometry(r, len, 4, 8), mat)
    m.position.y = -(len / 2 + r)
    pivot.add(m)
    return pivot
  }

  const saddleBlanket = mk(new BoxGeometry(0.58, 0.055, 0.7), blanket)
  saddleBlanket.position.set(0, -0.03, 0)
  group.add(saddleBlanket)
  const seat = mk(new BoxGeometry(0.38, 0.1, 0.5), saddle)
  seat.position.set(0, 0.025, -0.01)
  group.add(seat)

  const hips = mk(new CapsuleGeometry(0.22, 0.18, 4, 10), overall)
  hips.position.set(0, 0.14, -0.01)
  hips.rotation.x = Math.PI / 2
  hips.scale.set(1.1, 0.75, 0.9)
  group.add(hips)

  const torso = mk(new CapsuleGeometry(0.2, 0.34, 4, 10), shirt)
  torso.position.set(0, 0.5, 0.03)
  torso.rotation.x = -0.16
  group.add(torso)
  const bib = mk(new CapsuleGeometry(0.2, 0.23, 4, 10), overall)
  bib.position.set(0, 0.39, 0.06)
  bib.rotation.x = -0.16
  group.add(bib)
  const head = mk(new SphereGeometry(0.19, 14, 12), skin)
  head.position.set(0, 0.86, 0.04)
  group.add(head)
  const brim = mk(new CylinderGeometry(0.34, 0.36, 0.045, 14), straw)
  brim.position.set(0, 1.02, 0.04)
  group.add(brim)
  const crown = mk(new CylinderGeometry(0.16, 0.19, 0.14, 12), straw)
  crown.position.set(0, 1.11, 0.04)
  group.add(crown)

  const armL = limb(skin, 0.36, 0.052)
  armL.position.set(0.22, 0.58, 0.07)
  armL.rotation.x = -0.95
  armL.rotation.z = 0.2
  const armR = limb(skin, 0.36, 0.052)
  armR.position.set(-0.22, 0.58, 0.07)
  armR.rotation.x = -0.95
  armR.rotation.z = -0.2

  const legL = limb(overall, 0.34, 0.07)
  legL.position.set(0.23, 0.17, 0.02)
  legL.rotation.x = -0.38
  legL.rotation.z = -0.38
  const legR = limb(overall, 0.34, 0.07)
  legR.position.set(-0.23, 0.17, 0.02)
  legR.rotation.x = -0.38
  legR.rotation.z = 0.38
  for (const leg of [legL, legR]) {
    const b = mk(new SphereGeometry(0.078, 8, 8), boot)
    b.position.y = -0.42
    b.scale.set(1.1, 0.7, 1.45)
    leg.add(b)
  }
  group.add(armL, armR, legL, legR)
  group.scale.setScalar(0.94)
  return group
}

function buildTractorRider(): Group {
  const skin = new MeshStandardMaterial({ color: '#f2c79b', roughness: 0.9 })
  const overall = new MeshStandardMaterial({ color: '#4f74b8', roughness: 0.95 })
  const shirt = new MeshStandardMaterial({ color: '#d9543f', roughness: 0.95 })
  const straw = new MeshStandardMaterial({ color: '#e3b95c', roughness: 1 })
  const boot = new MeshStandardMaterial({ color: '#5b3d28', roughness: 1 })

  const group = new Group()
  const mk = (geo: BoxGeometry | CapsuleGeometry | SphereGeometry | CylinderGeometry, mat: MeshStandardMaterial): Mesh => {
    const m = new Mesh(geo, mat)
    m.castShadow = true
    return m
  }
  const limb = (mat: MeshStandardMaterial, len: number, r: number): Group => {
    const pivot = new Group()
    const m = mk(new CapsuleGeometry(r, len, 4, 8), mat)
    m.position.y = -(len / 2 + r)
    pivot.add(m)
    return pivot
  }

  const hips = mk(new BoxGeometry(0.42, 0.16, 0.28), overall)
  hips.position.set(0, 0.11, -0.02)
  hips.rotation.x = 0.08
  group.add(hips)

  const torso = mk(new CapsuleGeometry(0.2, 0.34, 4, 10), shirt)
  torso.position.set(0, 0.47, 0.03)
  torso.rotation.x = -0.16
  group.add(torso)
  const bib = mk(new CapsuleGeometry(0.2, 0.24, 4, 10), overall)
  bib.position.set(0, 0.37, 0.06)
  bib.rotation.x = -0.16
  group.add(bib)
  const head = mk(new SphereGeometry(0.2, 14, 12), skin)
  head.position.set(0, 0.84, 0.08)
  group.add(head)
  const brim = mk(new CylinderGeometry(0.34, 0.36, 0.045, 14), straw)
  brim.position.set(0, 1, 0.08)
  group.add(brim)
  const crown = mk(new CylinderGeometry(0.16, 0.19, 0.14, 12), straw)
  crown.position.set(0, 1.09, 0.08)
  group.add(crown)

  const armL = limb(skin, 0.42, 0.055)
  armL.position.set(0.2, 0.61, 0.08)
  armL.rotation.x = -1.08
  armL.rotation.z = 0.12
  const armR = limb(skin, 0.42, 0.055)
  armR.position.set(-0.2, 0.61, 0.08)
  armR.rotation.x = -1.08
  armR.rotation.z = -0.12
  const legL = limb(overall, 0.24, 0.068)
  legL.position.set(0.14, 0.18, 0)
  legL.rotation.x = -1.48
  legL.rotation.z = -0.08
  const legR = limb(overall, 0.24, 0.068)
  legR.position.set(-0.14, 0.18, 0)
  legR.rotation.x = -1.48
  legR.rotation.z = 0.08
  for (const leg of [legL, legR]) {
    const b = mk(new SphereGeometry(0.072, 8, 8), boot)
    b.position.y = -0.31
    b.scale.set(1.05, 0.62, 1.45)
    leg.add(b)
  }
  group.add(armL, armR, legL, legR)
  group.scale.setScalar(0.92)
  return group
}

function shapeVehicleAxis(value: number, deadzone: number): number {
  const clamped = clamp(value, -1, 1)
  const magnitude = Math.abs(clamped)
  if (magnitude <= deadzone) return 0
  return Math.sign(clamped) * ((magnitude - deadzone) / (1 - deadzone))
}
