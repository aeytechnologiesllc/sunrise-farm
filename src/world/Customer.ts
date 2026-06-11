/** A visiting customer: walks the road in, queues at the stand, browses
 * happily while waiting (never angry — no-punishment rule), does a joyful
 * hop + wave when served, then strolls away. Movement runs on the fixed step.
 *
 * PHASE 1: customers are the SAME adult Quaternius family as the farmer
 * (Worker / Adventurer / Casual, CC0, identical CharacterArmature rig) —
 * no chibi minis anywhere. Each visitor is seeded-unique: model pick, skin
 * tone, hair color, outfit tint, and a height inside the farmer±10% band
 * from the SCALE table. Walk playback is foot-locked to ground speed, and
 * every clip change crossfades (no T-pose flashes, no snapping). */
import gsap from 'gsap'
import {
  AnimationAction,
  AnimationMixer,
  Color,
  Group,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Vector3,
  type AnimationClip,
} from 'three'
import { mulberry32, type Rng } from '../game/rng'
import { type Assets, type ModelKey } from './assets'
import { assertSpawnScale, customerHeightFor, normalizeHeight, SCALE } from './scale'
import { GATE_SOUTH_X, MARKET, ROAD_Z } from './scenery'

const SPEED = 2.1
const EDGE_X = 26
/** smooth heading turns at waypoint corners (rad/s gain) */
const TURN_RATE = 8
const FADE = 0.22
/** ground speed covered by the family Walk clip at timeScale 1 for a 1.6u
 * adult (same measurement as the farmer's foot-lock) */
const WALK_REF_AT_FARMER_HEIGHT = 2.2

const LOOKS: ModelKey[] = ['customerA', 'customerB', 'customerC']

/** seeded appearance palettes (CC0 models ship with flat vertex-color mats) */
const SKIN_TONES = ['#f6cfa8', '#eec39a', '#d9a36e', '#b97f4f', '#8d5a36', '#6f4427']
const HAIR_COLORS = ['#2a2118', '#4a3220', '#74512c', '#a06b2f', '#883c22', '#9b9fa6']

function act(mixer: AnimationMixer, root: Group, clips: AnimationClip[], name: string): AnimationAction | null {
  const clip = clips.find((c) => c.name.toLowerCase() === name || c.name.toLowerCase().endsWith(`|${name}`))
  return clip ? mixer.clipAction(clip, root) : null
}

/** per-customer seeded look: skin tone, hair color, outfit hue/lightness.
 * Material names are stable across the Quaternius family (Skin, Hair,
 * Eyebrows, Moustache, Eye…) — anything else counts as outfit. */
