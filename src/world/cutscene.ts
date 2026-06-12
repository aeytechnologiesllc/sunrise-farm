/** Construction cutscenes — when the player funds a build or a land deed, a
 * small named crew (Gus, Wren — and Bram on the big jobs) walks in from the
 * road carrying real tools, waves hello, and takes posts AT the work: the
 * scaffold corners on a build, the dirt mounds on a dig. The scaffold rises
 * in three staged pops as they hammer; mounds grow shovel-beat by shovel-beat.
 * The scene speaks film grammar: an establishing wide, a cut to a close-up
 * tracking Gus at work, and a cut back to a reveal wide just before the
 * climax — where the scaffold is DISMANTLED (mounds flattened) behind a big
 * dust skirt and the real thing pops in. Pure presentation: the letterbox
 * bars are pointer-events:none and the camera focus is the FollowCamera
 * ceremony override, so input is NEVER locked (house rule). Any tap skips —
 * the gsap timeline jumps straight to the end state in one tick. Scenes
 * queue FIFO when several projects land at once. Timers ride update(dt)
 * accumulators (work beats, greet holds) and the globally re-rooted gsap
 * clock — no setTimeout anywhere. */
import gsap from 'gsap'
import {
  AnimationAction,
  AnimationMixer,
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Scene,
  SphereGeometry,
  Vector3,
  type AnimationClip,
} from 'three'
import { mulberry32, type Rng } from '../game/rng'
import { type Assets } from './assets'
import { buildScaffoldStaged } from './buildings'
import type { FollowCamera } from './FollowCamera'
import { normalizeHeight } from './scale'
import { makeCanvas, toTexture, woodCanvas } from './textures'

/** the named crew — distinct heights and a 30% wardrobe tint tell them apart
 * at a glance (the owner's note: twin clones read as a bug, not a crew) */
const CREW = [
  { name: 'Gus', h: 1.62, tint: '#c96f43' },
  { name: 'Wren', h: 1.46, tint: '#5b7ea6' },
  { name: 'Bram', h: 1.55, tint: '#7a8a4f' },
] as const

const WALK_SPEED = 2.0
/** ground speed the family Walk clip covers at timeScale 1 (Customer.ts) */
const WALK_REF = 2.2
/** entrance choreography: each worker trails the previous onto the site */
const STAGGER = 0.7
/** hat-tip hello before each worker takes their post */
const GREET = 0.8
/** the scaffold flinches on every hammer beat — 60ms out, 60ms back */
const PULSE = 0.06
const FADE = 0.18
/** a mid-work pause: lean back, quick wave-stretch, back to it */
const BREATHER = 1.2

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
  /** one call per hammer/shovel impact beat — `dig` is true on shovel beats
   * (older `() => void` callbacks remain assignable and just ignore the flag) */
  tickSfx?: (dig: boolean) => void
  /** shared cinematic letterbox — all bars/fades go through it. Created
   * internally when not provided, so older callers keep working; pass main's
   * instance so every cinematic shares one set of DOM bars. */
  letterbox?: Letterbox
}

export interface ConstructionJob {
  site: Vector3
  yaw: number
  footprint: { w: number; d: number }
  /** true = digging crew (land deeds): dirt mounds instead of scaffold */
  dig?: boolean
  /** coin price of the thing being built — scales scene length (8.5s under
   * 150c, 10s under 400c, 12.5s above) and brings Bram along at 400c+ */
  cost?: number
  /** seconds — explicit override wins over the cost-scaled duration */
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
  /** entrance marks: road spawn -> greet spot -> work post -> admire spot */
  greet: Vector3
  post: Vector3
  back: Vector3
  exit: Vector3
  /** the actual impact point — a scaffold corner or this worker's mound */
  workAt: Vector3
  faceYaw: number
  state: CrewState
  /** stagger before this worker starts walking in (film entrance, not a wall) */
  delay: number
  /** generic state clock (waiting stagger, greeting hold) */
  t: number
  /** seconds per swing — the punch clip's length, humanized ±9% per worker */
  beatLen: number
  beatT: number
  swingLeft: boolean
  /** beats since the last breather; at nextBreather the worker stretches */
  beats: number
  nextBreather: number
  breatherT: number
}

/** a camera setup the scene holds between cuts — update() re-feeds it to
 * cineFollow every tick so 'worker0' shots track a moving subject */
