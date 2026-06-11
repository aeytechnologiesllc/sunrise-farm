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
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  Scene,
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
  HERD_COOLDOWN,
  HERD_FIRST_DELAY,
  splitCoins,
  TRACTOR_COOLDOWN,
  xpNeeded,
  type CropKind,
  type GoodKind,
} from './game/economy'
import { Customers } from './game/customers'
import { Game, type Suggestion } from './game/Game'
import { catchUp, deserialize, initialState, SAVE_KEY, serialize, type GameState } from './game/state'
import { Joystick } from './input/joystick'
import { Hud, type ActionDef } from './ui/hud'
import { Assets } from './world/assets'
import { ChickenView } from './world/Chicken'
import { CustomerView } from './world/Customer'
import { DogView } from './world/Dog'
import { FollowCamera } from './world/FollowCamera'
import { heartBurst, sparkleBurst } from './world/fx'
import { AmbientLife } from './world/fxAmbient'
import { PlayerView } from './world/Player'
import { PlotView } from './world/Plot'
import {
  buildClouds,
  buildDeedSign,
  buildGround,
  buildLights,
  buildMeadow,
  buildPicketFence,
  buildSky,
  buildStand,
  buildPen,
  CRATE_POS,
  DOG_HOME,
  groundClear,
  NEST_POS,
  PLAYER_SPAWN,
  STAND_POS,
  WORLD_BOUNDS,
} from './world/scenery'
import { fenceFor, gatesFor, PEN, plotPositions, sheepCount, TIERS, type TierDef } from './game/expansion'
import {
  availableProjects,
  GREENHOUSE_PLOTS,
  PROJECTS,
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
import { FarmhandView } from './world/Farmhand'
import { Homestead } from './world/homestead'
import { NightSky } from './world/nightsky'
import { normalizeHeight } from './world/scale'
import { DELIVERY_RUN_TIME, MILK_COIN_PER_GOAT, WOOL_COIN_PER_SHEEP } from './game/produce'
import { AnimationMixer } from 'three'

const HEN_NAMES = ['Henrietta', 'Clucky', 'Pearl', 'Butterscotch', 'Nugget', 'Daisy', 'Pepper', 'Marigold']
const GOOD_EMOJI: Record<GoodKind, string> = { wheat: '\u{1F33E}', corn: '\u{1F33D}', egg: '\u{1F95A}' }

// interaction radii (diner grammar: you go to it)
const PLOT_R = 2.1
const CHICK_R = 2.4
const CRATE_R = 2.6
const STAND_R = 2.9
const AUTOPLANT_AFTER = 0.6

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
      sleepStart: () => void
      sleepSeek: (s: number) => void
      dusk: () => void
      draws: () => number
      warp: (x: number, z: number) => void
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
  renderer.setPixelRatio(Math.min(devicePixelRatio, isCoarse ? 1.7 : 2))
  document.body.appendChild(renderer.domElement)

  const scene = new Scene()
  const cam = new FollowCamera(renderer.domElement, PLAYER_SPAWN)

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
  const loaded = deserialize(localStorage.getItem(SAVE_KEY))
  const state = loaded ?? initialState((Math.random() * 0xffffffff) >>> 0)
  const offline = loaded ? catchUp(state, (Date.now() - loaded.savedAt) / 1000) : null
  const game = new Game(state)

  const lights = buildLights(scene)
  const sky = buildSky(scene)
  // the sun walks the sky: dawn -> noon -> golden hour, then PARKS at dusk
  // until the farmer goes to bed (the sleep ritual starts the next day)
  const dayCycle = new DayCycle({ ...lights, dome: sky.dome, sunDisk: sky.sunDisk, scene })
  const nightSky = new NightSky(scene)
  const homestead = new Homestead(scene)
  composer.addPass(
    new EffectPass(
      cam.camera,
      new GodRaysEffect(cam.camera, sky.sunDisk, {
        density: 0.96,
        decay: 0.93,
        weight: 0.25,
        samples: isCoarse ? 16 : 32,
        resolutionScale: isCoarse ? 0.35 : 0.5,
      }),
      new BloomEffect({ intensity: 0.42, luminanceThreshold: 0.82, mipmapBlur: true }),
      new VignetteEffect({ darkness: 0.3, offset: 0.26 }),
    ),
  )
  buildGround(scene)
  const grass = buildMeadow(scene, assets)
  // level one starts from SCRATCH: the stand exists only once its project is
  // built (and the Farm Shop later replaces it)
  let standGroup: Group | null =
    state.projects.shop || !state.projects.stand ? null : buildStand(scene, assets)
  let fenceMesh = buildPicketFence(scene, state.expansion)
  for (let t = 0; t <= state.expansion; t++) {
    const def = TIERS[t]
    if (def.field) scene.add(buildField(def.field, def.plots, 0x6011 + t * 97))
  }
  const clouds = buildClouds(scene)
  const ambient = new AmbientLife(scene)
  const sfx = new Sfx()
  const music = new Music()
  const hud = new Hud()
  hud.mountMusicToggle(music.isMuted, (m) => music.setMuted(m))
  hud.mountFullscreenToggle()
  // dual sticks: LEFT walks the farmer (+WASD), RIGHT orbits the camera
  const joy = new Joystick({ side: 'left', keyboard: true })
  const joyCam = new Joystick({ side: 'right', glyph: '\u{1F441}' })

  const mkPlot = (px: number, pz: number, compact = false): PlotView => {
    const v = new PlotView(assets, new Vector3(px, 0, pz), scene, compact)
    scene.add(v.group)
    return v
  }
  // view order mirrors Game's combined index space: field plots, then
  // greenhouse planters (always at the tail so expansions insert BEFORE them)
  const plots = plotPositions(state.expansion).map(([px, pz]) => mkPlot(px, pz))
  if (state.projects.greenhouse) for (const [px, pz] of GREENHOUSE_PLOTS) plots.push(mkPlot(px, pz, true))
  const lastGlow: Array<'none' | 'shimmer' | 'ready'> = plots.map(() => 'none')

  // ---- land deeds + tractor -------------------------------------------------
  const TRACTOR_SPOT = { pos: new Vector3(-7.2, 0, -6.6), yaw: -0.35 }
  let tractor: TractorView | null = state.expansion >= 2 ? new TractorView(scene, TRACTOR_SPOT.pos, TRACTOR_SPOT.yaw) : null
  let sowCooldown = 0
  let deedSign: { group: ReturnType<typeof buildDeedSign>; at: Vector3 } | null = null
  const placeDeedSign = (): void => {
    if (deedSign) {
      scene.remove(deedSign.group)
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
    state.projects.sheep ? sheepCount(state.expansion) : 0,
    (state.chicken.seed ^ 0x51f15e) >>> 0,
  )
  const player = new PlayerView(assets, scene, PLAYER_SPAWN, WORLD_BOUNDS)
  const customers = new Customers((state.chicken.seed ^ 0x9e3779b9) >>> 0)
  const customerViews = new Map<number, CustomerView>()

  let wiping = false
  const saveNow = (): void => {
    if (!wiping) localStorage.setItem(SAVE_KEY, serialize(state))
  }

  // ---- HUD sync -----------------------------------------------------------
  hud.setCoins(state.coins)
  hud.setWheat(state.wheat)
  hud.setXp(state.xp, xpNeeded(state.level), state.level)
  game.on('xp', (e) => hud.setXp(e.xp, e.need, e.level))
  game.on('levelup', (e) => {
    const sub = e.unlocked.length ? `${e.unlocked.map((k) => CROPS[k].label).join(', ')} unlocked!` : 'The farm grows.'
    hud.showBanner(`Level ${e.level}!`, sub)
    music.duck()
    sfx.fanfare()
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
    sparkleBurst(scene, plots[e.plot].center.clone().setY(0.8), false, 5)
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
  game.on('deliveryDone', (e) => {
    sfx.hooves()
    sfx.kaching()
    fountainFrom(STABLE_AT.clone().setY(1.0), e.coins, false)
    const s = cam.screenPos(STABLE_AT.clone().setY(1.8))
    if (!s.behind) hud.floatText(s, `Hazel's home! +${e.coins} \u{1FA99}`)
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
    sfx.crate()
    chicken.dropCrate()
    cam.focusOn(CRATE_POS, 0.9)
    gsap.delayedCall(2.1, () => cam.release(1.0))
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
    const readySpots: Vector3[] = []
    for (let i = 0; i < plots.length; i++) {
      const crop = game.plotAt(i)?.crop
      if (crop && crop.remaining <= 0) readySpots.push(plots[i].center)
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
    hud.coinFountain(from, splitCoins(coins, fountainCount(coins)), golden, () => sfx.tink())
  }

  let slowUntilReal = 0
  const rareSlowMo = (): void => {
    slowUntilReal = performance.now() + 100
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
  const PEN_GATE = new Vector3(PEN.x1 + 0.4, 0, (PEN.gate.z0 + PEN.gate.z1) / 2)
  let herdTimer = HERD_FIRST_DELAY[0] + Math.random() * (HERD_FIRST_DELAY[1] - HERD_FIRST_DELAY[0])
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
    herdTimer = HERD_COOLDOWN[0] + Math.random() * (HERD_COOLDOWN[1] - HERD_COOLDOWN[0])
    saveNow()
  }

  // ---- stick fetch: a little CINEMA (the waiting game's best friend) -------------
  let stick: Mesh | null = null
  let fetchCool = 0
  const letterbox = new Letterbox()
  let fetchCine = false
  let cineEnding = false
  let cineStarted = 0
  const cineAim = new Vector3()
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
      t.x = Math.max(WORLD_BOUNDS.minX + 1.5, Math.min(WORLD_BOUNDS.maxX - 1.5, t.x))
      t.z = Math.max(WORLD_BOUNDS.minZ + 1.5, Math.min(WORLD_BOUNDS.maxZ - 1.5, t.z))
      if (!groundClear(t.x, t.z)) {
        target = t
        break
      }
    }
    if (!dog.fetch(target)) return
    sfx.whistle()
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
    scene.add(s)
    stick = s
    const from = player.pos.clone().setY(1.2)
    s.position.copy(from)
    const flight = { t: 0 }
    gsap.to(flight, {
      t: 1,
      duration: 0.65,
      ease: 'none',
      onUpdate: () => {
        const t = flight.t
        s.position.set(
          from.x + (target.x - from.x) * t,
          0.15 + (1.2 - 0.15) * (1 - t) + Math.sin(t * Math.PI) * 2.4,
          from.z + (target.z - from.z) * t,
        )
        s.rotation.x += 0.35
      },
    })
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
  let sleepTl: gsap.core.Timeline | null = null
  let wife: { group: Group; mixer: AnimationMixer } | null = null
  const nightDial = { k: 0 }
  const applyNight = (): void => {
    dayCycle.setNight(nightDial.k)
    nightSky.set(nightDial.k)
  }
  const endSleepScene = (): void => {
    if (!sleepActive) return
    sleepActive = false
    skyGaze = false
    letterbox.hide()
    cam.cineFollow(null)
    player.autoWalkTo(null)
    nightDial.k = 0
    applyNight()
    player.group.scale.setScalar(1)
    if (wife) {
      scene.remove(wife.group)
      wife = null
    }
    saveNow()
  }
  const sleepScene = (): void => {
    if (sleepActive || !dayCycle.atDusk) return
    sleepActive = true
    sleepStarted = engine.uTime.value
    touch()
    dropStick()
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

    const tl = gsap.timeline()
    // supper drifting out of the kitchen window
    tl.call(() => sfx.clink(), undefined, 1.1)
    tl.call(() => sfx.clink(), undefined, 2.3)
    // they step inside together
    tl.call(() => {
      player.autoWalkTo(null)
      sfx.crate() // the old door creaks
      gsap.to(player.group.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.5, ease: 'power2.in' })
      if (wife) gsap.to(wife.group.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.5, ease: 'power2.in', delay: 0.15 })
    }, undefined, 3.6)
    // the camera drifts up; the world breathes out into night
    tl.call(() => {
      skyGaze = true
    }, undefined, 4.4)
    tl.to(nightDial, { k: 1, duration: 2.8, ease: 'sine.inOut', onUpdate: applyNight }, 4.6)
    for (const at of [6.2, 7.1, 8.3, 9.1, 9.9]) tl.call(() => sfx.cricket(), undefined, at)
    // deep night: the new day begins where no one can see the seam
    tl.call(() => {
      dayCycle.startNewDay()
      game.sleep()
    }, undefined, 10.4)
    // dawn washes the stars away
    tl.to(nightDial, { k: 0, duration: 3.0, ease: 'sine.inOut', onUpdate: applyNight }, 10.8)
    tl.call(() => sfx.birds(), undefined, 12.0)
    tl.call(() => sfx.birds(), undefined, 13.0)
    // back down to the door: he steps out into the morning
    tl.call(() => {
      skyGaze = false
      player.group.scale.setScalar(1)
      player.pos.copy(homestead.thresholdPos)
      player.autoWalkTo(door.clone().add(new Vector3(1.6, 0, 2.2)))
      if (wife) {
        wife.group.scale.setScalar(1)
        gsap.to(wife.group.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.6, delay: 1.6, ease: 'power2.in' })
      }
    }, undefined, 13.8)
    tl.call(() => {
      hud.showBanner(`Day ${state.day} \u{1F305}`, 'A brand-new morning on the farm')
      music.duck()
    }, undefined, 14.8)
    tl.call(() => endSleepScene(), undefined, 16.4)
    sleepTl = tl
  }

  // ---- construction projects (the build-your-farm spine) -------------------------
  const construction = new Construction({ scene, assets, cam, tickSfx: () => sfx.plant() })
  const grazers = new Grazers(assets, scene, 0xa11ce)
  /** the horse grazes the strip north of the east field; goats join the pen */
  const HORSE_RECT = { x0: 9.0, z0: -3.0, x1: 14.6, z1: -0.9 }
  const GOAT_RECT = { x0: PEN.x0 + 0.7, z0: PEN.z0 + 0.7, x1: PEN.x1 - 0.7, z1: PEN.z1 - 0.7 }
  let farmhand: FarmhandView | null = null

  const addBuilding = (builder: (seed: number) => Group, def: ProjectDef, pop: boolean): Group => {
    const b = builder(0xb1d + def.cost)
    b.position.set(def.site[0], 0, def.site[1])
    b.rotation.y = def.yaw
    scene.add(b)
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
        if (fresh) {
          standGroup.scale.setScalar(0.01)
          gsap.to(standGroup.scale, { x: 1, y: 1, z: 1, duration: 0.7, ease: 'back.out(1.5)' })
        }
      }
      customers.active = state.harvests >= 1
    } else if (def.id === 'sheep') {
      buildPen(scene)
      // at boot the Flock constructor already spawned the saved flock
      if (fresh) for (let i = 0; i < 3; i++) flock.addSheep()
    } else if (def.id === 'stable') {
      addBuilding(buildStable, def, fresh)
      grazers.add('horse', HORSE_RECT, 1)
    } else if (def.id === 'goats') {
      grazers.add('goat', GOAT_RECT, 2)
    } else if (def.id === 'shop') {
      if (standGroup) {
        scene.remove(standGroup)
        standGroup = null
      }
      addBuilding(buildShop, def, fresh)
      customers.premium = SHOP_PREMIUM
      customers.queueMax = SHOP_QUEUE_MAX
    } else if (def.id === 'greenhouse') {
      addBuilding(buildGreenhouse, def, fresh)
      if (fresh)
        for (const [px, pz] of GREENHOUSE_PLOTS) {
          plots.push(mkPlot(px, pz, true))
          lastGlow.push('none')
        }
    } else if (def.id === 'farmhand') {
      farmhand = new FarmhandView(assets, scene, new Vector3(def.site[0], 0, def.site[1]))
      farmhand.onHarvest = (i) => doHarvest(i)
    }
  }
  for (const { def } of game.projectBoard()) if (game.hasProject(def.id)) applyProject(def, false)

  // build-site signs for every project whose land exists
  const projectSigns = new Map<ProjectId, { group: Group; at: Vector3 }>()
  const refreshProjectSigns = (): void => {
    // chained projects (shop after stand, goats after sheep) keep their sign
    // hidden until the prerequisite exists — they also share build sites, so
    // early signs would stack on top of each other
    const avail = availableProjects({
      level: state.level,
      coins: state.coins,
      expansion: state.expansion,
      projects: state.projects as Partial<Record<ProjectId, boolean>>,
    }).filter((d) => !d.requires || state.projects[d.requires])
    for (const [id, s] of projectSigns) {
      if (!avail.some((d) => d.id === id)) {
        scene.remove(s.group)
        projectSigns.delete(id)
      }
    }
    // upgrade signs can't stand inside the building they replace
    const SIGN_OFFSET: Partial<Record<ProjectId, [number, number]>> = {
      shop: [-3.0, 0.6],
      goats: [1.6, -3.4],
    }
    for (const def of avail) {
      if (projectSigns.has(def.id)) continue
      const [ox, oz] = SIGN_OFFSET[def.id] ?? [0, 0]
      const at = new Vector3(def.site[0] + ox, 0, def.site[1] + oz)
      const group = buildDeedSign(def.name, def.cost, 'BUILD', '#2e6db4')
      group.position.copy(at)
      group.rotation.y = Math.atan2(PLAYER_SPAWN.x - at.x, PLAYER_SPAWN.z - at.z)
      scene.add(group)
      projectSigns.set(def.id, { group, at })
    }
  }
  refreshProjectSigns()

  // ---- buying land -----------------------------------------------------------
  /** the dig: a crew arrives, letterbox drops, shovels swing — then the new
   * field, fence ring, and whatever the deed brought reveal at the climax */
  const expandCeremony = (def: TierDef): void => {
    placeDeedSign()
    const center = def.field
      ? new Vector3((def.field.x0 + def.field.x1) / 2, 0, (def.field.z0 + def.field.z1) / 2)
      : player.pos.clone()
    construction.play({
      site: center,
      yaw: 0,
      footprint: def.field
        ? { w: def.field.x1 - def.field.x0, d: def.field.z1 - def.field.z0 }
        : { w: 3, d: 3 },
      dig: true,
      reveal: () => {
        if (fenceMesh) {
          scene.remove(fenceMesh)
          fenceMesh.geometry.dispose()
        }
        fenceMesh = buildPicketFence(scene, state.expansion)
        if (def.field) {
          const fg = buildField(def.field, def.plots, 0x6011 + state.expansion * 97)
          fg.scale.setScalar(0.01)
          scene.add(fg)
          gsap.to(fg.scale, { x: 1, y: 1, z: 1, duration: 0.8, ease: 'back.out(1.4)' })
          // insert BEFORE any greenhouse planters so view order keeps
          // matching Game's combined plot index space
          const insertAt = state.plots.length - def.plots.length
          def.plots.forEach(([px, pz], k) => {
            plots.splice(insertAt + k, 0, mkPlot(px, pz))
            lastGlow.splice(insertAt + k, 0, 'none')
          })
        }
        if (def.tractor && !tractor) tractor = new TractorView(scene, TRACTOR_SPOT.pos, TRACTOR_SPOT.yaw)
        if (def.sheep && game.hasProject('sheep')) for (let i = 0; i < def.sheep; i++) flock.addSheep()
        refreshProjectSigns()
        sparkleBurst(scene, center.clone().setY(1.2), true, 18)
      },
      done: () => {
        hud.showBanner(`${def.name}!`, def.flavor)
        music.duck()
        sfx.fanfare()
        rareSlowMo()
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
    const at = view.bubbleAnchor().setY(1.5)
    sparkleBurst(scene, at, false, 8)
    fountainFrom(at, total, false)
    const s = cam.screenPos(view.bubbleAnchor())
    if (!s.behind) hud.floatText(s, `+${c.want.tip} tip ♥`)
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
      // tap skips the goodnight scene (the day still turns over)
      if (sleepActive && engine.uTime.value - sleepStarted > 0.9) sleepTl?.progress(1, false)
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
    project: null as ProjectId | null,
  }
  const STABLE_DEF = PROJECTS.find((p) => p.id === 'stable')!
  const STABLE_AT = new Vector3(STABLE_DEF.site[0], 0, STABLE_DEF.site[1])
  const PEN_CENTER = new Vector3((PEN.x0 + PEN.x1) / 2, 0, (PEN.z0 + PEN.z1) / 2)
  const onAction = (id: string): void => {
    touch()
    if (id === 'wheat' && near.emptyPlot >= 0) plantAt(near.emptyPlot, 'wheat')
    else if (id === 'corn' && near.emptyPlot >= 0) plantAt(near.emptyPlot, 'corn')
    else if (id === 'stick' && near.dog && !dog.fetching && fetchCool <= 0) throwStick()
    else if (id === 'sleep' && near.home) sleepScene()
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
      if (game.sendDelivery()) {
        hud.setWheat(state.wheat)
        sfx.hooves()
        player.gesture(engine.uTime.value)
        // she gallops out to the road and off east toward town
        grazers.sendRun(
          'horse',
          [new Vector3(13.5, 0, 4.2), new Vector3(16.5, 0, 9.8), new Vector3(21, 0, 11)],
          DELIVERY_RUN_TIME - 12,
        )
        const s = cam.screenPos(STABLE_AT.clone().setY(1.6))
        if (!s.behind) hud.floatText(s, 'Hazel is off to town! \u{1F434}')
        saveNow()
      }
    } else if (id === 'build' && near.project) {
      const def = game.buildProject(near.project)
      if (def) {
        hud.setCoins(state.coins)
        refreshProjectSigns()
        sfx.crate()
        construction.play({
          site: new Vector3(def.site[0], 0, def.site[1]),
          yaw: def.yaw,
          footprint: def.footprint,
          dig: def.kind !== 'building',
          reveal: () => applyProject(def, true),
          done: () => {
            hud.showBanner(`${def.name}!`, def.flavor)
            music.duck()
            sfx.fanfare()
            rareSlowMo()
            saveNow()
          },
        })
      }
    } else if (id === 'deed' && near.deed) {
      const def = game.expand()
      if (def) {
        hud.setCoins(state.coins)
        expandCeremony(def)
        saveNow()
      }
    } else if (id === 'sow' && near.tractor && tractor && sowCooldown <= 0) {
      const planted = game.plantAll('wheat')
      if (planted.length) {
        sowCooldown = TRACTOR_COOLDOWN
        sfx.tractor()
        tractor.chug()
        planted.forEach((i, k) =>
          gsap.delayedCall(0.45 + k * 0.14, () => {
            plots[i]?.setCrop('wheat', 0, true)
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
  const fenceBlock = (): void => {
    const p = player.pos
    const f = fenceFor(state.expansion)
    const gates = gatesFor(state.expansion)
    const open = (wall: 'N' | 'S' | 'E' | 'W', along: number): boolean =>
      gates.some((g) => g.wall === wall && Math.abs(along - g.center) < g.half)
    const inX = Math.max(prevPos.x, p.x) > f.minX - 0.2 && Math.min(prevPos.x, p.x) < f.maxX + 0.2
    const inZ = Math.max(prevPos.z, p.z) > f.minZ - 0.2 && Math.min(prevPos.z, p.z) < f.maxZ + 0.2
    for (const [line, wall] of [[f.minZ, 'N'], [f.maxZ, 'S']] as Array<[number, 'N' | 'S']>) {
      if (inX && (prevPos.z - line) * (p.z - line) < 0 && !open(wall, p.x)) p.z = prevPos.z
    }
    for (const [line, wall] of [[f.minX, 'W'], [f.maxX, 'E']] as Array<[number, 'W' | 'E']>) {
      if (inZ && (prevPos.x - line) * (p.x - line) < 0 && !open(wall, p.z)) p.x = prevPos.x
    }
    prevPos.x = p.x
    prevPos.z = p.z
  }

  // ---- fixed-step systems ------------------------------------------------------
  let saveAccum = 0
  let coinMismatchFor = 0
  let standT = 0
  let movedEver = false
  engine.onUpdate((dt) => {
    game.update(dt)
    customers.active = state.harvests >= 1 && (game.hasProject('stand') || game.hasProject('shop'))
    customers.update(dt, game.stock())
    player.update(dt, joy.value, cam.yaw)
    fenceBlock()
    chicken.update(dt)
    dog.update(dt, player.pos)
    flock.update(dt, player.pos, dog.group.position, state.expansion)
    construction.update(dt)
    grazers.update(dt, player.pos)
    // fetch cinema safety: if the mission system yanked Rex off the job,
    // close the scene (the normal ending is scripted in onFetchDone)
    if (fetchCine && !cineEnding && !dog.fetching) endFetchCine()
    if (farmhand) {
      const info = plots.map((v, i) => {
        const c = game.plotAt(i)?.crop
        return { center: v.center, ready: !!c && c.remaining <= 0 }
      })
      farmhand.update(dt, info)
    }

    // sheep slip out while you wait on crops (post-FTUE, one mission at a time)
    if (!flock.missionActive && flock.sheep.length > 0 && state.harvests >= 2 && !hud.modalOpen) {
      herdTimer -= dt
      if (herdTimer <= 0) {
        const n = flock.startEscape(state.level >= 6 ? 3 : 2, state.expansion)
        if (n > 0) {
          dropStick() // playtime's over, Rex
          hud.showBanner('Baaad news!', `${n} sheep slipped out of the pen \u{1F411}`)
          sfx.baa()
          music.duck()
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
    if (joy.active || joyCam.active) {
      touch()
      if (joy.active) movedEver = true
    }

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
    if (!hud.modalOpen) {
      for (let i = 0; i < plots.length; i++) {
        if (p.distanceTo(plots[i].center) > PLOT_R) continue
        const crop = game.plotAt(i)?.crop
        if (!crop) {
          if (near.emptyPlot < 0) near.emptyPlot = i
        } else if (crop.remaining <= 0) doHarvest(i)
        else near.growingPlot = i
      }
      near.deed = deedSign !== null && p.distanceTo(deedSign.at) < 2.5
      near.tractor = tractor !== null && p.distanceTo(tractor.position) < 2.9
      near.dog = !flock.missionActive && p.distanceTo(dog.group.position) < 2.6
      near.home = !sleepActive && dayCycle.atDusk && p.distanceTo(homestead.doorPos) < 3.2
      near.pen = game.hasProject('sheep') && p.distanceTo(PEN_CENTER) < 4.2
      near.stable = game.hasProject('stable') && p.distanceTo(STABLE_AT) < 3.4
      near.project = null
      let signD = 2.6
      for (const [id, s] of projectSigns) {
        const d = p.distanceTo(s.at)
        if (d < signD) {
          signD = d
          near.project = id
        }
      }
      near.chicken = chicken.settled && p.distanceTo(chicken.group.position) < CHICK_R
      if (state.chicken.eggReady && chicken.settled && p.distanceTo(NEST_POS) < CHICK_R) collectEgg()
      if (chicken.cratePending && p.distanceTo(chicken.crateWorldPos) < CRATE_R) {
        cam.focusOn(CRATE_POS, 0.7)
        chicken.beginOpen(
          () => sfx.crate(),
          () => {
            cam.release(0.9)
            runNaming()
          },
        )
      }
      if (p.distanceTo(STAND_POS) < STAND_R) tryServe()

      // stand still on an empty plot for a moment -> wheat plants itself
      if (near.emptyPlot >= 0 && player.speed < 0.3) {
        standT += dt
        if (standT >= AUTOPLANT_AFTER) {
          standT = 0
          plantAt(near.emptyPlot, 'wheat')
        }
      } else {
        standT = 0
      }
    }

    // ---- context action buttons (big, above the right thumb) ----
    const actions: ActionDef[] = []
    if (!hud.modalOpen) {
      if (near.emptyPlot >= 0) {
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
        for (let i = 0; i < game.plotTotal; i++) if (!game.plotAt(i)?.crop) empties++
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
          sub: `${flock.sheep.length} sheep \u{2192} ${flock.sheep.length * WOOL_COIN_PER_SHEEP}c`,
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
                ? 'feed 1 \u{1F33E} \u{2192} 26-42c'
                : ds === 'feed'
                  ? 'needs 1 wheat to feed her'
                  : ds === 'out'
                    ? "she's on the road"
                    : `resting ${Math.ceil(state.produce.deliveryCd)}s`,
            locked: ds !== 'ok',
          })
        }
      }
      if (near.dog && !dog.fetching && fetchCool <= 0) {
        actions.push({ id: 'stick', emoji: '\u{1FAB5}', label: 'Throw the stick', sub: 'Rex loves this' })
      }
    }
    hud.setActions(actions, onAction)

    // ---- contextual top chip: top suggestion whose chip hasn't been retired ----
    const sug = game.suggestion()
    const customerWaiting = customers.frontServiceable(game.stock())
    const buildable = game.projectBoard().find((e) => e.status === 'ok') ?? null
    let chipText: string | null = null
    if (!hud.modalOpen && !construction.active) {
      if (!movedEver && !state.chipsDone.plant) {
        chipText = 'Drag the joystick to take a walk \u{1F33B}'
      } else if (dayCycle.atDusk && !sleepActive) {
        chipText = "\u{1F319} The sun's setting — head home for supper"
      } else if (customerWaiting) {
        chipText = 'A customer is waiting at the stand!'
      } else if (state.produce.woolReady && game.hasProject('sheep')) {
        chipText = "\u{2702}\u{FE0F} The flock's wool is ready — shear it at the pen"
      } else if (state.produce.milkReady && game.hasProject('goats')) {
        chipText = '\u{1F95B} The goats are ready for milking'
      } else if (flock.missionActive) {
        chipText = `\u{1F411} ${flock.looseCount} loose — herd them back with Rex!`
      } else if (game.deedStatus() === 'ok') {
        chipText = `You can afford ${game.nextDeed()?.name}! Find the FOR-SALE sign \u{1F4DC}`
      } else if (buildable) {
        chipText = `You can afford ${buildable.def.name}! Find its BUILD sign \u{1F3D7}`
      } else if (
        state.harvests === 0 &&
        state.plots.some((p) => p.crop) &&
        !dog.fetching &&
        fetchCool <= 0
      ) {
        // first-ever wait: hand the player something to DO right away
        chipText = 'While the wheat grows — walk to Rex and throw his stick \u{1FAB5}'
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
          ? STAND_POS
          : game.deedStatus() === 'ok' && deedSign
            ? deedSign.at
            : buildSignAt
              ? buildSignAt
              : sug
                ? sug.kind === 'plant' || sug.kind === 'harvest'
                  ? plots[sug.plot].center
                  : sug.kind === 'collect'
                    ? NEST_POS
                    : chicken.tagWorldPos().setY(0)
                : null
      dog.guideTo(pos)
    } else {
      dog.guideTo(null)
    }

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

    saveAccum += dt
    if (saveAccum >= 3) {
      saveAccum = 0
      saveNow()
    }
  })

  // ---- per-frame presentation ---------------------------------------------------
  engine.onFrame((dt) => {
    const t = engine.uTime.value
    cam.orbit(joyCam.value.x, joyCam.value.y, dt)
    cam.setRunning(player.running)
    if (cam.moved) touch()
    cam.follow(player.pos, player.vel, dt)
    music.tick()
    player.frame(dt, t)
    chicken.frame(dt, t)
    dog.frame(dt)
    flock.frame(dt)
    grazers.frame(dt)
    farmhand?.frame(dt)
    construction.frame(dt)
    dayCycle.update(dt)
    // fetch cinema camera: stick flight first, then smooth-pursuit on Rex
    if (fetchCine) {
      cam.cineFollow(
        cineEnding || t - cineStarted > 0.75 ? dog.group.position.clone().setY(0.55) : cineAim,
      )
    }
    // goodnight scene camera: framed on the lit doorway (yaw 0.55 = straight
    // down the door's normal), then a long gaze UP into the stars
    if (sleepActive) {
      if (skyGaze) {
        cam.cineFollow(homestead.doorPos.clone().add(new Vector3(0, 34, -10)), 0.55, -0.46)
      } else {
        cam.cineFollow(homestead.doorPos.clone().setY(1.2), 0.55, 0.38)
      }
    }
    // homestead windows warm up as the sun sinks (and stay lit all night)
    const eveK = sleepActive
      ? Math.max(nightDial.k, Math.min(1, (dayCycle.phase - 0.78) / 0.1))
      : Math.max(0, Math.min(1, (dayCycle.phase - 0.78) / 0.1))
    homestead.setEvening(eveK)
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

    // nest pip while an egg is cooking / ready
    const eggT = state.chicken.eggTimer
    if (eggT || state.chicken.eggReady) {
      const s = cam.screenPos(NEST_POS.clone().setY(0.6))
      const frac = state.chicken.eggReady ? 1 : 1 - (eggT ? eggT.remaining / eggT.total : 0)
      hud.setPip(!s.behind, s.x, s.y, frac, state.chicken.eggReady)
    } else {
      hud.setPip(false)
    }

    // floating name tag with hearts
    if (state.chicken.name && chicken.visible) {
      const s = cam.screenPos(chicken.tagWorldPos())
      hud.setNameTag(!s.behind, s.x, s.y, state.chicken.name, state.chicken.hearts)
    } else {
      hud.setNameTag(false)
    }

    // customer want bubbles
    let slot = 0
    for (const c of customers.queue) {
      if (c.phase === 'leaving') continue
      const v = customerViews.get(c.id)
      if (!v?.active) continue
      const s = cam.screenPos(v.bubbleAnchor())
      const html = `${GOOD_EMOJI[c.want.kind]}×${c.want.count} → <span class="coin-mini"></span> ${c.want.offer}`
      hud.setBubble(slot, !s.behind, s.x, s.y, html)
      slot += 1
      if (slot >= 2) break
    }
    for (; slot < 2; slot += 1) hud.setBubble(slot, false)
  })

  // ---- frame driver with rare-event slow-mo (presentation only) -------------------
  let last = performance.now()
  const loop = (now: number): void => {
    requestAnimationFrame(loop)
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    engine.advance(dt * (now < slowUntilReal ? 0.2 : 1))
  }
  requestAnimationFrame(loop)

  const resize = (): void => {
    cam.resize()
    renderer.setSize(innerWidth, innerHeight)
    composer.setSize(innerWidth, innerHeight)
  }
  addEventListener('resize', resize)
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
      if (away > 3) {
        catchUp(state, away)
        for (let i = 0; i < plots.length; i++) {
          const c = game.plotAt(i)?.crop ?? null
          plots[i].setCrop(c ? c.kind : null, c ? Game.stageOf(c.total, c.remaining) : 0, false)
        }
        if (state.chicken.eggReady && chicken.settled) chicken.showEgg(false)
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
        const c = Math.min(left, 0.25)
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
    escape: () => flock.startEscape(2, state.expansion),
    grazers: () => grazers.positions().map((p) => [p.x, p.z] as [number, number]),
    music: () => music.debug,
    musicUnlock: () => music.unlock(),
    sleepStart: () => {
      sleepScene()
      sleepTl?.pause()
    },
    sleepSeek: (s: number) => sleepTl?.seek(s, false),
    dusk: () => dayCycle.setPhase(0.88),
    draws: () => renderer.info.render.calls,
    warp: (x: number, z: number) => {
      player.pos.set(x, 0, z)
      prevPos.x = x
      prevPos.z = z
    },
  }
  window.__step = window.__farm.step

  gsap.to(veil, { opacity: 0, duration: 0.5, onComplete: () => veil.remove() })
}

void boot()
