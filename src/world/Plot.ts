/** One field plot: 2x2 dirt tiles + 4 crop plants stepping through 4 visible
 * stages. Stage-ups bounce (back.out); >=90% shimmers; ready pulses gold. */
import gsap from 'gsap'
import { Group, Scene, Vector3 } from 'three'
import type { CropKind } from '../game/economy'
import { setEmissive, type Assets, type ModelKey } from './assets'

const STAGE_MODELS: Record<CropKind, Array<{ key: ModelKey; scale: number }>> = {
  wheat: [
    { key: 'wheatA', scale: 0.45 },
    { key: 'wheatA', scale: 1.0 },
    { key: 'wheatB', scale: 0.8 },
    { key: 'wheatB', scale: 1.15 },
  ],
  corn: [
    { key: 'cornA', scale: 1 },
    { key: 'cornB', scale: 1 },
    { key: 'cornC', scale: 1 },
    { key: 'cornD', scale: 1.05 },
  ],
}

const PLANT_OFFSETS = [
  [-0.55, -0.55],
  [0.55, -0.55],
  [-0.55, 0.55],
  [0.55, 0.55],
] as const

export class PlotView {
  readonly group = new Group()
  readonly center: Vector3
  private plants: Group[] = []
  private cropRoot = new Group()
  private kind: CropKind | null = null
  private stage = -1
  private glow: 'none' | 'shimmer' | 'ready' = 'none'

  constructor(private assets: Assets, pos: Vector3, private scene: Scene) {
    this.center = pos.clone()
    this.group.position.copy(pos)
    for (const [ox, oz] of PLANT_OFFSETS) {
      const dirt = assets.spawn('dirt')
      dirt.position.set(ox * 1.05, 0, oz * 1.05)
      dirt.scale.setScalar(1.15)
      this.group.add(dirt)
    }
    this.group.add(this.cropRoot)
  }

  setCrop(kind: CropKind | null, stage: number, animate: boolean): void {
    if (kind === this.kind && stage === this.stage) return
    this.kind = kind
    this.stage = kind ? stage : -1
    this.cropRoot.clear()
    this.plants = []
    this.glow = 'none'
    if (!kind) return
    const def = STAGE_MODELS[kind][stage]
    for (const [ox, oz] of PLANT_OFFSETS) {
      const p = this.assets.spawn(def.key, true)
      p.position.set(ox, 0.05, oz)
      const target = def.scale * 1.5
      p.scale.setScalar(target)
      this.cropRoot.add(p)
      this.plants.push(p)
      if (animate) {
        p.scale.setScalar(target * 0.25)
        gsap.to(p.scale, {
          x: target,
          y: target,
          z: target,
          duration: 0.55,
          delay: Math.random() * 0.12,
          ease: 'back.out(2.4)',
        })
      }
    }
  }

  /** glow mode is recomputed from game progress every fixed tick */
  setGlow(mode: 'none' | 'shimmer' | 'ready'): void {
    this.glow = mode
    if (mode === 'none') for (const p of this.plants) setEmissive(p, 0)
  }

  /** time-based pulse, called every frame with the shared clock */
  pulse(t: number): void {
    if (this.glow === 'none' || this.plants.length === 0) return
    const k =
      this.glow === 'ready'
        ? 0.32 + Math.sin(t * 4.2) * 0.18
        : 0.1 + Math.sin(t * 7) * 0.07
    for (const p of this.plants) setEmissive(p, Math.max(0, k))
    if (this.glow === 'ready') {
      const s = 1 + Math.sin(t * 4.2) * 0.02
      this.cropRoot.scale.setScalar(s)
    }
  }

  /** squash-stretch harvest: crops pop, an item arcs out toward the sky */
  harvestPop(golden: boolean): void {
    const item = this.kind === 'corn' ? this.assets.spawn('cornItem') : this.assets.spawn('wheatB')
    item.scale.setScalar(this.kind === 'corn' ? 3 : 1.2)
    item.position.copy(this.center).setY(0.4)
    this.scene.add(item)
    const apex = this.center.clone().add(new Vector3(0, 2.6, 0.4))
    gsap.to(item.position, { x: apex.x, y: apex.y, z: apex.z, duration: 0.5, ease: 'power2.out' })
    gsap.to(item.rotation, { y: golden ? Math.PI * 3 : Math.PI, duration: 0.9 })
    gsap.to(item.scale, {
      x: 0.01,
      y: 0.01,
      z: 0.01,
      delay: 0.45,
      duration: 0.35,
      ease: 'power2.in',
      onComplete: () => this.scene.remove(item),
    })
    // squash-stretch on the plot itself
    gsap
      .timeline()
      .to(this.group.scale, { x: 1.25, y: 0.6, z: 1.25, duration: 0.09, ease: 'power2.out' })
      .to(this.group.scale, { x: 1, y: 1, z: 1, duration: 0.45, ease: 'elastic.out(1.4,0.35)' })
  }
}
