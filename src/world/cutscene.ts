/** Construction cutscenes — when the player funds a build or a land deed, a
 * two-worker crew arrives from the road, waves hello, takes the corners of
 * the footprint and hammers (or digs) away under a letterbox while the
 * camera drifts in one slow push over the site. At the climax the scaffold
 * sinks into the earth under a ring of dust, the real thing pops in, and the
 * crew steps back to admire it before walking home. Pure presentation: the
 * letterbox bars are pointer-events:none and the camera focus is the
 * FollowCamera ceremony override, so input is NEVER locked (house rule).
 * Any tap skips — the gsap timeline jumps straight to the reveal + teardown.
 * Scenes queue FIFO when several projects land at once. Timers ride
 * update(dt) accumulators (hammer beats, greet holds) and the globally
 * re-rooted gsap clock — no setTimeout anywhere. */
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
/** ground speed the family Walk clip covers at timeScale 1 (Customer.ts) */
const WALK_REF = 2.2
const DEFAULT_DURATION = 8.5
/** entrance choreography: second worker trails the first onto the site */
const STAGGER = 0.7
/** hat-tip hello before each worker takes their corner */
const GREET = 0.8
/** the scaffold flinches on every hammer beat — 60ms out, 60ms back */
const PULSE = 0.06
/** climax: scaffold/mounds sink to this depth under a ring of dust */
const SINK_DEPTH = 1.2
const SINK_DUR = 0.5
const FADE = 0.18

/** standalone letterbox for lightweight cinematics (stick fetch, ceremonies)
 * — same look as the construction bars, but caller-driven */
export class Letterbox {
  private box: HTMLDivElement
  private barTop: HTMLDivElement
  private barBottom: HTMLDivElement
  private hintEl: HTMLDivElement
  private fadeEl: HTMLDivElement

  constructor() {
    this.box = document.createElement('div')
    this.box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:39;overflow:hidden'
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
    this.hintEl = document.createElement('div')
    this.hintEl.style.cssText =
      "position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;color:rgba(255,252,240,.55);font:600 12px 'Trebuchet MS','Segoe UI',system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;pointer-events:none"
    this.barBottom.appendChild(this.hintEl)
    // cut-through-black overlay: UNDER the bars (38 vs 39) so the frame keeps
    // its cinema edges even at full black; never intercepts a tap
    this.fadeEl = document.createElement('div')
    this.fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:38'
    document.body.appendChild(this.fadeEl)
    document.body.appendChild(this.box)
    gsap.set(this.barTop, { yPercent: -103 })
    gsap.set(this.barBottom, { yPercent: 103 })
    gsap.set(this.hintEl, { opacity: 0 })
  }

  show(hint = 'tap to skip'): void {
    this.hintEl.textContent = hint
    gsap.killTweensOf([this.barTop, this.barBottom, this.hintEl])
    gsap.to(this.barTop, { yPercent: 0, duration: 0.45, ease: 'power3.out' })
    gsap.to(this.barBottom, { yPercent: 0, duration: 0.45, ease: 'power3.out' })
    gsap.to(this.hintEl, { opacity: 1, duration: 0.4, delay: 0.35 })
  }

  hide(): void {
    gsap.killTweensOf([this.barTop, this.barBottom, this.hintEl, this.fadeEl])
    gsap.to(this.barTop, { yPercent: -103, duration: 0.5, ease: 'power3.in' })
    gsap.to(this.barBottom, { yPercent: 103, duration: 0.5, ease: 'power3.in' })
    gsap.to(this.hintEl, { opacity: 0, duration: 0.2 })
    // skip-safety: ending the cinematic must never strand a black screen
    gsap.to(this.fadeEl, { opacity: 0, duration: 0.3 })
  }

