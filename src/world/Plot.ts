/** One field plot: real PLANTED ROWS — 9 staggered plants (6 in compact
 * greenhouse planters) stepping through 4 visible stages atop the furrowed
 * soil. All plants of a stage are baked into 1-2 merged meshes per plot so
 * draw calls stay flat while the fields finally read as crops, not pegs.
 * Stage-ups bounce (back.out); >=90% shimmers; ready pulses gold. */
import gsap from 'gsap'
import { BufferGeometry, Group, Material, Matrix4, Mesh, Quaternion, Scene, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CropKind } from '../game/economy'
import { mulberry32 } from '../game/rng'
import { setEmissive, tint, type Assets, type ModelKey } from './assets'
import { SOIL_TOP } from './field'

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

/** 3 rows x 3 plants fills the 2.3u frame like a real planting */
const FIELD_GRID: Array<[number, number]> = [
  [-0.72, -0.72], [0, -0.72], [0.72, -0.72],
  [-0.72, 0], [0, 0], [0.72, 0],
  [-0.72, 0.72], [0, 0.72], [0.72, 0.72],
]
/** greenhouse planters are tighter: 2 rows x 3 */
const COMPACT_GRID: Array<[number, number]> = [
  [-0.55, -0.42], [0, -0.42], [0.55, -0.42],
  [-0.55, 0.42], [0, 0.42], [0.55, 0.42],
]

export class PlotView {
  readonly group = new Group()
  readonly center: Vector3
  private plants: Mesh[] = []
  private cropRoot = new Group()
  private kind: CropKind | null = null
  private stage = -1
  private glow: 'none' | 'shimmer' | 'ready' = 'none'
  private seed: number

  constructor(
    private assets: Assets,
    pos: Vector3,
    private scene: Scene,
    private compact = false,
  ) {
    this.center = pos.clone()
    this.group.position.copy(pos)
    this.cropRoot.position.y = compact ? 0.06 : SOIL_TOP
    this.group.add(this.cropRoot)
    this.seed = ((Math.abs(pos.x * 73856) | 0) ^ (Math.abs(pos.z * 19349) | 0)) >>> 0 || 1
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
    const rng = mulberry32(this.seed + stage * 101)

    // one template; its (tinted) materials become the merged-mesh materials
    const template = this.assets.spawn(def.key, true)
    if (kind === 'corn' && stage < 3) tint(template, -0.13, -0.02)
    template.updateMatrixWorld(true)

    // bake every plant transform into per-material geometry buckets
    const grid = this.compact ? COMPACT_GRID : FIELD_GRID
    const baseScale = def.scale * (this.compact ? 0.95 : 1.05)
    const buckets = new Map<Material, BufferGeometry[]>()
    const m = new Matrix4()
    const q = new Quaternion()
    const up = new Vector3(0, 1, 0)
    const p = new Vector3()
    const s = new Vector3()
    for (const [ox, oz] of grid) {
      const jx = (rng.next() - 0.5) * 0.16
      const jz = (rng.next() - 0.5) * 0.16
      const sc = baseScale * (0.86 + rng.next() * 0.28)
      q.setFromAxisAngle(up, rng.next() * Math.PI * 2)
      m.compose(p.set(ox + jx, 0, oz + jz), q, s.set(sc, sc * (0.92 + rng.next() * 0.16), sc))
      template.traverse((o) => {
        if (o instanceof Mesh && o.geometry instanceof BufferGeometry) {
          const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as Material
          const geo = o.geometry.clone()
          geo.applyMatrix4(o.matrixWorld)
          geo.applyMatrix4(m)
          const arr = buckets.get(mat) ?? []
          arr.push(geo)
          buckets.set(mat, arr)
        }
      })
    }
    for (const [mat, geos] of buckets) {
      const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))
      if (!merged) continue
      const mesh = new Mesh(merged, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.cropRoot.add(mesh)
      this.plants.push(mesh)
    }
    if (animate) {
      this.cropRoot.scale.setScalar(0.3)
      gsap.to(this.cropRoot.scale, { x: 1, y: 1, z: 1, duration: 0.55, ease: 'back.out(2.2)' })
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
