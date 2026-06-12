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
/** right-stick orbit rates, rad/s at full deflection — deliberately gentle,
 * the owner found the old 2.6 'too fast' */
const YAW_RATE = 1.7
const PITCH_RATE = 0.95
/** desktop drag: radians per CSS pixel */
const DRAG_RATE = 0.0042
const FOV_BASE = 42
const FOV_RUN = 46.5
/** auto-follow: after this long hands-off, the camera eases around behind
 * the farmer's direction of travel — the player steers, the camera keeps up
 * (owner ask: "no constantly adjusting the camera by hand") */
const AUTO_FOLLOW_AFTER = 1.4
/** pursuit smoothing constant — deliberately gentle, same hand-feel rule as
 * the orbit rates above (never a hard snap behind the player) */
const AUTO_FOLLOW_RATE = 1.7
/** below this planar speed (u/s) the camera stays where the player left it */
const AUTO_FOLLOW_MIN_SPEED = 1.1
/** ceiling on auto-yaw (rad/s) for SMALL corrections: a held strafe becomes
 * a slow, wide orbit instead of a dizzy spin */
const AUTO_FOLLOW_MAX_RATE = 0.85
/** course-change ceiling: past 90° of misalignment the cap ramps up to this
 * so an abrupt 180/360 catches up in ~1.5s instead of four (owner: "small
 * turns are fine, abrupt turns need to be quicker"). NOTE the taper below:
 * camera-relative input means a HELD stick keeps the misalignment constant,
 * so any rate here is also the orbit speed of a held diagonal-back stick —
 * keep it brisk, not violent. */
