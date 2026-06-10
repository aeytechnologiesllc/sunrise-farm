/** A visiting customer: walks the road in, queues at the stand, browses
 * happily while waiting (never angry — no-punishment rule), does a joyful
 * hop when served, then strolls away. Movement runs on the fixed step. */
import gsap from 'gsap'
import {
  AnimationAction,
  AnimationMixer,
  Group,
  LoopOnce,
  Scene,
  Vector3,
  type AnimationClip,
} from 'three'
import { mulberry32 } from '../game/rng'
import { tint, type Assets, type ModelKey } from './assets'
import { GATE_SOUTH_X, QUEUE_SPOTS, ROAD_Z, STAND_POS } from './scenery'

const SPEED = 2.1
const EDGE_X = 26

const LOOKS: ModelKey[] = ['villagerA', 'villagerB', 'villagerC', 'villagerD']

function act(mixer: AnimationMixer, root: Group, clips: AnimationClip[], name: string): AnimationAction | null {
  const clip = clips.find((c) => c.name.toLowerCase() === name || c.name.toLowerCase().endsWith(`|${name}`))
  return clip ? mixer.clipAction(clip, root) : null
}

type Mode = 'walk-in' | 'waiting' | 'walk-out' | 'gone'

export class CustomerView {
  readonly group = new Group()
  readonly id: number
  /** fires once when the walk-in reaches the queue spot */
  onArrive: (() => void) | null = null
  /** fires when the walk-out finishes and the view removed itself */
  onGone: (() => void) | null = null

  private mixer: AnimationMixer | null = null
  private idle: AnimationAction | null = null
  private walk: AnimationAction | null = null
  private yes: AnimationAction | null = null
  private current: AnimationAction | null = null
  private mode: Mode = 'walk-in'
  private waypoints: Vector3[] = []
  private spot: Vector3
  private browseT = 0
  private exitX: number

  constructor(assets: Assets, private scene: Scene, id: number, seed: number, spotIndex: number) {
    this.id = id
    const rng = mulberry32(seed)
    const key = LOOKS[Math.floor(rng.next() * LOOKS.length)]
    const enterX = rng.next() > 0.5 ? -EDGE_X : EDGE_X
    this.exitX = -enterX
    this.spot = QUEUE_SPOTS[Math.min(spotIndex, QUEUE_SPOTS.length - 1)].clone()

    let model: Group
    try {
      model = assets.spawnSkinned(key)
      const clips = assets.clips(key)
      this.mixer = new AnimationMixer(model)
      this.idle = act(this.mixer, model, clips, 'idle')
      this.walk = act(this.mixer, model, clips, 'walk')
      this.yes = act(this.mixer, model, clips, 'emote-yes')
      tint(model, (rng.next() - 0.5) * 0.1, (rng.next() - 0.5) * 0.08)
      model.scale.setScalar(2.2 * (0.92 + rng.next() * 0.16))
      this.walk?.play()
      this.current = this.walk
    } catch {
      model = new Group()
    }
    this.group.add(model)
    this.group.position.set(enterX, 0, ROAD_Z + (rng.next() - 0.5) * 0.8)
    scene.add(this.group)
    // walk the road, turn in at the picket gate, take a queue spot
    this.waypoints = [
      new Vector3(GATE_SOUTH_X, 0, ROAD_Z),
      new Vector3(GATE_SOUTH_X, 0, 9.4),
      new Vector3(this.spot.x, 0, this.spot.z),
    ]
  }

  /** queue shuffles forward when the front customer leaves */
  moveToSpot(spotIndex: number): void {
    const next = QUEUE_SPOTS[Math.min(spotIndex, QUEUE_SPOTS.length - 1)].clone()
    if (next.distanceTo(this.spot) < 0.1) return
    this.spot = next
    if (this.mode === 'waiting') {
      this.mode = 'walk-in'
      this.waypoints = [next]
    } else if (this.mode === 'walk-in') {
      this.waypoints[this.waypoints.length - 1] = next
    }
  }

  /** served: happy hop + nod, then walk away down the road */
  serve(): void {
    if (this.mode === 'gone' || this.mode === 'walk-out') return
    this.mode = 'walk-out'
    this.waypoints = []
    if (this.yes) {
      this.yes.reset()
      this.yes.setLoop(LoopOnce, 1)
      this.yes.play()
      this.current?.crossFadeTo(this.yes, 0.15, false)
      this.current = this.yes
    }
    gsap.fromTo(this.group.position, { y: 0 }, { y: 0.5, duration: 0.22, yoyo: true, repeat: 1, ease: 'power1.out' })
    // linger through the nod, then head out (sim-time delay via waypointDelay)
    this.leaveDelay = 1.1
  }

  private leaveDelay = 0

  /** fixed-step movement along waypoints */
  update(dt: number): void {
    if (this.mode === 'gone') return
    if (this.mode === 'walk-out') {
      if (this.leaveDelay > 0) {
        this.leaveDelay -= dt
        if (this.leaveDelay <= 0) {
          // back out through the gate, then off down the road
          this.waypoints = [
            new Vector3(GATE_SOUTH_X, 0, 9.4),
            new Vector3(GATE_SOUTH_X, 0, ROAD_Z),
            new Vector3(this.exitX, 0, ROAD_Z + 0.4),
          ]
          this.swap(this.walk)
        }
        return
      }
      if (this.stepAlong(dt)) {
        this.mode = 'gone'
        this.scene.remove(this.group)
        this.onGone?.()
      }
      return
    }
    if (this.mode === 'walk-in') {
      if (this.stepAlong(dt)) {
        this.mode = 'waiting'
        this.swap(this.idle)
        this.group.lookAt(STAND_POS.x, 0, STAND_POS.z)
        this.onArrive?.()
      }
      return
    }
    // waiting: browse — sway and glance around, content to linger forever
    this.browseT += dt
    this.group.rotation.y += Math.sin(this.browseT * 0.7) * 0.0035
  }

  private stepAlong(dt: number): boolean {
    const wp = this.waypoints[0]
    if (!wp) return true
    const to = wp.clone().sub(this.group.position).setY(0)
    const d = to.length()
    if (d < 0.12) {
      this.waypoints.shift()
      return this.waypoints.length === 0
    }
    this.swap(this.walk)
    const step = Math.min(d, SPEED * dt)
    this.group.position.add(to.normalize().multiplyScalar(step))
    this.group.lookAt(this.group.position.clone().add(to))
    return false
  }

  frame(dt: number): void {
    this.mixer?.update(dt)
  }

  private swap(next: AnimationAction | null): void {
    if (!next || next === this.current) return
    next.reset().play()
    if (this.current) this.current.crossFadeTo(next, 0.2, false)
    this.current = next
  }

  /** anchor for the projected want bubble */
  bubbleAnchor(): Vector3 {
    return this.group.position.clone().add(new Vector3(0, 2.25, 0))
  }

  get waiting(): boolean {
    return this.mode === 'waiting'
  }

  get active(): boolean {
    return this.mode !== 'gone'
  }
}