  /** full-screen dip to (or up from) black for cut-through-black transitions
   * — the sleep scene cuts mid-black to teleport the camera without a pop */
  fade(black: boolean, dur = 0.5): void {
    gsap.killTweensOf(this.fadeEl)
    gsap.to(this.fadeEl, { opacity: black ? 1 : 0, duration: dur, ease: black ? 'power2.in' : 'power2.out' })
  }
}

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
  /** seconds, default ~8.5 */
  duration?: number
  /** fired at the climax — caller swaps the scaffold zone for the real thing */
  reveal: () => void
  /** fired after the letterbox lifts and the crew is gone */
  done: () => void
}

type CrewState = 'waiting' | 'entering' | 'greeting' | 'walking' | 'working' | 'stepback' | 'proud' | 'exiting'

interface CrewWorker {
  group: Group
  mixer: AnimationMixer
  idle: AnimationAction | null
  walk: AnimationAction | null
  punchL: AnimationAction | null
  punchR: AnimationAction | null
  wave: AnimationAction | null
  current: AnimationAction | null
  /** entrance marks: road spawn -> greet spot -> corner post -> admire spot */
  greet: Vector3
  post: Vector3
  back: Vector3
  exit: Vector3
  faceYaw: number
  state: CrewState
  /** stagger before this worker starts walking in (film entrance, not a wall) */
  delay: number
  /** generic state clock (waiting stagger, greeting hold) */
  t: number
  /** seconds per swing — the punch clip's own length keeps sfx on the beat */
  beatLen: number
  beatT: number
  swingLeft: boolean
  /** swing counter — dust lands on every OTHER beat, at the impact point */
  hits: number
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
  /** the shot's aim point — update() feeds it to cineFollow so the scene owns
   * dist/pitch too (focusOn alone inherited the player's zoom, which framed
   * the crew from inside the scaffold) */
  private camAim: Vector3 | null = null

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

