/** Third-person follow camera: behind-and-above, smooth-damped toward the
 * farmer with slight velocity look-ahead. The RIGHT joystick (and on desktop
 * any mouse drag on the canvas) orbits it freely: yaw unclamped, pitch
 * clamped. Pinch/wheel zoom, clamped. A subtle FOV nudge sells the run.
 * Ceremonies use a focus override that blends the look-target away and
 * back — the player never loses control. */
import gsap from 'gsap'
import { PerspectiveCamera, Vector3 } from 'three'

/** boot pose: camera sits NNE of the farmer looking SSW so the field reads
 * in the foreground and the stand + road sit up-screen */
export const START_YAW = Math.PI - 0.35
const START_PITCH = 0.52
const MIN_PITCH = 0.15
const MAX_PITCH = 0.55
const MIN_DIST = 7
const MAX_DIST = 17
const DAMP = 5.5
const LOOKAHEAD = 0.55
const LOOKAHEAD_MAX = 1.4
/** right-stick orbit rates, rad/s at full deflection */
const YAW_RATE = 2.6
const PITCH_RATE = 1.4
/** desktop drag: radians per CSS pixel */
const DRAG_RATE = 0.0042
const FOV_BASE = 42
const FOV_RUN = 46.5

export class FollowCamera {
  readonly camera: PerspectiveCamera
  dist = 11
  /** current orbit yaw — movement is camera-relative off this */
  yaw = START_YAW

  private pitch = START_PITCH
  private anchor = new Vector3()
  private smoothDist = 11
  private focusPoint = new Vector3()
  private focusW = { value: 0 }
  private pointers = new Map<number, { x: number; y: number; type: string }>()
  private pinchDist = 0
  private fovTarget = FOV_BASE
  /** true while any input touched the camera this frame (idle-timer reset) */
  moved = false

  constructor(dom: HTMLElement, start: Vector3) {
    this.camera = new PerspectiveCamera(FOV_BASE, innerWidth / innerHeight, 0.5, 400)
    this.anchor.copy(start)
    this.applyPose()
    dom.addEventListener('wheel', this.wheel, { passive: false })
    dom.addEventListener('pointerdown', this.pDown)
    dom.addEventListener('pointermove', this.pMove)
    dom.addEventListener('pointerup', this.pEnd)
    dom.addEventListener('pointercancel', this.pEnd)
    // right-drag must orbit, not open the context menu
    dom.addEventListener('contextmenu', (e) => e.preventDefault())
    addEventListener('blur', () => this.pointers.clear())
  }

  /** right-stick orbit (called per frame with the stick vector) */
  orbit(stickX: number, stickY: number, dt: number): void {
    if (stickX === 0 && stickY === 0) return
    this.yaw -= stickX * YAW_RATE * dt
    this.pitch = clampPitch(this.pitch + stickY * PITCH_RATE * dt)
    this.moved = true
  }

  /** run-state FOV nudge; eased every frame */
  setRunning(running: boolean): void {
    this.fovTarget = running ? FOV_RUN : FOV_BASE
  }

  // ---- zoom (wheel + two-finger pinch) + desktop drag-orbit ---------------

  private wheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.dist = clampDist(this.dist * (1 + Math.sign(e.deltaY) * 0.08))
    this.moved = true
  }

  private pDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
    }
  }

  private pMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    if (this.pointers.size === 2) {
      // two fingers on the canvas (sticks capture their own pointers) = pinch
      const [a, b] = [...this.pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.pinchDist > 0 && d > 0) this.dist = clampDist((this.dist * this.pinchDist) / d)
      this.pinchDist = d
      this.moved = true
    } else if (this.pointers.size === 1 && p.type === 'mouse') {
      // desktop: any mouse drag on the canvas orbits (left or right button)
      this.yaw -= dx * DRAG_RATE
      this.pitch = clampPitch(this.pitch + dy * DRAG_RATE)
      this.moved = true
    }
  }

  private pEnd = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId)
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
    const f = this.camera.fov + (this.fovTarget - this.camera.fov) * Math.min(1, 4 * dt)
    if (Math.abs(f - this.camera.fov) > 1e-4) {
      this.camera.fov = f
      this.camera.updateProjectionMatrix()
    }
    this.applyPose()
    this.moved = false
  }

  private tmp = new Vector3()

  private applyPose(): void {
    const w = this.focusW.value
    const t = this.tmp.copy(this.anchor).lerp(this.focusPoint, w)
    // landscape phones: the short viewport makes the farmer read tiny at the
    // portrait distance — pull the whole orbit ~25% closer when wide
    const k = this.camera.aspect > 1.2 ? 0.74 : 1
    const dist = this.smoothDist * k
    const horiz = Math.cos(this.pitch) * dist
    this.camera.position.set(
      t.x + Math.sin(this.yaw) * horiz,
      t.y + Math.sin(this.pitch) * dist,
      t.z + Math.cos(this.yaw) * horiz,
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

function clampDist(d: number): number {
  return Math.min(MAX_DIST, Math.max(MIN_DIST, d))
}

function clampPitch(p: number): number {
  return Math.min(MAX_PITCH, Math.max(MIN_PITCH, p))
}

function clampAbs(v: number, m: number): number {
  return Math.min(m, Math.max(-m, v))
}
