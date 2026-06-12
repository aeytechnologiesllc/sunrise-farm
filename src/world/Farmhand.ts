/** The hired farmhand — the 'you are not farming alone' project. He lives on
 * the farm, ambles between the fields, and every so often walks to a READY
 * plot and harvests it for you (main wires onHarvest into the same reward
 * path the player uses, so his work pays into your pocket with the full
 * fountain ceremony). He never outpaces the player: a long cooldown between
 * jobs keeps him a helper, not an autoplayer. */
import {
  AnimationAction,
  AnimationMixer,
  Group,
  Scene,
  Vector3,
  type AnimationClip,
} from 'three'
import { mulberry32, type Rng } from '../game/rng'
import { tint, type Assets } from './assets'
import { normalizeHeight } from './scale'

const WALK_SPEED = 1.5
const TURN_RATE = 8
/** seconds between jobs — the player stays the main farmer */
// brisk enough to feel like staff (the owner: "it costs a lot, it should
// do more") — he rests under half a minute, never outpacing the player
const JOB_COOLDOWN: [number, number] = [16, 26]
const HARVEST_TIME = 1.3

function suffixAction(mixer: AnimationMixer, root: Group, clips: AnimationClip[], suffix: string): AnimationAction | null {
  const clip = clips.find((c) => c.name.toLowerCase().endsWith(suffix.toLowerCase()))
  return clip ? mixer.clipAction(clip, root) : null
}

export interface FarmhandPlot {
  center: Vector3
  ready: boolean
}

export class FarmhandView {
  readonly group = new Group()
  /** fired when his harvest gesture lands on the plot he walked to */
  onHarvest: ((plotIndex: number) => void) | null = null

  private mixer: AnimationMixer
  private idle: AnimationAction | null
  private walk: AnimationAction | null
  private interact: AnimationAction | null
  private current: AnimationAction | null = null
  private heading = 0
  private dest: Vector3 | null = null
  private jobPlot = -1
  private jobCooldown = 12
  private harvestT = 0
  private wanderT = 4
  private home: Vector3

  /** his post moved with the farm's new layout — future rests happen there */
  setHome(v: Vector3): void {
    this.home.copy(v)
  }

  constructor(assets: Assets, scene: Scene, home: Vector3) {
    const model = assets.spawnSkinned('customerB')
    normalizeHeight(model, 1.56)
    tint(model, 0.02, -0.02)
    this.group.add(model)
    this.group.position.copy(home)
    this.home = home.clone()
    scene.add(this.group)
    this.mixer = new AnimationMixer(model)
    const clips = assets.clips('customerB')
    this.idle = suffixAction(this.mixer, model, clips, 'Idle')
    this.walk = suffixAction(this.mixer, model, clips, 'Walk')
    this.interact = suffixAction(this.mixer, model, clips, 'Interact')
    this.idle?.play()
    this.current = this.idle
  }

  update(dt: number, plots: FarmhandPlot[]): void {
    this.jobCooldown = Math.max(0, this.jobCooldown - dt)

    // mid-harvest: hold the gesture, then deliver the goods
    if (this.harvestT > 0) {
      this.harvestT -= dt
      if (this.harvestT <= 0) {
        const i = this.jobPlot
        this.jobPlot = -1
        this.jobCooldown = JOB_COOLDOWN[0] + this.rngNext() * (JOB_COOLDOWN[1] - JOB_COOLDOWN[0])
        if (i >= 0 && plots[i]?.ready) this.onHarvest?.(i)
        this.swap(this.idle, 1)
      }
      return
    }

    // pick a job: nearest ready plot, when rested
    if (this.jobPlot < 0 && this.jobCooldown <= 0) {
      let best = -1
      let bd = Number.POSITIVE_INFINITY
      for (let i = 0; i < plots.length; i++) {
        if (!plots[i].ready) continue
        const d = this.group.position.distanceTo(plots[i].center)
        if (d < bd) {
          bd = d
          best = i
        }
      }
      if (best >= 0) {
        this.jobPlot = best
        this.dest = plots[best].center.clone().setY(0)
      }
    }
    // job got harvested by the player while he walked — drop it gracefully
    if (this.jobPlot >= 0 && !plots[this.jobPlot]?.ready) {
      this.jobPlot = -1
      this.dest = null
    }

    if (this.dest) {
      const to = this.dest.clone().sub(this.group.position).setY(0)
      const d = to.length()
      if (d < 0.9) {
        this.dest = null
        if (this.jobPlot >= 0) {
          this.harvestT = HARVEST_TIME
          this.swap(this.interact ?? this.idle, 1)
        }
      } else {
        const want = Math.atan2(to.x, to.z)
        let dh = want - this.heading
        while (dh > Math.PI) dh -= Math.PI * 2
        while (dh < -Math.PI) dh += Math.PI * 2
        this.heading += dh * Math.min(1, TURN_RATE * dt)
        this.group.rotation.y = this.heading
        this.group.position.add(to.normalize().multiplyScalar(Math.min(d, WALK_SPEED * dt)))
        this.swap(this.walk ?? this.idle, 1.1)
      }
      return
    }

    // off the clock: drift around his post by the fields
    this.wanderT -= dt
    this.swap(this.idle, 1)
    if (this.wanderT <= 0) {
      this.wanderT = 5 + this.rngNext() * 7
      this.dest = this.home
        .clone()
        .add(new Vector3((this.rngNext() - 0.5) * 5, 0, (this.rngNext() - 0.5) * 5))
    }
  }

  frame(dt: number): void {
    this.mixer.update(dt)
  }

  private seededRng: Rng | null = null
  private rngNext(): number {
    this.seededRng ??= mulberry32(0xfa12)
    return this.seededRng.next()
  }

  private swap(next: AnimationAction | null, timeScale: number): void {
    if (!next) return
    next.timeScale = timeScale
    if (next === this.current) return
    next.reset().play()
    if (this.current) this.current.crossFadeTo(next, 0.25, false)
    this.current = next
  }
}