  /** fixed-step crew brain: staggered road entrance, hello wave, corner work
   * with on-beat impact pulses, the proud step-back, and the walk home */
  update(dt: number): void {
    const cur = this.current
    if (!cur) return
    // the scene owns the lens while it plays: a high 3/4 wide that clears the
    // scaffold and holds site + crew + road entrance in one establishing frame
    if (this.camAim) this.deps.cam.cineFollow(this.camAim, undefined, 0.46, 11.5, 46)
    const site = cur.site
    const gone: CrewWorker[] = []
    for (const u of this.workers) {
      switch (u.state) {
        case 'waiting':
          // film entrance: the second worker trails the first by STAGGER
          u.t += dt
          if (u.t >= u.delay) {
            u.state = 'entering'
            this.play3(u, u.walk)
          }
          break
        case 'entering':
          if (this.step(u, u.greet, dt)) {
            // a quick hello toward the site before taking their corner
            u.state = 'greeting'
            u.t = 0
            this.turn(u, Math.atan2(site.x - u.group.position.x, site.z - u.group.position.z))
            this.play3(u, u.wave ?? u.walk)
          }
          break
        case 'greeting':
          u.t += dt
          if (u.t >= GREET) {
            u.state = 'walking'
            this.play3(u, u.walk)
          }
          break
        case 'walking':
          if (this.step(u, u.post, dt)) {
            u.state = 'working'
            this.turn(u, u.faceYaw)
            this.play3(u, u.punchL ?? u.walk)
          }
          break
        case 'working': {
          u.beatT += dt
          if (u.beatT >= u.beatLen) {
            u.beatT -= u.beatLen
            this.deps.tickSfx()
            u.swingLeft = !u.swingLeft
            this.play3(u, u.swingLeft ? u.punchL : u.punchR)
            // every hit lands visually: the scaffold flinches on the beat
            this.pulseDressing()
            // dust on every OTHER beat, at the impact point in front of the worker
            if (++u.hits % 2 === 1) {
              const toward = site.clone().sub(u.group.position).setY(0).normalize().multiplyScalar(0.45)
              const at = u.group.position.clone().add(toward)
              at.y += 0.22 + this.rng.next() * 0.2
              this.puff(at, 0.8 + this.rng.next() * 0.5, cur.dig ? '#8d7156' : '#9a9a92', 0.8)
            }
          }
          break
        }
        case 'stepback':
          if (this.step(u, u.back, dt)) {
            // the proud moment: face what they built and wave it home
            u.state = 'proud'
            this.turn(u, Math.atan2(site.x - u.group.position.x, site.z - u.group.position.z))
            this.play3(u, u.wave ?? u.current)
          }
          break
        case 'proud':
          break
        case 'exiting':
          this.step(u, u.exit, dt)
          if (u.group.position.distanceTo(site) > 6) {
            this.removeWorker(u)
            gone.push(u)
          }
          break
      }
    }
    if (gone.length) this.workers = this.workers.filter((u) => !gone.includes(u))
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
    const climax = Math.max(1.2, dur - 2.6)

    // camera choreography: open slightly wide and LOW toward the road (where
    // the crew enters), then ONE slow push-in up and over the build — a ~1.2u
    // drift along a rising diagonal instead of a static hold. update() feeds
    // camAim to cineFollow with a WIDE dist so the whole site + crew frame.
    const siteA = opts.site.clone().add(new Vector3(0.5, 0.3, 0.75))
    const siteB = opts.site.clone().add(new Vector3(-0.1, 0.85, -0.15))
    this.camAim = siteA.clone()
    // hard CUT to the establishing wide as the letterbox slides in (film
    // grammar) — easing there could drag the camera through farm buildings.
    // Values must match update()'s per-tick cineFollow call.
    this.deps.cam.cineFollow(this.camAim, undefined, 0.46, 11.5, 46)
    this.deps.cam.cineCut()

    const tl = gsap.timeline()
    tl.call(
      () => {
        if (this.camAim) {
          gsap.to(this.camAim, { x: siteB.x, y: siteB.y, z: siteB.z, duration: Math.max(1.5, climax - 0.9), ease: 'power2.inOut' })
        }
      },
      undefined,
      Math.min(1.15, climax * 0.5),
    )
    // the money moment: dressing sinks under a ring of dust...
    tl.call(() => this.sinkDressing(), undefined, climax)
    // ...and the real thing appears at the sink's midpoint, hidden by the dust
    tl.call(() => this.fireReveal(), undefined, Math.min(dur - 0.2, climax + SINK_DUR * 0.5))
    tl.call(() => this.celebrate(), undefined, Math.min(dur - 0.15, climax + 0.55))
    tl.call(
      () => {
        this.liftLetterbox()
        if (this.camAim) gsap.killTweensOf(this.camAim)
        this.camAim = null
        this.deps.cam.cineFollow(null)
      },
      undefined,
      Math.min(dur - 0.1, climax + 0.9),
    )
    tl.call(() => this.beginExit(), undefined, Math.min(dur - 0.05, climax + 1.9))
    tl.call(() => this.finish(), undefined, dur)
    this.tl = tl
  }

