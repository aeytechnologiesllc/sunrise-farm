/** Farm-dog guide. When the player idles with an obvious next action, she
 * trots near the target and bounces toward it. Pure suggestion — input and
 * camera never lock, and she retreats the moment the player acts. */
import {
  AnimationAction,
  AnimationMixer,
  Group,
  Scene,
  Vector3,
  type AnimationClip,
} from 'three'
import { mulberry32 } from '../game/rng'
import { tint, type Assets } from './assets'

const SPEED = 3.2

function suffixAction(mixer: AnimationMixer, root: Group, clips: AnimationClip[], suffix: string): AnimationAction | null {
  const clip = clips.find((c) => c.name.toLowerCase().endsWith(suffix.toLowerCase()))
  return clip ? mixer.clipAction(clip, root) : null
}

export class DogView {
  readonly group = new Group()
  private dog: Group
  private mixer: AnimationMixer
  private idle: AnimationAction | null
  private walk: AnimationAction | null
  private current: AnimationAction | null = null
  private home: Vector3
  private dest: Vector3 | null = null
  private pointTarget: Vector3 | null = null
  private bounceT = 0

  constructor(assets: Assets, scene: Scene, home: Vector3) {
    this.home = home.clone()
    this.dog = assets.spawnSkinned('dog')
    this.dog.scale.setScalar(0.55)
    tint(this.dog, 0.01, 0.02)
    this.group.add(this.dog)
    this.group.position.copy(home)
    this.group.rotation.y = Math.PI * 0.8
    scene.add(this.group)
    this.mixer = new AnimationMixer(this.dog)
    const clips = assets.clips('dog')
    this.idle = suffixAction(this.mixer, this.dog, clips, 'Idle')
    this.walk = suffixAction(this.mixer, this.dog, clips, 'Walk')
    this.idle?.play()
    this.current = this.idle
    // tiny seeded variety so the dog is also an individual
    const rng = mulberry32(777)
    this.dog.scale.setScalar(0.55 * (0.95 + rng.next() * 0.1))
  }

  /** point near `target`, or null to head home */
  guideTo(target: Vector3 | null): void {
    if (target) {
      const offset = new Vector3(target.x > this.home.x ? -1.6 : 1.6, 0, 1.4)
      const dest = target.clone().add(offset).setY(0)
      if (this.pointTarget && dest.distanceTo(this.dest ?? dest) < 0.5) return
      this.dest = dest
      this.pointTarget = target.clone()
    } else {
      if (!this.pointTarget && !this.dest) return
      this.pointTarget = null
      if (this.group.position.distanceTo(this.home) > 0.5) this.dest = this.home.clone()
    }
  }

  /** fixed-step movement */
  update(dt: number): void {
    if (this.dest) {
      const to = this.dest.clone().sub(this.group.position).setY(0)
      const d = to.length()
      if (d < 0.15) {
        this.dest = null
        this.swap(this.idle)
        if (this.pointTarget) this.group.lookAt(this.pointTarget.x, 0, this.pointTarget.z)
      } else {
        const step = Math.min(d, SPEED * dt)
        this.group.position.add(to.normalize().multiplyScalar(step))
        this.group.lookAt(this.group.position.clone().add(to))
        this.swap(this.walk)
      }
    }
    if (this.pointTarget && !this.dest) {
      // excited bounce toward the thing she wants you to tap
      this.bounceT += dt * 7
      this.group.position.y = Math.abs(Math.sin(this.bounceT)) * 0.22
    } else {
      this.group.position.y = 0
      this.bounceT = 0
    }
  }

  frame(dt: number): void {
    this.mixer.update(dt)
  }

  private swap(next: AnimationAction | null): void {
    if (!next || next === this.current) return
    next.reset().play()
    if (this.current) this.current.crossFadeTo(next, 0.2, false)
    this.current = next
  }
}
