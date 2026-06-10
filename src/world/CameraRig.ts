/** 35-degree orbit-pan camera. One-finger drag pans the ground target,
 * pinch/wheel zooms; everything clamped. Short low-movement presses emit
 * taps. Input never locks — ceremonies only tween the target. */
import gsap from 'gsap'
import { PerspectiveCamera, Vector2, Vector3 } from 'three'

const ELEVATION = (35 * Math.PI) / 180
const YAW = Math.PI / 4
const MIN_DIST = 11
const MAX_DIST = 34
const BOUND = 16

interface PointerInfo {
  x: number
  y: number
  startX: number
  startY: number
  t: number
}

export class CameraRig {
  readonly camera: PerspectiveCamera
  readonly target = new Vector3(0, 0, 1.5)
  dist = 21
  onTap: ((ndc: Vector2, screen: { x: number; y: number }) => void) | null = null

  private pointers = new Map<number, PointerInfo>()
  private pinchDist = 0
  private moved = false

  constructor(dom: HTMLElement) {
    this.camera = new PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 300)
    dom.addEventListener('pointerdown', this.down)
    dom.addEventListener('pointermove', this.move)
    dom.addEventListener('pointerup', this.up)
    dom.addEventListener('pointercancel', this.cancel)
    dom.addEventListener('wheel', this.wheel, { passive: false })
  }

  private down = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, t: performance.now() })
    if (this.pointers.size === 1) this.moved = false
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
    }
  }

  private move = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 9) this.moved = true
    if (this.pointers.size === 1 && this.moved) {
      gsap.killTweensOf(this.target)
      const scale = this.dist / innerHeight / Math.tan((this.camera.fov * Math.PI) / 360)
      // drag in screen space -> world pan in the camera's ground-aligned frame
      const fx = -Math.sin(YAW)
      const fz = -Math.cos(YAW)
      const rx = Math.cos(YAW)
      const rz = -Math.sin(YAW)
      this.target.x += (-dx * rx + (dy / Math.sin(ELEVATION + 0.35)) * fx) * scale * 1.4
      this.target.z += (-dx * rz + (dy / Math.sin(ELEVATION + 0.35)) * fz) * scale * 1.4
      this.clamp()
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.pinchDist > 0) {
        this.dist *= this.pinchDist / d
        this.clamp()
      }
      this.pinchDist = d
      this.moved = true
    }
  }

  private up = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId)
    this.pointers.delete(e.pointerId)
    if (!p) return
    const quick = performance.now() - p.t < 400
    if (quick && !this.moved && this.pointers.size === 0) {
      const ndc = new Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
      this.onTap?.(ndc, { x: e.clientX, y: e.clientY })
    }
  }

  private cancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId)
  }

  private wheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.dist *= 1 + Math.sign(e.deltaY) * 0.08
    this.clamp()
  }

  private clamp(): void {
    this.dist = Math.min(MAX_DIST, Math.max(MIN_DIST, this.dist))
    this.target.x = Math.min(BOUND, Math.max(-BOUND, this.target.x))
    this.target.z = Math.min(BOUND, Math.max(-BOUND, this.target.z))
  }

  /** visual-only camera glide (comeback pan, ceremonies) */
  panTo(p: Vector3, duration = 1): gsap.core.Tween {
    return gsap.to(this.target, { x: p.x, z: p.z, duration, ease: 'power2.inOut' })
  }

  update(): void {
    const horiz = Math.cos(ELEVATION) * this.dist
    this.camera.position.set(
      this.target.x + Math.sin(YAW) * horiz,
      this.target.y + Math.sin(ELEVATION) * this.dist,
      this.target.z + Math.cos(YAW) * horiz,
    )
    this.camera.lookAt(this.target)
  }

  resize(): void {
    this.camera.aspect = innerWidth / innerHeight
    this.camera.updateProjectionMatrix()
  }

  /** world -> CSS pixels (for projected DOM widgets) */
  screenPos(world: Vector3): { x: number; y: number; behind: boolean } {
    const v = world.clone().project(this.camera)
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, behind: v.z > 1 }
  }
}
