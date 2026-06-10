/** Construction cutscenes — when the player funds a build or a land deed, a
 * two-worker crew walks in, takes the corners of the footprint and hammers
 * (or digs) away under a letterbox while the camera glides over. Pure
 * presentation: the letterbox bars are pointer-events:none and the camera
 * focus is the FollowCamera ceremony override, so input is NEVER locked
 * (house rule). Any tap skips — the gsap timeline jumps straight to the
 * reveal + teardown. Scenes queue FIFO when several projects land at once.
 * Timers ride update(dt) accumulators (hammer beats, dust puffs) and the
 * globally re-rooted gsap clock — no setTimeout anywhere. */
import gsap from 'gsap'
import {
  AnimationAction,
  AnimationMixer,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Scene,
  SphereGeometry,
  Vector3,
  type AnimationClip,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, type Rng } from '../game/rng'
import { type Assets } from './assets'
import { buildScaffold } from './buildings'
import type { FollowCamera } from './FollowCamera'
import { normalizeHeight } from './scale'
import { makeCanvas, toTexture } from './textures'

/** crew sizing: a touch under the 1.6u farmer — hired hands, not giants */
const WORKER_HEIGHT = 1.55
const WALK_SPEED = 2.0
const WALK_IN_DIST = 4
/** ground speed the family Walk clip covers at timeScale 1 (Customer.ts) */
const WALK_REF = 2.2
const DEFAULT_DURATION = 7
/** dust puff cadence per working crew member */
const PUFF_EVERY = 1.2
const FADE = 0.18

export interface ConstructionDeps {
  scene: Scene
  assets: Assets
  cam: FollowCamera
  /** one call per hammer/shovel impact beat */
  tickSfx: () => void
}

export interface ConstructionJob {
  site: Vector3
  yaw: number
  footprint: { w: number; d: number }
  /** true = digging crew (land deeds): dirt mounds instead of scaffold */
  dig?: boolean
  /** seconds, default ~7 */
  duration?: number
  /** fired at the climax — caller swaps the scaffold zone for the real thing */
  reveal: () => void
  /** fired after the letterbox lifts and the crew is gone */
  done: () => void
}

type CrewState = 'walking' | 'working' | 'cheering'

interface CrewWorker {
  group: Group
  mixer: AnimationMixer
  walk: AnimationAction | null
  punchL: AnimationAction | null
  punchR: AnimationAction | null
  cheer: AnimationAction | null
  current: AnimationAction | null
  post: Vector3
  faceYaw: number
  state: CrewState
  /** seconds per swing — the punch clip's own length keeps sfx on the beat */
  beatLen: number
  beatT: number
  swingLeft: boolean
  puffT: number
}

/** suffix clip lookup — Quaternius names look like 'CharacterArmature|Walk' */
function act(mixer: AnimationMixer, root: Group, clips: AnimationClip[], suffix: string): AnimationAction | null {
  const clip = clips.find((c) => c.name.toLowerCase().endsWith(suffix.toLowerCase()))
  return clip ? mixer.clipAction(clip, root) : null
}

// ---- set dressing: dirt mounds (dig scenes) ---------------------------------

/** speckled-soil canvas — house art rule: no flat-color blobs, ever */
let soilTex: CanvasTexture | null = null