const AUTO_FOLLOW_FAST_RATE = 2.2

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

  /** wired by main: given the focus point and a desired camera position,
   * return the unobstructed distance along that ray (null = clear). The
   * camera then pulls IN just in front of whatever building was about to
   * swallow it — the farmer never disappears behind the shop again. */
  occlusionTest: ((focus: Vector3, camPos: Vector3) => number | null) | null = null
  private occlClamp = Number.POSITIVE_INFINITY
  private lastDt = 0.016
  /** seconds since the player last touched the camera (drag/orbit/zoom) */
  private sinceManual = 99

  constructor(dom: HTMLElement, start: Vector3) {
    this.camera = new PerspectiveCamera(FOV_BASE, innerWidth / innerHeight, 0.5, 400)
    this.anchor.copy(start)
    this.applyPose()
    dom.addEventListener('wheel', this.wheel, { passive: false })
    dom.addEventListener('pointerdown', this.pDown)
    dom.addEventListener('pointermove', this.pMove)
    // releases land on WINDOW: a mouse-up over a HUD element must still end
    // the drag, or a phantom pointer turns every later drag into a pinch
    addEventListener('pointerup', this.pEnd)
    addEventListener('pointercancel', this.pEnd)
    // right-drag must orbit, not open the context menu
    dom.addEventListener('contextmenu', (e) => e.preventDefault())
    addEventListener('blur', () => this.pointers.clear())
  }

  /** right-stick orbit (called per frame with the stick vector).
   * INVERTED on both axes per the owner's hand-feel: push right = look right
   * (camera swings left around you), push up = look down. */
  orbit(stickX: number, stickY: number, dt: number): void {
    if (stickX === 0 && stickY === 0) return
    this.yaw += stickX * YAW_RATE * dt
    this.pitch = clampPitch(this.pitch - stickY * PITCH_RATE * dt)
    this.moved = true
  }

  /** run-state FOV nudge; eased every frame (a cinematic owns the lens) */
  setRunning(running: boolean): void {
    if (this.cineTarget) return
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
    } else if (this.pointers.size === 1) {
      // ONE pointer on the world looks around — mouse on desktop, the free
      // thumb on mobile (the left stick + HUD capture their own pointers, so
      // anything that reaches the canvas is camera intent)
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

  private cineTarget: Vector3 | null = null
  private cineYaw: number | null = null
  private cinePitch: number | null = null
  private cineDist: number | null = null

  /** CINEMATIC follow: focus glides toward a moving target every frame —
   * smooth pursuit with zero tween restarts (the old per-tick re-tweening
   * read as stutter). Optional `yaw` lets a scene DIRECT the shot (e.g. face
   * the homestead door) instead of inheriting whatever orbit the player left
   * the camera at. Optional `fov` widens the lens for a shot (interiors —
   * three diners won't fit a 1.9u table through 42 degrees). Pass null to
   * hand attention back to the farmer. */
  cineFollow(target: Vector3 | null, yaw?: number, pitch?: number, dist?: number, fov?: number): void {
    if (target) {
      if (!this.cineTarget) {
        this.cineTarget = target.clone()
        if (this.focusW.value === 0) this.focusPoint.copy(this.anchor)
        gsap.killTweensOf(this.focusW)
        gsap.to(this.focusW, { value: 1, duration: 0.8, ease: 'power2.inOut' })
      } else {
        this.cineTarget.copy(target)
      }
      this.cineYaw = yaw ?? null
      // scenes may pitch BELOW the gameplay clamp (negative = looking up at
      // the night sky); hand back a legal pitch before releasing
      this.cinePitch = pitch ?? null
      // and may frame closer than the gameplay zoom floor (interior shots)
      this.cineDist = dist ?? null
      this.fovTarget = fov ?? FOV_BASE
    } else if (this.cineTarget) {
      this.cineTarget = null
      this.cineYaw = null
      this.cinePitch = null
      this.cineDist = null
      this.fovTarget = FOV_BASE
      this.pitch = clampPitch(this.pitch)
      this.smoothDist = clampDist(this.smoothDist)
      // drop any occlusion clamp from before the scene — re-measured next frame
      this.occlClamp = Number.POSITIVE_INFINITY
      this.release(0.9)
    }
  }

  /** CUT to the current cinematic shot: snap the eased yaw/pitch/dist/focus
   * to their targets instantly. Scenes call this behind a dip-to-black so
   * the camera never visibly flies through buildings to reach a new angle —
   * films cut, they don't sweep. */
  cineCut(): void {
    if (!this.cineTarget) return
    this.focusPoint.copy(this.cineTarget)
    gsap.killTweensOf(this.focusW)
    this.focusW.value = 1
    if (this.cineYaw !== null) this.yaw = this.cineYaw
    if (this.cinePitch !== null) this.pitch = this.cinePitch
    if (this.cineDist !== null) this.smoothDist = this.cineDist
    this.camera.fov = this.fovTarget
    this.camera.updateProjectionMatrix()
  }

  /** teleport follow: snap the smoothed anchor/focus to a far point so an
   * interior-set door transition doesn't fly the camera 170u across the map */
  snapTo(p: Vector3): void {
    this.anchor.set(p.x, p.y + 0.9, p.z)
    this.focusPoint.copy(this.anchor)
    this.occlClamp = Number.POSITIVE_INFINITY
  }

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
    this.lastDt = dt
    // soft auto-follow: once the hands have been off the camera a beat and
    // the farmer is really walking, glide the yaw around behind the travel
    // direction. Any manual touch wins instantly and holds for a while.
    if (this.moved) this.sinceManual = 0
    else this.sinceManual += dt
    const planar = Math.hypot(vel.x, vel.z)
    if (!this.cineTarget && this.sinceManual > AUTO_FOLLOW_AFTER && planar > AUTO_FOLLOW_MIN_SPEED) {
      const want = Math.atan2(-vel.x, -vel.z) // camera sits opposite travel
      let d = want - this.yaw
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      // deadbands: an aligned camera never micro-hunts behind the farmer,
      // and dead-backward (within ~5° of 180) HOLDS deliberately — at exact
      // opposition the correction sign flip-flops per frame (the target
      // rotates with the camera), which would read as shimmer, and walking
      // straight at the lens is how you look at your farmer's face anyway
      const ad = Math.abs(d)
      if (ad > 0.04 && ad < 3.05) {
        const k = Math.min(1, planar / 3.2) * (1 - Math.exp(-AUTO_FOLLOW_RATE * dt))
        // urgency lives in the COURSE-CHANGE band (90°-160°): a held strafe
        // (90°) keeps its slow orbit, a real turn catches up briskly, and
        // dead-backward (180°) tapers back to slow — walking toward the lens
        // pins the misalignment at 180°, so speed there would be a perpetual
        // whip-pan, not a catch-up
        let urgency = 0
        if (ad > Math.PI / 2) {
          urgency = Math.min(1, (ad - Math.PI / 2) / 0.85)
          if (ad > 2.75) urgency *= Math.max(0, (Math.PI - ad) / (Math.PI - 2.75))
        }
        const cap = AUTO_FOLLOW_MAX_RATE + (AUTO_FOLLOW_FAST_RATE - AUTO_FOLLOW_MAX_RATE) * urgency
        this.yaw += clampAbs(d * k, cap * dt)
      }
    }
    if (this.cineTarget) {
      this.focusPoint.lerp(this.cineTarget, 1 - Math.exp(-3.4 * dt))
      // a ceremony's release() may fight a running cinematic for focusW —
      // the cinematic owns the channel while it lives, so re-assert
      if (this.focusW.value < 0.999 && !gsap.isTweening(this.focusW)) {
        gsap.to(this.focusW, { value: 1, duration: 0.5, ease: 'power2.out' })
      }
      if (this.cineYaw !== null) {
        let d = this.cineYaw - this.yaw
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        this.yaw += d * (1 - Math.exp(-2.4 * dt))
      }
      if (this.cinePitch !== null) {
        this.pitch += (this.cinePitch - this.pitch) * (1 - Math.exp(-2.0 * dt))
      }
      if (this.cineDist !== null) {
        this.smoothDist += (this.cineDist - this.smoothDist) * (1 - Math.exp(-2.2 * dt))
      }
    }
    const k = 1 - Math.exp(-DAMP * dt)
    const lookX = clampAbs(vel.x * LOOKAHEAD, LOOKAHEAD_MAX)
    const lookZ = clampAbs(vel.z * LOOKAHEAD, LOOKAHEAD_MAX)
    this.anchor.x += (playerPos.x + lookX - this.anchor.x) * k
    this.anchor.y += (playerPos.y + 0.9 - this.anchor.y) * k
    this.anchor.z += (playerPos.z + lookZ - this.anchor.z) * k
    if (this.cineDist === null) this.smoothDist += (this.dist - this.smoothDist) * k
    const f = this.camera.fov + (this.fovTarget - this.camera.fov) * Math.min(1, 4 * dt)
    if (Math.abs(f - this.camera.fov) > 1e-4) {
      this.camera.fov = f
      this.camera.updateProjectionMatrix()
    }
    this.applyPose()
    this.moved = false
  }

  private tmp = new Vector3()

  private desired = new Vector3()

  private applyPose(): void {
    const w = this.focusW.value
    const t = this.tmp.copy(this.anchor).lerp(this.focusPoint, w)
    // landscape phones: the short viewport makes the farmer read tiny at the
    // portrait distance — pull the whole orbit ~25% closer when wide
    const k = this.camera.aspect > 1.2 ? 0.74 : 1
    let dist = this.smoothDist * k
    const place = (d: number, into: Vector3): Vector3 => {
      const horiz = Math.cos(this.pitch) * d
      return into.set(
        t.x + Math.sin(this.yaw) * horiz,
        t.y + Math.sin(this.pitch) * d,
        t.z + Math.cos(this.yaw) * horiz,
      )
    }
    // building occlusion: snap IN fast (never clip inside a wall), ease OUT.
    // During cinematics the rule is softer: if the hit is in the NEAR third
    // of the shot distance the focus itself sits at/inside an occluder (the
    // construction wide shot frames across the old stand) — ignore it; a
    // far hit means a building stands between subject and lens (the barn in
    // the dawn shot) and the pull-in keeps the subject visible.
    if (this.occlusionTest && this.cineTarget) {
      const blocked = this.occlusionTest(t, place(dist, this.desired))
      if (blocked !== null && blocked > dist * 0.35) {
        dist = Math.max(2.4, blocked - 0.5)
      }
    } else if (this.occlusionTest) {
      const blocked = this.occlusionTest(t, place(dist, this.desired))
      const want = blocked !== null ? Math.max(2.4, blocked - 0.5) : dist
      if (want < this.occlClamp) this.occlClamp = want
      else this.occlClamp += (want - this.occlClamp) * Math.min(1, 3.5 * this.lastDt)
      dist = Math.min(dist, this.occlClamp)
    }
    this.camera.position.copy(place(dist, this.desired))
    this.camera.lookAt(t)
  }

  /** pass the measured viewport when available — iOS can report stale
   * innerWidth/innerHeight right after a rotation */
  resize(w = innerWidth, h = innerHeight): void {
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private spTmp = new Vector3()

  /** world -> CSS pixels (projected DOM widgets) — allocation-free, it runs
   * several times every frame for the ring/pip/name-tag/bubbles */
  screenPos(world: Vector3): { x: number; y: number; behind: boolean } {
    const v = this.spTmp.copy(world).project(this.camera)
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
