/** Third-person follow camera: behind-and-above at a fixed diagonal yaw,
 * smooth-damped toward the farmer with slight velocity look-ahead.
 * Pinch/wheel zoom, clamped. Ceremonies use a focus override that blends
 * the look-target away and back — the player never loses control. */
import gsap from 'gsap'
import { PerspectiveCamera, Vector3 } from 'three'

/** camera sits NNE of the farmer looking SSW: the field reads in the
 * foreground and the stand + road sit up-screen, never hiding the player */
export const CAM_YAW = Math.PI - 0.35
const ELEV = (38 * Math.PI) / 180
const MIN_DIST = 7
const MAX_DIST = 17
const DAMP = 5.5
const LOOKAHEAD = 0.55
const LOOKAHEAD_MAX = 1.4

export class FollowCamera {
  readonly camera: PerspectiveCamera
  dist = 11

  private anchor = new Vector3()
  private smoothDist = 11
  private focusPoint = new Vector3()
  private focusW = { value: 0 }
  private pinch = new Map<number, { x: number; y: number }>()
  private pinchDist = 0

  constructor(dom: HTMLElement, start: Vector3) {
    this.camera = new PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 400)
    this.anchor.copy(start)
    this.applyPose()
    dom.addEventListener('wheel', this.wheel, { passive: false })
    dom.addEventListener('pointerdown', this.pDown)
    dom.addEventListener('pointermove', this.pMove)
    dom.addEventListener('pointerup', this.pEnd)
    dom.addEventListener('pointercancel', this.pEnd)
  }

  // ---- zoom (wheel + two-finger pinch on the canvas) ----------------------

  private wheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.dist = clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.08))
  }

  private pDown = (e: PointerEvent): void => {
    this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pinch.size === 2) {
      const [a, b] = [...this.pinch.values()]
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
    }
  }

  private pMove = (e: PointerEvent): void => {
    const p = this.pinch.get(e.pointerId)
    if (!p) return
    p.x = e.clientX
    p.y = e.clientY
    if (this.pinch.size === 2) {
      const [a, b] = [...this.pinch.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.pinchDist > 0 && d > 0) this.dist = clamp((this.dist * this.pinchDist) / d)
      this.pinchDist = d
    }
  }

  private pEnd = (e: PointerEvent): void => {
    this.pinch.delete(e.pointerId)
    this.pinchDist = 0
  }

  // ---- ceremony focus (visual only; never locks input) --------------------

  /** glide attention to a world point; returns the tween for sequencing */
  focusOn(p: Vector3, dur = 0.9): gsap.core.Tween {
    gsap.killTweensOf(this.focusW)
    if (this.focusW.value === 0) this.focusPoint.copy(this.anchor)
    gsap.to(this.focusPoint, { x: p.x, y: p.y, z: p.z, duration: dur, ease: 'power2.inOut' })
    return gsap.to(this.focusW, { value: 1, duration: dur * 0.7, ease: 'power2.inOut' })
  }

  /** hand attention back to the farmer */
  release(dur = 0.9): gsap.core.Tween {
    gsap.killTweensOf(this.focusW)
    return gsap.to(this.focusW, { value: 0, duration: dur, ease: 'power2.inOut' })
  }

  /** retarget the focus point mid-hold (comeback pan sequences) */
  moveFocus(p: Vector3, dur = 0.9): gsap.core.Tween {
    return gsap.to(this.focusPoint, { x: p.x, y: p.y, z: p.z, duration: dur, ease: 'power2.inOut' })
  }

  // ---- per-frame -----------------------------------------------------------

  /** smooth-damp toward the farmer (+ look-ahead), then place the camera */
  follow(playerPos: Vector3, vel: Vector3, dt: number): void {
    const k = 1 - Math.exp(-DAMP * dt)
    const lookX = clampAbs(vel.x * LOOKAHEAD, LOOKAHEAD_MAX)
    const lookZ = clampAbs(vel.z * LOOKAHEAD, LOOKAHEAD_MAX)
    this.anchor.x += (playerPos.x + lookX - this.anchor.x) * k
    this.anchor.y += (playerPos.y + 0.9 - this.anchor.y) * k
    this.anchor.z += (playerPos.z + lookZ - this.anchor.z) * k
    this.smoothDist += (this.dist - this.smoothDist) * k
    this.applyPose()
  }

  private tmp = new Vector3()

  private applyPose(): void {
    const w = this.focusW.value
    const t = this.tmp.copy(this.anchor).lerp(this.focusPoint, w)
    const horiz = Math.cos(ELEV) * this.smoothDist
    this.camera.position.set(
      t.x + Math.sin(CAM_YAW) * horiz,
      t.y + Math.sin(ELEV) * this.smoothDist,
      t.z + Math.cos(CAM_YAW) * horiz,
    )
    this.camera.lookAt(t)
  }

  resize(): void {
    this.camera.aspect = innerWidth / innerHeight
    this.camera.updateProjectionMatrix()
  }

  /** world -> CSS pixels (projected DOM widgets) */
  screenPos(world: Vector3): { x: number; y: number; behind: boolean } {
    const v = world.clone().project(this.camera)
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, behind: v.z > 1 }
  }
}

function clamp(d: number): number {
  return Math.min(MAX_DIST, Math.max(MIN_DIST, d))
}

function clampAbs(v: number, m: number): number {
  return Math.min(m, Math.max(-m, v))
}