function varyLook(model: Group, rng: Rng): void {
  const skin = new Color(SKIN_TONES[Math.floor(rng.next() * SKIN_TONES.length)])
  const hair = new Color(HAIR_COLORS[Math.floor(rng.next() * HAIR_COLORS.length)])
  const outfitHue = (rng.next() - 0.5) * 0.22
  // biased upward: visitors get the same anti-silhouette lift as the farmer
  const outfitLight = 0.06 + (rng.next() - 0.5) * 0.12
  model.traverse((o) => {
    if (!(o instanceof Mesh)) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      if (!(m instanceof MeshStandardMaterial)) continue
      const name = m.name.toLowerCase()
      if (name === 'eye') continue // keep eye whites/pupils crisp
      if (name.startsWith('skin')) {
        m.color.copy(skin)
        if (name.includes('darker')) m.color.offsetHSL(0, 0, -0.06) // lips/ears shading
      } else if (name === 'hair' || name === 'eyebrows' || name === 'moustache') {
        m.color.copy(hair)
        if (name === 'eyebrows') m.color.offsetHSL(0, 0, -0.04)
      } else {
        m.color.offsetHSL(outfitHue, 0, outfitLight)
      }
    }
  })
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
  private idleAlt: AnimationAction | null = null
  private walk: AnimationAction | null = null
  private happy: AnimationAction | null = null
  private current: AnimationAction | null = null
  private mode: Mode = 'walk-in'
  private waypoints: Vector3[] = []
  private spot: Vector3
  private browseT = 0
  private browseSwapIn: number
  private exitX: number
  private heading = 0
  private height: number = SCALE.farmer
  private rng: Rng

  constructor(assets: Assets, private scene: Scene, id: number, seed: number, spotIndex: number) {
    this.id = id
    const rng = (this.rng = mulberry32(seed))
    const key = LOOKS[Math.floor(rng.next() * LOOKS.length)]
    const enterX = rng.next() > 0.5 ? -EDGE_X : EDGE_X
    this.exitX = -enterX
    // MARKET routes the visit: the roadside stand inside the gate early on,
    // the farm shop across the road once it opens (read fresh, never cached)
    this.spot = MARKET.spots[Math.min(spotIndex, MARKET.spots.length - 1)].clone()
    this.browseSwapIn = 4 + rng.next() * 5

    let model: Group
    try {
      model = assets.spawnSkinned(key)
      const clips = assets.clips(key)
      this.mixer = new AnimationMixer(model)
      this.idle = act(this.mixer, model, clips, 'idle')
      this.idleAlt = act(this.mixer, model, clips, 'idle_neutral')
      this.walk = act(this.mixer, model, clips, 'walk')
      this.happy = act(this.mixer, model, clips, 'wave')
      // adult height from the SCALE table (farmer ±10%), then seeded look
      this.height = customerHeightFor(rng)
      normalizeHeight(model, this.height)
      assertSpawnScale('customer', this.height, SCALE.customer.min, SCALE.customer.max)
      varyLook(model, rng)
      if (this.walk) {
        this.walk.timeScale = this.walkTimeScale()
        this.walk.play()
        // de-sync clones so a queue never struts in lockstep
        this.walk.time = rng.next() * this.walk.getClip().duration
      }
      this.current = this.walk
    } catch {
      model = new Group()
    }
    this.group.add(model)
    this.group.position.set(enterX, 0, ROAD_Z + (rng.next() - 0.5) * 0.8)
    this.heading = this.group.rotation.y = enterX > 0 ? -Math.PI / 2 : Math.PI / 2
    scene.add(this.group)
    // walk the road, then turn IN through the picket gate (stand) or step
    // OFF the south shoulder to the shop front (shop) — no gate to cross
    this.waypoints = MARKET.atShop
      ? [new Vector3(this.spot.x, 0, ROAD_Z), new Vector3(this.spot.x, 0, this.spot.z)]
      : [
          new Vector3(GATE_SOUTH_X, 0, ROAD_Z),
          new Vector3(GATE_SOUTH_X, 0, 9.4),
          new Vector3(this.spot.x, 0, this.spot.z),
        ]
  }

  /** foot-lock: clip ground coverage scales with body height */
  private walkTimeScale(): number {
    const ref = WALK_REF_AT_FARMER_HEIGHT * (this.height / SCALE.farmer)
    return Math.min(1.8, Math.max(0.6, SPEED / ref))
  }

  /** queue shuffles forward when the front customer leaves */
  moveToSpot(spotIndex: number): void {
    const next = MARKET.spots[Math.min(spotIndex, MARKET.spots.length - 1)].clone()
    if (next.distanceTo(this.spot) < 0.1) return
    this.spot = next
    if (this.mode === 'waiting') {
      this.mode = 'walk-in'
      this.waypoints = [next]
    } else if (this.mode === 'walk-in') {
      this.waypoints[this.waypoints.length - 1] = next
    }
  }

  /** served: happy hop + a wave, then walk away down the road */
  serve(): void {
    if (this.mode === 'gone' || this.mode === 'walk-out') return
    this.mode = 'walk-out'
    this.waypoints = []
    if (this.happy) {
      this.happy.reset()
      this.happy.setLoop(LoopOnce, 1)
      this.happy.timeScale = 1.25
      this.happy.play()
      this.current?.crossFadeTo(this.happy, 0.15, false)
      this.current = this.happy
    }
    // joyful hop, sized for an adult (not the old chibi spring)
    gsap.fromTo(this.group.position, { y: 0 }, { y: 0.32, duration: 0.2, yoyo: true, repeat: 1, ease: 'power1.out' })
    // linger through the wave, then head out (sim-time delay, never timeouts)
    this.leaveDelay = 1.2
  }

  private leaveDelay = 0

  /** fixed-step movement along waypoints */
  update(dt: number): void {
    if (this.mode === 'gone') return
    if (this.mode === 'walk-out') {
      if (this.leaveDelay > 0) {
        this.leaveDelay -= dt
        if (this.leaveDelay <= 0) {
          // back out the way they came in, then off down the road
          this.waypoints = MARKET.atShop
            ? [new Vector3(this.group.position.x, 0, ROAD_Z + 0.3), new Vector3(this.exitX, 0, ROAD_Z + 0.4)]
            : [
                new Vector3(GATE_SOUTH_X, 0, 9.4),
                new Vector3(GATE_SOUTH_X, 0, ROAD_Z),
                new Vector3(this.exitX, 0, ROAD_Z + 0.4),
              ]
          this.swap(this.walk, this.walkTimeScale())
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
        this.browseT = 0
        this.turnTo(Math.atan2(MARKET.pos.x - this.group.position.x, MARKET.pos.z - this.group.position.z), 1)
        this.onArrive?.()
      }
      return
    }
    // waiting: browse — gentle sway, occasional shift between the two idles,
    // content to linger forever (no anger, ever)
    this.browseT += dt
    this.group.rotation.y = this.heading + Math.sin(this.browseT * 0.7) * 0.1
    this.browseSwapIn -= dt
    if (this.browseSwapIn <= 0 && this.idle && this.idleAlt) {
      this.browseSwapIn = 5 + this.rng.next() * 6
      this.swap(this.current === this.idle ? this.idleAlt : this.idle)
    }
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
    this.swap(this.walk, this.walkTimeScale())
    const step = Math.min(d, SPEED * dt)
    this.group.position.add(to.normalize().multiplyScalar(step))
    // damped turn toward travel direction — no corner-snapping
    this.turnTo(Math.atan2(to.x, to.z), dt)
    return false
  }

  private turnTo(want: number, dt: number): void {
    let d = want - this.heading
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    this.heading += d * Math.min(1, TURN_RATE * dt)
    this.group.rotation.y = this.heading
  }

  frame(dt: number): void {
    this.mixer?.update(dt)
  }

  private swap(next: AnimationAction | null, timeScale = 1): void {
    if (!next) return
    next.timeScale = timeScale
    if (next === this.current) return
    next.reset().play()
    if (this.current) this.current.crossFadeTo(next, FADE, false)
    this.current = next
  }

  /** anchor for the projected want bubble — just above an adult head */
  bubbleAnchor(): Vector3 {
    return this.group.position.clone().add(new Vector3(0, this.height + 0.4, 0))
  }

  get waiting(): boolean {
    return this.mode === 'waiting'
  }

  get active(): boolean {
    return this.mode !== 'gone'
  }
}
