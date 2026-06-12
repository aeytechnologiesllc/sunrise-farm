/** Move-in Day — pick a building up and CARRY it (owner: "if you wanna move
 * it far away... it comes with you, drop it across the street").
 * The farmer hoists the whole structure overhead (tiny farmer, huge coop —
 * the contrast IS the joke), walks anywhere with the joystick, and a ghost
 * footprint glides ahead snapping to the half-unit grid: green where it can
 * land, amber where it can't. Setting down is the same contextual action
 * button as every other verb. No confirm dialogs, no cost, no timeout —
 * the old spot stays legal, so walking back IS the undo.
 * Presentation only: rules live in game/layout.ts (canPlace), state writes
 * happen in main's relayout() at commit. Mid-carry reload = building home. */
import gsap from 'gsap'
import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { DEFAULT_PLACES, footprintOf, type PlaceId } from '../game/layout'

/** placement grid: tidy without feeling rigid */
export const CARRY_GRID = 0.5

export function snapToGrid(v: number): number {
  return Math.round(v / CARRY_GRID) * CARRY_GRID
}

/** white rounded footprint card — material color tints it green/amber */
function ghostCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 128, 128)
  g.fillStyle = 'rgba(255,255,255,0.30)'
  g.strokeStyle = 'rgba(255,255,255,0.95)'
  g.lineWidth = 7
  const r = 16
  g.beginPath()
  g.moveTo(r, 4)
  g.arcTo(124, 4, 124, 124, r)
  g.arcTo(124, 124, 4, 124, r)
  g.arcTo(4, 124, 4, 4, r)
  g.arcTo(4, 4, 124, 4, r)
  g.closePath()
  g.fill()
  g.stroke()
  return c
}

const OK_TINT = 0x7ec850
const NO_TINT = 0xe0a33f

export class CarrySystem {
  /** the building in the farmer's arms, or null */
  carrying: PlaceId | null = null
  /** true while a landing tween settles — no re-lift mid-squash */
  settling = false
  /** latest ghost spot (world, grid-snapped) — main validates + commits it */
  readonly ghostAt = new Vector3()

  private readonly scene: Scene
  private readonly targets = new Map<PlaceId, Group>()
  private readonly holder = new Group()
  private readonly ghost: Mesh
  private readonly ghostMat: MeshBasicMaterial
  private lifted: Group | null = null
  private t = 0

  constructor(scene: Scene) {
    this.scene = scene
    const tex = new CanvasTexture(ghostCanvas())
    tex.colorSpace = SRGBColorSpace
    this.ghostMat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    this.ghost = new Mesh(new PlaneGeometry(1, 1), this.ghostMat)
    this.ghost.rotation.x = -Math.PI / 2
    this.ghost.position.y = 0.05
    this.ghost.renderOrder = 3
    this.ghost.visible = false
    scene.add(this.ghost)
  }

  /** main registers every movable building's Group as it spawns */
  register(id: PlaceId, group: Group): void {
    this.targets.set(id, group)
  }

  unregister(id: PlaceId): void {
    this.targets.delete(id)
  }

  /** raycast surface for the long-press (id resolution by hit) */
  entries(): Array<[PlaceId, Group]> {
    return [...this.targets.entries()]
  }

  /** hoist the building overhead — re-parents under the carrier so it walks
   * with the farmer. Big barns shrink to a liftable armful (the visual gag);
   * scale and yaw are restored on landing. */
  lift(id: PlaceId, carrier: Object3D): boolean {
    if (this.carrying || this.settling) return false
    const g = this.targets.get(id)
    if (!g) return false
    this.carrying = id
    this.lifted = g
    carrier.add(this.holder)
    this.holder.position.set(0, 2.35, 0)
    this.holder.rotation.set(0, 0, 0)
    this.holder.add(g)
    g.position.set(0, 0, 0)
    const fp = footprintOf(id)
    const armful = Math.min(1, 2.3 / Math.max(fp.w, fp.d))
    g.scale.setScalar(0.01)
    gsap.to(g.scale, { x: armful, y: armful, z: armful, duration: 0.45, ease: 'back.out(1.8)' })
    const w = fp.w + 0.5
    const d = fp.d + 0.5
    this.ghost.scale.set(w, d, 1)
    this.ghost.rotation.z = -DEFAULT_PLACES[id].yaw
    this.ghost.visible = true
    return true
  }

  /** glide the ghost to the aim spot and tint it by validity */
  aimGhost(x: number, z: number, ok: boolean): void {
    this.ghostAt.set(snapToGrid(x), 0, snapToGrid(z))
    this.ghost.position.x = this.ghostAt.x
    this.ghost.position.z = this.ghostAt.z
    this.ghostMat.color.setHex(ok ? OK_TINT : NO_TINT)
  }

  /** set it down at the (already validated) ghost spot: re-parent to the
   * world, drop + squash-stretch landing. onLanded fires at touchdown —
   * main runs relayout()/juice there. */
  place(onLanded: () => void): boolean {
    const g = this.lifted
    const id = this.carrying
    if (!g || !id) return false
    this.carrying = null
    this.lifted = null
    this.settling = true
    this.ghost.visible = false
    this.holder.remove(g)
    this.holder.removeFromParent()
    this.scene.add(g)
    g.position.set(this.ghostAt.x, 2.2, this.ghostAt.z)
    g.rotation.set(0, DEFAULT_PLACES[id].yaw, 0)
    gsap.killTweensOf(g.scale)
    g.scale.setScalar(1)
    const tl = gsap.timeline()
    tl.to(g.position, { y: 0, duration: 0.3, ease: 'power2.in' })
    tl.call(() => onLanded())
    tl.to(g.scale, { x: 1.1, y: 0.72, z: 1.1, duration: 0.09, ease: 'power2.out' })
    tl.to(g.scale, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'elastic.out(1.3,0.4)' })
    tl.call(() => {
      this.settling = false
    })
    return true
  }

  /** put it back exactly where it was — every edit needs a way OUT (the
   * owner lifted a building with no legal ground in reach and was stuck
   * holding it). State never changed mid-carry, so "back" is just a
   * landing at the home spot. */
  cancel(homeX: number, homeZ: number, onLanded: () => void): boolean {
    this.ghostAt.set(homeX, 0, homeZ)
    return this.place(onLanded)
  }

  /** the carried building breathes: gentle bob + sway overhead */
  frame(dt: number): void {
    if (!this.lifted) return
    this.t += dt
    this.holder.position.y = 2.35 + Math.sin(this.t * 2.2) * 0.07
    this.holder.rotation.z = Math.sin(this.t * 1.7) * 0.03
  }
}