interface Shot {
  aim: Vector3 | 'worker0'
  yaw?: number
  pitch: number
  dist: number
  fov: number
}

/** zero-alloc scratch for resolving the live shot aim each tick */
const AIM = new Vector3()
/** close-up framing: aim chest-high on the tracked worker */
const HEAD = new Vector3(0, 1.2, 0)

/** suffix clip lookup — Quaternius names look like 'CharacterArmature|Walk' */
function act(mixer: AnimationMixer, root: Group, clips: AnimationClip[], suffix: string): AnimationAction | null {
  const clip = clips.find((c) => c.name.toLowerCase().endsWith(suffix.toLowerCase()))
  return clip ? mixer.clipAction(clip, root) : null
}

// ---- hand tools --------------------------------------------------------------

/** wood-grain canvas shared by every tool handle (house art rule: textured) */
let toolTex: CanvasTexture | null = null

function toolWoodTex(): CanvasTexture {
  if (!toolTex) toolTex = toTexture(woodCanvas(mulberry32(0x700d5), '#8a6438'), true)
  return toolTex
}

/** prototypes built once; per-worker tools are clones sharing geo + materials */
let hammerP: Group | null = null
let shovelP: Group | null = null

function hammerProto(): Group {
  if (hammerP) return hammerP
  const g = new Group()
  const handle = new Mesh(
    new CylinderGeometry(0.035, 0.035, 0.46, 6),
    new MeshStandardMaterial({ map: toolWoodTex(), roughness: 0.9 }),
  )
  handle.position.y = 0.08 // grip (the bone origin) sits 0.15 up from the butt
  handle.castShadow = true
  const head = new Mesh(new BoxGeometry(0.09, 0.09, 0.16), new MeshStandardMaterial({ color: '#4a4a50', roughness: 0.55, metalness: 0.35 }))
  head.position.y = 0.31
  head.castShadow = true
  g.add(handle, head)
  hammerP = g
  return g
}

function shovelProto(): Group {
  if (shovelP) return shovelP
  const g = new Group()
  const handle = new Mesh(
    new CylinderGeometry(0.028, 0.028, 0.7, 6),
    new MeshStandardMaterial({ map: toolWoodTex(), roughness: 0.9 }),
  )
  handle.position.y = -0.13 // spans +0.22 .. -0.48 around the grip
  handle.castShadow = true
  const blade = new Mesh(new BoxGeometry(0.18, 0.22, 0.025), new MeshStandardMaterial({ color: '#5a5a60', roughness: 0.5, metalness: 0.45 }))
  blade.position.set(0, -0.56, 0.02)
  blade.rotation.x = 0.16
  blade.castShadow = true
  g.add(handle, blade)
  shovelP = g
  return g
}

/** feature-detect the right hand bone (Quaternius rigs name it 'Wrist.R').
 * Returns null when the rig has no recognizable hand — the scene must play
 * propless without errors (house veto: never throw on a bone lookup). */
