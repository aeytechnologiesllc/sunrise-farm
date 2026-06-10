/** The farmer you walk around. Uses a Kenney mini-character (idle/walk/sprint
 * clips) when its clips load; otherwise builds a charming articulated
 * procedural farmer (~1.6u: round head, straw hat, overalls, swinging limbs).
 * Movement is fixed-step + camera-relative; rendering is frame-rate. */
import {
  AnimationAction,
  AnimationMixer,
  Box3,
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
import type { Assets } from './assets'

const WALK_SPEED = 3.6
const TURN_RATE = 11
const TARGET_HEIGHT = 1.6

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
  /** current planar speed, units/s */
  speed = 0

  private model: Group
  private mixer: AnimationMixer | null = null
  private idle: AnimationAction | null = null
  private walk: AnimationAction | null = null
  private sprint: AnimationAction | null = null
  private gestureA: AnimationAction | null = null
  private current: AnimationAction | null = null
  private gestureUntil = -1
  private heading = 0
  private rig: ProceduralRig | null = null
  private swingT = 0
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
        this.sprint = suffixAction(mixer, model, clips, 'sprint')
        this.gestureA = suffixAction(mixer, model, clips, 'pick-up')
        // normalize to ~1.6 units tall regardless of source scale
        const h = new Box3().setFromObject(model).getSize(new Vector3()).y || 1
        model.scale.multiplyScalar(TARGET_HEIGHT / h)
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
    this.group.add(model)
    this.group.position.copy(spawn)
    scene.add(this.group)
  }

  get pos(): Vector3 {
    return this.group.position
  }

  /** fixed-step: camera-relative input -> velocity -> clamped position */
  update(dt: number, input: { x: number; y: number }, camYaw: number): void {
    const mag = Math.min(1, Math.hypot(input.x, input.y))
    const fx = -Math.sin(camYaw)
    const fz = -Math.cos(camYaw)
    const rx = Math.cos(camYaw)
    const rz = -Math.sin(camYaw)
    const dirX = rx * input.x + fx * input.y
    const dirZ = rz * input.x + fz * input.y
    this.vel.set(dirX * WALK_SPEED, 0, dirZ * WALK_SPEED)
    this.speed = mag * WALK_SPEED
    if (mag > 0.02) {
      const p = this.group.position
      p.x = Math.min(this.bounds.maxX, Math.max(this.bounds.minX, p.x + this.vel.x * dt))
      p.z = Math.min(this.bounds.maxZ, Math.max(this.bounds.minZ, p.z + this.vel.z * dt))
      const want = Math.atan2(dirX, dirZ)
      let d = want - this.heading
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      this.heading += d * Math.min(1, TURN_RATE * dt)
      this.group.rotation.y = this.heading
    } else {
      this.speed = 0
    }
  }

  /** frame-rate: animation blending / procedural limb swing */
  frame(dt: number, t: number): void {
    const moving = this.speed > 0.25
    if (this.mixer) {
      if (t < this.gestureUntil) {
        // one-shot gesture owns the body briefly
      } else if (moving) {
        const fast = this.speed > WALK_SPEED * 0.85 && this.sprint
        const next = fast ? this.sprint : this.walk
        this.swap(next, Math.max(0.6, this.speed / WALK_SPEED) * 1.25)
      } else {
        this.swap(this.idle, 1)
      }
      this.mixer.update(dt)
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
    if (this.current) this.current.crossFadeTo(next, 0.18, false)
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
