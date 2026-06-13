/** Sunrise Farm — third-person diner-style boot + wiring.
 * You WALK the farm: joystick/WASD drives the farmer, actions fire by
 * proximity (walk into a ripe plot to harvest, walk to the hen to feed,
 * walk to the stand to serve customers). Hard rules honored: game logic
 * runs only on the fixed-step engine clock (no setTimeout, no tween-
 * completion gating); gsap is re-rooted on the engine clock; slow-mo is a
 * presentation-layer dip on rare events. */
import gsap from 'gsap'
import {
  ACESFilmicToneMapping,
  Box3,
  BoxGeometry,
  Color,
  CylinderGeometry,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  Raycaster,
  Scene,
  SkinnedMesh,
  Vector3,
  WebGLRenderer,
} from 'three'
import { BloomEffect, EffectComposer, EffectPass, GodRaysEffect, RenderPass, VignetteEffect } from 'postprocessing'
import { Music } from './audio/music'
import { Sfx } from './audio/sfx'
import { Engine } from './engine/Engine'
import {
  CROPS,
  fountainCount,
  GREENHOUSE_CROPS,
  HERD_COOLDOWN,
  HERD_FIRST_DELAY,
  splitCoins,
  TRACTOR_COOLDOWN,
  xpNeeded,
  type CropKind,
  type GoodKind,
} from './game/economy'
import { Customers } from './game/customers'
import { DECOR, decorDef, DECOR_MAX, type DecorId } from './game/decor'
import { blockByEdges, encodeEdge, FENCE_STYLES, nearestEdge, toSets, toState } from './game/fence'
import { Game, type Suggestion } from './game/Game'
import {
  canPlace,
  DEFAULT_PLACES,
  deliveryRoute,
  fieldPlotsFor,
  fieldTierOf,
  footprintOf,
  layoutView,
  paddockRect,
  fenceEdgeAllowed,
  penRect,
  PLACE_IDS,
  pointInBuilding,
  placeOf,
  setPlace,
  type PlaceCheck,
  type PlaceId,
} from './game/layout'
import { FenceEditor } from './ui/fenceEditor'
import { CarrySystem, snapToGrid } from './world/carry'
import { DecorSet } from './world/decorSet'
import { catchUp, deserialize, initialState, SAVE_KEY, serialize, type GameState } from './game/state'
import { Joystick } from './input/joystick'
import { Hud, type ActionDef } from './ui/hud'
import { Assets } from './world/assets'
import { ChickenView } from './world/Chicken'
import { CustomerView } from './world/Customer'
import { DogView } from './world/Dog'
import { FollowCamera } from './world/FollowCamera'
import { camBoxFromRect } from './world/cameraMath'
import { heartBurst, sparkleBurst } from './world/fx'
import { AmbientLife } from './world/fxAmbient'
import { PlayerView } from './world/Player'
import { PlotView } from './world/Plot'
import {
  bindLayout,
  bindParcels,
  buildClouds,
  repaintGround,
  buildDeedSign,
  buildOrderBoard,
  buildGround,
  buildLights,
  buildMeadow,
  buildFenceEdges,
  buildSky,
  buildStand,
  buildPen,
  CRATE_POS,
  DOG_HOME,
  groundClear,
  MARKET,
  marketToShop,
  marketToStand,
  NEST_POS,
  OCCLUDERS,
  PLAYER_SPAWN,
  WORLD_BOUNDS,
} from './world/scenery'
import { BARN_AT, BARN_ROT, worldMaxX } from './game/geo'
import { keeperName, tomorrowLines } from './game/tomorrow'
import { busWindow, busWindowPm, nextTownAct, recessNow, TOWN_ACTS, woolMult } from './game/town'
import { nextGoal } from './game/goals'
import {
  availableUpgrades,
  canRideHazel,
  greenhouseBeds,
  marketPremiumBonus,
  marketQueueBonus,
  pastureGoatBonus,
  pastureSheepBonus,
  upgradeDef,
  type UpgradeId,
} from './game/upgrades'
import { RideRig } from './world/riding'
import { TownSet } from './world/townSet'
import { fieldParcel, sheepCount, type TierDef } from './game/expansion'
import { orderFor } from './game/orders'
import {
  availableProjects,
  SHOP_PREMIUM,
  SHOP_QUEUE_MAX,
  type ProjectDef,
  type ProjectId,
} from './game/projects'
import { buildField } from './world/field'
import { TractorView } from './world/Tractor'
import { Flock } from './world/Sheep'
import { Grazers } from './world/animals'
import { buildGreenhouse, buildShop, buildStable } from './world/buildings'
import { Construction, Letterbox } from './world/cutscene'
import { DayCycle } from './world/daycycle'
import { CoopInterior } from './world/coopInterior'
import { STABLE_ANCHOR, StableInterior } from './world/stableInterior'
import { FarmhouseInterior } from './world/farmhouseInterior'
import { GreenhouseInterior } from './world/greenhouseInterior'
import { Homestead } from './world/homestead'
import { HomeInterior } from './world/interior'
import { NightSky } from './world/nightsky'
import { normalizeHeight } from './world/scale'
import {
  COOP_COIN_PER_HEN,
  DELIVERY_RUN_TIME,
  MILK_COIN_PER_GOAT,
  WOOL_COIN_PER_SHEEP,
} from './game/produce'
import { HEN_CAPACITY, henCost, MAX_COOP_TIER, WING_COST, WING_LEVEL, type CoopFlock } from './game/henhouse'
import { buildCoopAnnex, buildCoopHouse, CoopHens } from './world/coop'
import { AnimationMixer, type AnimationAction } from 'three'

// a boot that dies must CONFESS: headless consoles and some WebViews
// swallow unhandled async rejections, and a silent 'loading 54/54' freeze
// is undebuggable from a phone (cost us an hour in QA)
addEventListener('unhandledrejection', (e) => {
  const r = (e as PromiseRejectionEvent).reason as Error | undefined
  console.error('[boot-failure]', r?.stack ?? String(r))
})

const HEN_NAMES = ['Henrietta', 'Clucky', 'Pearl', 'Butterscotch', 'Nugget', 'Daisy', 'Pepper', 'Marigold']

/** every walk-in room (the registry in boot() holds each room's door,
 * bounds, camera volume and occluder shell) */
type RoomId = 'gh' | 'coop' | 'stable' | 'home'
const PLACE_NAMES: Record<PlaceId, string> = {
  stand: 'the Stand',
  shop: 'the Shop',
  coop: 'the Coop',
  stable: 'the Stable',
  greenhouse: 'the Greenhouse',
  tractor: 'the Tractor',
  pen: 'the Sheep Pen',
  field0: 'the Home Field',
  field1: 'the East Meadow field',
  field2: 'the Far East field',
  field3: 'the Old Pasture field',
  field5: "Old Tom's Field",
  field6: 'the Birch Field',
}
const GOOD_EMOJI: Record<GoodKind, string> = {
  wheat: '\u{1F33E}',
  corn: '\u{1F33D}',
  tomato: '\u{1F345}',
  pepper: '\u{1FAD1}',
  eggplant: '\u{1F346}',
  egg: '\u{1F95A}',
}

// interaction radii (diner grammar: you go to it)
const PLOT_R = 2.1
const CHICK_R = 2.4
const CRATE_R = 2.6
const STAND_R = 2.9
const AUTOPLANT_AFTER = 1.5

declare global {
  interface Window {
    __farm: {
      state: () => GameState
      give: (n: number) => void
      step: (s: number) => void
      wipe: () => void
      pos: () => [number, number]
      dogPos: () => [number, number, number]
      henPos: () => [number, number, number]
      sheep: () => Array<[number, number, string]>
      escape: () => number
      grazers: () => Array<[number, number]>
      music: () => Music['debug']
      musicUnlock: () => void
      sleepStart: (pause?: boolean) => void
      sleepSeek: (s: number) => void
      dusk: () => void
      interiorProbe: () => Array<{ name: string; x: number; y: number; z: number; vis: boolean }>
      sheet: (n?: number, stepS?: number) => number
      sheetOff: () => void
      camProbe: () => Record<string, unknown>
      ray: (nx: number, ny: number) => Array<{ d: number; n: number | undefined; name: string }>
      draws: () => number
      perf: () => { calls: number; tris: number; dpr: number; frameMs: number; fps: number }
      meshes: () => Array<{ name: string; tris: number; inst: number }>
      warp: (x: number, z: number) => void
      lookYaw: (y: number) => void
      fence: (x0: number, z0: number, x1: number, z1: number) => number
      unfence: (x: number, z: number) => boolean
      fences: () => number
      editor: {
        open: () => boolean
        close: () => void
        draw: (ax: number, az: number, bx: number, bz: number) => number
        remove: (x: number, z: number) => boolean
        gate: (x: number, z: number) => boolean
        active: () => boolean
      }
      lift: (id: string) => boolean
      placeAt: (x: number, z: number) => boolean
      carry: () => { id: string; ghost: [number, number]; ok: boolean } | null
      layout: () => Record<string, { x: number; z: number }>
      actions: () => string[]
      act: (id: string) => void
      room: { enter: (which: RoomId) => void; exit: (which: RoomId) => void; which: () => RoomId | null }
      flock: () => CoopFlock
      cam: () => ReturnType<FollowCamera['probe']>
      camMat: () => Record<string, unknown>
      town: () => GameState['town']
    }
    __step: (s: number) => void
  }
}

