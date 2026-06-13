/** RideRig — mounts the player onto Hazel the horse.
 *
 * This is a RENDER-ONLY helper: player movement is still driven by the
 * farmer controller in main.ts.  All this module does is:
 *   1. Keep its own skinned horse clone (distinct from the pasture Hazel that
 *      Grazers owns — main hides the pasture one while riding).
 *   2. On mount(), position it under the farmer, make it visible, start Idle.
 *   3. Each frame, snap the horse to the farmer's ground position, smoothly
 *      bank its yaw, crossfade Idle/Walk/Gallop by planar speed, tick the mixer.
 *
 * Determinism rules: no Math.random, no Date, no per-frame heap allocations
 * in update() (scratch objects are allocated once in the constructor).
 */
import { AnimationAction, AnimationMixer, Group, Scene, Vector3, type AnimationClip } from 'three'
import type { Assets } from './assets'
import { measuredHeight } from './scale'

/** the horse's head-to-toe target, matching animals.ts BAND.horse — the raw
 * GLB is many times this, so the ride-horse MUST be scaled to it like the
 * pasture Hazel is, or she renders giant and the saddle height is wrong */
const HORSE_TARGET_H = 1.75

// ── constants ────────────────────────────────────────────────────────────────

/** Horse asset key — matches MODEL_URLS['horse'] in assets.ts. */
const HORSE_KEY = 'horse' as const


/** Rotation smoothing: lerp rate in turns/second toward the target yaw.
 * 10 /s gives a natural "banking" lean without feeling sloppy. */
const YAW_LERP_RATE = 10

/** planarSpeed (m/s) thresholds that select the animation clip. */
const SPEED_WALK_MIN = 0.2 // below → Idle
const SPEED_GALLOP_MIN = 3.0 // above → Gallop; between → Walk

/** crossfade duration in seconds — matches animals.ts `play()`. */
const FADE_S = 0.22

// ── clip helper (mirrors animals.ts — not exported there so copied here) ─────

/** Find a clip whose name ends with `suffix` (case-insensitive) and return an
 * AnimationAction bound to `root`.  Returns null when the clip is absent so
 * callers degrade gracefully. */
function suffixAction(
  mixer: AnimationMixer,
  root: Group,
  clips: AnimationClip[],
  suffix: string,
): AnimationAction | null {
  const clip = clips.find((c) => c.name.toLowerCase().endsWith(suffix.toLowerCase()))
  return clip ? mixer.clipAction(clip, root) : null
}

// ── RideRig ──────────────────────────────────────────────────────────────────

export class RideRig {
  /** The Y the farmer should be placed at while riding (main reads this) —
   * set from the SCALED horse's back height in the constructor. */
  readonly saddleY: number

  private readonly group: Group
  private readonly mixer: AnimationMixer
  private readonly idle: AnimationAction | null
  private readonly walk: AnimationAction | null
  private readonly gallop: AnimationAction | null

  private _active = false
  private current: AnimationAction | null = null

  /** Scratch Vector3 — reused in update() to avoid per-frame allocation. */
  private readonly _scratchPos = new Vector3()

  constructor(scene: Scene, assets: Assets) {
    // Spawn our own skinned clone; the pasture Grazers owns a different one.
    this.group = assets.spawnSkinned(HORSE_KEY)
    // scale the raw GLB to the same head-to-toe target the pasture Hazel uses
    // (animals.ts does this; without it the ride-horse is giant)
    const rawH = measuredHeight(this.group)
    const s = rawH > 0 ? HORSE_TARGET_H / rawH : 1
    this.group.scale.setScalar(s)
    // the back/saddle sits at ~55% of the scaled height
    this.saddleY = HORSE_TARGET_H * 0.55
    this.group.visible = false

    // castShadow on every mesh — matches what animals.ts does via prepare().
    // assets.spawnSkinned() already calls prepare() which sets castShadow on
    // all Mesh descendants, so this is already handled; no extra traverse needed.

    scene.add(this.group)

    this.mixer = new AnimationMixer(this.group)
    const clips = assets.clips(HORSE_KEY)

    this.idle = suffixAction(this.mixer, this.group, clips, 'Idle')
    this.walk = suffixAction(this.mixer, this.group, clips, 'Walk')
    // Quaternius horse exports 'Gallop'; fall back to 'Run' just in case.
    this.gallop =
      suffixAction(this.mixer, this.group, clips, 'Gallop') ??
      suffixAction(this.mixer, this.group, clips, 'Run')
  }

  // ── public API ──────────────────────────────────────────────────────────────

  get active(): boolean {
    return this._active
  }

  /**
   * Show the ride-horse at the farmer's current ground position and begin Idle.
   * Idempotent: calling mount() again while already mounted is a no-op.
   */
  mount(at: Vector3, yaw: number): void {
    if (this._active) return
    this._active = true

    this.group.position.set(at.x, 0, at.z)
    this.group.rotation.y = yaw
    this.group.visible = true

    this._crossfadeTo(this.idle)
  }

  /**
   * Hide the ride-horse.  Idempotent.
   */
  dismount(): void {
    if (!this._active) return
    this._active = false
    this.group.visible = false
  }

  /**
   * Call every frame while mounted.
   *
   * @param dt          frame delta-time in seconds
   * @param pos         farmer's current world position (ground level)
   * @param yaw         farmer's current heading in radians
   * @param planarSpeed farmer's planar speed in m/s
   *
   * Allocation-free: uses the pre-allocated `_scratchPos`; no closures or
   * temporaries are created during the call.
   */
  update(dt: number, pos: Vector3, yaw: number, planarSpeed: number): void {
    if (!this._active) return

    // ── 1. position — horse feet stay on the ground plane ────────────────
    this._scratchPos.set(pos.x, 0, pos.z)
    this.group.position.copy(this._scratchPos)

    // ── 2. yaw — smooth lerp so the horse "banks" into turns ─────────────
    // Shortest-path angle difference, then lerp (capped at 1 so we never overshoot).
    let delta = yaw - this.group.rotation.y
    // Normalise to (−π, π]
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    this.group.rotation.y += delta * Math.min(1, YAW_LERP_RATE * dt)

    // ── 3. clip selection by speed ────────────────────────────────────────
    let target: AnimationAction | null
    if (planarSpeed < SPEED_WALK_MIN) {
      target = this.idle
    } else if (planarSpeed < SPEED_GALLOP_MIN) {
      target = this.walk ?? this.idle
    } else {
      target = this.gallop ?? this.walk ?? this.idle
    }
    this._crossfadeTo(target)

    // ── 4. advance the mixer ──────────────────────────────────────────────
    this.mixer.update(dt)
  }

  // ── private helpers ──────────────────────────────────────────────────────

  /** Crossfade to `next`; no-op if it is already the current action. */
  private _crossfadeTo(next: AnimationAction | null): void {
    if (!next || next === this.current) return
    next.reset().play()
    if (this.current) this.current.crossFadeTo(next, FADE_S, false)
    this.current = next
  }
}