  /** climax part 1: the scaffold/mounds SINK into the earth under a ring of
   * dust — the dressing doesn't pop off, the ground swallows it */
  private sinkDressing(): void {
    const opts = this.current
    if (!opts) return
    const d = this.dressing
    if (d) {
      gsap.killTweensOf(d.scale)
      gsap.killTweensOf(d.position)
      gsap.to(d.position, {
        y: opts.site.y - SINK_DEPTH,
        duration: SINK_DUR,
        ease: 'power2.in',
        onComplete: () => {
          this.deps.scene.remove(d)
          if (this.dressing === d) this.dressing = null
        },
      })
    }
    // ring of dust around the footprint edge hides the sink
    const cos = Math.cos(opts.yaw)
    const sin = Math.sin(opts.yaw)
    const rx = opts.footprint.w / 2 + 0.35
    const rz = opts.footprint.d / 2 + 0.35
    const color = opts.dig ? '#8d7156' : '#a8a49a'
    // MANY small puffs read as a rolling dust skirt; a few big ones read as
    // balloons — count up, size down
    const n = 20 + Math.floor(this.rng.next() * 5)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rng.next() * 0.4
      const lx = Math.cos(a) * rx
      const lz = Math.sin(a) * rz
      const at = new Vector3(
        opts.site.x + lx * cos + lz * sin,
        opts.site.y + 0.1 + this.rng.next() * 0.3,
        opts.site.z - lx * sin + lz * cos,
      )
      this.puff(at, 0.8 + this.rng.next() * 0.55, color, 0.85)
    }
  }

  /** climax part 2: hand the spot back to the caller — exactly once, even
   * when a skip fast-forwards every timeline call in the same tick */
  private fireReveal(): void {
    if (this.revealed || !this.current) return
    this.revealed = true
    this.current.reveal()
  }

  /** crew steps back two paces to admire the work (the wave lands in update) */
  private celebrate(): void {
    for (const u of this.workers) {
      if (u.state === 'exiting') continue
      u.state = 'stepback'
      this.play3(u, u.walk)
    }
  }

  /** crew walks home the way they came — update() retires them at 6u out */
  private beginExit(): void {
    for (const u of this.workers) {
      u.state = 'exiting'
      this.play3(u, u.walk)
    }
  }

  /** teardown: kill every dressing/crew tween, crew off, callbacks out, next
   * queued scene in — the skip path lands here with nothing left animating */
  private finish(): void {
    if (!this.current) return
    if (this.skipHandler) {
      window.removeEventListener('pointerdown', this.skipHandler, { capture: true })
      this.skipHandler = null
    }
    if (this.dressing) {
      // a skip can land mid-pulse or mid-sink — kill both before removal
      gsap.killTweensOf(this.dressing.scale)
      gsap.killTweensOf(this.dressing.position)
      this.deps.scene.remove(this.dressing)
      this.dressing = null
    }
    // skip path may land here with the shot still live
    if (this.camAim) {
      gsap.killTweensOf(this.camAim)
      this.camAim = null
      this.deps.cam.cineFollow(null)
    }
    for (const u of this.workers) this.removeWorker(u)
    this.workers = []
    const opts = this.current
    this.current = null
    this.tl = null
    opts.done()
    if (this.queue.length) this.startNext()
  }

  private removeWorker(u: CrewWorker): void {
    gsap.killTweensOf(u.group.rotation)
    u.mixer.stopAllAction()
    this.deps.scene.remove(u.group)
  }

  // ---- crew -------------------------------------------------------------------

  /** two hard-hat workers enter from the ROAD side (world +z of the site),
   * staggered, greet, then split to opposite corners of the footprint */
  private spawnCrew(opts: ConstructionJob): void {
    const cos = Math.cos(opts.yaw)
    const sin = Math.sin(opts.yaw)
    const halfW = opts.footprint.w / 2 + 0.45
    const halfD = opts.footprint.d / 2 + 0.45
    // approach: from the site toward z+6, clamped so big footprints don't
    // push the spawn into the next county
    const enterDist = Math.min(6, Math.max(4, opts.footprint.d / 2 + 3.4))
    for (let i = 0; i < 2; i++) {
      const g = this.deps.assets.spawnSkinned('customerA')
      normalizeHeight(g, WORKER_HEIGHT + (this.rng.next() - 0.5) * 0.06)
      const side = i === 0 ? 1 : -1
      const lx = side * halfW
      const lz = side * halfD
      const post = new Vector3(opts.site.x + lx * cos + lz * sin, opts.site.y, opts.site.z - lx * sin + lz * cos)
      const spawn = new Vector3(opts.site.x + side * 0.55, opts.site.y, opts.site.z + enterDist)
      const greet = new Vector3(opts.site.x + side * 0.85, opts.site.y, opts.site.z + opts.footprint.d / 2 + 1.35)
      const outward = post.clone().sub(opts.site).setY(0).normalize()
      const back = post.clone().addScaledVector(outward, 1.25)
      const exit = new Vector3(opts.site.x + side * 0.7, opts.site.y, opts.site.z + Math.max(6.6, enterDist + 2.4))
      g.position.copy(spawn)
      g.rotation.y = Math.atan2(greet.x - spawn.x, greet.z - spawn.z)
      this.deps.scene.add(g)
      const mixer = new AnimationMixer(g)
      const clips = this.deps.assets.clips('customerA')
      const u: CrewWorker = {
        group: g,
        mixer,
        idle: act(mixer, g, clips, 'Idle'),
        walk: act(mixer, g, clips, 'Walk'),
        punchL: act(mixer, g, clips, 'Punch_Left'),
        punchR: act(mixer, g, clips, 'Punch_Right'),
        wave: act(mixer, g, clips, 'Wave'),
        current: null,
        greet,
        post,
        back,
        exit,
        faceYaw: Math.atan2(opts.site.x - post.x, opts.site.z - post.z),
        state: 'waiting',
        delay: i === 0 ? 0 : STAGGER,
        t: 0,
        beatLen: 0.9,
        beatT: i === 0 ? 0 : -0.45,
        swingLeft: true,
        hits: 0,
      }
      const swing = u.punchL?.getClip()
      if (swing && swing.duration > 0.3) u.beatLen = swing.duration
      if (u.walk) u.walk.timeScale = WALK_SPEED / WALK_REF
      if (u.idle) {
        u.idle.play()
        u.current = u.idle
      }
      this.workers.push(u)
    }
  }

  /** ground-plane walk toward a mark; true when arrived */
  private step(u: CrewWorker, target: Vector3, dt: number): boolean {
    const to = target.clone().sub(u.group.position).setY(0)
    const dist = to.length()
    if (dist < 0.08) return true
    const step = Math.min(dist, WALK_SPEED * dt)
    u.group.position.add(to.normalize().multiplyScalar(step))
    u.group.rotation.y = Math.atan2(to.x, to.z)
    return false
  }

  /** shortest-path eased turn — workers TURN to face their work, not snap */
  private turn(u: CrewWorker, yaw: number): void {
    let d = yaw - u.group.rotation.y
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    gsap.killTweensOf(u.group.rotation)
    gsap.to(u.group.rotation, { y: u.group.rotation.y + d, duration: 0.3, ease: 'power2.out' })
  }

  private play3(u: CrewWorker, next: AnimationAction | null): void {
    if (!next || next === u.current) return
    next.reset().play()
    if (u.current) u.current.crossFadeTo(next, FADE, false)
    u.current = next
  }

  /** hammer-beat impact pulse: the dressing flinches 3% and settles in 120ms */
  private pulseDressing(): void {
    const d = this.dressing
    if (!d || this.revealed) return
    gsap.killTweensOf(d.scale)
    d.scale.setScalar(1)
    gsap.to(d.scale, { x: 1.03, y: 1.03, z: 1.03, duration: PULSE, ease: 'power2.out', yoyo: true, repeat: 1 })
  }

  // ---- dust ---------------------------------------------------------------------

  /** TractorView.chug pattern: gray sphere rises, swells and fades, then frees
   * itself — geometry shared, material cloned per puff for the opacity tween.
   * Kept SMALL and short-lived: a puff that swells past ~half a unit reads as
   * a floating translucent blob on screen (house art rule), not dust */
  private puff(at: Vector3, size: number, color: string, rise: number): void {
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.5 })
    const m = new Mesh(PUFF_GEO, mat)
    m.position.copy(at)
    m.scale.set(size, size * 0.78, size)
    this.deps.scene.add(m)
    const drift = new Vector3((this.rng.next() - 0.5) * 0.7, rise * (0.8 + this.rng.next() * 0.4), (this.rng.next() - 0.5) * 0.7)
    gsap.to(m.position, { x: at.x + drift.x, y: at.y + drift.y, z: at.z + drift.z, duration: 0.85, ease: 'power1.out' })
    gsap.to(m.scale, { x: size * 1.7, y: size * 1.35, z: size * 1.7, duration: 0.85 })
    gsap.to(mat, {
      opacity: 0,
      duration: 0.72,
      delay: 0.08,
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