function soilTexture(): CanvasTexture {
  if (soilTex) return soilTex
  const rng = mulberry32(48151)
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#6a4a2d'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 340; i++) {
    const tone = rng.next()
    g.fillStyle = tone > 0.66 ? '#7d5a38' : tone > 0.33 ? '#59391f' : '#4a2f18'
    g.globalAlpha = 0.3 + rng.next() * 0.5
    g.fillRect(rng.next() * 64, rng.next() * 64, 1 + rng.next() * 2.5, 1 + rng.next() * 2)
  }
  // a few pale pebbles catch the light
  for (let i = 0; i < 14; i++) {
    g.globalAlpha = 0.5 + rng.next() * 0.3
    g.fillStyle = '#8f7a5e'
    g.beginPath()
    g.arc(rng.next() * 64, rng.next() * 64, 0.8 + rng.next() * 1.2, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1
  soilTex = toTexture(c, true)
  return soilTex
}

/** 4-6 low squashed soil cones merged into ONE mesh (single draw call);
 * per-mound tint variety rides a vertex-color attribute over the soil map */
function makeMounds(w: number, d: number, rng: Rng): Group {
  const geos: BufferGeometry[] = []
  const n = 4 + Math.floor(rng.next() * 3)
  for (let i = 0; i < n; i++) {
    const r = 0.3 + rng.next() * 0.24
    const h = 0.2 + rng.next() * 0.18
    const cone = new ConeGeometry(r, h, 8, 1)
    cone.translate(0, h / 2, 0)
    cone.rotateY(rng.next() * Math.PI)
    cone.scale(1, 1, 0.82 + rng.next() * 0.32)
    cone.translate((rng.next() - 0.5) * Math.max(0.4, w - 0.8), 0, (rng.next() - 0.5) * Math.max(0.4, d - 0.8))
    const k = 0.86 + rng.next() * 0.26
    const warm = 0.94 + rng.next() * 0.08
    const count = cone.attributes.position.count
    const col = new Float32Array(count * 3)
    for (let j = 0; j < count; j++) {
      col[j * 3] = k
      col[j * 3 + 1] = k * warm
      col[j * 3 + 2] = k * warm * 0.97
    }
    cone.setAttribute('color', new BufferAttribute(col, 3))
    geos.push(cone)
  }
  const group = new Group()
  const merged = mergeGeometries(geos)
  if (merged) {
    const mesh = new Mesh(merged, new MeshStandardMaterial({ map: soilTexture(), vertexColors: true, roughness: 1 }))
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}

/** shared puff geometry — every puff is this sphere scaled, never re-allocated */
const PUFF_GEO = new SphereGeometry(0.09, 8, 6)

export class Construction {
  private deps: ConstructionDeps
  private queue: ConstructionJob[] = []
  private current: ConstructionJob | null = null
  private tl: gsap.core.Timeline | null = null
  private workers: CrewWorker[] = []
  private dressing: Group | null = null
  private revealed = false
  private rng: Rng = mulberry32(1)
  private skipHandler: (() => void) | null = null

  // letterbox DOM (built once, slid in/out per scene)
  private box: HTMLDivElement
  private barTop: HTMLDivElement
  private barBottom: HTMLDivElement
  private hint: HTMLDivElement

  constructor(deps: ConstructionDeps) {
    this.deps = deps
    this.box = document.createElement('div')
    this.box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:40;overflow:hidden'
    const bar = (): HTMLDivElement => {
      const b = document.createElement('div')
      b.style.cssText = 'position:absolute;left:0;right:0;height:11vh;background:#000;pointer-events:none;will-change:transform'
      this.box.appendChild(b)
      return b
    }
    this.barTop = bar()
    this.barTop.style.top = '0'
    this.barBottom = bar()
    this.barBottom.style.bottom = '0'
    this.hint = document.createElement('div')
    this.hint.textContent = 'tap to skip'
    this.hint.style.cssText =
      "position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;color:rgba(255,252,240,.55);font:600 12px 'Trebuchet MS','Segoe UI',system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;pointer-events:none"
    this.barBottom.appendChild(this.hint)
    document.body.appendChild(this.box)
    gsap.set(this.barTop, { yPercent: -103 })
    gsap.set(this.barBottom, { yPercent: 103 })
    gsap.set(this.hint, { opacity: 0 })
  }

  /** true while a scene is on screen (queued scenes start back-to-back) */
  get active(): boolean {
    return this.current !== null
  }

  /** start (or queue) a construction scene — FIFO when one is already playing */
  play(opts: ConstructionJob): void {
    this.queue.push(opts)
    if (!this.current) this.startNext()
  }

  /** fixed-step timers: crew walk-in, hammer beats (tickSfx), dust cadence */
  update(dt: number): void {
    if (!this.current) return
    const site = this.current.site
    for (const u of this.workers) {
      if (u.state === 'walking') {
        const to = u.post.clone().sub(u.group.position).setY(0)
        const dist = to.length()
        if (dist < 0.08) {
          u.state = 'working'
          u.group.rotation.y = u.faceYaw
          this.play3(u, u.punchL ?? u.walk)
        } else {
          const step = Math.min(dist, WALK_SPEED * dt)
          u.group.position.add(to.normalize().multiplyScalar(step))
          u.group.rotation.y = Math.atan2(to.x, to.z)
        }
      } else if (u.state === 'working') {
        u.beatT += dt
        if (u.beatT >= u.beatLen) {
          u.beatT -= u.beatLen
          this.deps.tickSfx()
          u.swingLeft = !u.swingLeft
          this.play3(u, u.swingLeft ? u.punchL : u.punchR)
        }
        u.puffT += dt
        if (u.puffT >= PUFF_EVERY) {
          u.puffT = this.rng.next() * 0.35
          const toward = site.clone().sub(u.group.position).setY(0).normalize().multiplyScalar(0.45)
          const at = u.group.position.clone().add(toward)
          at.y += 0.22 + this.rng.next() * 0.2
          this.puff(at, 0.8 + this.rng.next() * 0.5, this.current.dig ? '#8d7156' : '#9a9a92', 0.8)
        }
      }
    }
  }

  /** per-render: animation mixers only */
  frame(dt: number): void {
    for (const u of this.workers) u.mixer.update(dt)
  }

  // ---- scene lifecycle -------------------------------------------------------

  private startNext(): void {
    const opts = this.queue.shift()
    if (!opts) return
    this.current = opts
    this.revealed = false
    // deterministic per site — same deed always builds the same little scene
    const seed =
      ((Math.round(opts.site.x * 8) * 73856093) ^
        (Math.round(opts.site.z * 8) * 19349663) ^
        (Math.round(opts.footprint.w * 16) * 83492791)) >>>
      0
    this.rng = mulberry32(seed)

    // set dressing: scaffold for builds, dirt mounds for digs
    const dressing: Group = opts.dig
      ? makeMounds(opts.footprint.w, opts.footprint.d, this.rng)
      : buildScaffold(opts.footprint.w, opts.footprint.d, Math.floor(this.rng.next() * 0xffffffff))
    dressing.position.copy(opts.site)
    dressing.rotation.y = opts.yaw
    this.deps.scene.add(dressing)
    this.dressing = dressing

    this.spawnCrew(opts)
    this.deps.cam.focusOn(opts.site.clone().add(new Vector3(0, 0.8, 0)), 1.0)
    this.showLetterbox()

    // any tap skips — capture-phase so it beats the canvas, once per scene,
    // and it never preventDefaults: the same tap still moves/acts (no locks).
    // A short grace window swallows taps from players mid-steer when the
    // scene opens, so the crew never blinks out of existence by accident.
    const startedAt = performance.now()
    const onSkip = (): void => {
      if (performance.now() - startedAt < 900) return
      if (this.skipHandler) window.removeEventListener('pointerdown', this.skipHandler, { capture: true })
      this.skipHandler = null
      this.tl?.progress(1, false)
    }
    this.skipHandler = onSkip
    window.addEventListener('pointerdown', onSkip, { capture: true })

    const dur = Math.max(3, opts.duration ?? DEFAULT_DURATION)
    const climax = Math.max(1.2, dur - 1.8)
    const tl = gsap.timeline()
    tl.call(() => this.doReveal(), undefined, climax)
    tl.call(
      () => {
        this.liftLetterbox()
        this.deps.cam.release(0.9)
      },
      undefined,
      Math.min(dur - 0.1, climax + 0.5),
    )
    tl.call(() => this.finish(), undefined, dur)
    this.tl = tl
  }

  /** climax: dressing out, big dust burst, hand the spot back to the caller */
  private doReveal(): void {
    if (this.revealed || !this.current) return
    this.revealed = true
    const opts = this.current
    if (this.dressing) {
      this.deps.scene.remove(this.dressing)
      this.dressing = null
    }
    // big burst across the whole footprint
    const cos = Math.cos(opts.yaw)
    const sin = Math.sin(opts.yaw)
    const color = opts.dig ? '#8d7156' : '#a8a49a'
    for (let i = 0; i < 12; i++) {
      const lx = (this.rng.next() - 0.5) * opts.footprint.w
      const lz = (this.rng.next() - 0.5) * opts.footprint.d
      const at = new Vector3(
        opts.site.x + lx * cos + lz * sin,
        opts.site.y + 0.12 + this.rng.next() * 0.5,
        opts.site.z - lx * sin + lz * cos,
      )
      this.puff(at, 1.6 + this.rng.next() * 1.2, color, 1.4)
    }
    opts.reveal()
    // crew steps back and celebrates while the letterbox lifts
    for (const u of this.workers) {
      u.state = 'cheering'
      this.play3(u, u.cheer ?? u.current)
    }
  }

  /** teardown: crew off, callbacks out, next queued scene in */
  private finish(): void {
    if (!this.current) return
    if (this.skipHandler) {
      window.removeEventListener('pointerdown', this.skipHandler, { capture: true })
      this.skipHandler = null
    }
    if (this.dressing) {
      // safety: a sub-second custom duration could land finish before reveal
      this.deps.scene.remove(this.dressing)
      this.dressing = null
    }
    for (const u of this.workers) {
      u.mixer.stopAllAction()
      this.deps.scene.remove(u.group)
    }
    this.workers = []
    const opts = this.current
    this.current = null
    this.tl = null
    opts.done()
    if (this.queue.length) this.startNext()
  }

  // ---- crew -------------------------------------------------------------------

  /** two hard-hat workers, opposite corners, walked in from 4u out */
  private spawnCrew(opts: ConstructionJob): void {
    const cos = Math.cos(opts.yaw)
    const sin = Math.sin(opts.yaw)
    const halfW = opts.footprint.w / 2 + 0.45
    const halfD = opts.footprint.d / 2 + 0.45
    for (let i = 0; i < 2; i++) {
      const g = this.deps.assets.spawnSkinned('customerA')
      normalizeHeight(g, WORKER_HEIGHT + (this.rng.next() - 0.5) * 0.06)
      const side = i === 0 ? 1 : -1
      const lx = side * halfW
      const lz = side * halfD
      const post = new Vector3(opts.site.x + lx * cos + lz * sin, opts.site.y, opts.site.z - lx * sin + lz * cos)
      const outward = post.clone().sub(opts.site).setY(0).normalize()
      g.position.copy(post).add(outward.multiplyScalar(WALK_IN_DIST))
      g.rotation.y = Math.atan2(post.x - g.position.x, post.z - g.position.z)
      this.deps.scene.add(g)
      const mixer = new AnimationMixer(g)
      const clips = this.deps.assets.clips('customerA')
      const u: CrewWorker = {
        group: g,
        mixer,
        walk: act(mixer, g, clips, 'Walk'),
        punchL: act(mixer, g, clips, 'Punch_Left'),
        punchR: act(mixer, g, clips, 'Punch_Right'),
        cheer: act(mixer, g, clips, 'Wave'),
        current: null,
        post,
        faceYaw: Math.atan2(opts.site.x - post.x, opts.site.z - post.z),
        state: 'walking',
        beatLen: 0.9,
        beatT: i === 0 ? 0 : -0.45,
        swingLeft: true,
        puffT: this.rng.next() * PUFF_EVERY,
      }
      const swing = u.punchL?.getClip()
      if (swing && swing.duration > 0.3) u.beatLen = swing.duration
      if (u.walk) {
        u.walk.timeScale = WALK_SPEED / WALK_REF
        u.walk.play()
        u.current = u.walk
      }
      this.workers.push(u)
    }
  }

  private play3(u: CrewWorker, next: AnimationAction | null): void {
    if (!next || next === u.current) return
    next.reset().play()
    if (u.current) u.current.crossFadeTo(next, FADE, false)
    u.current = next
  }

  // ---- dust ---------------------------------------------------------------------

  /** TractorView.chug pattern: gray sphere rises, swells and fades, then frees
   * itself — geometry shared, material cloned per puff for the opacity tween */
  private puff(at: Vector3, size: number, color: string, rise: number): void {
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.65 })
    const m = new Mesh(PUFF_GEO, mat)
    m.position.copy(at)
    m.scale.setScalar(size)
    this.deps.scene.add(m)
    const drift = new Vector3((this.rng.next() - 0.5) * 0.7, rise * (0.8 + this.rng.next() * 0.4), (this.rng.next() - 0.5) * 0.7)
    gsap.to(m.position, { x: at.x + drift.x, y: at.y + drift.y, z: at.z + drift.z, duration: 1.05, ease: 'power1.out' })
    gsap.to(m.scale, { x: size * 2.5, y: size * 2.5, z: size * 2.5, duration: 1.05 })
    gsap.to(mat, {
      opacity: 0,
      duration: 0.95,
      delay: 0.1,
      onComplete: () => {
        this.deps.scene.remove(m)
        mat.dispose()
      },
    })
  }

  // ---- letterbox -------------------------------------------------------------

  private showLetterbox(): void {
    gsap.killTweensOf([this.barTop, this.barBottom, this.hint])
    gsap.to(this.barTop, { yPercent: 0, duration: 0.5, ease: 'power3.out' })
    gsap.to(this.barBottom, { yPercent: 0, duration: 0.5, ease: 'power3.out' })
    gsap.to(this.hint, { opacity: 1, duration: 0.4, delay: 0.35 })
  }

  private liftLetterbox(): void {
    gsap.killTweensOf([this.barTop, this.barBottom, this.hint])
    gsap.to(this.barTop, { yPercent: -103, duration: 0.45, ease: 'power2.in' })
    gsap.to(this.barBottom, { yPercent: 103, duration: 0.45, ease: 'power2.in' })
    gsap.to(this.hint, { opacity: 0, duration: 0.2 })
  }
}