function rightHandBone(root: Object3D): Object3D | null {
  const named =
    root.getObjectByName('Wrist.R') ??
    root.getObjectByName('Hand.R') ??
    root.getObjectByName('HandR') ??
    root.getObjectByName('WristR')
  if (named) return named
  let found: Object3D | null = null
  root.traverse((o) => {
    if (!found && /(hand|wrist).*r$/i.test(o.name) && !/_end$/i.test(o.name)) found = o
  })
  return found
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

/** 4-6 low squashed soil cones, ONE mesh each (they scale up independently as
 * the crew digs); per-mound tint variety rides vertex colors over the soil
 * map, all mounds share one material. Returns local spots so the crew can
 * take a post at a mound each. */
function makeMounds(w: number, d: number, rng: Rng): { group: Group; mounds: Mesh[]; spots: Vector3[] } {
  const group = new Group()
  const mat = new MeshStandardMaterial({ map: soilTexture(), vertexColors: true, roughness: 1 })
  const mounds: Mesh[] = []
  const spots: Vector3[] = []
  const n = 4 + Math.floor(rng.next() * 3)
  for (let i = 0; i < n; i++) {
    const r = 0.3 + rng.next() * 0.24
    const h = 0.2 + rng.next() * 0.18
    const cone = new ConeGeometry(r, h, 8, 1)
    cone.translate(0, h / 2, 0)
    cone.rotateY(rng.next() * Math.PI)
    cone.scale(1, 1, 0.82 + rng.next() * 0.32)
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
    const m = new Mesh(cone, mat)
    m.castShadow = true
    m.receiveShadow = true
    m.position.set((rng.next() - 0.5) * Math.max(0.4, w - 0.8), 0, (rng.next() - 0.5) * Math.max(0.4, d - 0.8))
    group.add(m)
    mounds.push(m)
    spots.push(m.position.clone())
  }
  return { group, mounds, spots }
}

/** shared puff geometry — every puff is this sphere scaled, never re-allocated */
const PUFF_GEO = new SphereGeometry(0.09, 8, 6)

export class Construction {
  private deps: ConstructionDeps
  private lb: Letterbox
  private queue: ConstructionJob[] = []
  private current: ConstructionJob | null = null
  private tl: gsap.core.Timeline | null = null
  private workers: CrewWorker[] = []
  private dressing: Group | null = null
  /** staged scaffold groups (builds) — raised on the beats, dismantled at climax */
  private stages: Group[] = []
  /** individual mounds (digs), in seeded grow order */
  private mounds: Mesh[] = []
  private moundIdx = 0
  private revealed = false
  /** set the moment the dismantle/flatten starts — work beats stop here so a
   * late shovel beat can never re-grow a mound mid-flatten */
  private climaxed = false
  private rng: Rng = mulberry32(1)
  private skipHandler: (() => void) | null = null
  /** the live camera setup — update() re-feeds it to cineFollow every tick */
  private shot: Shot | null = null
  /** shot 1's drifting aim point (a slow push over the site) — killed on cuts */
  private aimDrift: Vector3 | null = null

  constructor(deps: ConstructionDeps) {
    this.deps = deps
    // letterbox unification: no private bar/fade DOM — everything cinematic
    // goes through the one Letterbox (shared with main's when provided)
    this.lb = deps.letterbox ?? new Letterbox()
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

  /** fixed-step crew brain: staggered road entrance, hello wave, posts AT the
   * work with humanized beats + breathers, the proud step-back, walk home */
  update(dt: number): void {
    const cur = this.current
    if (!cur) return
    // the scene owns the lens while it plays — re-feed the current shot every
    // tick so the close-up keeps tracking Gus as he works
    if (this.shot) {
      const s = this.shot
      this.deps.cam.cineFollow(this.resolveAim(s), s.yaw, s.pitch, s.dist, s.fov)
    }
    const site = cur.site
    const gone: CrewWorker[] = []
    for (const u of this.workers) {
      switch (u.state) {
        case 'waiting':
          // film entrance: each worker trails the previous by STAGGER
          u.t += dt
          if (u.t >= u.delay) {
            u.state = 'entering'
            this.play3(u, u.walk)
          }
          break
        case 'entering':
          if (this.step(u, u.greet, dt)) {
            // a quick hello toward the site before taking their post
            u.state = 'greeting'
            u.t = 0
            this.turn(u, Math.atan2(site.x - u.group.position.x, site.z - u.group.position.z))
            if (u.wave) u.wave.timeScale = 1
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
          // tools down once the dismantle starts — celebrate() collects them
          if (this.climaxed) break
          // breather: a 1.2s wave-stretch every 5th-7th beat (seeded), so the
          // crew reads as people pacing themselves, not metronomes
          if (u.breatherT > 0) {
            u.breatherT -= dt
            if (u.breatherT <= 0) this.play3(u, u.swingLeft ? u.punchL : u.punchR)
            break
          }
          u.beatT += dt
          if (u.beatT >= u.beatLen) {
            u.beatT -= u.beatLen
            this.deps.tickSfx?.(cur.dig === true)
            u.swingLeft = !u.swingLeft
            this.play3(u, u.swingLeft ? u.punchL : u.punchR)
            // every hit lands visually: the dressing flinches on the beat...
            this.pulseDressing()
            // ...dust kicks AT the work point...
            const at = u.workAt.clone()
            at.y += 0.5 + this.rng.next() * 0.6
            this.puff(at, 0.55 + this.rng.next() * 0.4, cur.dig ? '#8d7156' : '#9a9a92', 0.7)
            // ...and on digs, a mound visibly grows (seeded order)
            if (cur.dig) this.growMound()
            if (++u.beats >= u.nextBreather) {
              u.beats = 0
              u.nextBreather = 5 + Math.floor(this.rng.next() * 3)
              u.breatherT = BREATHER
              if (u.wave) {
                u.wave.timeScale = 1.6
                this.play3(u, u.wave)
              }
            }
          }
          break
        }
        case 'stepback':
          if (this.step(u, u.back, dt)) {
            // the proud moment: face what they built and wave it home
            u.state = 'proud'
            this.turn(u, Math.atan2(site.x - u.group.position.x, site.z - u.group.position.z))
            if (u.wave) u.wave.timeScale = 1
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
    this.climaxed = false
    // deterministic per site — same deed always builds the same little scene
    const seed =
      ((Math.round(opts.site.x * 8) * 73856093) ^
        (Math.round(opts.site.z * 8) * 19349663) ^
        (Math.round(opts.footprint.w * 16) * 83492791)) >>>
      0
    this.rng = mulberry32(seed)

    // set dressing: staged scaffold for builds, dirt mounds for digs
    let workSpots: Vector3[] = []
    const cos = Math.cos(opts.yaw)
    const sin = Math.sin(opts.yaw)
    let dressing: Group
    if (opts.dig) {
      const res = makeMounds(opts.footprint.w, opts.footprint.d, this.rng)
      dressing = res.group
      // mounds start as small spade marks and GROW on the shovel beats
      for (const m of res.mounds) m.scale.setScalar(0.2)
      // crew posts at the first mounds (creation order); grow order is a
      // separate seeded shuffle so the dig builds up around the whole site
      workSpots = res.spots.map(
        (p) => new Vector3(opts.site.x + p.x * cos + p.z * sin, opts.site.y, opts.site.z - p.x * sin + p.z * cos),
      )
      this.mounds = res.mounds
      for (let i = this.mounds.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng.next() * (i + 1))
        ;[this.mounds[i], this.mounds[j]] = [this.mounds[j], this.mounds[i]]
      }
      this.moundIdx = 0
      this.stages = []
    } else {
      const res = buildScaffoldStaged(opts.footprint.w, opts.footprint.d, Math.floor(this.rng.next() * 0xffffffff))
      dressing = res.root
      this.stages = res.stages
      this.mounds = []
    }
    dressing.position.copy(opts.site)
    dressing.rotation.y = opts.yaw
    this.deps.scene.add(dressing)
    this.dressing = dressing

    const crewN = (opts.cost ?? 0) >= 400 ? 3 : 2
    this.spawnCrew(opts, crewN, workSpots)
    this.lb.show(crewN >= 3 ? 'Gus, Wren & Bram on the job — tap to skip' : 'Gus & Wren on the job — tap to skip')

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

    // duration scales with what the thing COST — pricier projects earn a
    // longer ceremony, with the extra time spent in the work phase
    const cost = opts.cost ?? 0
    const dur = Math.max(3, opts.duration ?? (cost >= 400 ? 12.5 : cost >= 150 ? 10 : 8.5))
    const climax = Math.max(1.2, dur - 2.6)
    const workStart = Math.min(3.0, climax * 0.5)
    const workDur = climax - workStart

    // ---- three-shot grammar ---------------------------------------------------
    // Shot 1: establishing wide, opening slightly low toward the road (where
    // the crew enters) with ONE slow push over the build. Hard CUT in (film
    // grammar) — easing there could drag the camera through farm buildings.
    const siteA = opts.site.clone().add(new Vector3(0.5, 0.3, 0.75))
    const siteB = opts.site.clone().add(new Vector3(-0.1, 0.85, -0.15))
    this.aimDrift = siteA.clone()
    this.setShot({ aim: this.aimDrift, pitch: 0.46, dist: 11.5, fov: 46 })
    // Shot 2: close-up tracking worker0 (Gus) at work. Shot 3: reveal wide.
    // Short scenes (explicit tiny durations) degrade gracefully to fewer cuts.
    const cut1 = Math.min(3.2, climax * 0.55)
    const useShot2 = climax - cut1 > 1.2
    const cut2 = climax - 0.4
    const useShot3 = useShot2 && cut2 - cut1 > 1.0

    const tl = gsap.timeline()
    tl.call(
      () => {
        if (this.aimDrift) {
          gsap.to(this.aimDrift, {
            x: siteB.x,
            y: siteB.y,
            z: siteB.z,
            duration: Math.max(1.2, (useShot2 ? cut1 : climax) - 0.4),
            ease: 'power2.inOut',
          })
        }
      },
      undefined,
      0.2,
    )
    if (useShot2) {
      // CUT = dip to black (0.18s), swap the shot mid-black, fade up (0.3s)
      tl.call(() => this.lb.fade(true, 0.18), undefined, Math.max(0.2, cut1 - 0.18))
      tl.call(
        () => {
          this.setShot({ aim: 'worker0', pitch: 0.3, dist: 4.6, fov: 44 })
          this.lb.fade(false, 0.3)
        },
        undefined,
        cut1,
      )
    }
    // builds rise in stages while the crew hammers (digs grow on the beats)
    if (!opts.dig) {
      for (let k = 0; k < 3; k++) {
        tl.call(() => this.raiseStage(k), undefined, workStart + (0.15 + 0.3 * k) * workDur)
      }
    }
    if (useShot3) {
      tl.call(() => this.lb.fade(true, 0.18), undefined, cut2 - 0.18)
      tl.call(
        () => {
          this.setShot({ aim: opts.site.clone().add(new Vector3(0, 0.7, 0)), pitch: 0.5, dist: 10.5, fov: 46 })
          this.lb.fade(false, 0.3)
        },
        undefined,
        cut2,
      )
    }
    // the money moment: scaffold dismantles / mounds flatten under dust...
    tl.call(() => this.climaxFx(), undefined, climax)
    // ...and the real thing appears behind the dust skirt
    tl.call(() => this.fireReveal(), undefined, Math.min(dur - 0.2, climax + 0.25))
    tl.call(() => this.celebrate(), undefined, Math.min(dur - 0.15, climax + 0.55))
    tl.call(
      () => {
        this.lb.hide()
        if (this.aimDrift) gsap.killTweensOf(this.aimDrift)
        this.aimDrift = null
        this.shot = null
        this.deps.cam.cineFollow(null)
      },
      undefined,
      Math.min(dur - 0.1, climax + 0.9),
    )
    tl.call(() => this.beginExit(), undefined, Math.min(dur - 0.05, climax + 1.9))
    tl.call(() => this.finish(), undefined, dur)
    this.tl = tl
  }

  // ---- camera shots ------------------------------------------------------------

  /** hard cut to a new shot — update() keeps re-feeding it every tick */
  private setShot(shot: Shot): void {
    this.shot = shot
    this.deps.cam.cineFollow(this.resolveAim(shot), shot.yaw, shot.pitch, shot.dist, shot.fov)
    this.deps.cam.cineCut()
  }

  private resolveAim(shot: Shot): Vector3 {
    if (shot.aim !== 'worker0') return shot.aim
    const u = this.workers[0]
    if (u) return AIM.copy(u.group.position).add(HEAD)
    const site = this.current?.site
    return site ? AIM.copy(site).setY(site.y + 1.2) : AIM.set(0, 1.2, 0)
  }

  // ---- the work -----------------------------------------------------------------

  /** a scaffold stage pops up out of the work: stage 0 settles, stages 1-2
   * rise from the ground, all under a burst of dust + an accented hit (two
   * jittered hammer layers sum louder than one) */
  private raiseStage(k: number): void {
    const opts = this.current
    const st = this.stages[k]
    if (!opts || !st || this.revealed) return
    gsap.killTweensOf(st.scale)
    if (k === 0) {
      st.scale.y = 0.86
      gsap.to(st.scale, { y: 1, duration: 0.35, ease: 'back.out(1.3)' })
    } else {
      gsap.to(st.scale, { y: 1, duration: 0.35, ease: 'back.out(1.3)' })
    }
    this.deps.tickSfx?.(false)
    this.deps.tickSfx?.(false)
    const cos = Math.cos(opts.yaw)
    const sin = Math.sin(opts.yaw)
    const rx = opts.footprint.w / 2 + 0.35
    const rz = opts.footprint.d / 2 + 0.35
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + this.rng.next() * 0.7
      const lx = Math.cos(a) * rx
      const lz = Math.sin(a) * rz
      const at = new Vector3(
        opts.site.x + lx * cos + lz * sin,
        opts.site.y + 0.5 + this.rng.next() * 0.6,
        opts.site.z - lx * sin + lz * cos,
      )
      this.puff(at, 0.6 + this.rng.next() * 0.4, '#9a9a92', 0.7)
    }
  }

  /** one shovel beat = one mound visibly grows (seeded rotation through the
   * set, each pop +0.18 toward full size) */
  private growMound(): void {
    const n = this.mounds.length
    if (!n) return
    for (let tries = 0; tries < n; tries++) {
      const m = this.mounds[this.moundIdx % n]
      this.moundIdx++
      if (m.scale.x < 0.999) {
        const s = Math.min(1, m.scale.x + 0.18)
        gsap.killTweensOf(m.scale)
        gsap.to(m.scale, { x: s, y: s, z: s, duration: 0.26, ease: 'back.out(1.7)' })
        return
      }
    }
  }

  /** climax: the scaffold is DISMANTLED — reverse pops, top stage first,
   * staggered 0.1s (it never sinks into the earth); dig mounds flatten. A big
   * dust skirt around the footprint hides the building's pop-in. */
  private climaxFx(): void {
    const opts = this.current
    if (!opts) return
    this.climaxed = true
    // tools down: hammering a scaffold that is coming apart reads wrong
    for (const u of this.workers) {
      if (u.state === 'working') this.play3(u, u.idle ?? u.current)
    }
    const d = this.dressing
    if (d && this.stages.length) {
      const n = this.stages.length
      this.stages.forEach((st, i) => {
        gsap.killTweensOf(st.scale)
        gsap.to(st.scale, {
          y: 0.01,
          duration: 0.12,
          ease: 'power2.in',
          delay: (n - 1 - i) * 0.1,
          // the bottom stage pops last — its tween retires the whole prop
          onComplete:
            i === 0
              ? () => {
                  this.deps.scene.remove(d)
                  if (this.dressing === d) this.dressing = null
                }
              : undefined,
        })
      })
    } else if (d && this.mounds.length) {
      const last = this.mounds.length - 1
      this.mounds.forEach((m, i) => {
        gsap.killTweensOf(m.scale)
        gsap.to(m.scale, {
          y: 0.05,
          duration: 0.3,
          ease: 'power2.in',
          delay: i * 0.05,
          onComplete:
            i === last
              ? () => {
                  this.deps.scene.remove(d)
                  if (this.dressing === d) this.dressing = null
                }
              : undefined,
        })
      })
    }
    // ring of dust around the footprint edge hides the swap
    const cos = Math.cos(opts.yaw)
    const sin = Math.sin(opts.yaw)
    const rx = opts.footprint.w / 2 + 0.35
    const rz = opts.footprint.d / 2 + 0.35
    const color = opts.dig ? '#8d7156' : '#a8a49a'
    // MANY small puffs read as a rolling dust skirt; a few big ones read as
    // balloons — count up, size down
    const n = 20 + Math.floor(this.rng.next() * 7)
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

  /** hand the spot back to the caller — exactly once, even when a skip
   * fast-forwards every timeline call in the same tick */
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

  /** teardown: kill every dressing/crew/camera tween, letterbox cleared (no
   * stranded black), crew off, callbacks out, next queued scene in — the skip
   * path lands here in the same tick with nothing left animating */
  private finish(): void {
    if (!this.current) return
    if (this.skipHandler) {
      window.removeEventListener('pointerdown', this.skipHandler, { capture: true })
      this.skipHandler = null
    }
    // a skip can land mid-pulse, mid-raise or mid-dismantle — kill them all
    for (const st of this.stages) gsap.killTweensOf(st.scale)
    for (const m of this.mounds) gsap.killTweensOf(m.scale)
    this.stages = []
    this.mounds = []
    if (this.dressing) {
      gsap.killTweensOf(this.dressing.scale)
      gsap.killTweensOf(this.dressing.position)
      this.deps.scene.remove(this.dressing)
      this.dressing = null
    }
    // skip path may land here mid-shot or mid-cut: drop the shot, clear bars
    // AND any black fade through the shared letterbox
    if (this.aimDrift) {
      gsap.killTweensOf(this.aimDrift)
      this.aimDrift = null
    }
    this.shot = null
    this.deps.cam.cineFollow(null)
    this.lb.hide()
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

  /** the named crew enters from the ROAD side (world +z of the site),
   * staggered, greets, then splits to posts AT the work — scaffold corners on
   * builds, dirt mounds on digs. Each worker gets a distinct height, a 30%
   * wardrobe tint, a hand tool (when the rig has a hand bone) and humanized
   * beat timing. */
  private spawnCrew(opts: ConstructionJob, crewN: number, workSpots: Vector3[]): void {
    const cos = Math.cos(opts.yaw)
    const sin = Math.sin(opts.yaw)
    const toWorld = (lx: number, lz: number): Vector3 =>
      new Vector3(opts.site.x + lx * cos + lz * sin, opts.site.y, opts.site.z - lx * sin + lz * cos)
    /** scaffold-corner assignments: opposite corners first, third up the back */
    const corners: Array<[number, number]> = [
      [1, 1],
      [-1, -1],
      [-1, 1],
    ]
    // approach: from the site toward z+6, clamped so big footprints don't
    // push the spawn into the next county
    const enterDist = Math.min(6, Math.max(4, opts.footprint.d / 2 + 3.4))
    for (let i = 0; i < crewN; i++) {
      const spec = CREW[Math.min(i, CREW.length - 1)]
      const g = this.deps.assets.spawnSkinned('customerA')
      normalizeHeight(g, spec.h)
      // distinct look: spawnSkinned already gives this clone unique materials,
      // so the tint never bleeds into customers using the same GLB
      const tint = new Color(spec.tint)
      g.traverse((o) => {
        if (o instanceof Mesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          for (const m of mats) if (m instanceof MeshStandardMaterial) m.color.lerp(tint, 0.3)
        }
      })
      // posts AT the work: a mound each on digs, a scaffold corner on builds
      let workAt: Vector3
      let post: Vector3
      const spot = opts.dig ? workSpots[i] : undefined
      if (spot) {
        workAt = spot
        const out = spot.clone().sub(opts.site).setY(0)
        if (out.lengthSq() < 0.09) out.set(sin, 0, cos) // center mound: stand off-axis
        post = spot.clone().add(out.normalize().multiplyScalar(0.55))
      } else {
        const [sx, sz] = corners[i % corners.length]
        workAt = toWorld(sx * (opts.footprint.w / 2 + 0.35), sz * (opts.footprint.d / 2 + 0.35))
        post = toWorld(sx * (opts.footprint.w / 2 + 0.7), sz * (opts.footprint.d / 2 + 0.7))
      }
      const side = i === 0 ? 1 : i === 1 ? -1 : 0
      const spawn = new Vector3(opts.site.x + side * 0.55, opts.site.y, opts.site.z + enterDist)
      const greet = new Vector3(
        opts.site.x + side * 0.85,
        opts.site.y,
        opts.site.z + opts.footprint.d / 2 + 1.35 + (i === 2 ? 0.5 : 0),
      )
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
        workAt,
        faceYaw: Math.atan2(workAt.x - post.x, workAt.z - post.z),
        state: 'waiting',
        delay: i * STAGGER,
        t: 0,
        beatLen: 0.9,
        beatT: 0,
        swingLeft: true,
        beats: 0,
        nextBreather: 5 + Math.floor(this.rng.next() * 3),
        breatherT: 0,
      }
      // humanized timing: the punch clip sets the swing length, then each
      // worker drifts ±9% with a seeded phase offset — never a metronome row
      const swing = u.punchL?.getClip()
      const clipDur = swing && swing.duration > 0.3 ? swing.duration : 0.9
      u.beatLen = clipDur * (0.92 + this.rng.next() * 0.18)
      u.beatT = -this.rng.next() * u.beatLen
      if (u.walk) u.walk.timeScale = WALK_SPEED / WALK_REF
      if (u.idle) {
        u.idle.play()
        u.current = u.idle
      }
      // the right tool for the job, feature-detected: hammer on builds,
      // shovel on digs — silently propless when the rig has no hand bone
      this.attachTool(u, opts.dig === true)
      this.workers.push(u)
    }
  }

  /** parent a tool to the right hand bone, compensating the bone's world
   * scale so the prop keeps its authored world size. No bone → no prop, no
   * error (the scene must always play). */
  private attachTool(u: CrewWorker, dig: boolean): void {
    const bone = rightHandBone(u.group)
    if (!bone) return
    const tool = (dig ? shovelProto() : hammerProto()).clone()
    u.group.updateMatrixWorld(true)
    const ws = bone.getWorldScale(new Vector3()) // spawn-time only, no per-tick alloc
    const s = ws.x > 1e-6 ? 1 / ws.x : 1
    tool.scale.setScalar(s)
    tool.rotation.x = dig ? 0.5 : 0.3 // tip forward out of the fist a touch
    bone.add(tool)
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

  /** work-beat impact pulse: the dressing flinches 3% and settles in 120ms */
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
}