async function boot(): Promise<void> {
  // ---- loading veil -----------------------------------------------------
  const veil = document.createElement('div')
  veil.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'background:#87b86a;color:#fff;font:800 28px Trebuchet MS,sans-serif;z-index:99;gap:10px'
  veil.innerHTML = '<div>🌻 Sunrise Farm</div><div id="ldp" style="font-size:15px;font-weight:700">loading…</div>'
  document.body.appendChild(veil)

  // phones get a lighter pipeline: lower DPR cap, no MSAA, cheaper god rays —
  // the owner's device reported lag and post-processing is the big lever
  const isCoarse = matchMedia('(pointer: coarse)').matches
  const renderer = new WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance' })
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  // the shadow map redraws on OUR schedule (every other frame — the sun
  // crawls, nobody can see a 33ms-stale shadow), not every frame
  renderer.shadowMap.autoUpdate = false
  // ADAPTIVE resolution (the smooth-fps pass, repaired by the 2026-06-12
  // perf audit): start sharp-ish, ease down when frame time misses budget.
  // The old coarse ceiling of 2.2 was HIGHER than desktop's — every post
  // pass paid ~40% more fragments than needed on the very devices that
  // struggle. Boot 1.6 with headroom to 1.8 stays above the flat 1.5 cap
  // the owner once clocked as 'lost quality'; on a 460ppi panel at arm's
  // length the difference is at visual acuity in motion.
  const DPR_MAX = Math.min(devicePixelRatio, isCoarse ? 1.8 : 2)
  const DPR_MIN = isCoarse ? 1.1 : 1.5
  let dpr = Math.min(devicePixelRatio, isCoarse ? 1.6 : 2)
  renderer.setPixelRatio(dpr)
  document.body.appendChild(renderer.domElement)

  const scene = new Scene()
  const cam = new FollowCamera(renderer.domElement, PLAYER_SPAWN)
  // displacement-based camera look-ahead (see the onFrame block): reset
  // alongside every player teleport or the first frame computes a huge jump
  /** occlusion-hull material: the proxy OBJECT is invisible (renderer
   * skips it) while the raycaster — which ignores object.visible — still
   * hits it. Material stays default-visible or Mesh.raycast would bail. */
  const OCC_PROXY_MAT = new MeshBasicMaterial()
  const lastCamPos = PLAYER_SPAWN.clone()
  const camDispVel = new Vector3()
  /** look-ahead velocity, LOW-PASSED. The player moves on the fixed 60Hz step
   * while the camera follows at render rate, so the raw per-frame displacement
   * alternates 0 / 1x / 2x as steps land between frames — feeding that jagged
   * value to the look-ahead made the camera shake when running. Smoothing it
   * into a steady velocity fixes the shake without touching the orbit feel. */
  const camVelSmooth = new Vector3()
  /** first-person collapse: lens pressed into the farmer = he fades out */
  let playerGhost = false
  const camHead = new Vector3()

  // warm ACES grade; the effect pass (god rays + bloom + vignette) is added
  // after the sky exists — god rays need the sun disk as a light source
  const composer = new EffectComposer(renderer, { multisampling: isCoarse ? 0 : 4 })
  composer.addPass(new RenderPass(scene, cam.camera))
  // manual info reset: the composer runs multiple passes per frame and
  // autoReset would hide the real draw-call total from the dev driver
  renderer.info.autoReset = false
  const engine = new Engine((dt) => {
    renderer.info.reset()
    composer.render(dt)
  })

  // gsap re-rooted on the engine clock: tweens advance only when the engine
  // does, so __farm.step() fast-forwards visuals deterministically too.
  gsap.ticker.remove(gsap.updateRoot)
  engine.onFrame(() => gsap.updateRoot(engine.uTime.value))

  const assets = new Assets()
  const ldp = veil.querySelector('#ldp')!
  await assets.loadAll((d, t) => (ldp.textContent = `loading ${d}/${t}`))

  // ---- state first (scenery is tier-aware) --------------------------------
  const rawSave = localStorage.getItem(SAVE_KEY)
  const loaded = deserialize(rawSave)
  // a save that EXISTS but no longer parses is rescued, never clobbered: the
  // autosave would otherwise overwrite a farm a bad update failed to read.
  // The copy keeps the original recoverable (manually, or by a future fix).
  if (rawSave && !loaded) localStorage.setItem(`${SAVE_KEY}.rescue`, rawSave)
  const state = loaded ?? initialState((Math.random() * 0xffffffff) >>> 0)
  const offline = loaded ? catchUp(state, (Date.now() - loaded.savedAt) / 1000) : null
  // a save that just took the one-time farmhand-retirement migration (refund +
  // flag) must be flushed at boot — an iOS kill before the first action/pagehide
  // would otherwise re-run the refund on the next cold open (double-pay). Detect
  // it from the PRE-migration raw save (loaded ⟹ rawSave parsed cleanly).
  const migrationFlush = !!loaded && !!rawSave && !(JSON.parse(rawSave) as { farmhandRetired?: boolean }).farmhandRetired
  const game = new Game(state)
  // the saved LAYOUT drives where everything stands — scenery's ground art,
  // exclusion zones, and every anchor below resolve through it
  bindLayout(layoutView(state))
  // the endless crop field's exclusion zones + fallow beds read the parcel count
  bindParcels(state.fieldParcels)
  if (!state.projects.shop) marketToStand(placeOf(state, 'stand'))

  const lights = buildLights(scene)
  const sky = buildSky(scene)
  // the sun walks the sky: dawn -> noon -> golden hour, then PARKS at dusk
  // until the farmer goes to bed (the sleep ritual starts the next day).
  // The hour persists: reload picks up where the sun left off.
  const dayCycle = new DayCycle(
    { ...lights, dome: sky.dome, sunDisk: sky.sunDisk, scene },
    { startPhase: state.dayPhase },
  )
  const nightSky = new NightSky(scene)
  const homestead = new Homestead(scene)
  // the family-dinner film set, parked far off-world until the scene cuts in
  const homeInterior = new HomeInterior(scene, assets)
  // the WALKABLE glasshouse set — small shed outside, a whole building inside
  const ghInterior = new GreenhouseInterior(scene)
  // the HENHOUSE set — the coop's walk-in hall, same trick, opposite corner.
  // Each room's shell joins OCCLUDERS only while the player is INSIDE it
  // (the door swap handles both): idle off-world sets must never tax the
  // camera's per-frame occlusion raycast.
  const coopInterior = new CoopInterior(scene)
  // the STABLE hall — Hazel's house; her stall mirrors the delivery state
  const stableInterior = new StableInterior(scene, assets)
  // the FARMHOUSE by day — the family's room, the dusk supper untouched
  const farmhouseInterior = new FarmhouseInterior(scene, assets)
  // MILLBROOK: the town the farm builds, living scenery east of the gate
  const townSet = new TownSet(scene, assets)
  /** which walk-in room the player is inside (null = out on the farm).
   * ANY-room gates read `room !== null`, room-specific verbs read
   * `room === 'coop'` — a new room inherits every gate for free. */
  let room: RoomId | null = null
  composer.addPass(
    new EffectPass(
      cam.camera,
      new GodRaysEffect(cam.camera, sky.sunDisk, {
        density: 0.96,
        decay: 0.93,
        weight: 0.25,
        samples: isCoarse ? 12 : 32,
        resolutionScale: isCoarse ? 0.3 : 0.5,
      }),
      // phones: half-res luminance + 5 mip levels — the outer mips blur to
      // a halo wider than a 6-inch screen resolves, and bloom was the one
      // effect that never had a coarse tier (the perf audit's #2 GPU cost)
      new BloomEffect({
        intensity: 0.42,
        luminanceThreshold: 0.82,
        mipmapBlur: true,
        levels: isCoarse ? 5 : 8,
        resolutionScale: isCoarse ? 0.5 : 1,
      }),
      new VignetteEffect({ darkness: 0.3, offset: 0.26 }),
    ),
  )
  buildGround(scene)
  const { grass, forest } = buildMeadow(scene, assets)
  // level one starts from SCRATCH: the stand exists only once its project is
  // built (and the Farm Shop later replaces it)
  let standGroup: Group | null =
    state.projects.shop || !state.projects.stand ? null : buildStand(scene, assets)
  if (standGroup) OCCLUDERS.push(standGroup)
  let fenceMesh: Mesh | null = null // built once the fence edge-set loads below
  /** each owned crop-field parcel's soil slab, keyed by parcel index. The
   * field is a FIXED place out east now — slabs are not movable; each land
   * deed simply drops the next one in (see expandCeremony). */
  const fieldGroups = new Map<number, Group>()
  for (let n = 0; n < state.fieldParcels; n++) {
    const parcel = fieldParcel(n)
    const g = buildField(parcel.rect, parcel.plots, 0x6011 + n * 97)
    scene.add(g)
    fieldGroups.set(n, g)
  }
  const clouds = buildClouds(scene)
  const ambient = new AmbientLife(scene)
  const sfx = new Sfx()
  const music = new Music()
  const hud = new Hud()
  hud.mountMusicToggle(music.isMuted, (m) => music.setMuted(m))
  hud.mountFullscreenToggle()
  // ONE stick: LEFT walks the farmer (+WASD). The camera is direct-drag —
  // mouse on desktop, the free thumb anywhere on the world on touch.
  const joy = new Joystick({ side: 'left', keyboard: true })

  // the camera refuses to hide behind buildings: raycast focus -> camera
  // against everything registered in OCCLUDERS and pull in front of hits
  const occlRay = new Raycaster()
  const occlDir = new Vector3()
  cam.occlusionTest = (focus, camPos) => {
    occlDir.subVectors(camPos, focus)
    const len = occlDir.length()
    if (len < 0.6 || OCCLUDERS.length === 0) return null
    occlRay.set(focus, occlDir.normalize())
    occlRay.far = len
    const hits = occlRay.intersectObjects(OCCLUDERS, true)
    return hits.length > 0 ? hits[0].distance : null
  }

  const mkPlot = (px: number, pz: number, compact = false): PlotView => {
    const v = new PlotView(assets, new Vector3(px, 0, pz), scene, compact)
    scene.add(v.group)
    return v
  }
  // view order mirrors Game's combined index space: field plots, then
  // greenhouse planters (always at the tail so expansions insert BEFORE them)
  const plots = fieldPlotsFor(state).map(([px, pz]) => mkPlot(px, pz))
  // greenhouse planters live INSIDE the walkable glasshouse set — only as many
  // as the greenhouse owns (8, or 12 once the "Bigger Greenhouse" wing is up)
  if (state.projects.greenhouse) {
    const nb = greenhouseBeds(state)
    for (let i = 0; i < nb; i++) plots.push(mkPlot(ghInterior.bedPositions[i].x, ghInterior.bedPositions[i].z, true))
    if (nb >= 12) ghInterior.revealWing()
  }
  // the home renovation shows on boot if it's been bought
  if (state.upgrades.homereno) farmhouseInterior.setRenovated(true)
  if (state.upgrades.tackroom) stableInterior.setTackRoom(true)
  const lastGlow: Array<'none' | 'shimmer' | 'ready'> = plots.map(() => 'none')

  /** free GPU resources of a removed object tree (textures included) */
  const disposeMaterials = (root: Group | Mesh): void => {
    root.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose()
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) {
          if (m instanceof MeshStandardMaterial && m.map) m.map.dispose()
          m.dispose()
        }
      }
    })
  }

  // ---- land deeds + tractor -------------------------------------------------
  const tractorPlace = placeOf(state, 'tractor')
  const TRACTOR_SPOT = { pos: new Vector3(tractorPlace.x, 0, tractorPlace.z), yaw: tractorPlace.yaw }
  // the tractor is earned once the crop field is worth sowing all at once — the
  // 3rd parcel (≈ the old expansion-2 timing, so existing saves keep theirs)
  let tractor: TractorView | null = state.fieldParcels >= 3 ? new TractorView(scene, TRACTOR_SPOT.pos, TRACTOR_SPOT.yaw) : null
  let sowCooldown = state.timers.sow
  let deedSign: { group: ReturnType<typeof buildDeedSign>; at: Vector3 } | null = null
  const placeDeedSign = (): void => {
    if (deedSign) {
      scene.remove(deedSign.group)
      disposeMaterials(deedSign.group)
      deedSign = null
    }
    const def = game.nextDeed()
    if (!def?.sign) return
    const group = buildDeedSign(def.name, def.cost)
    group.position.set(def.sign[0], 0, def.sign[1])
    group.rotation.y = Math.atan2(PLAYER_SPAWN.x - def.sign[0], PLAYER_SPAWN.z - def.sign[1])
    scene.add(group)
    deedSign = { group, at: new Vector3(def.sign[0], 0, def.sign[1]) }
  }
  placeDeedSign()
  const chicken = new ChickenView(assets, scene, NEST_POS, CRATE_POS, state.chicken.seed)
  const dog = new DogView(assets, scene, DOG_HOME)
  dog.onBark = () => sfx.bark()
  // the flock exists only after The Sheep Pen project (fresh farms are empty)
  const flock = new Flock(
    assets,
    scene,
    state.projects.sheep ? sheepCount(state.expansion) + pastureSheepBonus(state) : 0,
    (state.chicken.seed ^ 0x51f15e) >>> 0,
  )
  // a saved pen location binds before anyone meets the flock — penned sheep
  // spawn at the default rect and ride the delta to wherever the pen stands
  flock.setPen(penRect(state))
  const player = new PlayerView(assets, scene, PLAYER_SPAWN, WORLD_BOUNDS)
  // the east walk bound grows with the crop field — reach the last parcel's edge
  player.setBounds({ ...WORLD_BOUNDS, maxX: worldMaxX(state.fieldParcels) })
  const customers = new Customers((state.chicken.seed ^ 0x9e3779b9) >>> 0)
  const customerViews = new Map<number, CustomerView>()

  // ---- Move-in Day: carry & place ------------------------------------------
  const carry = new CarrySystem(scene)
  if (standGroup) carry.register('stand', standGroup)
  if (tractor) carry.register('tractor', tractor.group)
  // crop-field slabs are NOT carryable — the field is a fixed east place now
  /** the latest ghost validity — buttons + commit share one verdict */
  let carryCheck: PlaceCheck = { ok: false }

  // ---- the fence is yours: free to draw, free to tear down ------------------
  const fences = toSets(state.fences)
  fenceMesh = buildFenceEdges(scene, fences.edges, fences.gates, state.fenceStyle)
  const fenceEditor = new FenceEditor({
    dom: renderer.domElement,
    camera: cam.camera,
    scene,
    fences,
    allowed: (mx, mz) => fenceEdgeAllowed(state, mx, mz),
    onChange: () => rebuildFenceMesh(),
    ownedStyles: () => game.ownedFenceStyles(),
    activeStyle: () => state.fenceStyle,
    onStyle: (id) => {
      game.setFenceStyle(id as typeof state.fenceStyle)
      rebuildFenceMesh()
    },
    onFx: (x, z, kind) => {
      if (kind === 'remove') sfx.pop()
      else if (kind === 'build') sfx.plant()
      else sfx.crate()
      navigator.vibrate?.(8)
      sparkleBurst(scene, new Vector3(x, 0.5, z), false, 4)
    },
    canOpen: () =>
      !sleepActive && !construction.active && !fetchCine && !roomBusy && room === null && !carry.carrying && !hud.modalOpen && !riding && !placingDecor,
    // editing wants OVERVIEW: pull back to see the line you're drawing
    // (the tight landscape ride is for walking, not surveying)
    onOpen: () => {
      editSavedDist = cam.dist
      cam.dist = Math.max(cam.dist, 14)
      // the camera STOPS reading gestures while the editor owns the pointer —
      // otherwise every fence tap also orbits the world and the ground slides
      // under the finger between touch and pick (the "taps don't register" bug)
      cam.editorActive = true
    },
    onClose: () => {
      cam.editorActive = false
      if (editSavedDist !== null) cam.dist = editSavedDist
      editSavedDist = null
    },
  })
  let editSavedDist: number | null = null
  const rebuildFenceMesh = (): void => {
    if (fenceMesh) {
      scene.remove(fenceMesh)
      // traverse, not just root: the stone style parents a wooden gate overlay
      // as a child — dispose every mesh's geometry so nothing orphans on edits
      fenceMesh.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose()
      })
      disposeMaterials(fenceMesh)
    }
    fenceMesh = buildFenceEdges(scene, fences.edges, fences.gates, state.fenceStyle)
    state.fences = toState(fences)
    saveNow()
  }

  // ---- the decoration shop: place repeatable cosmetics, repaint fences ------
  const decorSet = new DecorSet(scene)
  decorSet.refresh(state.decor, state.day)
  game.on('decorChanged', () => decorSet.refresh(state.decor, state.day))
  // placement: a ghost glides ahead of the farmer; a pad shows whether the
  // spot is legal (the reach guard rejects anywhere you couldn't walk back to)
  let placingDecor: DecorId | null = null
  let decorGhost: Group | null = null
  let decorOk = false
  const decorAim = new Vector3()
  const decorPad = new Mesh(
    new CircleGeometry(0.7, 24).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0x5ac85a, transparent: true, opacity: 0.5, depthWrite: false }),
  )
  decorPad.position.y = 0.03
  decorPad.visible = false
  decorPad.renderOrder = 2
  scene.add(decorPad)
  const cancelDecorPlace = (): void => {
    if (decorGhost) {
      scene.remove(decorGhost)
      decorGhost.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose()
      })
      decorGhost = null
    }
    decorPad.visible = false
    placingDecor = null
  }
  const startPlacingDecor = (id: DecorId): void => {
    cancelDecorPlace()
    placingDecor = id
    decorGhost = decorSet.buildOne(id, 0)
    scene.add(decorGhost)
    decorPad.visible = true
    hud.showChip('Walk to aim it \u{2014} then Place it')
  }
  const commitDecor = (): void => {
    if (!placingDecor || !decorOk) return
    game.placeDecor(placingDecor, decorAim.x, decorAim.z, player.facing)
    sfx.plant()
    sparkleBurst(scene, new Vector3(decorAim.x, 0.3, decorAim.z), false, 5)
    cancelDecorPlace()
    hud.showChip(null)
  }
  /** the shop catalog: decorations to place + fence skins to buy */
  const openCatalog = (): void => {
    const decorCards = DECOR.map((d) => ({
      id: `d:${d.id}`,
      emoji: d.emoji,
      title: d.name,
      sub: state.level < d.level ? `unlocks at level ${d.level}` : d.blurb,
      price: `${d.cost}c`,
      locked: state.level < d.level || state.coins < d.cost || state.decor.length >= DECOR_MAX,
    }))
    const styleCards = FENCE_STYLES.map((s) => {
      const owned = game.ownedFenceStyles().includes(s.id)
      return {
        id: `f:${s.id}`,
        emoji: s.emoji,
        title: `${s.name} fence`,
        sub: owned
          ? '\u{2713} owned \u{2014} pick it in the fence editor'
          : state.level < s.level
            ? `unlocks at level ${s.level}`
            : 'a fresh look for every fence',
        price: owned ? '' : `${s.cost}c`,
        locked: owned || state.level < s.level || state.coins < s.cost,
      }
    })
    hud.showCardPanel('The Catalog \u{1F380}', [...decorCards, ...styleCards], (cardId) => {
      if (cardId.startsWith('d:')) {
        const id = cardId.slice(2) as DecorId
        const d = decorDef(id)
        if (state.level < d.level) return hud.floatText(hud.coinPillPos(), `level ${d.level} \u{1F512}`)
        if (state.decor.length >= DECOR_MAX)
          return hud.floatText(hud.coinPillPos(), 'the farm is full — pick one up to re-arrange')
        if (state.coins < d.cost) return hud.floatText(hud.coinPillPos(), 'not enough coins')
        hud.hideCardPanel()
        startPlacingDecor(id)
      } else if (cardId.startsWith('f:')) {
        const id = cardId.slice(2) as typeof state.fenceStyle
        if (game.ownedFenceStyles().includes(id)) {
          hud.hideCardPanel()
          return
        }
        if (game.buyFenceStyle(id)) {
          rebuildFenceMesh()
          sfx.kaching()
          hud.hideCardPanel()
          hud.showBanner('New fence skin! \u{1F380}', 'pick it in the fence editor \u{1F6E0}')
        } else {
          hud.floatText(hud.coinPillPos(), 'not yet')
        }
      }
    })
  }


  let wiping = false
  const saveNow = (): void => {
    if (!wiping) localStorage.setItem(SAVE_KEY, serialize(state))
  }
  // persist a just-applied one-time migration immediately (see migrationFlush)
  if (migrationFlush) saveNow()

  // ---- HUD sync -----------------------------------------------------------
  hud.setCoins(state.coins)
  hud.setWheat(state.wheat)
  hud.setXp(state.xp, xpNeeded(state.level), state.level)
  game.on('xp', (e) => hud.setXp(e.xp, e.need, e.level))
  // a level-up fanfare must never be hollow — every level names what it
  // unlocked or brought closer (an empty 'the farm grows' trains players
  // that the fanfare means nothing)
  const LEVEL_NEWS: Record<number, string> = {
    2: 'The roadside stand is on sale! \u{1F3D5}',
    3: 'Sheep join the flock — and your field can stretch east \u{1F411}',
    5: 'Goat friends join the pen — fresh milk money \u{1F410}',
    6: 'Big day: the Coop, a Stable — and Hazel \u{1F434}',
    8: 'A real Farm Shop unlocks across the road \u{1F3EA}',
    9: 'The Greenhouse unlocks \u{1F33F}',
    12: "The coop's east wing — room for three more hens \u{1F414}",
    13: "Another coop wing — room for a fuller flock \u{1F414}",
    15: 'Your east field rolls on — always another parcel to claim \u{1F331}',
    16: 'A bigger Greenhouse — four more beds under glass \u{1F33F}',
    18: 'The coop can grow a third wing — the Long Roost \u{1F414}',
    20: 'The Market Awning: richer customers come to the shop \u{1F3EA}',
    22: 'The Pasture Loft makes room for more sheep and a goat \u{1F411}',
    24: "Hazel's Tack Room — you can finally saddle up and RIDE her \u{1F434}",
    26: 'Make the farmhouse cosier — shelves, curtains, a tiled hearth \u{1F3E1}',
    // milestones past the last unlock — leveling always means something warm
    30: 'Thirty seasons in — Millbrook feels like home now \u{1F3E1}',
    35: 'The whole valley knows Sunrise Farm by name \u{2600}\u{FE0F}',
    40: 'Forty seasons! Grandpa would be so proud \u{1F33E}',
    45: 'A farm for the ages — the orchards run gold \u{1F33B}',
    50: 'Fifty seasons — a true Sunrise legend \u{1F3C6}',
  }
  /** a level-up mid-cutscene queues — the fanfare must never fire over the
   * crew's reveal (it lands ~1.2s after done(), the payday-banking pattern) */
  let queuedLevelUp: (() => void) | null = null
  const levelUpBeat = (e: { level: number; unlocked: CropKind[] }): void => {
    // show BOTH the building/town news AND any crop unlock — the crop text used
    // to mask the more important pointer (e.g. lvl 2 "the roadside stand is on sale")
    const news = LEVEL_NEWS[e.level]
    const crops = e.unlocked.length ? `${e.unlocked.map((k) => CROPS[k].label).join(', ')} unlocked!` : ''
    const sub = news && crops ? `${news} \u{2014} ${crops}` : news || crops || 'The whole town hears the news \u{1F4EF}'
    hud.showBanner(`Level ${e.level}!`, sub)
    music.duck()
    sfx.fanfare()
    navigator.vibrate?.([20, 40, 20])
  }
  game.on('levelup', (e) => {
    if (construction.active) queuedLevelUp = () => levelUpBeat(e)
    else levelUpBeat(e)
    // a new level can unlock an upgrade sign (market lvl 20, pasture lvl 22)
    refreshUpgradeSigns()
  })
  // the ready-chime is rate-limited HARD: with a dozen plots ripening near
  // each other it used to ring over and over ("toon toon") — one chime now
  // speaks for the whole batch
  let lastChime = -99
  game.on('cropReady', (e) => {
    if (engine.uTime.value - lastChime > 9) {
      lastChime = engine.uTime.value
      sfx.chime()
    }
    // glasshouse beds sparkle only while the player is actually in there
    if (!game.isGreenhouse(e.plot) || room === 'gh') {
      sparkleBurst(scene, plots[e.plot].center.clone().setY(0.8), false, 5)
    }
  })
  game.on('coopReady', () => {
    // an egg settles into its box — in the room you see it land
    if (room === 'coop') {
      coopInterior.sync(state.coopFlock)
      sfx.cluck()
    }
  })
  // crops visibly grow while you watch (stage-up bounce)
  game.on('stage', (e) => {
    const crop = game.plotAt(e.plot)?.crop
    if (crop) plots[e.plot]?.setCrop(crop.kind, e.stage, true)
  })
  game.on('eggReady', () => {
    sfx.chime()
    chicken.showEgg(false)
  })
  game.on('bakerySold', (e) => {
    hud.setWheat(state.wheat)
    if (!sleepActive && !construction.active) {
      hud.showBanner("Rosie's standing order \u{1F956}", `4 wheat baked into +${e.coins}c`)
      sfx.kaching()
    }
  })
  game.on('cafeSold', (e) => {
    if (!sleepActive && !construction.active) {
      hud.showBanner('The Copper Kettle \u{2615}', `3 eggs whisked into +${e.coins}c`)
      sfx.kaching()
    }
  })
  game.on('upgraded', (e) => {
    const id = e.def.id
    if (id === 'ghwing') {
      // the new row of beds becomes plantable AND visible at once
      for (let i = 8; i < greenhouseBeds(state); i++) {
        plots.push(mkPlot(ghInterior.bedPositions[i].x, ghInterior.bedPositions[i].z, true))
        lastGlow.push('none')
      }
      ghInterior.revealWing()
    } else if (id === 'market') {
      customers.premium = SHOP_PREMIUM + marketPremiumBonus(state)
      customers.queueMax = SHOP_QUEUE_MAX + marketQueueBonus(state)
    } else if (id === 'pasture') {
      // the loft makes room: two more sheep at the pen, one more goat
      for (let i = 0; i < 2; i++) flock.addSheep()
      grazers.add('goat', GOAT_RECT, 1)
    } else if (id === 'homereno') {
      farmhouseInterior.setRenovated(true)
    } else if (id === 'tackroom') {
      stableInterior.setTackRoom(true)
    }
    refreshUpgradeSigns()
    if (!sleepActive && !construction.active) {
      hud.showBanner(`${e.def.name}!`, e.def.blurb)
      sfx.fanfare()
      rareSlowMo()
    }
    saveNow()
  })
  game.on('contractDone', (e) => {
    if (!sleepActive && !construction.active && !hud.modalOpen) {
      hud.showBanner('Order filled! \u{1F4CB}', `${e.contract.sponsor} \u{2014} +${e.contract.payout}c`)
      sfx.kaching()
    }
    saveNow()
  })
  game.on('festivalDone', (e) => {
    if (!sleepActive && !construction.active && !hud.modalOpen) {
      hud.showBanner(`Festival ribbon #${e.ribbons} \u{1F380}`, `the whole town celebrates \u{2014} +${e.payout}c`)
      sfx.fanfare()
      rareSlowMo()
    }
    saveNow()
  })
  game.on('deliveryDone', (e) => {
    grazers.setHidden('horse', false) // back from town, whatever the path
    // the town board appears after the first delivery — refresh its state
    if (state.town.delivered <= TOWN_ACTS[0].needDelivered + 1) refreshTownSign()
    // ...and so does the order board, the first time the town notices
    ensureOrderBoard()
    // if the farmer is standing in her stall when she gets back, she
    // appears home — the room mirrors the delivery truth, always
    if (room === 'stable') stableInterior.sync({ horseOwned: game.hasProject('horse'), horseHome: true })
    // never let the payday fanfare fire over a cutscene — bank quietly
    if (!sleepActive && !construction.active) {
      sfx.hooves()
      sfx.kaching()
      fountainFrom(STABLE_AT.clone().setY(1.0), e.coins, false)
      const s = cam.screenPos(STABLE_AT.clone().setY(1.8))
      // the itemized receipt: WHO bought the load makes the trip a story
      const o = orderFor(state.day, Math.max(0, state.deliveriesSent - 1))
      if (!s.behind) hud.floatText(s, `Hazel's home! ${o.buyer} paid ${e.coins} \u{1FA99}`)
    }
    saveNow()
  })

  // ---- ceremonies ----------------------------------------------------------
  const suggestedName = HEN_NAMES[state.chicken.seed % HEN_NAMES.length]
  const runNaming = (): void => {
    if (state.chicken.name) return
    hud.showNameCard(suggestedName, (name) => {
      game.setChickenName(name)
      sfx.cluck()
      heartBurst(scene, chicken.tagWorldPos())
      chicken.acknowledge(cam.camera.position)
      saveNow()
    })
  }
  // first harvest: the crate thuds down and WAITS — walking up opens it
  game.on('chickenArrive', () => {
    endFetchCine() // the crate ceremony outranks a stick chase
    sfx.crate()
    chicken.dropCrate()
    cam.focusOn(CRATE_POS, 0.9)
    // hand back after the beat — unless a cutscene grabbed the lens meanwhile
    // (a construction within 2.1s would otherwise drift its focus away)
    gsap.delayedCall(2.1, () => {
      if (!construction.active && !fetchCine) cam.release(1.0)
    })
  })

  // ---- restore visuals from save ------------------------------------------
  for (let i = 0; i < plots.length; i++) {
    const crop = game.plotAt(i)?.crop
    if (crop) plots[i].setCrop(crop.kind, Game.stageOf(crop.total, crop.remaining), false)
  }
  if (state.chicken.arrived) {
    chicken.settle()
    if (state.chicken.eggReady) chicken.showEgg(false)
    if (!state.chicken.name) runNaming()
  }

  // comeback pan: glide across everything that got ready while away
  if (offline) {
    // away-progress is a reward list, not a silent ledger: Hazel's offline
    // payday used to bank 34c without a word
    if (offline.offlineDelivery) {
      gsap.delayedCall(1.2, () =>
        hud.showBanner('While you were away \u{1F305}', 'Hazel came home from Millbrook — 34 coins in the saddlebag'),
      )
    } else if (offline.readyPlots.length > 0 || offline.offlineEggs > 0) {
      // a signed note beats a silent ledger: someone kept watch. Only what
      // ACTUALLY happened while away — never claim stale eggs as fresh
      const crops = offline.readyPlots.length
      const eggsLaid = offline.offlineEggs
      const bits = [
        crops > 0 ? `${crops} crop${crops === 1 ? '' : 's'} ripened` : null,
        eggsLaid > 0 ? `${eggsLaid} egg${eggsLaid === 1 ? '' : 's'} laid` : null,
      ].filter(Boolean)
      if (bits.length) {
        gsap.delayedCall(1.2, () =>
          hud.showBanner('Welcome back to Sunrise Farm \u{1F305}', `${bits.join(', ')} — ${keeperName(state)} kept watch`),
        )
      }
    }
    const readySpots: Vector3[] = []
    for (let i = 0; i < plots.length; i++) {
      const crop = game.plotAt(i)?.crop
      // glasshouse beds live on the far-off set — the pan must not stare there
      if (crop && crop.remaining <= 0 && !game.isGreenhouse(i)) readySpots.push(plots[i].center)
    }
    if (state.chicken.eggReady) readySpots.push(NEST_POS)
    if (readySpots.length) {
      const tl = gsap.timeline({ delay: 0.5 })
      tl.add(cam.focusOn(readySpots[0], 0.9))
      for (let i = 1; i < readySpots.length; i++) {
        tl.to({}, { duration: 0.55 })
        tl.add(cam.moveFocus(readySpots[i], 0.9))
      }
      tl.to({}, { duration: 0.55 })
      tl.add(cam.release(1.0))
    }
  }

  // ---- juice helpers --------------------------------------------------------
  let lastInteract = 0
  const touch = (): void => {
    lastInteract = engine.uTime.value
  }

  const fountainFrom = (world: Vector3, coins: number, golden: boolean): void => {
    const from = cam.screenPos(world)
    // behind-camera projections mirror across the screen — coins would fly in
    // from a phantom corner (audit finding); land them on the HUD coin pill
    if (from.behind) return hud.coinFountain(hud.coinPillPos(), splitCoins(coins, fountainCount(coins)), golden, () => sfx.tink())
    hud.coinFountain(from, splitCoins(coins, fountainCount(coins)), golden, () => sfx.tink())
  }

  let slowUntilReal = 0
  const rareSlowMo = (): void => {
    slowUntilReal = performance.now() + 100
    // touch is the one juice channel phones add — rare moments only, never
    // common pops (over-buzzing erodes the signal like the old chime spam)
    navigator.vibrate?.(30)
  }

  // ---- proximity actions ------------------------------------------------------
  const doHarvest = (i: number): void => {
    const center = plots[i].center.clone().setY(0.9)
    const res = game.harvest(i)
    if (!res) return
    plots[i].harvestPop(res.golden)
    plots[i].setCrop(null, 0, false)
    lastGlow[i] = 'none'
    sfx.pop()
    player.gesture(engine.uTime.value)
    if (res.golden) {
      sfx.golden()
      sparkleBurst(scene, center, true, 16)
      rareSlowMo()
    } else {
      sparkleBurst(scene, center, false, 6)
    }
    fountainFrom(center, res.coins, res.golden)
    const s = cam.screenPos(center.clone().setY(1.6))
    if (!s.behind) hud.floatText(s, `+1 ${GOOD_EMOJI[res.kind]}`)
    hud.setWheat(state.wheat)
    saveNow()
  }

  const plantAt = (i: number, kind: CropKind): void => {
    if (game.plant(i, kind)) {
      plots[i].setCrop(kind, 0, true)
      sfx.plant()
      saveNow()
    }
  }

  const collectEgg = (): void => {
    const res = game.collectEgg()
    if (!res) return
    chicken.collectEggFx()
    player.gesture(engine.uTime.value)
    if (res.golden) {
      sfx.golden()
      sparkleBurst(scene, NEST_POS.clone().setY(0.45), true, 16)
      rareSlowMo()
    } else {
      sfx.pop()
    }
    fountainFrom(NEST_POS.clone().setY(0.45), res.coins, res.golden)
    saveNow()
  }

  // ---- herding missions --------------------------------------------------------
  let penGroup: Group | null = null
  const penNow = penRect(state)
  const PEN_GATE = new Vector3(penNow.x1 + 0.4, 0, (penNow.gate.z0 + penNow.gate.z1) / 2)
  // mission cadence survives reload (no more refresh-to-farm-sheep)
  let herdTimer = state.timers.herd > 0
    ? state.timers.herd
    : HERD_FIRST_DELAY[0] + game.rollFloat() * (HERD_FIRST_DELAY[1] - HERD_FIRST_DELAY[0])
  let flankTick = 0
  let lastBaa = -10
  flock.onBaa = (at) => {
    const t = engine.uTime.value
    // ambient bleats stay occasional and close-range — flavor, not noise
    if (t - lastBaa < 5 || at.distanceTo(player.pos) > 10) return
    lastBaa = t
    sfx.baa()
  }
  flock.onSheepHome = (left) => {
    sfx.baa()
    sparkleBurst(scene, PEN_GATE.clone().setY(0.9), false, 6)
    const s = cam.screenPos(PEN_GATE.clone().setY(1.4))
    if (!s.behind) hud.floatText(s, left > 0 ? `\u{1F411} home! ${left} to go` : '\u{1F411} home!')
  }
  flock.onAllHome = (count) => {
    const res = game.herdComplete(count)
    hud.showBanner("Flock's home!", `Rex is a very good boy • +${res.coins} coins`)
    sfx.fanfare()
    fountainFrom(PEN_GATE.clone().setY(0.8), res.coins, false)
    heartBurst(scene, dog.group.position.clone().setY(0.7))
    rareSlowMo()
    herdTimer = HERD_COOLDOWN[0] + game.rollFloat() * (HERD_COOLDOWN[1] - HERD_COOLDOWN[0])
    saveNow()
  }

  // ---- stick fetch: a little CINEMA (the waiting game's best friend) -------------
  let stick: Mesh | null = null
  let fetchCool = state.timers.fetch
  /** scatter-feed cooldown — pure delight, but not a hold-the-button toy */
  let feedCool = 0
  const letterbox = new Letterbox()
  let fetchCine = false
  let cineEnding = false
  let cineStarted = 0
  const cineAim = new Vector3()
  const fetchEye = new Vector3()
  const endFetchCine = (): void => {
    if (!fetchCine) return
    fetchCine = false
    cineEnding = false
    letterbox.hide()
    cam.cineFollow(null)
  }
  const dropStick = (): void => {
    if (stick) {
      stick.removeFromParent()
      stick = null
    }
  }
  dog.onFetchPickup = () => {
    // the snatch — a beat of slow-mo sells it
    rareSlowMo()
    sfx.bark()
    if (!stick) return
    stick.removeFromParent()
    dog.group.add(stick)
    stick.position.set(0, 0.48, 0.38)
    stick.rotation.set(0, 0, Math.PI / 2)
  }
  dog.onFetchDone = () => {
    // THE PAYOFF — the part that was missing. Rex drops the stick at the
    // farmer's feet, the farmer kneels for the good-dog pat, hearts pop,
    // the reward lands... and only THEN do the bars lift. A complete scene.
    cineEnding = true
    if (stick) {
      dog.group.remove(stick)
      scene.add(stick)
      stick.position.copy(dog.group.position).setY(0.04)
      stick.rotation.set(Math.PI / 2, 0, 1.2)
    }
    sfx.bark()
    const tl = gsap.timeline()
    tl.call(() => {
      player.gesture(engine.uTime.value) // the pat
      sfx.heart()
      heartBurst(scene, dog.group.position.clone().setY(0.6))
    }, undefined, 0.45)
    tl.call(() => {
      const treasure = game.rollFetchTreasure()
      game.fetchReturned(treasure)
      const at = dog.group.position.clone().setY(0.5)
      if (treasure > 0) {
        sfx.kaching()
        fountainFrom(at, treasure, false)
        const s = cam.screenPos(at.clone().setY(1.1))
        if (!s.behind) hud.floatText(s, 'Rex dug something up! \u{1F9B4}')
      } else {
        const s = cam.screenPos(at.clone().setY(1.1))
        if (!s.behind) hud.floatText(s, 'good boy \u{2764}\u{FE0F}')
      }
    }, undefined, 1.15)
    tl.call(() => {
      endFetchCine()
      fetchCool = 16
      saveNow()
    }, undefined, 2.1)
  }
  const throwStick = (): void => {
    dropStick()
    // the stick flies WHERE THE FARMER FACES — wind-up, arc, chase. If that
    // line lands on the stand/fields/pen, shorten the throw to open lawn so
    // the chase (and the camera) never disappears behind a roof.
    const ang = player.facing
    const dir = new Vector3(Math.sin(ang), 0, Math.cos(ang))
    let target = player.pos.clone().add(dir.clone().multiplyScalar(4))
    for (let r = 7.5 + Math.random() * 3.5; r >= 3.5; r -= 1.1) {
      const t = player.pos.clone().add(dir.clone().multiplyScalar(r))
      t.x = Math.max(WORLD_BOUNDS.minX + 1.5, Math.min(worldMaxX(state.fieldParcels) - 1.5, t.x))
      t.z = Math.max(WORLD_BOUNDS.minZ + 1.5, Math.min(WORLD_BOUNDS.maxZ - 1.5, t.z))
      if (!groundClear(t.x, t.z)) {
        target = t
        break
      }
    }
    if (!dog.fetch(target)) return
    // ANTICIPATION first (film grammar: setup -> action -> payoff): the stick
    // is visibly IN HAND through a wind-up beat — Rex bolts early like a real
    // dog — and only then sails out of the hand on its arc.
    player.gesture(engine.uTime.value)
    // roll camera: letterbox in, eye on the flight line, then the per-frame
    // smooth follow rides alongside Rex out and back until the handoff
    fetchCine = true
    cineEnding = false
    cineStarted = engine.uTime.value
    cineAim.copy(player.pos).lerp(target, 0.62).setY(0.9)
    letterbox.show('rex is on it — tap to skip')
    const s = new Mesh(
      new CylinderGeometry(0.035, 0.05, 0.6, 6),
      new MeshStandardMaterial({ color: '#7a5a36', roughness: 1 }),
    )
    s.castShadow = true
    player.group.add(s)
    s.position.set(0.32, 0.82, 0.2) // gripped at the right hand
    s.rotation.set(0, 0, Math.PI / 2.6)
    stick = s
    gsap.timeline().call(
      () => {
        if (stick !== s) return // skip/cleanup landed during the wind-up
        const from = s.getWorldPosition(new Vector3())
        player.group.remove(s)
        scene.add(s)
        s.position.copy(from)
        sfx.whistle()
        const flight = { t: 0 }
        gsap.to(flight, {
          t: 1,
          duration: 0.65,
          ease: 'none',
          onUpdate: () => {
            const t = flight.t
            s.position.set(
              from.x + (target.x - from.x) * t,
              0.15 + (from.y - 0.15) * (1 - t) + Math.sin(t * Math.PI) * 2.4,
              from.z + (target.z - from.z) * t,
            )
            s.rotation.x += 0.35
          },
        })
      },
      undefined,
      0.5,
    )
  }

  // ---- the sleep ritual: supper, stars, sunrise -----------------------------------
  // Direction notes: this is the emotional centerpiece. Beats — golden porch
  // light and supper sounds as he walks home; his wife waving at the lit
  // door; the two step inside; the camera drifts UP into a sky that fills
  // with stars while crickets sing; held breath; then the dawn washes the
  // stars away, birdsong, and he steps back out into Day N+1. Skippable.
  let sleepActive = false
  let sleepStarted = 0
  let skyGaze = false
  let interiorShot = false
  let sleepTl: gsap.core.Timeline | null = null
  let wife: { group: Group; mixer: AnimationMixer } | null = null
  /** the kid joins the morning farewell (spawned at the dawn cut) */
  let kiddo: { group: Group; mixer: AnimationMixer; walk: AnimationAction | null; idle: AnimationAction | null } | null = null
  const nightDial = { k: 0 }
  const applyNight = (): void => {
    dayCycle.setNight(nightDial.k)
    nightSky.set(nightDial.k)
  }
  let sleepSkipped = false
  /** the star-gaze tally card — the bed is also the day's reward dispenser */
  const dayCard = document.createElement('div')
  dayCard.style.cssText =
    'position:fixed;left:50%;top:30%;transform:translate(-50%,-50%) scale(.92);opacity:0;z-index:39;' +
    "text-align:center;color:#fff7e0;font:700 17px 'Trebuchet MS','Segoe UI',system-ui,sans-serif;" +
    'text-shadow:0 1px 10px rgba(0,0,0,.65);letter-spacing:.04em;pointer-events:none;line-height:1.9'
  document.body.appendChild(dayCard)
  const showDayCard = (day: number, s: { coins: number; harvests: number; eggs: number }): void => {
    const parts = [
      s.coins > 0 ? `\u{1FA99} ${s.coins} earned` : null,
      s.harvests > 0 ? `\u{1F33E} ${s.harvests} harvest${s.harvests === 1 ? '' : 's'}` : null,
      s.eggs > 0 ? `\u{1F95A} ${s.eggs} egg${s.eggs === 1 ? '' : 's'}` : null,
    ].filter(Boolean)
    // the Tomorrow tease: true things to look forward to — anticipation is
    // what brings a player back at dawn (and it must never lie)
    const tease = tomorrowLines(state)
    const teaseHtml = tease.length
      ? `<div style="font-size:13px;opacity:.85;margin-top:6px"><span style="opacity:.7;letter-spacing:.14em;text-transform:uppercase;font-size:11px">Tomorrow</span><br>${tease.join('<br>')}</div>`
      : `<div style="font-size:13px;opacity:.8">\u{1F331} the crops grow while everyone sleeps</div>`
    dayCard.innerHTML =
      `<div style="font-size:13px;opacity:.75;letter-spacing:.18em;text-transform:uppercase">Day ${day} on Sunrise Farm</div>` +
      `<div>${parts.length ? parts.join(' &nbsp;\u{B7}&nbsp; ') : 'A quiet day of good work'}</div>` +
      teaseHtml
    gsap.killTweensOf(dayCard)
    gsap.to(dayCard, { opacity: 1, scale: 1, duration: 0.9, ease: 'power2.out' })
  }
  const hideDayCard = (fast = false): void => {
    gsap.killTweensOf(dayCard)
    gsap.to(dayCard, { opacity: 0, duration: fast ? 0.15 : 0.7, ease: 'power1.in' })
  }
  const endSleepScene = (): void => {
    if (!sleepActive) return
    sleepActive = false
    skyGaze = false
    interiorShot = false
    homeInterior.setLit(false)
    letterbox.hide()
    hideDayCard(true)
    cam.cineFollow(null)
    player.autoWalkTo(null)
    nightDial.k = 0
    applyNight()
    // QA blocker: an early skip used to leave the shrink tween alive — it
    // would re-capture scale 1 and quietly erase the farmer. Kill it dead.
    gsap.killTweensOf(player.group.scale)
    player.group.scale.setScalar(1)
    if (wife) {
      gsap.killTweensOf(wife.group.scale)
      gsap.killTweensOf(wife.group.position)
      scene.remove(wife.group)
      wife = null
    }
    if (kiddo) {
      gsap.killTweensOf(kiddo.group.position)
      gsap.killTweensOf(kiddo.group.scale)
      scene.remove(kiddo.group)
      kiddo = null
    }
    homestead.setDoorOpen(0)
    saveNow()
  }
  const sleepScene = (): void => {
    // inGreenhouse can't happen via the button (near.home needs the real
    // door) — the guard protects the dev driver and future callers from
    // auto-walking 170u toward a homestead the room bounds will never reach
    if (sleepActive || construction.active || fetchCine || room !== null || roomBusy || carry.carrying || !dayCycle.atDusk) return
    dismountHazel() // you don't sleep in the saddle
    cancelDecorPlace() // and you don't leave a decoration floating overnight
    fenceEditor.close() // the day's fencing is done at dusk
    sleepActive = true
    sleepStarted = engine.uTime.value
    touch()
    dropStick()
    hud.dismissBanner() // a lingering event toast must not float over the scene
    letterbox.show('goodnight — tap to skip')
    const door = homestead.doorPos
    // his wife appears at the lit threshold, waving him in
    const w = assets.spawnSkinned('customerC')
    normalizeHeight(w, 1.5)
    // she holds the door: half a step out, tucked beside the frame
    const doorN = new Vector3(Math.sin(0.55), 0, Math.cos(0.55))
    w.position
      .copy(homestead.thresholdPos)
      .addScaledVector(doorN, 0.5)
      .add(new Vector3(doorN.z, 0, -doorN.x).multiplyScalar(0.6))
    w.rotation.y = Math.atan2(player.pos.x - w.position.x, player.pos.z - w.position.z)
    scene.add(w)
    const wMixer = new AnimationMixer(w)
    const waveClip = assets.clips('customerC').find((c) => c.name.toLowerCase().endsWith('wave'))
    if (waveClip) wMixer.clipAction(waveClip, w).play()
    wife = { group: w, mixer: wMixer }
    player.autoWalkTo(door)

    const quiet = (fn: () => void) => () => {
      if (!sleepSkipped) fn()
    }
    /** lateral offset along the door frame (+ = the wife's side) */
    const side = (s: number): Vector3 => new Vector3(doorN.z, 0, -doorN.x).multiplyScalar(s)
    /** where mom stands holding the door (her evening spot, reused at dawn) */
    const jamb = homestead.thresholdPos.addScaledVector(doorN, 0.5).add(side(0.6))
    const tl = gsap.timeline()
    // scene entry: a quick blink-cut to the authored door shot — easing there
    // from an arbitrary gameplay angle could sweep the camera THROUGH the barn
    tl.call(() => letterbox.fade(true, 0.16), undefined, 0.02)
    tl.call(() => {
      cam.cineFollow(homestead.doorPos.clone().setY(1.2), 0.55, 0.38)
      cam.cineCut()
      letterbox.fade(false, 0.4)
    }, undefined, 0.24)
    // supper drifting out of the kitchen window
    tl.call(quiet(() => sfx.clink()), undefined, 1.1)
    tl.call(quiet(() => sfx.clink()), undefined, 2.3)
    // the door swings open ahead of him — the old hinge creaks
    tl.call(quiet(() => {
      homestead.openDoor(0.9)
      sfx.crate()
    }), undefined, 2.6)
    // they actually WALK inside: past the wall plane the dark doorway recess
    // swallows them — no shrink tricks, a real entrance
    tl.call(() => {
      player.autoWalkTo(homestead.thresholdPos.addScaledVector(doorN, -0.45))
      if (wife) {
        const inSpot = homestead.thresholdPos.addScaledVector(doorN, -0.5).add(side(0.25))
        wife.group.rotation.y = Math.atan2(inSpot.x - wife.group.position.x, inSpot.z - wife.group.position.z)
        gsap.to(wife.group.position, { x: inSpot.x, z: inSpot.z, duration: 1.2, ease: 'power1.inOut', delay: 0.45 })
      }
    }, undefined, 3.6)
    // CUT inside, through black: the family is at the table
    tl.call(() => letterbox.fade(true, 0.45), undefined, 4.1)
    tl.call(() => {
      homeInterior.setLit(true)
      interiorShot = true
      // CUT to the dinner table while the screen is black — never dolly in
      cam.cineFollow(homeInterior.camFocus, homeInterior.camYaw, homeInterior.camPitch, homeInterior.camDist, homeInterior.camFov)
      cam.cineCut()
      letterbox.fade(false, 0.6)
    }, undefined, 4.7)
    // the door shuts behind them, unseen in the black
    tl.call(quiet(() => homestead.closeDoor(0.6)), undefined, 4.8)
    // supper — the heart of the scene. Firelight, the child looking up at
    // dad, clinks between bites. The world outside slips into night unseen.
    for (const at of [5.8, 7.0, 8.3, 9.6]) tl.call(quiet(() => sfx.clink()), undefined, at)
    tl.to(nightDial, { k: 1, duration: 3.0, ease: 'sine.inOut', onUpdate: applyNight }, 5.2)
    // dinner ends; cut up to the stars
    tl.call(() => letterbox.fade(true, 0.5), undefined, 11.3)
    // today's tally, read under the stars (snapshot BEFORE sleep() resets it)
    const summary = game.daySummary()
    tl.call(() => {
      homeInterior.setLit(false)
      interiorShot = false
      skyGaze = true
      // CUT up to the crescent in the black — the moon shot holds steady
      cam.cineFollow(homestead.doorPos.clone().add(new Vector3(14, 34, 12)), -2.3, -0.55)
      cam.cineCut()
      letterbox.fade(false, 0.7)
    }, undefined, 11.9)
    tl.call(quiet(() => showDayCard(state.day, summary)), undefined, 12.7)
    tl.call(() => hideDayCard(), undefined, 15.1)
    for (const at of [12.8, 13.7, 14.9]) tl.call(quiet(() => sfx.cricket()), undefined, at)
    // deep night: the new day begins where no one can see the seam — and
    // the lawn re-scatters around any moved buildings (the one frame heavy
    // grass pass, hidden in the dark)
    tl.call(() => {
      dayCycle.startNewDay()
      game.sleep()
      grass.rebuild()
      decorSet.refresh(state.decor, state.day) // saplings grow with the new day
    }, undefined, 15.4)
    // dawn washes the stars away
    tl.to(nightDial, { k: 0, duration: 2.8, ease: 'sine.inOut', onUpdate: applyNight }, 15.8)
    tl.call(quiet(() => sfx.birds()), undefined, 17.0)
    tl.call(quiet(() => sfx.birds()), undefined, 17.9)
    // cut back down to the door — the morning farewell. The whole family
    // starts INSIDE behind the closed door; everyone emerges from the dark
    // doorway when it opens (the recess plane reveals them naturally).
    tl.call(() => letterbox.fade(true, 0.45), undefined, 18.6)
    tl.call(() => {
      skyGaze = false
      // CUT down from the stars to the door while black — easing down used
      // to leave the camera INSIDE the barn as the morning faded in
      cam.cineFollow(homestead.doorPos.clone().setY(1.2), 0.55, 0.38)
      cam.cineCut()
      letterbox.fade(false, 0.6)
      gsap.killTweensOf(player.group.scale)
      player.group.scale.setScalar(1)
      homestead.setDoorOpen(0)
      player.pos.copy(homestead.thresholdPos.addScaledVector(doorN, -0.4))
      player.autoWalkTo(null)
      if (wife) {
        gsap.killTweensOf(wife.group.scale)
        gsap.killTweensOf(wife.group.position)
        wife.group.scale.setScalar(1)
        wife.group.position.copy(homestead.thresholdPos).addScaledVector(doorN, -0.5).add(side(0.4))
        wife.group.rotation.y = 0.55
      }
      if (!sleepSkipped && !kiddo) {
        // their little one joins the goodbye (the kid from the dinner table)
        const g = assets.spawnSkinned('customerC')
        normalizeHeight(g, 0.95)
        g.traverse((o) => {
          if (o instanceof SkinnedMesh && o.material instanceof MeshStandardMaterial) {
            // customerC materials are SHARED across clones and their color IS
            // the garment — clone, then only warm it (a blanket recolor turns
            // her into a gray mannequin)
            o.material = o.material.clone()
            o.material.color.lerp(new Color('#ffd9b0'), 0.22)
          }
        })
        g.position.copy(homestead.thresholdPos).addScaledVector(doorN, -0.45).add(side(-0.3))
        g.rotation.y = 0.55
        scene.add(g)
        const m = new AnimationMixer(g)
        const clipOf = (n: string): AnimationAction | null => {
          const c = assets.clips('customerC').find((k) => {
            const l = k.name.toLowerCase()
            return l === n || l.endsWith(`|${n}`)
          })
          return c ? m.clipAction(c, g) : null
        }
        const idle = clipOf('idle')
        idle?.play()
        kiddo = { group: g, mixer: m, walk: clipOf('walk'), idle }
      }
    }, undefined, 19.2)
    // the door opens on the new day
    tl.call(quiet(() => {
      homestead.openDoor(0.8)
      sfx.crate()
    }), undefined, 19.35)
    // dad steps out into the light
    tl.call(() => player.autoWalkTo(door.clone().addScaledVector(doorN, 0.5)), undefined, 19.9)
    // mom comes to hold the door frame
    tl.call(quiet(() => {
      if (wife) gsap.to(wife.group.position, { x: jamb.x, z: jamb.z, duration: 0.9, ease: 'power1.inOut' })
    }), undefined, 20.1)
    // the kid bursts out after dad for one more goodbye
    tl.call(quiet(() => {
      if (!kiddo) return
      const to = door.clone().addScaledVector(doorN, 1.0).add(side(0.18))
      kiddo.group.rotation.y = Math.atan2(to.x - kiddo.group.position.x, to.z - kiddo.group.position.z)
      kiddo.idle?.stop()
      if (kiddo.walk) {
        kiddo.walk.reset().play()
        kiddo.walk.timeScale = 1.5
      }
      gsap.to(kiddo.group.position, {
        x: to.x,
        z: to.z,
        duration: 1.0,
        ease: 'power1.inOut',
        onComplete: () => {
          kiddo?.walk?.stop()
          kiddo?.idle?.reset().play()
        },
      })
    }), undefined, 20.7)
    // the stoop: dad bends down for a goodbye kiss on her head
    tl.call(quiet(() => {
      player.gesture(engine.uTime.value)
      if (kiddo) sparkleBurst(scene, kiddo.group.position.clone().setY(1.05), false, 4)
    }), undefined, 21.7)
    // she scampers back to mom; dad turns for the fields
    tl.call(quiet(() => {
      if (!kiddo) return
      const back = jamb.clone().add(side(-0.55))
      kiddo.group.rotation.y = Math.atan2(back.x - kiddo.group.position.x, back.z - kiddo.group.position.z)
      kiddo.idle?.stop()
      if (kiddo.walk) {
        kiddo.walk.reset().play()
        kiddo.walk.timeScale = 1.5
      }
      gsap.to(kiddo.group.position, {
        x: back.x,
        z: back.z,
        duration: 1.1,
        ease: 'power1.inOut',
        onComplete: () => {
          kiddo?.walk?.stop()
          kiddo?.idle?.reset().play()
        },
      })
    }), undefined, 22.6)
    tl.call(() => player.autoWalkTo(door.clone().add(new Vector3(1.6, 0, 2.2))), undefined, 22.8)
    tl.call(() => {
      // tenure milestones make the day number an emotional scoreboard
      const MILESTONES: Record<number, string> = {
        7: 'One whole week on the farm \u{1F33B}',
        14: 'Two weeks of good mornings \u{1F425}',
        30: 'A month of mornings \u{1F304}',
        100: 'A hundred days — this land knows you now \u{1F3E1}',
      }
      hud.showBanner(`Day ${state.day} \u{1F305}`, MILESTONES[state.day] ?? 'A brand-new morning on the farm')
      music.duck()
    }, undefined, 23.2)
    // the family slips back inside and the door closes on a good morning
    tl.call(quiet(() => {
      const inSpot = homestead.thresholdPos.addScaledVector(doorN, -0.55)
      if (wife) gsap.to(wife.group.position, { x: inSpot.x, z: inSpot.z, duration: 0.8, ease: 'power1.in', delay: 0.1 })
      if (kiddo) {
        const kidIn = inSpot.clone().add(side(-0.3))
        gsap.to(kiddo.group.position, { x: kidIn.x, z: kidIn.z, duration: 0.75, ease: 'power1.in' })
      }
    }), undefined, 23.7)
    tl.call(quiet(() => homestead.closeDoor(0.7)), undefined, 24.7)
    tl.call(() => endSleepScene(), undefined, 25.5)
    sleepTl = tl
  }

  // ---- construction projects (the build-your-farm spine) -------------------------
  const construction = new Construction({
    scene,
    assets,
    cam,
    letterbox,
    tickSfx: (dig: boolean) => (dig ? sfx.dig() : sfx.hammer()),
  })
  const grazers = new Grazers(assets, scene, 0xa11ce)
  /** the horse grazes her west paddock by the stable; goats join the pen */
  const paddock = paddockRect(state) // travels with the stable
  const HORSE_RECT = { x0: paddock.x0 + 0.3, z0: paddock.z0 + 0.3, x1: paddock.x1 - 0.3, z1: paddock.z1 - 0.3 }
  const PADDOCK_CENTER = new Vector3((paddock.x0 + paddock.x1) / 2, 0, (paddock.z0 + paddock.z1) / 2)
  // riding Hazel: the rig renders her under the farmer; the player controller
  // stays authoritative for movement (gated on the Tack Room upgrade)
  const rideRig = new RideRig(scene, assets)
  let riding = false
  let rideSavedDist: number | null = null
  const mountHazel = (): void => {
    if (riding || !canRideHazel(state) || state.produce.deliveryT > 0) return
    riding = true
    grazers.setHidden('horse', true) // the grazing Hazel steps in to be ridden
    rideRig.mount(player.pos, player.facing)
    player.setMounted(true, rideRig.saddleY)
    cam.rideLift = 0.85 // aim up at the rider, not the horse's back
    cam.clearWhiskers() // the +2.2u jump must not inherit the old orbit's hits
    rideSavedDist = cam.dist
    cam.dist = Math.min(17, cam.dist + 2.2) // sit back to frame horse + rider
    sfx.hooves()
    hud.showBanner('Up on Hazel \u{1F434}', 'ride out — press Hop down to dismount')
  }
  const dismountHazel = (): void => {
    if (!riding) return
    riding = false
    rideRig.dismount()
    player.setMounted(false)
    cam.rideLift = 0
    grazers.setHidden('horse', state.produce.deliveryT > 0) // back to grazing unless she's away
    if (rideSavedDist !== null) cam.dist = rideSavedDist
    rideSavedDist = null
    cam.clearWhiskers() // dropping back to the closer orbit, same reason
  }
  const penRect0 = penRect(state)
  const GOAT_RECT = { x0: penRect0.x0 + 0.7, z0: penRect0.z0 + 0.7, x1: penRect0.x1 - 0.7, z1: penRect0.z1 - 0.7 }
  let coopHens: CoopHens | null = null
  let coopGroup: Group | null = null
  const coopPlace = placeOf(state, 'coop')
  const COOP_AT = new Vector3(coopPlace.x, 0, coopPlace.z)

  /** where a project lives NOW: layout-resolved for movable buildings,
   * the authored site for animal projects (pen/paddock dwellers). Hazel is
   * an add-on to the stable, so her ceremony rides wherever it stands. */
  const projectSite = (def: ProjectDef): { x: number; z: number } =>
    def.id in DEFAULT_PLACES
      ? placeOf(state, def.id as PlaceId)
      : def.id === 'horse'
        ? placeOf(state, 'stable')
        : { x: def.site[0], z: def.site[1] }

  const addBuilding = (builder: (seed: number) => Group, def: ProjectDef, pop: boolean): Group => {
    const b = builder(0xb1d + def.cost)
    // the camera's occlusion rays test an invisible HULL, not the building's
    // merged trimwork: a box is a handful of triangles, the real geometry is
    // thousands (the near-building raycast spikes the perf audit clocked).
    // It's a CHILD, so carries and relayouts take it along for free.
    const hull = new Box3().setFromObject(b)
    const hsize = hull.getSize(new Vector3())
    const hcenter = hull.getCenter(new Vector3())
    const proxy = new Mesh(new BoxGeometry(hsize.x, hsize.y, hsize.z), OCC_PROXY_MAT)
    proxy.name = 'occ-proxy'
    proxy.position.copy(hcenter)
    proxy.visible = false
    b.add(proxy)
    const at = placeOf(state, def.id as PlaceId) // only buildings come here — all PlaceIds
    b.position.set(at.x, 0, at.z)
    b.rotation.y = at.yaw
    scene.add(b)
    OCCLUDERS.push(proxy)
    carry.register(def.id as PlaceId, b)
    if (pop) {
      b.scale.setScalar(0.01)
      gsap.to(b.scale, { x: 1, y: 1, z: 1, duration: 0.7, ease: 'back.out(1.5)' })
    }
    return b
  }

  /** make an owned project exist in the world (boot restore + fresh reveals) */
  const applyProject = (def: ProjectDef, fresh: boolean): void => {
    if (def.id === 'stand') {
      if (!state.projects.shop && !standGroup) {
        standGroup = buildStand(scene, assets)
        OCCLUDERS.push(standGroup)
        carry.register('stand', standGroup)
        if (fresh) {
          standGroup.scale.setScalar(0.01)
          gsap.to(standGroup.scale, { x: 1, y: 1, z: 1, duration: 0.7, ease: 'back.out(1.5)' })
        }
      }
      customers.active = state.harvests >= 1
    } else if (def.id === 'sheep') {
      penGroup = buildPen(scene, placeOf(state, 'pen'))
      carry.register('pen', penGroup)
      // at boot the Flock constructor already spawned the saved flock; a
      // fresh build spawns the full state-derived headcount (incl. any
      // pasture-deed bonus bought first) so reloads never change income
      if (fresh) for (let i = 0; i < sheepCount(state.expansion) + pastureSheepBonus(state); i++) flock.addSheep()
    } else if (def.id === 'stable') {
      // the stable is just the building — Hazel is her own purchase now
      addBuilding(buildStable, def, fresh)
    } else if (def.id === 'horse') {
      grazers.add('horse', HORSE_RECT, 1)
      if (fresh) {
        sfx.hooves()
        const at = projectSite(def)
        sparkleBurst(scene, new Vector3(at.x, 1.0, at.z), false, 10)
      }
    } else if (def.id === 'goats') {
      grazers.add('goat', GOAT_RECT, 2 + pastureGoatBonus(state))
    } else if (def.id === 'shop') {
      if (standGroup) {
        scene.remove(standGroup)
        const i = OCCLUDERS.indexOf(standGroup)
        if (i >= 0) OCCLUDERS.splice(i, 1)
        carry.unregister('stand')
        standGroup = null
      }
      addBuilding(buildShop, def, fresh)
      customers.premium = SHOP_PREMIUM + marketPremiumBonus(state)
      customers.queueMax = SHOP_QUEUE_MAX + marketQueueBonus(state)
      // the serving counter moves across the road — customers reroute to the
      // shop front, and anyone mid-queue walks over (a nice opening-day beat)
      marketToShop(placeOf(state, 'shop'))
      if (fresh) reflowQueue()
    } else if (def.id === 'coop') {
      coopGroup = addBuilding(buildCoopHouse, def, fresh)
      // owned wings show on the OUTSIDE too (children, so moves carry them)
      buildCoopAnnex(coopGroup, state.coopFlock.tier)
      coopHens = new CoopHens(scene, COOP_AT, def.yaw, Math.min(3, state.coopFlock.hens.length), 0xc00b)
    } else if (def.id === 'greenhouse') {
      addBuilding(buildGreenhouse, def, fresh)
      if (fresh)
        for (let i = 0; i < greenhouseBeds(state); i++) {
          plots.push(mkPlot(ghInterior.bedPositions[i].x, ghInterior.bedPositions[i].z, true))
          lastGlow.push('none')
        }
    }
  }
  for (const { def } of game.projectBoard()) if (game.hasProject(def.id)) applyProject(def, false)
  // the room mirrors the flock from the first frame (plaques, eggs, hens)
  coopInterior.sync(state.coopFlock)
  // Millbrook stands back up exactly as far as the farm has built it
  for (const a of TOWN_ACTS) if (state.town.built[a.id]) townSet.reveal(a.id, false)
  townSet.setShift(state.town.built.works === true)
  // ambient villagers stroll the bakery↔cottages shoulder all day once the
  // cottages stand — so a player in town at any hour sees life, not a diorama
  townSet.setStrollers(state.town.built.cottages === true)
  // reloaded mid-delivery? Hazel is still in town, not grazing at the stable
  if (state.produce.deliveryT > 0) grazers.setHidden('horse', true)

  // build-site signs for every project whose land exists
  const projectSigns = new Map<ProjectId, { group: Group; at: Vector3 }>()
  // upgrade/build signs can't stand inside the building they replace
  const SIGN_OFFSET: Partial<Record<ProjectId, [number, number]>> = {
    shop: [-2.8, -1.6], // beside the lot, clear of the queue spots at z-2.4
    goats: [1.6, -3.4],
    stable: [3.4, 0.8], // east of the paddock, on the walking line
    horse: [3.4, -1.8], // her own sign beside the stable's
  }
  const refreshProjectSigns = (): void => {
    const gate = {
      level: state.level,
      coins: state.coins,
      expansion: state.expansion,
      projects: state.projects as Partial<Record<ProjectId, boolean>>,
    }
    // chained projects (shop after stand, goats after sheep) keep their sign
    // hidden until the prerequisite exists — they also share build sites, so
    // early signs would stack on top of each other
    const avail = availableProjects(gate).filter((d) => !d.requires || state.projects[d.requires])
    for (const [id, s] of projectSigns) {
      if (!avail.some((d) => d.id === id)) {
        scene.remove(s.group)
        disposeMaterials(s.group)
        projectSigns.delete(id)
      }
    }
    for (const def of avail) {
      if (projectSigns.has(def.id)) continue
      const [ox, oz] = SIGN_OFFSET[def.id] ?? [0, 0]
      const site = projectSite(def) // signs follow moved buildings
      const at = new Vector3(site.x + ox, 0, site.z + oz)
      const group = buildDeedSign(def.name, def.cost, 'BUILD', '#2e6db4')
      group.position.copy(at)
      group.rotation.y = Math.atan2(PLAYER_SPAWN.x - at.x, PLAYER_SPAWN.z - at.z)
      scene.add(group)
      projectSigns.set(def.id, { group, at })
    }
    // (NEEDS-LAND teaser signs are gone — buildings are level/coins-gated only
    // now, so a build sign appears the moment a project becomes buildable; no
    // more "needs land" lots to tease.)
  }
  refreshProjectSigns()

  // ---- the MILLBROOK board: one act for sale at a time --------------------
  const TOWN_SIGN_AT = new Vector3(19.4, 0, 13.2)
  let townSign: Group | null = null
  const refreshTownSign = (): void => {
    if (townSign) {
      scene.remove(townSign)
      disposeMaterials(townSign)
      townSign = null
    }
    const def = nextTownAct(state)
    // the town notices the farm after its first delivery — before that the
    // board would just be noise on the roadside
    if (!def || state.town.delivered < 1) return
    townSign = buildDeedSign(def.name, def.coins, 'MILLBROOK', '#7a4a9e', def.wheat)
    townSign.position.copy(TOWN_SIGN_AT)
    townSign.rotation.y = Math.atan2(PLAYER_SPAWN.x - TOWN_SIGN_AT.x, PLAYER_SPAWN.z - TOWN_SIGN_AT.z)
    scene.add(townSign)
  }
  refreshTownSign()

  // ---- the ORDER BOARD: daily contracts, beside the town board ------------
  const ORDER_BOARD_AT = new Vector3(17.4, 0, 13.6)
  let orderBoard: Group | null = null
  // the board appears the moment the town first notices the farm (first
  // delivery) and then stays — Millbrook always has work going forward
  const ensureOrderBoard = (): void => {
    if (orderBoard || state.town.delivered < 1) return
    orderBoard = buildOrderBoard()
    orderBoard.position.copy(ORDER_BOARD_AT)
    orderBoard.rotation.y = Math.atan2(PLAYER_SPAWN.x - ORDER_BOARD_AT.x, PLAYER_SPAWN.z - ORDER_BOARD_AT.z)
    scene.add(orderBoard)
  }
  ensureOrderBoard()

  /** open the order-board modal: today's contracts + the weekly festival */
  const openOrderPanel = (): void => {
    const goodEmoji: Record<string, string> = {
      wheat: '\u{1F33E}', corn: '\u{1F33D}', tomato: '\u{1F345}', pepper: '\u{1FAD1}',
      eggplant: '\u{1F346}', egg: '\u{1F95A}', wool: '\u{1F411}', milk: '\u{1F95B}',
    }
    const cards = game.contractBoard().map((row, i) => ({
      id: `c${i}`,
      emoji: goodEmoji[row.contract.good] ?? '\u{1F4E6}',
      title: row.contract.sponsor,
      sub: row.done
        ? `\u{2713} filled — earned +${row.contract.payout}c`
        : `${Math.min(row.progress, row.contract.qty)}/${row.contract.qty} ${row.contract.good}  \u{00B7}  +${row.contract.payout}c`,
      progress: Math.min(1, row.progress / row.contract.qty),
    }))
    const fest = game.festivalBoard()
    if (fest) {
      const need = fest.order.goods
        .map((g, j) => `${Math.min(fest.progress[j] ?? 0, g.qty)}/${g.qty} ${g.good}`)
        .join('  \u{00B7}  ')
      const filled = fest.order.goods.reduce((a, g, j) => a + Math.min(fest.progress[j] ?? 0, g.qty), 0)
      const total = fest.order.goods.reduce((a, g) => a + g.qty, 0)
      cards.push({
        id: 'festival',
        emoji: '\u{1F388}',
        title: fest.done ? 'Festival \u{2014} ribbon earned \u{1F380}' : 'The weekly Festival order',
        sub: fest.done ? `+${fest.order.payout}c paid` : `${need}  \u{00B7}  +${fest.order.payout}c`,
        progress: Math.min(1, filled / total),
      })
    }
    hud.showCardPanel('The Order Board \u{1F4CB}', cards)
  }

  // ---- buying land: the ENDLESS east field ----------------------------------
  /** the dig: a crew arrives, letterbox drops, shovels swing — then the NEXT
   * crop-field parcel reveals at the climax. expand() has already incremented
   * state.fieldParcels and grown state.plots, so the synthetic deed's
   * field/plots ARE the parcel just bought (index state.fieldParcels - 1). */
  const expandCeremony = (def: TierDef): void => {
    placeDeedSign()
    const n = state.fieldParcels - 1
    const rect = def.field! // synthetic field deed always carries its parcel rect
    const center = new Vector3((rect.x0 + rect.x1) / 2, 0, (rect.z0 + rect.z1) / 2)
    // the slab + plot views are created NOW (hidden tiny) so plot indices match
    // game state throughout the dig — the reveal only pops them to full size.
    // Field plots always sit at the TAIL of the field block (greenhouse beds
    // follow after), so the new parcel's plots append before the gh planters.
    const newViews: PlotView[] = []
    const fg = buildField(rect, def.plots, 0x6011 + n * 97)
    fg.scale.setScalar(0.001)
    scene.add(fg)
    fieldGroups.set(n, fg)
    const insertAt = n * def.plots.length
    def.plots.forEach(([px, pz], k) => {
      const v = mkPlot(px, pz)
      v.group.scale.setScalar(0.001)
      newViews.push(v)
      plots.splice(insertAt + k, 0, v)
      lastGlow.splice(insertAt + k, 0, 'none')
    })
    // the field grew east — extend the player's walk bound + the exclusion zones
    bindParcels(state.fieldParcels)
    player.setBounds({ ...WORLD_BOUNDS, maxX: worldMaxX(state.fieldParcels) })
    hud.dismissBanner() // a lingering event toast must not float over the scene
    // the 3rd parcel rolls the tractor in mid-ceremony — flag it so the closing
    // banner can announce the unlock instead of leaving the player to find it
    let tractorArrived = false
    construction.play({
      site: center,
      yaw: 0,
      footprint: { w: rect.x1 - rect.x0, d: rect.z1 - rect.z0 },
      cost: def.cost,
      dig: true,
      reveal: () => {
        // blades scattered into this once-unowned parcel must not poke through
        // the fresh soil slab (the scatter only excluded OWNED parcels at boot)
        if (def.field) grass.hideIn(def.field)
        gsap.to(fg.scale, { x: 1, y: 1, z: 1, duration: 0.8, ease: 'back.out(1.4)' })
        for (const v of newViews) gsap.to(v.group.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'back.out(1.6)' })
        repaintGround() // the fallow bed / grass exclusion now covers the new parcel
        // the 3rd parcel earns the tractor — it drives in to help sow the field
        if (!tractor && state.fieldParcels >= 3) {
          tractor = new TractorView(scene, TRACTOR_SPOT.pos, TRACTOR_SPOT.yaw)
          carry.register('tractor', tractor.group)
          tractorArrived = true
        }
        sparkleBurst(scene, center.clone().setY(1.2), true, 18)
      },
      done: () => {
        hud.showBanner(
          `${def.name}!`,
          tractorArrived
            ? 'The old tractor rumbles in \u{1F69C} — it sows the whole field in one pass'
            : def.flavor,
        )
        music.duck()
        sfx.fanfare()
        rareSlowMo()
        if (queuedLevelUp) {
          gsap.delayedCall(1.2, queuedLevelUp)
          queuedLevelUp = null
        }
        saveNow()
      },
    })
  }

  // ---- customers ----------------------------------------------------------------
  const reflowQueue = (): void => {
    for (const c of customers.queue) customerViews.get(c.id)?.moveToSpot(customers.spotOf(c.id))
  }
  let lastBell = -99
  customers.onSpawn = (c) => {
    const view = new CustomerView(assets, scene, c.id, c.seed, customers.spotOf(c.id))
    view.onArrive = () => {
      customers.notifyArrived(c.id)
      // ding once for a NEW wave, not for every walker-up
      if (engine.uTime.value - lastBell > 20) {
        lastBell = engine.uTime.value
        sfx.bell()
      }
    }
    view.onGone = () => {
      customers.remove(c.id)
      customerViews.delete(c.id)
      reflowQueue()
    }
    customerViews.set(c.id, view)
  }

  let serveCooldown = 0
  const tryServe = (): void => {
    if (serveCooldown > 0) return
    const c = customers.frontServiceable(game.stock())
    if (!c) return
    const view = customerViews.get(c.id)
    if (!view?.waiting) return
    const total = c.want.offer + c.want.tip
    if (!game.fulfill(c.want.kind, c.want.count, total)) return
    customers.serve(c.id)
    view.serve()
    reflowQueue()
    serveCooldown = 0.9
    sfx.kaching()
    player.gesture(engine.uTime.value)
    // the 2x band of the tip roll is a once-in-fifty event — let it LAND
    const bigTip = c.want.tip >= c.want.offer
    const at = view.bubbleAnchor().setY(1.5)
    sparkleBurst(scene, at, bigTip, bigTip ? 14 : 8)
    fountainFrom(at, total, bigTip)
    const s = cam.screenPos(view.bubbleAnchor())
    if (!s.behind) hud.floatText(s, bigTip ? `+${c.want.tip} DOUBLE tip!! ♥♥` : `+${c.want.tip} tip ♥`)
    if (bigTip) rareSlowMo()
    hud.setWheat(state.wheat)
    saveNow()
  }

  // ---- input plumbing --------------------------------------------------------------
  addEventListener(
    'pointerdown',
    () => {
      sfx.unlock()
      music.unlock() // media elements prime inside the gesture call stack
      touch()
      // tap skips the fetch cinema (Rex keeps working off-camera)
      if (fetchCine && engine.uTime.value - cineStarted > 0.9) endFetchCine()
      // tap skips the goodnight scene (the day still turns over). Sounds are
      // muted for the fast-forward so 9 callbacks don't chord in one frame.
      if (sleepActive && engine.uTime.value - sleepStarted > 0.9) {
        sleepSkipped = true
        sleepTl?.progress(1, false)
        sleepSkipped = false
      }
    },
    { capture: true },
  )
  addEventListener(
    'keydown',
    () => {
      sfx.unlock()
      music.unlock()
    },
    { capture: true },
  )

  // ---- long-press on a building = pick it up (engine-clock timed) ----------
  // A stationary hold is free input real estate: the camera only orbits on
  // drag, sticks/HUD capture their own pointers. >8px of drift cancels.
  const pressRay = new Raycaster()
  let press: { id: number; x: number; y: number; at: number } | null = null
  renderer.domElement.addEventListener('pointerdown', (e) => {
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, at: engine.uTime.value }
  })
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) press = null
  })
  addEventListener('pointerup', () => {
    press = null
  })
  addEventListener('pointercancel', () => {
    press = null
  })
  /** fixed-tick: a held press matures into a lift if it's over a movable */
  const checkLongPress = (): void => {
    if (riding || placingDecor) return // not while mounted or arranging decor
    if (!press || engine.uTime.value - press.at < 0.55) return
    const ndc = {
      x: (press.x / innerWidth) * 2 - 1,
      y: -(press.y / innerHeight) * 2 + 1,
    }
    press = null
    pressRay.setFromCamera(ndc as never, cam.camera)
    const ents = carry.entries()
    const hits = pressRay.intersectObjects(ents.map(([, g]) => g), true)
    if (!hits.length) return
    let obj: typeof hits[0]['object'] | null = hits[0].object
    while (obj) {
      const ent = ents.find(([, g]) => g === obj)
      if (ent) {
        tryLift(ent[0])
        return
      }
      obj = obj.parent
    }
  }

  // proximity snapshot shared between fixed step (logic) and taps (handlers)
  const near = {
    emptyPlot: -1,
    growingPlot: -1,
    chicken: false,
    deed: false,
    tractor: false,
    dog: false,
    home: false,
    pen: false,
    stable: false,
    coop: false,
    project: null as ProjectId | null,
    /** nearest liftable building (the "Move" button fallback + E2E path) */
    movable: null as PlaceId | null,
    /** nearest fence edge key (build/remove/gate actions) */
    fence: null as number | null,
    /** inside the henhouse: by the hen crate / the next wing's boards */
    crate: false,
    wing: false,
    /** inside the stable: at Hazel's stall gate */
    stall: false,
    /** inside the farmhouse: close to the wife or the kiddo */
    family: false,
    /** at a walk-in door, outside: which room could be entered */
    roomDoor: null as RoomId | null,
    /** at the doorway, inside: the exit button shows */
    roomExit: false,
    /** at the Millbrook board by the gate */
    town: false,
    /** at the order board (daily contracts) by the gate */
    orders: false,
    /** at a building-UPGRADE sign */
    upgrade: null as UpgradeId | null,
    /** by Hazel's paddock with the tack room owned — can mount up */
    ride: false,
    /** at the Farm Shop with the catalog open to browse decor + fence skins */
    catalog: false,
    /** standing on a placed decoration — can pick it up to re-arrange / free a slot */
    decor: false,
  }
  /** Hazel's stall gate + muzzle anchors (the stable hall is a fixed set) */
  const STALL_GATE = STABLE_ANCHOR.clone().add(new Vector3(-1.2, 0, -2.6))
  const HAZEL_MUZZLE = STABLE_ANCHOR.clone().add(new Vector3(-3.0, 1.2, -2.2))
  const stablePlace = placeOf(state, 'stable')
  const STABLE_AT = new Vector3(stablePlace.x, 0, stablePlace.z)
  const PEN_CENTER = new Vector3((penNow.x0 + penNow.x1) / 2, 0, (penNow.z0 + penNow.z1) / 2)

  // ---- building UPGRADES: a green sign by each improvable building ---------
  // (the greenhouse wing, the tack room, the home reno land in later arcs;
  // these are the ones whose effect is live today)
  const UPGRADE_SITE: Partial<Record<UpgradeId, () => Vector3>> = {
    ghwing: () => {
      const p = placeOf(state, 'greenhouse')
      return new Vector3(p.x, 0, p.z + 3.4)
    },
    market: () => {
      const p = placeOf(state, 'shop')
      return new Vector3(p.x - 2.8, 0, p.z + 1.9)
    },
    pasture: () => PEN_CENTER.clone().add(new Vector3(0, 0, -3.4)),
    tackroom: () => {
      const p = placeOf(state, 'stable')
      return new Vector3(p.x + 3.4, 0, p.z + 2.0)
    },
    homereno: () => homestead.doorPos.clone().add(new Vector3(2.4, 0, 0.4)),
  }
  const upgradeSigns = new Map<UpgradeId, { group: Group; at: Vector3 }>()
  const refreshUpgradeSigns = (): void => {
    const avail = availableUpgrades(state).filter((u) => UPGRADE_SITE[u.id])
    for (const [id, s] of upgradeSigns) {
      if (!avail.some((u) => u.id === id)) {
        scene.remove(s.group)
        disposeMaterials(s.group)
        upgradeSigns.delete(id)
      }
    }
    for (const def of avail) {
      if (upgradeSigns.has(def.id)) continue
      const at = UPGRADE_SITE[def.id]!()
      const group = buildDeedSign(def.name, def.cost, 'UPGRADE', '#3b7a57')
      group.position.copy(at)
      group.rotation.y = Math.atan2(PLAYER_SPAWN.x - at.x, PLAYER_SPAWN.z - at.z)
      scene.add(group)
      upgradeSigns.set(def.id, { group, at })
    }
  }
  refreshUpgradeSigns()

  // ---- the walk-in rooms: ONE registry drives doors, occluders, camera ----
  // (diner grammar — no button; the dip-to-black hides the off-world teleport)
  interface RoomDef {
    interior: {
      setActive(on: boolean): void
      spawnPos: Vector3
      exitPos: Vector3
      shell: Mesh[]
    }
    /** opaque rooms hide the farm's heavy roots + pull both camera planes in */
    opaque: boolean
    /** shown on the Enter/Exit buttons ("Enter the Henhouse") */
    label: string
    /** may this door be ENTERED right now? (ownership / time of day) —
     * leaving is always allowed: a room you can't get out of breaks cozy */
    gate(): boolean
    /** movable rooms derive their door from the layout... */
    placeId?: PlaceId
    /** ...fixed rooms (the family house) pin it here instead */
    fixedDoor?: { x: number; z: number; yaw: number }
    /** the real hinged door swings as you pass (the homestead's pivot) */
    onDoorStart?(): void
    onSwap?(enter: boolean): void
    /** the door bay's local-x offset on the front face (the stable's door
     * sits at −1.8, not centered) */
    doorLocalX: number
    /** enter trigger sits this far out from the building center... */
    doorGap: number
    /** ...and walking out lands here — beyond the 0.95 radius, can't re-fire */
    exitGap: number
    bounds(): { minX: number; maxX: number; minZ: number; maxZ: number }
    /** camera volume relative to the walk bounds (+shrink / −grow) + ceiling */
    camInset: number
    camMaxY: number
    zoom: { min: number; max: number }
    door: { dir: Vector3; out: Vector3; exitSpot: Vector3 }
    onEnter?(): void
  }
  const ROOMS: Record<RoomId, RoomDef> = {
    gh: {
      interior: ghInterior,
      opaque: false, // glass: the farm stays visible, near plane stays 0.5
      label: 'the Greenhouse',
      gate: () => game.hasProject('greenhouse'),
      placeId: 'greenhouse',
      doorLocalX: 0,
      doorGap: 1.95,
      exitGap: 3.2,
      bounds: () => ghInterior.bounds,
      camInset: 0.4, // near 0.5 ⇒ near-safe radius ~0.85 off the glass
      camMaxY: 5.7,
      zoom: { min: 5, max: 11 },
      door: { dir: new Vector3(), out: new Vector3(), exitSpot: new Vector3() },
    },
    coop: {
      interior: coopInterior,
      opaque: true,
      label: 'the Henhouse',
      gate: () => game.hasProject('coop'),
      placeId: 'coop',
      doorLocalX: 0,
      doorGap: 1.4,
      exitGap: 2.6,
      bounds: () => coopInterior.boundsForTier(state.coopFlock.tier),
      camInset: -0.1, // the lens may hug walls a touch closer than feet do
      camMaxY: 3.9,
      zoom: { min: 4.5, max: 9 },
      door: { dir: new Vector3(), out: new Vector3(), exitSpot: new Vector3() },
      onEnter: () => {
        coopInterior.sync(state.coopFlock)
        // the nearest two hens come say hello — it's THEIR house
        coopInterior.greetAt(coopInterior.spawnPos)
      },
    },
    stable: {
      interior: stableInterior,
      opaque: true,
      label: 'the Stable',
      gate: () => game.hasProject('stable'),
      placeId: 'stable',
      doorLocalX: -1.8, // the door bay sits left of the open stall front
      doorGap: 2.3,
      exitGap: 3.4,
      bounds: () => stableInterior.bounds,
      camInset: -0.1,
      camMaxY: 4.5,
      zoom: { min: 4.5, max: 9 },
      door: { dir: new Vector3(), out: new Vector3(), exitSpot: new Vector3() },
      onEnter: () => {
        const home = state.produce.deliveryT <= 0
        stableInterior.sync({ horseOwned: game.hasProject('horse'), horseHome: home })
        // one soft stamp of welcome — never repeats inside
        if (game.hasProject('horse') && home) sfx.hooves()
      },
    },
    home: {
      interior: farmhouseInterior,
      opaque: true,
      label: 'the Farmhouse',
      // the dusk doorway belongs to supper (near.home claims it within
      // 3.2u); by day the house is the family's — walk right in
      gate: () => !dayCycle.atDusk && !sleepActive,
      fixedDoor: { x: BARN_AT[0], z: BARN_AT[1], yaw: BARN_ROT },
      doorLocalX: 0,
      doorGap: 3.0,
      exitGap: 4.2,
      bounds: () => farmhouseInterior.bounds,
      camInset: -0.1,
      camMaxY: 2.45, // under the 2.9 joists — tightness coupling earns its keep
      zoom: { min: 4.0, max: 7.0 },
      door: { dir: new Vector3(), out: new Vector3(), exitSpot: new Vector3() },
      // the REAL hinged door swings for you both directions and settles
      // shut behind the black (the sleep timeline owns it at dusk, not now)
      onDoorStart: () => homestead.openDoor(0.35),
      onSwap: () => homestead.closeDoor(0.5),
    },
  }
  const ROOM_IDS = Object.keys(ROOMS) as RoomId[]
  /** door triggers follow their building wherever the layout puts it */
  const roomYaw = (def: RoomDef): number =>
    def.fixedDoor ? def.fixedDoor.yaw : placeOf(state, def.placeId!).yaw
  const recomputeDoor = (id: RoomId): void => {
    const def = ROOMS[id]
    const at = def.fixedDoor ?? placeOf(state, def.placeId!)
    const yaw = def.fixedDoor ? def.fixedDoor.yaw : (at as { yaw: number }).yaw
    const d = def.door
    d.dir.set(Math.sin(yaw), 0, Math.cos(yaw))
    // the bay may sit off-center on the front face: slide along the
    // building's local +x first, then step out through the face
    const bx = at.x + Math.cos(yaw) * def.doorLocalX
    const bz = at.z - Math.sin(yaw) * def.doorLocalX
    d.out.set(bx, 0, bz).addScaledVector(d.dir, def.doorGap)
    d.exitSpot.set(bx, 0, bz).addScaledVector(d.dir, def.exitGap)
  }
  for (const id of ROOM_IDS) recomputeDoor(id)

  /** a building LANDED somewhere new: write the layout, then walk every
   * system that captured its position at boot (the Phase-0 review's land-
   * mine list — each item here answers one of them) */
  const relayout = (id: PlaceId, x: number, z: number): void => {
    setPlace(state, id, x, z)
    bindLayout(layoutView(state)) // ground art + exclusion zones follow
    const p = placeOf(state, id)
    if (id === 'tractor') {
      TRACTOR_SPOT.pos.set(p.x, 0, p.z)
    } else if (id === 'coop') {
      COOP_AT.set(p.x, 0, p.z)
      coopHens?.moveTo(COOP_AT, p.yaw)
      recomputeDoor('coop')
    } else if (id === 'stable') {
      STABLE_AT.set(p.x, 0, p.z)
      // the paddock (and the horse's grazing world) ride along — Grazers
      // hold the rect by REFERENCE, so mutating it re-aims her next wander
      const pr = paddockRect(state)
      HORSE_RECT.x0 = pr.x0 + 0.3
      HORSE_RECT.z0 = pr.z0 + 0.3
      HORSE_RECT.x1 = pr.x1 - 0.3
      HORSE_RECT.z1 = pr.z1 - 0.3
    } else if (id === 'greenhouse') {
      recomputeDoor('gh')
    } else if (id === 'stand') {
      marketToStand(p)
      reflowQueue()
    } else if (id === 'shop') {
      marketToShop(p)
      reflowQueue()
    } else if (id === 'pen') {
      const r = penRect(state)
      PEN_GATE.set(r.x1 + 0.4, 0, (r.gate.z0 + r.gate.z1) / 2)
      PEN_CENTER.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2)
      GOAT_RECT.x0 = r.x0 + 0.7
      GOAT_RECT.z0 = r.z0 + 0.7
      GOAT_RECT.x1 = r.x1 - 0.7
      GOAT_RECT.z1 = r.z1 - 0.7
      // penned sheep ride along with their home; the goats (whose grazing
      // rect just moved) amble over on their own
      flock.setPen(r)
    }
    // signs re-stake beside wherever their buildings stand now
    for (const [sid, sgn] of projectSigns) {
      scene.remove(sgn.group)
      disposeMaterials(sgn.group)
      projectSigns.delete(sid)
    }
    refreshProjectSigns()
    // the ground takes its worn dirt along (one-off repaint, hidden under
    // the landing squash); fresh lawn under the building hides instantly —
    // the full re-scatter happens overnight behind the sleep dip-to-black
    repaintGround()
    const fp = footprintOf(id)
    grass.hideIn({ x0: p.x - fp.w / 2 - 0.4, z0: p.z - fp.d / 2 - 0.4, x1: p.x + fp.w / 2 + 0.4, z1: p.z + fp.d / 2 + 0.4 })
    saveNow()
  }

  /** may the player pick this up right now? (one scene at a time) */
  const canLift = (id: PlaceId): boolean => {
    if (carry.carrying || carry.settling || fenceEditor.active) return false
    if (sleepActive || construction.active || fetchCine || roomBusy || room !== null || hud.modalOpen) return false
    // fields stay where they're laid out — carrying them dropped the player into
    // "something little lives there" dead-ends near the home-yard landmarks, with
    // no clear spot (owner's call: lock fields, keep buildings movable)
    if (fieldTierOf(id) >= 0) return false
    const owned =
      id === 'tractor'
        ? state.fieldParcels >= 3
        : id === 'pen'
          ? state.projects.sheep === true
          : id === 'stand'
            ? state.projects.stand === true && state.projects.shop !== true
            : state.projects[id] === true
    if (!owned) return false
    // Hazel can't come home to a missing stable
    if (id === 'stable' && state.produce.deliveryT > 0) return false
    // the pen stays put while the flock's out ("bring them home first")
    if (id === 'pen' && flock.missionActive) return false
    const p = placeOf(state, id)
    return player.pos.distanceTo(new Vector3(p.x, 0, p.z)) < 4.6
  }

  const tryLift = (id: PlaceId): boolean => {
    if (!canLift(id)) return false
    if (!carry.lift(id, player.group)) return false
    touch()
    sfx.crate()
    navigator.vibrate?.(20)
    // the carried building stops hiding the camera and stops occluding
    const g = carry.entries().find(([cid]) => cid === id)?.[1]
    if (g) {
      const occ = g.getObjectByName('occ-proxy') ?? g
      const i = OCCLUDERS.indexOf(occ as Mesh)
      if (i >= 0) OCCLUDERS.splice(i, 1)
    }
    return true
  }

  const cancelCarry = (): void => {
    const id = carry.carrying
    if (!id) return
    touch()
    const home = placeOf(state, id)
    carry.cancel(home.x, home.z, () => {
      // nothing changed — no relayout, just a landing where it lived
      sfx.crate()
      navigator.vibrate?.(12)
      sparkleBurst(scene, new Vector3(home.x, 0.6, home.z), false, 6)
      const g = carry.entries().find(([cid]) => cid === id)?.[1]
      const occ = (g?.getObjectByName('occ-proxy') ?? g) as Mesh | undefined
      if (occ && !OCCLUDERS.includes(occ)) OCCLUDERS.push(occ)
    })
  }

  const setDown = (): void => {
    const id = carry.carrying
    if (!id || !carryCheck.ok) return
    touch()
    const lx = carry.ghostAt.x // capture NOW — the ghost moves on
    const lz = carry.ghostAt.z
    carry.place(() => {
      relayout(id, lx, lz)
      sfx.pop()
      sfx.crate()
      navigator.vibrate?.([18, 30, 18])
      sparkleBurst(scene, new Vector3(lx, 0.6, lz), false, 10)
      const g = carry.entries().find(([cid]) => cid === id)?.[1]
      const occ = (g?.getObjectByName('occ-proxy') ?? g) as Mesh | undefined
      if (occ && !OCCLUDERS.includes(occ)) OCCLUDERS.push(occ)
    })
  }
  let roomBusy = false
  const FAR_OUTSIDE = cam.camera.far
  /** walk through an interior door, both directions (diner grammar: the
   * dip-to-black hides the off-world teleport). Only the ACTIVE room's
   * shell joins OCCLUDERS, and OPAQUE rooms hide the farm's heavy roots
   * (grass chunks, the forest) — no window in there looks back anyway. */
  const throughDoor = (which: RoomId, enter: boolean): void => {
    if (roomBusy) return
    roomBusy = true
    fenceEditor.close() // editing ends at any interior door
    touch()
    sfx.crate() // the old hinge
    ROOMS[which].onDoorStart?.()
    letterbox.fade(true, 0.22)
    gsap.delayedCall(0.26, () => {
      const def = ROOMS[which]
      def.onSwap?.(enter)
      room = enter ? which : null
      for (const id of ROOM_IDS) {
        const r = ROOMS[id]
        r.interior.setActive(id === room)
        for (const m of r.interior.shell) {
          const i = OCCLUDERS.indexOf(m)
          if (i >= 0) OCCLUDERS.splice(i, 1)
        }
      }
      if (enter) OCCLUDERS.push(...def.interior.shell)
      // opaque rooms see nothing past their own walls: hide the farm's
      // heavy roots and pull BOTH camera planes in — the whole outside
      // world frustum-culls itself (mobile keeps its 60fps), and a
      // wall-tight lens can't slice the wall out of the near frustum
      const opaque = enter && def.opaque
      grass.setVisible(!opaque)
      forest.visible = !opaque
      cam.camera.far = opaque ? 64 : FAR_OUTSIDE
      cam.camera.near = opaque ? 0.15 : 0.5
      cam.camera.updateProjectionMatrix()
      if (enter) def.onEnter?.()
      const to = enter ? def.interior.spawnPos : def.door.exitSpot
      player.pos.copy(to)
      prevPos.x = to.x
      prevPos.z = to.z
      lastCamPos.copy(to)
      camVelSmooth.set(0, 0, 0) // a teleport isn't motion — don't let it fling the look-ahead
      // leaving a room restores the OUTDOOR walk box — east bound grown to
      // reach the last crop-field parcel
      const bounds = enter ? def.bounds() : { ...WORLD_BOUNDS, maxX: worldMaxX(state.fieldParcels) }
      player.setBounds(bounds)
      // the camera lives in its own per-room volume (aim box = the walk
      // bounds exactly, so the focus keeps a near-safe radius off walls)
      if (enter) {
        cam.setConfine(
          camBoxFromRect(bounds, def.camInset, 1.0, def.camMaxY),
          camBoxFromRect(bounds, 0, 0.6, def.camMaxY),
        )
        cam.zoomRange(def.zoom.min, def.zoom.max)
      } else {
        cam.setConfine(null, null)
        cam.zoomRange(7, 17)
      }
      // CUT the camera through the black — never fly it 170u across the map.
      // Walking in it faces up the aisle; walking out, back toward the farm.
      cam.snapTo(player.pos)
      cam.yaw = enter ? 0 : Math.PI + roomYaw(def)
      letterbox.fade(false, 0.45)
      gsap.delayedCall(0.5, () => {
        roomBusy = false
      })
    })
  }
  const onAction = (id: string): void => {
    touch()
    // belt-and-braces: a stale button can never start a second scene
    // (roomBusy: nor act through the door-transition's dip to black)
    if (sleepActive || construction.active || roomBusy || fetchCine) return
    if (id === 'setdown') setDown()
    else if (id === 'carryback') cancelCarry()
    else if (id === 'enterroom' && near.roomDoor !== null) throughDoor(near.roomDoor, true)
    else if (id === 'exitroom' && room !== null && near.roomExit) throughDoor(room, false)
    else if (id.startsWith('move-')) tryLift(id.slice(5) as PlaceId)
    else if (carry.carrying) return // a building in your arms is a full-time job
    else if (id === 'fence-edit') fenceEditor.open()
    else if (id in CROPS && near.emptyPlot >= 0) plantAt(near.emptyPlot, id as CropKind)
    else if (id === 'stick' && near.dog && !dog.fetching && fetchCool <= 0) throwStick()
    else if (id === 'sleep' && near.home) sleepScene()
    else if (id === 'orders' && near.orders) openOrderPanel()
    else if (id === 'ride' && near.ride) mountHazel()
    else if (id === 'hopoff' && riding) dismountHazel()
    else if (id === 'catalog' && near.catalog) openCatalog()
    else if (id === 'decorpick' && near.decor) {
      // remove the nearest placed decoration so the player can re-arrange or
      // free a slot (no refund — decorChanged refreshes the world)
      if (game.removeDecorNear(player.pos.x, player.pos.z, 1.3)) {
        sfx.pop()
        hud.floatText(cam.screenPos(player.pos.clone().setY(0.6)), 'picked up \u{1F33C}')
      }
    }
    else if (id === 'decorplace' && placingDecor) commitDecor()
    else if (id === 'decorcancel') cancelDecorPlace()
    else if (id === 'upgrade' && near.upgrade) {
      const at = upgradeSigns.get(near.upgrade)?.at
      const def = game.buyUpgrade(near.upgrade)
      if (def) {
        if (at) {
          const sp = cam.screenPos(at.clone().setY(1.6))
          if (!sp.behind) hud.floatText(sp, `-${def.cost}c`)
        }
        refreshUpgradeSigns() // the sign is done — the building is upgraded
        saveNow()
      }
    }
    else if (id === 'shear' && near.pen) {
      const coins = game.shearFlock(flock.sheep.length)
      if (coins > 0) {
        sfx.pop()
        sfx.baa()
        player.gesture(engine.uTime.value)
        sparkleBurst(scene, PEN_CENTER.clone().setY(0.8), false, 8)
        fountainFrom(PEN_CENTER.clone().setY(0.8), coins, false)
        saveNow()
      }
    } else if (id === 'eggs' && near.coop) {
      const coins = game.collectCoop()
      if (coins > 0) {
        sfx.cluck()
        sfx.pop()
        player.gesture(engine.uTime.value)
        sparkleBurst(scene, COOP_AT.clone().setY(0.8), false, 8)
        fountainFrom(COOP_AT.clone().setY(0.8), coins, false)
        saveNow()
      }
    } else if (id === 'buyhen' && room === 'coop' && near.crate) {
      // the FIRST bought hen gets the full naming ceremony; after that the
      // plaque over her box does the talking (naming fatigue is real)
      const firstBought = state.coopFlock.hens.length === 4
      const hen = game.buyHen()
      if (hen) {
        sfx.cluck()
        sfx.pop()
        coopInterior.sync(state.coopFlock)
        sparkleBurst(scene, coopInterior.cratePos.clone().setY(0.9), false, 10)
        if (firstBought) {
          hud.showNameCard(hen.name, (name) => {
            hen.name = name.trim() === '' ? hen.name : name.trim()
            coopInterior.sync(state.coopFlock)
            hud.showBanner(`${hen.name} joins the flock \u{1F414}`, 'her box is on the wall, plaque and all')
            saveNow()
          })
        } else {
          hud.showBanner(`${hen.name} joins the flock \u{1F414}`, 'her name is over her box')
          saveNow()
        }
      }
    } else if (id === 'wing' && room === 'coop' && near.wing) {
      const tier = state.coopFlock.tier
      if (game.openWing()) {
        sfx.crate()
        sfx.pop()
        navigator.vibrate?.([18, 30, 18])
        // boards fly, THEN the room syncs (sync would hide them mid-flight)
        coopInterior.blowBoards(tier)
        coopInterior.sync(state.coopFlock)
        const wb = coopInterior.boundsForTier(state.coopFlock.tier)
        player.setBounds(wb)
        // the camera volume widens with the wing — same numbers as the door
        cam.setConfine(camBoxFromRect(wb, -0.1, 1.0, 3.9), camBoxFromRect(wb, 0, 0.6, 3.9))
        sparkleBurst(scene, coopInterior.wingBoardPos[tier].clone().setY(1.4), true, 14)
        hud.showBanner('The wing is open! \u{1F528}', `the henhouse holds ${HEN_CAPACITY[state.coopFlock.tier]} hens now`)
        if (coopGroup) buildCoopAnnex(coopGroup, state.coopFlock.tier)
        saveNow()
      }
    } else if (id === 'feedhens' && room === 'coop') {
      if (game.scatterFeed()) {
        hud.setWheat(state.wheat)
        feedCool = 24
        sfx.cluck()
        player.gesture(engine.uTime.value)
        coopInterior.scatterAt(player.pos.x, player.pos.z)
        saveNow()
      }
    } else if (id === 'pethorse' && room === 'stable' && near.stall) {
      if (game.petHorse()) {
        heartBurst(scene, HAZEL_MUZZLE)
        sfx.heart()
        player.gesture(engine.uTime.value)
        hud.showBanner(
          'Hazel leans into it \u{2764}\u{FE0F}',
          `${state.hazel.hearts} heart${state.hazel.hearts === 1 ? '' : 's'} — deliveries pay +${Math.min(8, state.hazel.hearts)}c`,
        )
        saveNow()
      }
    } else if (id === 'feedoats' && room === 'stable' && near.stall) {
      const heartsBefore = state.hazel.hearts
      if (game.feedHorse()) {
        hud.setWheat(state.wheat)
        sfx.crate()
        player.gesture(engine.uTime.value)
        if (state.hazel.hearts > heartsBefore) {
          heartBurst(scene, HAZEL_MUZZLE)
          sfx.heart()
        }
        saveNow()
      }
    } else if (id === 'hug' && room === 'home' && near.family) {
      if (game.greetFamily()) {
        const at = player.pos.distanceTo(farmhouseInterior.kidPos) < player.pos.distanceTo(farmhouseInterior.wifePos)
          ? farmhouseInterior.kidPos
          : farmhouseInterior.wifePos
        heartBurst(scene, at.clone().setY(1.3))
        sfx.heart()
        player.gesture(engine.uTime.value)
        // the renovated home lays on a breakfast — a small daily coin treat
        if (game.breakfastBonus > 0) {
          hud.showBanner('Family breakfast \u{1F373}', `the cosy kitchen warms the day \u{2014} +${game.breakfastBonus}c`)
          sfx.kaching()
        } else {
          hud.showBanner('Family time \u{1F49B}', 'the best part of any day')
        }
        saveNow()
      }
    } else if (id === 'milk' && near.pen) {
      const coins = game.milkGoats(grazers.count('goat'))
      if (coins > 0) {
        sfx.pop()
        player.gesture(engine.uTime.value)
        sparkleBurst(scene, PEN_CENTER.clone().setY(0.8), false, 8)
        fountainFrom(PEN_CENTER.clone().setY(0.8), coins, false)
        saveNow()
      }
    } else if (id === 'deliver' && near.stable) {
      // the order is named BEFORE the send so the toast and the receipt agree
      const order = orderFor(state.day, state.deliveriesSent)
      if (game.sendDelivery()) {
        hud.setWheat(state.wheat)
        sfx.hooves()
        player.gesture(engine.uTime.value)
        // she gallops from her paddock across the farm, out the south gate,
        // and off east down the road THROUGH the Millbrook gate — the whole
        // farm watches her go (that run IS the delivery story). The route
        // derives from wherever the stable stands TODAY.
        grazers.sendRun(
          'horse',
          deliveryRoute(state).map(([wx, wz]) => new Vector3(wx, 0, wz)),
          DELIVERY_RUN_TIME - 12,
        )
        const s = cam.screenPos(STABLE_AT.clone().setY(1.6))
        if (!s.behind) {
          hud.floatText(s, `Off to Millbrook — ${order.buyer}'s order \u{1F434}`)
          hud.floatText({ x: s.x, y: s.y + 26 }, '-1 \u{1F33E}')
        }
        saveNow()
      }
    } else if (id === 'build' && near.project) {
      const def = game.buildProject(near.project)
      if (def) {
        hud.setCoins(state.coins)
        refreshProjectSigns()
        sfx.crate()
        hud.dismissBanner() // a lingering event toast must not float over the scene
        const buildAt = projectSite(def) // the crew digs at the LAYOUT site
        // the SPEND lands visibly at the site before the crew arrives —
        // a price paid on-screen is a decision honored, not a ledger entry
        sfx.kaching()
        const spendAt = cam.screenPos(new Vector3(buildAt.x, 1.6, buildAt.z))
        if (!spendAt.behind) hud.floatText(spendAt, `-${def.cost}c`)
        construction.play({
          site: new Vector3(buildAt.x, 0, buildAt.z),
          yaw: def.yaw,
          footprint: def.footprint,
          cost: def.cost,
          dig: def.kind !== 'building',
          reveal: () => applyProject(def, true),
          done: () => {
            // the banner answers "what does this DO for me" — purpose first
            hud.showBanner(`${def.name}!`, def.earns)
            music.duck()
            sfx.fanfare()
            rareSlowMo()
            if (queuedLevelUp) {
              gsap.delayedCall(1.2, queuedLevelUp)
              queuedLevelUp = null
            }
            saveNow()
          },
        })
      }
    } else if (id === 'townbuild' && near.town) {
      const def = nextTownAct(state)
      if (def && game.buyTownAct(def.id)) {
        hud.setCoins(state.coins)
        hud.setWheat(state.wheat)
        sfx.kaching()
        const spendAt = cam.screenPos(TOWN_SIGN_AT.clone().setY(1.6))
        if (!spendAt.behind) hud.floatText(spendAt, `-${def.coins}c  -${def.wheat}\u{1F33E}`)
        hud.dismissBanner()
        construction.play({
          site: new Vector3(def.lot[0], 0, def.lot[1]),
          yaw: def.yaw,
          footprint: def.footprint,
          cost: def.coins,
          dig: false,
          reveal: () => {
            townSet.reveal(def.id, true)
            if (def.id === 'works') townSet.setShift(true)
            if (def.id === 'cottages') townSet.setStrollers(true)
          },
          done: () => {
            hud.showBanner(`${def.name}!`, def.earns)
            music.duck()
            sfx.fanfare()
            rareSlowMo()
            refreshTownSign()
            if (queuedLevelUp) {
              gsap.delayedCall(1.2, queuedLevelUp)
              queuedLevelUp = null
            }
            saveNow()
          },
        })
      }
    } else if (id === 'deed' && near.deed) {
      const def = game.expand()
      if (def) {
        hud.setCoins(state.coins)
        sfx.kaching()
        expandCeremony(def)
        saveNow()
      }
    } else if (id === 'sow' && near.tractor && tractor && sowCooldown <= 0) {
      const planted = game.plantAll('wheat')
      if (planted.length) {
        sowCooldown = TRACTOR_COOLDOWN
        sfx.tractor()
        tractor.chug()
        // the sowing must be IMPOSSIBLE to miss (owner pressed it and saw
        // "nothing"): the count floats at the tractor and a sparkle wave
        // rolls plot to plot as each one takes its seed
        const ts = cam.screenPos(tractor.position.clone().setY(1.8))
        if (!ts.behind) hud.floatText(ts, `${planted.length} plots sown 🌾`)
        planted.forEach((i, k) =>
          gsap.delayedCall(0.45 + k * 0.14, () => {
            plots[i]?.setCrop('wheat', 0, true)
            sparkleBurst(scene, plots[i].center.clone().setY(0.5), false, 4)
            sfx.plant()
          }),
        )
        player.gesture(engine.uTime.value)
        saveNow()
      }
    } else if (id === 'feed' && game.canFeed()) {
      if (game.feed()) {
        hud.setWheat(state.wheat)
        chicken.eat(engine.uTime.value)
        sfx.cluck()
        saveNow()
      }
    } else if (id === 'pet' && game.canPet()) {
      if (game.pet()) {
        heartBurst(scene, chicken.tagWorldPos())
        sfx.heart()
        chicken.acknowledge(cam.camera.position)
        saveNow()
      }
    }
  }

  // picket fence is solid except at its gates (walls/gates follow the tier)
  const prevPos = { x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z }
  /** fence honesty + walk-to-draw. Normally any fence edge (except gates)
   * cancels the step that crosses it. In fence mode the player is the
   * builder: steps are never blocked, and every grid line they cross gets a
   * fence BEHIND them (you can never wall yourself in mid-stride). */
  const fenceBlock = (): void => {
    const p = player.pos
    blockByEdges(prevPos, p, fences)
    // buildings are SOLID now (the camera was living inside coop roofs):
    // a step INTO a footprint cancels; stepping OUT is always allowed, and
    // cutscene escorts (the sleep walk enters the homestead) pass freely
    if (!player.autoWalking && pointInBuilding(state, p.x, p.z, carry.carrying) && !pointInBuilding(state, prevPos.x, prevPos.z, carry.carrying)) {
      p.x = prevPos.x
      p.z = prevPos.z
    }
    prevPos.x = p.x
    prevPos.z = p.z
  }

  // ---- fixed-step systems ------------------------------------------------------
  let saveAccum = 0
  let coinMismatchFor = 0
  let standT = 0
  let movedEver = false
  /** the current action-button ids (dev driver / E2E introspection) */
  let lastActions: string[] = []
  /** engine time when dusk parked (-1 while the sun is up) — chip cadence */
  let duskAt = -1
  engine.onUpdate((dt) => {
    game.update(dt)
    customers.active = state.harvests >= 1 && (game.hasProject('stand') || game.hasProject('shop'))
    customers.update(dt, game.stock())
    player.update(dt, joy.value, cam.yaw)
    fenceBlock()
    // ---- carry & place: long-press lifts; the ghost glides ahead ----
    checkLongPress()
    if (carry.carrying) {
      const fp = footprintOf(carry.carrying)
      const ahead = Math.max(fp.w, fp.d) / 2 + 1.4
      const gx = snapToGrid(player.pos.x + Math.sin(player.facing) * ahead)
      const gz = snapToGrid(player.pos.z + Math.cos(player.facing) * ahead)
      carryCheck = canPlace(state, carry.carrying, gx, gz)
      carry.aimGhost(gx, gz, carryCheck.ok)
    }
    if (placingDecor && decorGhost) {
      decorAim.set(player.pos.x + Math.sin(player.facing) * 2.0, 0, player.pos.z + Math.cos(player.facing) * 2.0)
      decorGhost.position.copy(decorAim)
      decorGhost.rotation.y = player.facing
      decorOk = game.canBuyDecor(placingDecor, decorAim.x, decorAim.z)
      decorPad.position.set(decorAim.x, 0.03, decorAim.z)
      ;(decorPad.material as MeshBasicMaterial).color.setHex(decorOk ? 0x5ac85a : 0xd05a5a)
    }
    chicken.update(dt)
    dog.update(dt, player.pos)
    flock.update(dt, player.pos, dog.group.position, fences)
    construction.update(dt)
    grazers.update(dt, player.pos)
    // fetch cinema safety: if the mission system yanked Rex off the job,
    // close the scene (the normal ending is scripted in onFetchDone)
    if (fetchCine && !cineEnding && !dog.fetching) endFetchCine()
    coopHens?.update(dt)

    // sheep slip out while you wait on crops (post-FTUE, one mission at a
    // time). Framed as an INVITATION, not an alarm (cozy rule: no needy
    // mechanics): the music keeps playing, and a fetch in flight finishes
    // before any sheep wander — the game never snatches Rex's stick away.
    if (
      !flock.missionActive &&
      flock.sheep.length > 0 &&
      state.harvests >= 2 &&
      !hud.modalOpen &&
      !sleepActive &&
      !construction.active &&
      !dog.fetching &&
      // no wanderers while the player is under glass (or mid-door-cut) —
      // an invitation you can't see is a nag waiting at the exit. Nor with
      // a building overhead: one job at a time.
      room === null &&
      !roomBusy &&
      !carry.carrying
    ) {
      herdTimer -= dt
      if (herdTimer <= 0) {
        const n = flock.startEscape(state.level >= 6 ? 3 : 2)
        if (n > 0) {
          dropStick() // pick the stick back up after the flock's home, Rex
          hud.showBanner('Wanderers! \u{1F411}', `${n} sheep strolled out to the meadow — Rex is ready when you are`)
          sfx.baa()
          herdTimer = Number.POSITIVE_INFINITY // reset by onAllHome
        } else {
          herdTimer = 60
        }
      }
    }
    // Rex works the flock: flank the sheep nearest home, push from the far side
    if (flock.missionActive) {
      flankTick -= dt
      if (flankTick <= 0) {
        flankTick = 0.4
        const loose = flock.loosePositions()
        if (loose.length) {
          let best = loose[0]
          let bd = Number.POSITIVE_INFINITY
          for (const s of loose) {
            const d = s.distanceTo(PEN_GATE)
            if (d < bd) {
              bd = d
              best = s
            }
          }
          // station just OUTSIDE the flee radius: Rex contains the far side,
          // the PLAYER provides the push — teamwork, not a self-playing dog
          const dir = best.clone().sub(PEN_GATE).setY(0).normalize()
          dog.herdTo(best.clone().add(dir.multiplyScalar(3.8)))
        } else {
          dog.herdTo(null)
        }
      }
    } else {
      dog.herdTo(null)
    }
    for (const v of customerViews.values()) v.update(dt)
    serveCooldown = Math.max(0, serveCooldown - dt)
    sowCooldown = Math.max(0, sowCooldown - dt)
    fetchCool = Math.max(0, fetchCool - dt)
    feedCool = Math.max(0, feedCool - dt)
    if (joy.active) {
      touch()
      if (joy.active) movedEver = true
    }

    // ---- the 20Hz tier: proximity, buttons, chips, guidance ----
    // Pure derivation runs every 3rd fixed step: interaction radii are 2u+
    // and nothing the thumb feels changes in 33ms — but this block is where
    // the per-tick allocation churn lived (the perf audit's GC finding).
    // Movement, physics, cooldowns and fences above stay at 60Hz.
    uiTick = (uiTick + 1) % 3
    if (uiTick === 0) {
    const uiDt = dt * 3
    // glow tiers from growth progress
    for (let i = 0; i < plots.length; i++) {
      const crop = game.plotAt(i)?.crop ?? null
      const mode = !crop ? 'none' : crop.remaining <= 0 ? 'ready' : 1 - crop.remaining / crop.total >= 0.9 ? 'shimmer' : 'none'
      if (mode !== lastGlow[i]) {
        plots[i].setGlow(mode)
        lastGlow[i] = mode
      }
    }

    // ---- proximity scan (you go to it, it happens) ----
    near.emptyPlot = -1
    near.growingPlot = -1
    const p = player.pos
    // the goodnight walk passes the fields — no auto-harvests mid-cinematic
    if (!hud.modalOpen && !sleepActive) {
      for (let i = 0; i < plots.length; i++) {
        if (!plots[i].group.visible) continue // riding overhead right now
        if (p.distanceTo(plots[i].center) > PLOT_R) continue
        const crop = game.plotAt(i)?.crop
        if (!crop) {
          if (near.emptyPlot < 0) near.emptyPlot = i
        } else if (crop.remaining <= 0) doHarvest(i)
        else near.growingPlot = i
      }
      near.deed = deedSign !== null && p.distanceTo(deedSign.at) < 2.5
      near.town = townSign !== null && p.distanceTo(TOWN_SIGN_AT) < 2.6
      near.orders = orderBoard !== null && p.distanceTo(ORDER_BOARD_AT) < 2.4
      near.upgrade = null
      let upgD = 2.6
      for (const [id, s] of upgradeSigns) {
        const d = p.distanceTo(s.at)
        if (d < upgD) {
          upgD = d
          near.upgrade = id
        }
      }
      // ---- Millbrook breathes on the day clock ----
      customers.pace = state.town.built.cottages ? 0.7 : 1
      if (state.town.built.bakery && !sleepActive && !construction.active) {
        // two buses a day now (the town used to look dead between the single
        // 21s morning run and dusk): morning visitors in, afternoon trippers
        // home. Keyed per-half-day so a reload can't double-ring the same run.
        if (busWindow(dayCycle.phase) && state.town.lastBusDay !== `day-${state.day}-am`) {
          state.town.lastBusDay = `day-${state.day}-am`
          townSet.busRun()
          sfx.bell()
          hud.showBanner('The morning bus \u{1F68C}', 'visitors ride in from Millbrook')
          saveNow()
        } else if (busWindowPm(dayCycle.phase) && state.town.lastBusDay !== `day-${state.day}-pm`) {
          state.town.lastBusDay = `day-${state.day}-pm`
          townSet.busRun()
          sfx.bell()
          hud.showBanner('The afternoon bus \u{1F68C}', 'the day-trippers head home')
          saveNow()
        }
      }
      // the station's train rolls through twice a day (silent ambience — the
      // bus owns the banner; same half-day windows, its own latch)
      if (state.town.built.station && !sleepActive && !construction.active) {
        if (busWindow(dayCycle.phase) && state.town.lastTrainDay !== `day-${state.day}-am`) {
          state.town.lastTrainDay = `day-${state.day}-am`
          townSet.trainRun()
        } else if (busWindowPm(dayCycle.phase) && state.town.lastTrainDay !== `day-${state.day}-pm`) {
          state.town.lastTrainDay = `day-${state.day}-pm`
          townSet.trainRun()
        }
      }
      const recess = state.town.built.school === true && recessNow(dayCycle.phase) && !sleepActive
      if (recess !== recessWas) {
        recessWas = recess
        townSet.setRecess(recess)
        if (recess) sfx.bell() // the schoolbell — once, gentle
      }
      near.tractor = tractor !== null && p.distanceTo(tractor.position) < 2.9
      near.dog = !flock.missionActive && p.distanceTo(dog.group.position) < 2.6
      near.home = !sleepActive && dayCycle.atDusk && p.distanceTo(homestead.doorPos) < 3.2
      near.pen = game.hasProject('sheep') && p.distanceTo(PEN_CENTER) < 4.2
      near.stable = game.hasProject('stable') && p.distanceTo(STABLE_AT) < 3.4
      near.coop = game.hasProject('coop') && p.distanceTo(COOP_AT) < 3.6
      near.ride =
        !riding && canRideHazel(state) && state.produce.deliveryT <= 0 && p.distanceTo(PADDOCK_CENTER) < 3.6
      near.catalog =
        !placingDecor && !riding && game.hasProject('shop') && MARKET.atShop && p.distanceTo(MARKET.pos) < 3.4
      near.decor =
        !placingDecor &&
        !riding &&
        !carry.carrying &&
        state.decor.some((d) => (d.x - p.x) ** 2 + (d.z - p.z) ** 2 < 1.69)
      near.project = null
      let signD = 2.6
      for (const [id, s] of projectSigns) {
        const d = p.distanceTo(s.at)
        if (d < signD) {
          signD = d
          near.project = id
        }
      }
      // walk-in doors are BUTTONS now, not trip-wires (owner: ghosting
      // through a wall reads wrong — "press enter, press exit, fast").
      // The transition itself stays the quick 0.7s dip, never a cutscene.
      near.roomDoor = null
      near.roomExit = false
      if (!construction.active && !fetchCine && !carry.carrying) {
        if (room === null) {
          for (const id of ROOM_IDS) {
            const def = ROOMS[id]
            // gate() guards ENTERING only — leaving is always allowed
            if (!def.gate()) continue
            if (p.distanceTo(def.door.out) < 1.7) {
              near.roomDoor = id
              break
            }
          }
        } else if (p.distanceTo(ROOMS[room].interior.exitPos) < 1.5) {
          near.roomExit = true
        }
      }
      // inside the henhouse: walking the box row collects as you pass, and
      // every inside egg rolls for GOLD (the reason to visit in person)
      near.crate = false
      near.wing = false
      if (room === 'coop' && !roomBusy && !carry.carrying) {
        for (let i = 0; i < state.coopFlock.boxes.length; i++) {
          if (!state.coopFlock.boxes[i].ready) continue
          const bp = coopInterior.boxPositions[i]
          if (!bp || p.distanceTo(bp) > 1.25) continue
          const got = game.collectBoxInside(i)
          if (!got) continue
          sfx.cluck()
          if (got.golden) {
            // the wind-up: a held breath before the payoff (the roll is
            // already banked and saved — this is pure theater)
            sfx.tink()
            sparkleBurst(scene, bp.clone().setY(1.0), false, 4)
            const at = bp.clone()
            const henName = state.coopFlock.hens[i]?.name ?? 'The flock'
            gsap.delayedCall(0.45, () => {
              sfx.golden()
              sparkleBurst(scene, at.clone().setY(1.0), true, 16)
              fountainFrom(at.clone().setY(0.9), got.coins, true)
              hud.showBanner('A golden egg! \u2728', `${henName} outdid herself — ${got.coins}c`)
            })
          } else {
            sfx.pop()
            sparkleBurst(scene, bp.clone().setY(1.0), false, 6)
            fountainFrom(bp.clone().setY(0.9), got.coins, false)
          }
          coopInterior.sync(state.coopFlock)
          saveNow()
        }
        near.crate = p.distanceTo(coopInterior.cratePos) < 2.0
        near.wing = state.coopFlock.tier < MAX_COOP_TIER && p.distanceTo(coopInterior.wingBoardPos[state.coopFlock.tier]) < 2.4
      }
      near.stall = room === 'stable' && !roomBusy && p.distanceTo(STALL_GATE) < 2.1
      near.family =
        room === 'home' &&
        !roomBusy &&
        (p.distanceTo(farmhouseInterior.wifePos) < 1.9 || p.distanceTo(farmhouseInterior.kidPos) < 1.9)
      near.fence = nearestEdge(fences, p.x, p.z, 3.0)
      // nearest building you could pick up (fallback button + discoverability)
      near.movable = null
      if (!carry.carrying && !carry.settling && !riding) {
        let md = 3.4
        for (const id of PLACE_IDS) {
          if (!canLift(id)) continue
          const pl = placeOf(state, id)
          const d = p.distanceTo(new Vector3(pl.x, 0, pl.z))
          if (d < md) {
            md = d
            near.movable = id
          }
        }
      }
      near.chicken = chicken.settled && p.distanceTo(chicken.group.position) < CHICK_R
      // neither the egg pickup nor the crate ceremony fires with a building
      // overhead — the ceremony opens a modal that would orphan the carry
      if (state.chicken.eggReady && chicken.settled && !carry.carrying && p.distanceTo(NEST_POS) < CHICK_R) collectEgg()
      if (chicken.cratePending && !carry.carrying && p.distanceTo(chicken.crateWorldPos) < CRATE_R) {
        cam.focusOn(CRATE_POS, 0.7)
        chicken.beginOpen(
          () => sfx.crate(),
          () => {
            cam.release(0.9)
            runNaming()
          },
        )
      }
      if (!carry.carrying && p.distanceTo(MARKET.pos) < STAND_R) tryServe()

      // stand still on an empty plot for a moment -> wheat plants itself.
      // Only after the player has planted once BY CHOICE (an action the game
      // took for me is not mine — IKEA effect), and slow enough that reaching
      // for the corn button never loses a race to free wheat. Glasshouse beds
      // are exempt: those are CHOSEN plantings of rare crops, never wheat.
      if (near.emptyPlot >= 0 && !game.isGreenhouse(near.emptyPlot) && !carry.carrying && player.speed < 0.3 && state.chipsDone.plant) {
        standT += uiDt
        if (standT >= AUTOPLANT_AFTER) {
          standT = 0
          plantAt(near.emptyPlot, 'wheat')
        }
      } else {
        standT = 0
      }
    }

    // ---- context action buttons (big, above the right thumb) ----
    // one scene at a time: no buttons exist while ANY cinematic is rolling
    const actions: ActionDef[] = []
    if (riding) {
      // up on Hazel: the only verb is to get back down (riding owns the rest)
      actions.push({ id: 'hopoff', emoji: '\u{1F434}', label: 'Hop down', sub: 'back on your own feet' })
    } else if (placingDecor && !hud.modalOpen) {
      // arranging a decoration — set it down where the pad is green, or bail
      actions.push({
        id: 'decorplace',
        emoji: '\u{1F33C}',
        label: 'Place it here',
        sub: decorOk ? 'set it down' : "can't place there",
        locked: !decorOk,
      })
      actions.push({ id: 'decorcancel', emoji: '\u{274C}', label: 'Cancel', sub: 'never mind' })
    } else if (carry.carrying && !hud.modalOpen) {
      // one verb while a building is in your arms (the spot speaks via color)
      const why: Record<string, string> = {
        far: "you couldn't walk back to it out there",
        land: 'buildings stay in the homestead yard',
        road: 'the road has to stay clear',
        field: 'crops will grow there',
        pen: "that's the sheep's yard",
        paddock: "that's Hazel's paddock",
        building: 'too close to another building',
        home: 'the family house has roots',
        spot: 'something little lives there',
        gate: 'keep the gateway walkable',
        'hazel-out': "she's on the road",
      }
      actions.push({
        id: 'setdown',
        emoji: '\u{1F4E6}',
        label: 'Set it down',
        sub: carryCheck.ok ? 'right here' : (why[carryCheck.reason ?? 'building'] ?? 'not here'),
        locked: !carryCheck.ok,
      })
      // every edit needs a way OUT — with no legal ground in reach the
      // farmer was stuck holding his own coop forever
      actions.push({
        id: 'carryback',
        emoji: '\u{21A9}\u{FE0F}',
        label: 'Put it back',
        sub: 'right where it was',
      })
    } else if (fenceEditor.active) {
      // the editor panel owns the screen — no contextual buttons under it
    } else if (!hud.modalOpen && !sleepActive && !construction.active && !fetchCine && !roomBusy && !carry.settling) {
      if (room === null && near.roomDoor !== null) {
        actions.push({
          id: 'enterroom',
          emoji: '\u{1F6AA}',
          label: `Enter ${ROOMS[near.roomDoor].label}`,
          sub: 'step inside',
        })
      }
      if (room !== null && near.roomExit) {
        actions.push({
          id: 'exitroom',
          emoji: '\u{1F6AA}',
          label: `Exit ${ROOMS[room].label}`,
          sub: 'back to the farm',
        })
      }
      if (near.upgrade && room === null) {
        const def = upgradeDef(near.upgrade)
        const aff = state.coins >= def.cost
        actions.push({
          id: 'upgrade',
          emoji: def.emoji,
          label: def.name,
          sub: aff ? `${def.cost}c \u{2014} ${def.blurb}` : `${def.cost}c \u{2014} need ${def.cost - state.coins} more`,
          locked: !aff,
        })
      }
      if (near.orders && room === null) {
        const open = game.contractBoard().filter((r) => !r.done).length
        actions.push({
          id: 'orders',
          emoji: '\u{1F4CB}',
          label: 'The Order Board',
          sub: open > 0 ? `${open} order${open === 1 ? '' : 's'} waiting` : 'all filled today — back tomorrow',
        })
      }
      if (near.town && room === null) {
        const def = nextTownAct(state)
        if (def) {
          const st = game.townStatusOf(def.id)
          actions.push({
            id: 'townbuild',
            emoji: '\u{1F3D8}\u{FE0F}',
            label: `Build ${def.name}`,
            sub:
              st === 'ok'
                ? `${def.coins}c + ${def.wheat} wheat`
                : st === 'delivered'
                  ? `make ${def.needDelivered - state.town.delivered} more deliveries`
                  : st === 'coins'
                    ? `${def.coins}c — need ${def.coins - state.coins} more`
                    : st === 'wheat'
                      ? `needs ${def.wheat} wheat in the pantry`
                      : 'the town builds in order',
            locked: st !== 'ok',
          })
        }
      }
      if (room === 'coop') {
        // the henhouse's own verbs — the farm's buttons stay outside
        if (near.crate) {
          const st = game.henBuyStatus()
          const cost = henCost(state.coopFlock.hens.length)
          actions.push({
            id: 'buyhen',
            emoji: '\u{1F414}',
            label: 'A new hen',
            sub:
              st === 'ok'
                ? `${cost}c — her box waits on the wall`
                : st === 'capacity'
                  ? 'open the next wing first'
                  : `${cost}c — short on coins`,
            locked: st !== 'ok',
          })
        }
        if (near.wing) {
          const ws = game.wingStatus()
          const tier = state.coopFlock.tier
          actions.push({
            id: 'wing',
            emoji: '\u{1F528}',
            label: tier === 0 ? 'Open the east wing' : tier === 1 ? 'Open the long wing' : 'Open the Long Roost',
            sub:
              ws === 'ok'
                ? `${WING_COST[tier]}c — room for ${HEN_CAPACITY[tier + 1]} hens`
                : ws === 'level'
                  ? `reach Lv ${WING_LEVEL[tier]} first`
                  : `${WING_COST[tier]}c — short on coins`,
            locked: ws !== 'ok',
          })
        }
        if (feedCool <= 0 && state.coopFlock.hens.length > 0) {
          actions.push({
            id: 'feedhens',
            emoji: '\u{1F33E}',
            label: 'Scatter feed',
            sub: state.wheat >= 1 ? 'the whole flock comes running' : 'grow 1 wheat first',
            locked: state.wheat < 1,
          })
        }
      }
      if (room === 'stable' && near.stall && game.hasProject('horse') && state.produce.deliveryT <= 0) {
        // Hazel's verbs — only while she's actually home in her stall
        if (game.canPetHorse()) {
          actions.push({
            id: 'pethorse',
            emoji: '\u{1F434}',
            label: 'Pet Hazel',
            sub: 'once a day — she remembers',
          })
        }
        actions.push({
          id: 'feedoats',
          emoji: '\u{1F33E}',
          label: 'A scoop of oats',
          sub: state.wheat >= 1 ? 'hearts pay +1c on her runs' : 'grow 1 wheat first',
          locked: state.wheat < 1,
        })
      }
      if (room === 'home' && near.family && game.canGreetFamily()) {
        actions.push({
          id: 'hug',
          emoji: '\u{1F49B}',
          label: 'Say hello',
          sub: 'family time — once a day',
        })
      }
      if (near.emptyPlot >= 0) {
        if (game.isGreenhouse(near.emptyPlot)) {
          // the glasshouse ladder — rare crops, planted only under glass
          for (const kind of GREENHOUSE_CROPS) {
            const def = CROPS[kind]
            const ok = game.cropUnlocked(kind)
            actions.push({
              id: kind,
              emoji: GOOD_EMOJI[kind],
              label: `Plant ${def.label}${def.label.endsWith('o') ? 'es' : 's'}`,
              sub: ok ? `~${Math.round((def.growSec * 0.6) / 60)}m under glass · ${def.sell}c` : `Lv ${def.unlockLevel}`,
              locked: !ok,
            })
          }
        } else {
          actions.push({ id: 'wheat', emoji: '\u{1F33E}', label: 'Plant Wheat', sub: '90s · 2c' })
          const cornOk = game.cropUnlocked('corn')
          actions.push({
            id: 'corn',
            emoji: '\u{1F33D}',
            label: 'Plant Corn',
            sub: cornOk ? '4m · 5c' : `Lv ${CROPS.corn.unlockLevel}`,
            locked: !cornOk,
          })
        }
      }
      if (near.chicken) {
        const name = state.chicken.name ?? 'her'
        if (game.canFeed()) actions.push({ id: 'feed', emoji: '\u{1F33E}', label: `Feed ${name}`, sub: '1 wheat → egg' })
        if (game.canPet()) actions.push({ id: 'pet', emoji: '\u{1F497}', label: `Pet ${name}`, sub: 'once a day' })
      }
      if (near.deed) {
        const def = game.nextDeed()
        const status = game.deedStatus()
        if (def && status) {
          actions.push({
            id: 'deed',
            emoji: '\u{1F4DC}',
            label: `Buy ${def.name}`,
            sub:
              status === 'ok'
                ? `${def.cost} coins`
                : status === 'level'
                  ? `reach Lv ${def.level} first`
                  : `${def.cost} coins — need ${def.cost - state.coins} more`,
            locked: status !== 'ok',
          })
        }
      }
      if (near.tractor) {
        let empties = 0
        // the tractor sows FIELDS — glasshouse beds are hand-planted
        for (let i = 0; i < game.plotTotal; i++) if (!game.plotAt(i)?.crop && !game.isGreenhouse(i)) empties++
        const ready = sowCooldown <= 0 && empties > 0
        actions.push({
          id: 'sow',
          emoji: '\u{1F69C}',
          label: 'Sow ALL plots',
          sub: ready ? `${empties} plots · wheat` : sowCooldown > 0 ? `catching breath ${Math.ceil(sowCooldown)}s` : 'fields are full',
          locked: !ready,
        })
      }
      if (near.project) {
        const entry = game.projectBoard().find((e) => e.def.id === near.project)
        if (entry && entry.status !== 'owned') {
          const { def, status } = entry
          actions.push({
            id: 'build',
            emoji: '\u{1F3D7}',
            label: `Build ${def.name}`,
            sub:
              status === 'ok'
                ? `${def.cost} coins`
                : status === 'level'
                  ? `reach Lv ${def.level} first`
                  : status === 'coins'
                    ? `${def.cost} coins — need ${def.cost - state.coins} more`
                    : status === 'needs'
                      ? `build ${game.projectBoard().find((e) => e.def.id === def.requires)?.def.name ?? 'the prerequisite'} first`
                      : 'needs more land',
            locked: status !== 'ok',
          })
        }
      }
      if (near.home) {
        actions.push({ id: 'sleep', emoji: '\u{1F319}', label: 'Head in for the night', sub: "supper's ready" })
      }
      if (near.pen && state.produce.woolReady && flock.sheep.length > 0) {
        actions.push({
          id: 'shear',
          emoji: '\u{2702}\u{FE0F}',
          label: 'Shear the flock',
          sub: `${flock.sheep.length} sheep \u{2192} ${Math.round(flock.sheep.length * WOOL_COIN_PER_SHEEP * woolMult(state))}c`,
        })
      }
      if (near.coop && game.coopReadyCount() > 0) {
        actions.push({
          id: 'eggs',
          emoji: '\u{1F95A}',
          label: 'Gather the eggs',
          sub: `${game.coopReadyCount()} boxes \u{2192} ${game.coopReadyCount() * COOP_COIN_PER_HEN}c`,
        })
      }
      if (near.pen && state.produce.milkReady && grazers.count('goat') > 0) {
        actions.push({
          id: 'milk',
          emoji: '\u{1F95B}',
          label: 'Milk the goats',
          sub: `${grazers.count('goat')} goats \u{2192} ${grazers.count('goat') * MILK_COIN_PER_GOAT}c`,
        })
      }
      if (near.stable) {
        const ds = game.deliveryStatus()
        if (ds !== 'no-stable') {
          actions.push({
            id: 'deliver',
            emoji: '\u{1F434}',
            label: 'Send Hazel to town',
            sub:
              ds === 'ok'
                ? `feed 1 \u{1F33E} \u{2192} 26-50c \u{B7} ${Math.round(DELIVERY_RUN_TIME)}s trip`
                : ds === 'feed'
                  ? 'needs 1 wheat to feed her'
                  : ds === 'out'
                    ? "she's on the road"
                    : `resting ${Math.ceil(state.produce.deliveryCd)}s`,
            locked: ds !== 'ok',
          })
        }
      }
      if (near.ride) {
        actions.push({ id: 'ride', emoji: '\u{1F434}', label: 'Ride Hazel', sub: 'saddle up and roam the farm' })
      }
      if (near.catalog) {
        actions.push({ id: 'catalog', emoji: '\u{1F380}', label: 'The Catalog', sub: 'decorations & fence skins' })
      }
      if (near.decor) {
        actions.push({ id: 'decorpick', emoji: '\u{1F91A}', label: 'Pick it up', sub: 're-arrange or free a slot' })
      }
      if (near.dog && !dog.fetching && fetchCool <= 0) {
        actions.push({ id: 'stick', emoji: '\u{1FAB5}', label: 'Throw the stick', sub: 'Rex loves this' })
      }
      // fallback verbs only join a QUIET stack — when real work is on the
      // buttons (plant/serve/sow...), they step aside (long-press still
      // lifts, the fence editor entry waits for a calmer moment)
      if (actions.length <= 2 && near.movable) {
        actions.push({
          id: `move-${near.movable}`,
          emoji: '\u{1F4E6}',
          label: `Move ${PLACE_NAMES[near.movable]}`,
          sub: 'carry it anywhere',
        })
      }
      if (actions.length <= 2 && (near.fence !== null || fences.edges.size + fences.gates.size === 0)) {
        actions.push({ id: 'fence-edit', emoji: '\u{1F6E0}', label: 'Edit fences', sub: 'draw, gate, remove' })
      }
    }
    lastActions = actions.map((a) => a.id)
    hud.setActions(actions, onAction)

    // ---- contextual top chip: top suggestion whose chip hasn't been retired ----
    const sug = game.suggestion()
    const customerWaiting = customers.frontServiceable(game.stock())
    const buildable = game.projectBoard().find((e) => e.status === 'ok') ?? null
    // bedtime is an INVITATION, not a nag: the supper chip leads for its
    // first 20s of dusk, then steps aside for customers/produce and only
    // resurfaces once the player has gone quiet (golden hour is theirs)
    if (dayCycle.atDusk) {
      if (duskAt < 0) duskAt = engine.uTime.value
    } else {
      duskAt = -1
    }
    const duskFor = duskAt >= 0 ? engine.uTime.value - duskAt : -1
    let chipText: string | null = null
    if (!hud.modalOpen && !construction.active && !sleepActive && !fenceEditor.active) {
      if (!movedEver && !state.chipsDone.plant) {
        chipText = 'Drag the joystick to take a walk \u{1F33B}'
      } else if (dayCycle.atDusk && duskFor < 20) {
        chipText = state.plots.some((p) => !p.crop)
          ? '\u{1F319} Plant before bed — crops grow overnight'
          : "\u{1F319} The sun's setting — head home for supper"
      } else if (customerWaiting) {
        chipText = MARKET.atShop ? 'A customer is waiting at the shop!' : 'A customer is waiting at the stand!'
      } else if (state.produce.deliveryT > 0 && game.hasProject('horse')) {
        // the trip is trackable: rounded so the chip doesn't churn per frame
        chipText = `\u{1F434} Hazel's in Millbrook — back in ~${Math.max(5, Math.ceil(state.produce.deliveryT / 5) * 5)}s`
      } else if (state.produce.woolReady && game.hasProject('sheep')) {
        chipText = "\u{2702}\u{FE0F} The flock's wool is ready — shear it at the pen"
      } else if (state.produce.milkReady && game.hasProject('goats')) {
        chipText = '\u{1F95B} The goats are ready for milking'
      } else if (game.coopReadyCount() >= 3 && game.hasProject('coop')) {
        chipText = '\u{1F95A} The coop is full of eggs — go gather them'
      } else if (flock.missionActive) {
        chipText = `\u{1F411} ${flock.looseCount} loose — herd them back with Rex!`
      } else if (buildable) {
        chipText = `You can afford ${buildable.def.name}! Find its BUILD sign \u{1F3D7}`
      } else if (game.deedStatus() === 'ok') {
        chipText = `You can afford ${game.nextDeed().name}! Find the FOR-SALE sign \u{1F4DC}`
      } else if (
        state.harvests === 0 &&
        state.plots.some((p) => p.crop) &&
        !dog.fetching &&
        fetchCool <= 0
      ) {
        // first-ever wait: hand the player something to DO right away
        chipText = 'While the wheat grows — walk to Rex and throw his stick \u{1FAB5}'
      } else if (
        Object.keys(state.layout).length === 0 &&
        !carry.carrying &&
        state.harvests >= 8 &&
        (state.projects.stand || state.projects.coop) &&
        state.plots.some((p) => p.crop && p.crop.remaining > 0)
      ) {
        // the waiting window IS the rearranging window (until their first move)
        chipText = 'While the crops grow — press and hold a building to pick it up \u{1F4E6}'
      } else if (sug) {
        const name = state.chicken.name ?? 'her'
        const texts: Record<Suggestion['kind'], string> = {
          plant: 'Walk to a field plot to plant \u{1F33E}',
          harvest: 'Your crop is ready — walk over and gather it!',
          feed: `Bring ${name} a wheat — walk up and feed her`,
          collect: `${name} laid an egg — go pick it up!`,
          pet: `Visit ${name} for her daily pets ♥`,
        }
        const chipFor: Record<Suggestion['kind'], keyof GameState['chipsDone']> = {
          plant: 'plant',
          harvest: 'harvest',
          feed: 'feed',
          collect: 'collect',
          pet: 'pet',
        }
        if (!state.chipsDone[chipFor[sug.kind]]) chipText = texts[sug.kind]
      }
      // soft late-dusk reminder, only once the player has gone idle
      if (!chipText && dayCycle.atDusk && duskFor >= 20 && engine.uTime.value - lastInteract > 30) {
        chipText = "\u{1F3E1} supper's still warm — home when you're ready"
      }
      // the always-a-goal compass: when nothing urgent is chirping, name the
      // next thing worth walking toward, so the player never wonders "what
      // now?" — this is what surfaces the hidden half of the game (the deed
      // that unlocks the stable, the town, the next farmstead)
      if (!chipText) {
        const goal = nextGoal(state)
        if (goal) chipText = goal.pill
      }
    }
    hud.showChip(chipText)

    // dog guide: idle 5s + an obvious next goal -> trot near it and bounce
    const idleFor = engine.uTime.value - lastInteract
    if (idleFor > 5 && !hud.modalOpen && !chicken.ceremonyActive) {
      const buildSignAt = buildable ? (projectSigns.get(buildable.def.id)?.at ?? null) : null
      const pos = dayCycle.atDusk && !sleepActive
        ? homestead.doorPos
        : chicken.cratePending
        ? chicken.crateWorldPos
        : customerWaiting
          ? MARKET.pos
          : buildSignAt
            ? buildSignAt
            : game.deedStatus() === 'ok' && deedSign
              ? deedSign.at
              : sug
                ? sug.kind === 'plant' || sug.kind === 'harvest'
                  ? game.isGreenhouse(sug.plot)
                    ? null // Rex can't lead anyone through the glasshouse door
                    : plots[sug.plot].center
                  : sug.kind === 'collect'
                    ? NEST_POS
                    : chicken.tagWorldPos().setY(0)
                : null
      dog.guideTo(pos)
    } else {
      dog.guideTo(null)
    }
    } // ---- end of the 20Hz tier ----

    // displayed coins self-heal toward truth (never tween-gated)
    if (!hud.coinsInFlight && hud.displayedCoins !== state.coins) {
      coinMismatchFor += dt
      if (coinMismatchFor > 1.5) {
        hud.setCoins(state.coins)
        coinMismatchFor = 0
      }
    } else {
      coinMismatchFor = 0
    }

    state.dayPhase = dayCycle.phase
    state.timers.sow = sowCooldown
    state.timers.fetch = fetchCool
    state.timers.herd = Number.isFinite(herdTimer) ? herdTimer : 240
    saveAccum += dt
    if (saveAccum >= 3) {
      saveAccum = 0
      saveNow()
    }
  })

  // ---- per-frame presentation ---------------------------------------------------
  engine.onFrame((dt) => {
    const t = engine.uTime.value
    cam.setRunning(player.running)
    if (cam.moved) touch()
    // the camera's look-ahead reads DISPLACEMENT, not intent: a player
    // pushing into a wall has full velocity but zero displacement, and
    // velocity-fed look-ahead used to shove the ray origin through the wall
    const camDt = Math.max(1e-4, dt)
    camDispVel.set((player.pos.x - lastCamPos.x) / camDt, 0, (player.pos.z - lastCamPos.z) / camDt)
    // low-pass the fixed-step-quantized displacement into a steady velocity so
    // the look-ahead stops juddering the camera when the farmer runs (~85ms TC:
    // averages out the 0/1x/2x per-frame jitter, still tracks real speed changes).
    // a touch faster (~50ms) while riding so the look-ahead keeps up on a hard
    // canter turn without the rider sliding off-centre
    const kVel = 1 - Math.exp(-(riding ? 20 : 12) * camDt)
    camVelSmooth.set(
      camVelSmooth.x + (camDispVel.x - camVelSmooth.x) * kVel,
      0,
      camVelSmooth.z + (camDispVel.z - camVelSmooth.z) * kVel,
    )
    cam.follow(player.pos, camVelSmooth, dt)
    lastCamPos.copy(player.pos)
    // pressed flat against a wall the farmer's own body fills the lens —
    // fade him out (first-person collapse, with hysteresis so the doorway
    // never flickers him). Cutscenes always show him.
    const ghostable = !sleepActive && !construction.active && !fetchCine
    const wantGhost =
      ghostable &&
      cam.camera.position.distanceTo(camHead.set(player.pos.x, player.pos.y + 1.1, player.pos.z)) <
        (playerGhost ? 1.05 : 0.85)
    if (wantGhost !== playerGhost) {
      playerGhost = wantGhost
      player.root.visible = !wantGhost
    }
    music.tick()
    player.frame(dt, t)
    if (riding) rideRig.update(dt, player.pos, player.facing, player.speed)
    chicken.frame(dt, t)
    dog.frame(dt)
    flock.frame(dt, player.pos)
    grazers.frame(dt, player.pos)
    coopHens?.frame(dt, t)
    construction.frame(dt)
    dayCycle.update(dt)
    // fetch cinema camera: stick flight first, then smooth-pursuit on Rex
    // (reused temp — a per-frame clone() was feeding the GC during cines)
    if (fetchCine) {
      cam.cineFollow(
        cineEnding || t - cineStarted > 0.75 ? fetchEye.copy(dog.group.position).setY(0.55) : cineAim,
      )
    }
    // goodnight scene camera: the lit doorway -> the dinner table inside ->
    // a long gaze up into the stars -> back to the door at dawn
    if (sleepActive) {
      // the door-side family lives: mom's wave, the kid's run (these mixers
      // only tick during the scene — they're removed at endSleepScene)
      wife?.mixer.update(dt)
      kiddo?.mixer.update(dt)
      if (interiorShot) {
        cam.cineFollow(homeInterior.camFocus, homeInterior.camYaw, homeInterior.camPitch, homeInterior.camDist, homeInterior.camFov)
        homeInterior.update(dt)
      } else if (skyGaze) {
        // aimed at the crescent (nightsky hangs it az 47, elev 50 — world
        // dir ~(0.47, 0.77, 0.44)) so the gaze finds the moon among the stars
        cam.cineFollow(homestead.doorPos.clone().add(new Vector3(14, 34, 12)), -2.3, -0.55)
      } else {
        cam.cineFollow(homestead.doorPos.clone().setY(1.2), 0.55, 0.38)
      }
    }
    ghInterior.update(dt)
    fenceEditor.update()
    coopInterior.update(dt)
    stableInterior.update(dt)
    farmhouseInterior.update(dt)
    townSet.update(dt)
    carry.frame(dt)
    hud.setDay(state.day, dayCycle.label)
    // homestead windows warm up as the sun sinks (and stay lit all night)
    const eveK = sleepActive
      ? Math.max(nightDial.k, Math.min(1, (dayCycle.phase - 0.78) / 0.1))
      : Math.max(0, Math.min(1, (dayCycle.phase - 0.78) / 0.1))
    homestead.setEvening(eveK)
    // the glasshouse lamps warm on the same dusk dial (no-op while hidden)
    ghInterior.setNight(eveK)
    homestead.update(dt)
    nightSky.update(t)
    for (const v of customerViews.values()) v.frame(dt)
    for (const p of plots) p.pulse(t)
    clouds.update(dt)
    grass.update(t)
    ambient.update(t)

    // countdown ring while standing by a growing crop
    const gi = near.growingPlot
    const rp = gi >= 0 ? game.plotAt(gi)?.crop : null
    if (rp && rp.remaining > 0) {
      const s = cam.screenPos(plots[gi].center.clone().setY(1.2))
      hud.setRing(!s.behind, s.x, s.y, 1 - rp.remaining / rp.total, rp.remaining)
    } else {
      hud.setRing(false)
    }

    // nest pip while an egg is cooking / ready (the farm's widgets stay
    // outside — projected from the glasshouse they'd float over the glass)
    const eggT = state.chicken.eggTimer
    if ((eggT || state.chicken.eggReady) && !sleepActive && room === null) {
      const s = cam.screenPos(NEST_POS.clone().setY(0.6))
      const frac = state.chicken.eggReady ? 1 : 1 - (eggT ? eggT.remaining / eggT.total : 0)
      hud.setPip(!s.behind, s.x, s.y, frac, state.chicken.eggReady)
    } else {
      hud.setPip(false)
    }

    // floating name tag with hearts
    if (state.chicken.name && chicken.visible && !sleepActive && room === null) {
      const s = cam.screenPos(chicken.tagWorldPos())
      hud.setNameTag(!s.behind, s.x, s.y, state.chicken.name, state.chicken.hearts)
    } else {
      hud.setNameTag(false)
    }

    // customer want bubbles
    let slot = 0
    for (const c of customers.queue) {
      if (c.phase === 'leaving' || sleepActive || room !== null) continue
      const v = customerViews.get(c.id)
      if (!v?.active) continue
      const s = cam.screenPos(v.bubbleAnchor())
      const html = `${GOOD_EMOJI[c.want.kind]}×${c.want.count} → <span class="coin-mini"></span> ${c.want.offer}`
      hud.setBubble(slot, !s.behind, s.x, s.y, html)
      slot += 1
      if (slot >= 3) break
    }
    for (; slot < 3; slot += 1) hud.setBubble(slot, false)
  })

  // ---- frame driver with rare-event slow-mo (presentation only) -------------------
  let last = performance.now()
  let driftTick = 0
  let uiTick = 0
  let shadowTick = 0
  let recessWas = false
  /** stressed: pinned at the DPR floor AND still missing budget — shed the
   * invisible extras (shadow cadence, whisker ray) before anything the eye
   * would catch. Releases with hysteresis so it never flickers. */
  let stressed = false
  let stressMs = 0
  /** ms spent at a steady ~33ms cadence while already at the DPR floor —
   * that signature is a 30Hz LOCK (iOS Low Power Mode / thermal vsync
   * shelf), not load: stepping resolution further down buys nothing */
  let lockedMs = 0
  /** EMA of real frame time, ms — drives the adaptive resolution */
  let frameAvg = 16.7
  let dprSettleAt = performance.now() + 4000 // let boot hitches pass first
  const loop = (now: number): void => {
    requestAnimationFrame(loop)
    // self-healing viewport: iOS standalone misses resize events — if the
    // window drifted from what we sized for, fix it before drawing. Checked
    // every 10th frame: viewport reads can force layout, no need per-frame
    if (++driftTick >= 10) {
      driftTick = 0
      if (viewW() !== sizedW || viewH() !== sizedH) resize()
    }
    // the veil lifts the moment the new shape is stable and rendering —
    // its own min-hold keeps the beat readable, its cap keeps it honest
    if (hud.rotateVeilUp && viewW() === sizedW && viewH() === sizedH) hud.hideRotateVeil()
    const dtMs = now - last
    const dt = Math.min(dtMs / 1000, 0.1)
    last = now
    // shadows redraw on a slow cadence (the sun crawls; nobody can tell a
    // 50ms-stale shadow) — and the every-OTHER-frame sawtooth this used to
    // be read as judder on phones. Dusk park crawls even slower.
    shadowTick++
    const shadowEvery = stressed || dayCycle.atDusk ? 6 : isCoarse ? 3 : 2
    if (shadowTick % shadowEvery === 0) renderer.shadowMap.needsUpdate = true
    // adaptive resolution: miss budget -> step softer; comfortably under
    // budget for a while -> step sharper. Cooldowns stop buffer thrash.
    if (dtMs < 250) frameAvg += (dtMs - frameAvg) * 0.04
    // 30Hz-lock detector: pinned at the floor AND parked on the ~33ms shelf
    // means the cadence is imposed from outside — freeze the stepper so it
    // neither nukes quality nor oscillates (resize() itself is a hitch)
    if (dpr <= DPR_MIN + 1e-3 && frameAvg > 31 && frameAvg < 35.5) lockedMs += dtMs
    else lockedMs = 0
    // the stress latch: at the floor and still over budget -> shed the
    // invisible extras; recover only after a comfortably-smooth stretch
    if (!stressed && dpr <= DPR_MIN + 1e-3 && frameAvg > 17.5) {
      stressMs += dtMs
      if (stressMs > 3000) {
        stressed = true
        cam.lowSpec = true
        stressMs = 0
      }
    } else if (stressed && frameAvg < 15) {
      stressMs += dtMs
      if (stressMs > 5000) {
        stressed = false
        cam.lowSpec = false
        stressMs = 0
      }
    } else {
      stressMs = 0
    }
    if (now > dprSettleAt && lockedMs < 5000) {
      // down-step BEFORE the 60fps budget is truly lost (the old 19.5
      // threshold left 16.7 inside the dead band — a phone at half refresh
      // never recovered); shorter cooldown = ~3s to find footing, not 12
      if (frameAvg > 17.5 && dpr > DPR_MIN) {
        dpr = Math.max(DPR_MIN, dpr - 0.2)
        renderer.setPixelRatio(dpr)
        resize()
        dprSettleAt = now + 1500
      } else if (frameAvg < 13 && dpr < DPR_MAX) {
        dpr = Math.min(DPR_MAX, dpr + 0.15)
        renderer.setPixelRatio(dpr)
        resize()
        dprSettleAt = now + 5000
      }
    }
    engine.advance(dt * (now < slowUntilReal ? 0.2 : 1))
  }
  requestAnimationFrame(loop)

  // updateStyle=false: the canvas is CSS-pinned to fill the viewport
  // (index.html), so a missed resize event can never leave a background bar —
  // iOS standalone (Add to Home Screen) settles its viewport AFTER boot and
  // doesn't reliably fire window resize for it. Size from visualViewport when
  // present: after a rotation iOS can keep reporting STALE innerWidth/Height
  // for a while, but the visual viewport is already correct.
  const viewW = (): number => Math.round(visualViewport?.width ?? innerWidth)
  const viewH = (): number => Math.round(visualViewport?.height ?? innerHeight)
  let sizedW = 0
  let sizedH = 0
  let lastRealloc = 0
  const resize = (): void => {
    // iOS can report 0/stale sizes right after rotation (and a hidden tab
    // reports 0 at boot) — a zero here would bake NaN into the camera's
    // projection matrix and silently kill every raycast (the fence editor
    // died this way in QA). Keep the last good size instead.
    if (viewW() < 2 || viewH() < 2) return
    // a rotation makes iOS walk through several intermediate sizes while
    // the viewport settles, and EVERY size change reallocates the whole
    // post chain (a guaranteed hitch). No-ops bail; real changes apply at
    // most ~3x/second — the drift check re-converges within 500ms anyway.
    if (viewW() === sizedW && viewH() === sizedH) return
    // an aspect FLIP without an orientationchange event (iPadOS does this)
    // still deserves the veil
    if (sizedW > 2 && (viewW() > viewH()) !== (sizedW > sizedH)) hud.showRotateVeil()
    const now = performance.now()
    if (now - lastRealloc < 350) return
    lastRealloc = now
    sizedW = viewW()
    sizedH = viewH()
    cam.resize(sizedW, sizedH)
    renderer.setSize(sizedW, sizedH, false)
    composer.setSize(sizedW, sizedH)
    // the realloc hitch itself must not read as load: reset the frame
    // average and hold the DPR governor still while the dust settles —
    // rotation used to fire realloc -> panic down-step -> realloc -> ...
    frameAvg = 16
    dprSettleAt = Math.max(dprSettleAt, now + 2200)
    // composer.setSize stamps INLINE px width/height on the canvas (inline
    // beats the stylesheet pin in index.html) — re-assert fill so a stale
    // measurement can never leave a background bar
    const cs = renderer.domElement.style
    cs.width = '100%'
    cs.height = '100%'
  }
  addEventListener('resize', resize)
  visualViewport?.addEventListener('resize', resize)
  addEventListener('orientationchange', () => {
    // the rotation rebuild is unavoidable (every buffer re-shapes) — so it
    // hides behind a branded split-second instead of reading as lag
    hud.showRotateVeil()
    resize()
    // iOS reports stale innerHeight for a beat after rotating — re-measure
    // on the next frames (the per-frame drift check below also catches it)
    requestAnimationFrame(resize)
  })
  resize()
  addEventListener('pagehide', saveNow)
  // crops keep growing while the tab/app is in the background: the engine's
  // rAF freezes when hidden, so on return we fast-forward the SAVE timers by
  // the wall-clock gap and refresh every plot's look. Works for minimized
  // browsers and home-screen PWAs alike.
  let hiddenAt = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
      saveNow()
    } else if (hiddenAt) {
      const away = (Date.now() - hiddenAt) / 1000
      hiddenAt = 0
      // a resumed tab lands one long frame (dt clamped to 0.1s) with the sim
      // having stepped — keep that out of the look-ahead so it doesn't lurch
      lastCamPos.copy(player.pos)
      camVelSmooth.set(0, 0, 0)
      if (away > 3) {
        const res = catchUp(state, away)
        for (let i = 0; i < plots.length; i++) {
          const c = game.plotAt(i)?.crop ?? null
          plots[i].setCrop(c ? c.kind : null, c ? Game.stageOf(c.total, c.remaining) : 0, false)
        }
        if (state.chicken.eggReady && chicken.settled) chicken.showEgg(false)
        // only after a REAL absence (not a tab flick) — and never mid-scene
        if (res.offlineDelivery && away > 120 && !sleepActive && !construction.active) {
          grazers.setHidden('horse', false)
          hud.showBanner('While you were away \u{1F305}', 'Hazel came home from Millbrook — 34 coins in the saddlebag')
        }
        hud.setWheat(state.wheat)
        hud.setCoins(state.coins)
        saveNow()
      }
    }
  })

  // iOS Safari ignores user-scalable=no: a stray pinch zooms the PAGE and
  // sticks. Blocking gesture events kills page-zoom while the canvas pinch
  // (camera zoom) keeps working through pointer events.
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false })
  }
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false })

  // one-time fullscreen tip for iPhone Safari (no Fullscreen API there —
  // Add to Home Screen is THE way to lose the browser bars)
  const standalone = matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (
    isCoarse &&
    !standalone &&
    typeof document.documentElement.requestFullscreen !== 'function' &&
    localStorage.getItem('sunrise-farm.fsHint') !== '1'
  ) {
    gsap.delayedCall(45, () => {
      localStorage.setItem('sunrise-farm.fsHint', '1')
      hud.showBanner('Play fullscreen!', 'Share button → Add to Home Screen')
    })
  }

  // ---- dev driver ------------------------------------------------------------------
  window.__farm = {
    state: () => JSON.parse(serialize(state)) as GameState,
    give: (n: number) => {
      game.give(n)
      hud.setCoins(state.coins)
      saveNow()
    },
    step: (s: number) => {
      // chunks <= engine accumulator cap so no fixed ticks are dropped
      let left = s
      while (left > 1e-9) {
        const c = Math.min(left, 4 / 60)
        engine.advance(c)
        left -= c
      }
    },
    wipe: () => {
      wiping = true // pagehide save must not resurrect the old state
      localStorage.removeItem(SAVE_KEY)
      location.reload()
    },
    pos: () => [player.pos.x, player.pos.z],
    dogPos: () => [dog.group.position.x, dog.group.position.y, dog.group.position.z],
    henPos: () => [chicken.group.position.x, chicken.group.position.y, chicken.group.position.z],
    sheep: () => flock.sheep.map((s) => [s.group.position.x, s.group.position.z, s.mode] as [number, number, string]),
    escape: () => flock.startEscape(2),
    grazers: () => grazers.positions().map((p) => [p.x, p.z] as [number, number]),
    music: () => music.debug,
    musicUnlock: () => music.unlock(),
    sleepStart: (pause = true) => {
      sleepScene()
      if (pause) sleepTl?.pause()
    },
    interiorProbe: () => {
      const out: Array<{ name: string; x: number; y: number; z: number; vis: boolean; lo?: number; hi?: number }> = []
      const v = new Vector3()
      scene.traverse((o) => {
        if ((o as Mesh).isMesh) {
          o.getWorldPosition(v)
          if (Math.abs(v.x - 120) < 14 && Math.abs(v.z - 120) < 14) {
            const m = o as Mesh
            const mat = Array.isArray(m.material) ? m.material[0] : m.material
            const rec: { name: string; x: number; y: number; z: number; vis: boolean; lo?: number; hi?: number; n?: number; col?: string } = {
              name: o.name || o.type, x: +(v.x - 120).toFixed(2), y: +v.y.toFixed(2), z: +(v.z - 120).toFixed(2), vis: o.visible,
              n: m.geometry.getAttribute('position')?.count,
              col: (mat as MeshStandardMaterial).color?.getHexString?.(),
            }
            const sm = o as SkinnedMesh
            if (sm.isSkinnedMesh) {
              sm.computeBoundingBox()
              const bb = sm.boundingBox?.clone().applyMatrix4(sm.matrixWorld)
              if (bb) {
                rec.lo = +bb.min.y.toFixed(2)
                rec.hi = +bb.max.y.toFixed(2)
              }
            }
            out.push(rec)
          }
        }
      })
      return out
    },
    sleepSeek: (s: number) => sleepTl?.seek(s, false),
    /** cutscene QA: advance the sim n times by stepS, tiling a REAL rendered
     * frame into a grid after each step, then overlay the grid — one outside
     * screenshot reviews a whole scene including every camera transition */
    sheet: (n = 12, stepS = 0.75) => {
      document.getElementById('qa-sheet')?.remove()
      const src = renderer.domElement
      const cols = Math.ceil(Math.sqrt(n))
      const rows = Math.ceil(n / cols)
      const cw = Math.floor(1280 / cols)
      const ch = Math.floor((cw * src.height) / src.width)
      const grid = document.createElement('canvas')
      grid.width = cw * cols
      grid.height = ch * rows
      const g = grid.getContext('2d')!
      g.fillStyle = '#111'
      g.fillRect(0, 0, grid.width, grid.height)
      for (let i = 0; i < n; i++) {
        engine.advance(stepS)
        // copy is synchronous right after the advance's render — the WebGL
        // buffer is still valid without preserveDrawingBuffer
        g.drawImage(src, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch)
        g.fillStyle = '#ffe9a0'
        g.font = 'bold 13px monospace'
        g.fillText(`${((i + 1) * stepS).toFixed(2)}s`, (i % cols) * cw + 5, Math.floor(i / cols) * ch + 16)
      }
      const img = document.createElement('img')
      img.id = 'qa-sheet'
      img.src = grid.toDataURL('image/jpeg', 0.7)
      img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#111;z-index:999'
      document.body.appendChild(img)
      return n * stepS
    },
    sheetOff: () => document.getElementById('qa-sheet')?.remove(),
    lookYaw: (y: number) => {
      ;(cam as unknown as { yaw: number }).yaw = y
    },
    camProbe: () => {
      const c = cam as unknown as Record<string, unknown>
      return {
        pos: cam.camera.position.toArray().map((v) => +v.toFixed(2)),
        fov: cam.camera.fov,
        smoothDist: c.smoothDist,
        cineDist: c.cineDist,
        pitch: c.pitch,
        yaw: c.yaw,
        cine: c.cineTarget !== null,
      }
    },
    ray: (nx: number, ny: number) => {
      const rc = new Raycaster()
      rc.setFromCamera({ x: nx, y: ny } as never, cam.camera)
      return rc.intersectObjects(scene.children, true).slice(0, 4).map((h) => ({
        d: +h.distance.toFixed(2),
        n: (h.object as Mesh).geometry?.getAttribute('position')?.count,
        name: h.object.name || h.object.type,
      }))
    },
    dusk: () => dayCycle.setPhase(0.88),
    draws: () => renderer.info.render.calls,
    meshes: () => {
      const out: Array<{ name: string; tris: number; inst: number }> = []
      scene.traverse((o) => {
        const m = o as Mesh
        if (!m.isMesh || !m.visible) return
        const g = m.geometry as { index?: { count: number } | null; attributes?: { position?: { count: number } } }
        const idx = g.index ? g.index.count : (g.attributes?.position?.count ?? 0)
        const inst = (m as unknown as { isInstancedMesh?: boolean; count?: number }).isInstancedMesh
          ? ((m as unknown as { count: number }).count ?? 1)
          : 1
        const im = m as unknown as {
          isInstancedMesh?: boolean
          frustumCulled: boolean
          boundingSphere?: { center: { x: number; z: number }; radius: number } | null
          computeBoundingSphere?: () => void
        }
        if (im.isInstancedMesh && im.boundingSphere === null) im.computeBoundingSphere?.()
        const bs = im.isInstancedMesh ? im.boundingSphere : null
        out.push({
          name: m.name || (im.isInstancedMesh ? 'inst' : m.type),
          tris: Math.round((idx / 3) * inst),
          inst,
          fc: im.frustumCulled,
          sphere: bs ? `r${bs.radius.toFixed(1)}@${bs.center.x.toFixed(0)},${bs.center.z.toFixed(0)}` : 'n/a',
        } as never)
      })
      return out.sort((a, b) => b.tris - a.tris).slice(0, 14)
    },
    perf: () => ({
      calls: renderer.info.render.calls,
      tris: renderer.info.render.triangles,
      dpr: +dpr.toFixed(2),
      frameMs: +frameAvg.toFixed(2),
      fps: Math.round(engine.fps),
    }),
    warp: (x: number, z: number) => {
      player.pos.set(x, 0, z)
      prevPos.x = x
      prevPos.z = z
      // a warp is a teleport: cut the camera cleanly (no glide / look-ahead fling)
      // so QA snapshots are accurate the instant after the jump
      lastCamPos.copy(player.pos)
      camVelSmooth.set(0, 0, 0)
      cam.snapTo(player.pos)
      cam.clearWhiskers()
    },
    // ---- fences (E2E) ----
    fence: (x0: number, z0: number, x1: number, z1: number) => {
      let n = 0
      if (z0 === z1) {
        for (let x = Math.min(x0, x1); x < Math.max(x0, x1); x++) {
          const k = encodeEdge(x, z0, 0)
          if (!fences.edges.has(k)) {
            fences.edges.add(k)
            n++
          }
        }
      } else {
        for (let z = Math.min(z0, z1); z < Math.max(z0, z1); z++) {
          const k = encodeEdge(x0, z, 1)
          if (!fences.edges.has(k)) {
            fences.edges.add(k)
            n++
          }
        }
      }
      rebuildFenceMesh()
      return n
    },
    unfence: (x: number, z: number) => {
      const k = nearestEdge(fences, x, z, 2.5)
      if (k === null) return false
      fences.edges.delete(k)
      fences.gates.delete(k)
      rebuildFenceMesh()
      return true
    },
    fences: () => fences.edges.size + fences.gates.size,
    editor: {
      open: () => fenceEditor.open(),
      close: () => fenceEditor.close(),
      draw: (ax: number, az: number, bx: number, bz: number) => fenceEditor.drawRun(ax, az, bx, bz),
      remove: (x: number, z: number) => fenceEditor.removeNear(x, z),
      gate: (x: number, z: number) => fenceEditor.toggleGateNear(x, z),
      active: () => fenceEditor.active,
    },
    // ---- carry & place (E2E drives the same paths the thumb does) ----
    lift: (id: string) => tryLift(id as PlaceId),
    placeAt: (x: number, z: number) => {
      if (!carry.carrying) return false
      const check = canPlace(state, carry.carrying, snapToGrid(x), snapToGrid(z))
      carry.aimGhost(x, z, check.ok)
      carryCheck = check
      if (!check.ok) return false
      setDown()
      return true
    },
    carry: () =>
      carry.carrying
        ? { id: carry.carrying, ghost: [carry.ghostAt.x, carry.ghostAt.z] as [number, number], ok: carryCheck.ok }
        : null,
    layout: () => JSON.parse(JSON.stringify(state.layout)) as Record<string, { x: number; z: number }>,
    actions: () => [...lastActions],
    act: (id: string) => onAction(id),
    room: {
      enter: (which: RoomId) => throughDoor(which, true),
      exit: (which: RoomId) => throughDoor(which, false),
      which: () => room,
    },
    flock: () => JSON.parse(JSON.stringify(state.coopFlock)) as CoopFlock,
    cam: () => cam.probe(),
    town: () => JSON.parse(JSON.stringify(state.town)) as GameState['town'],
    camMat: () => ({
      pos: cam.camera.position.toArray().map((v) => +v.toFixed(2)),
      aspect: cam.camera.aspect,
      fov: +cam.camera.fov.toFixed(1),
      pm0: cam.camera.projectionMatrix.elements[0],
      pmi0: cam.camera.projectionMatrixInverse.elements[0],
      mw12: cam.camera.matrixWorld.elements.slice(12, 15).map((v) => +v.toFixed(2)),
    }),
  }
  window.__step = window.__farm.step

  gsap.to(veil, { opacity: 0, duration: 0.5, onComplete: () => veil.remove() })
}

void boot()
