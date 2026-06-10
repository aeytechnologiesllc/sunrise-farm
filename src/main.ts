/** Sunrise Farm — third-person diner-style boot + wiring.
 * You WALK the farm: joystick/WASD drives the farmer, actions fire by
 * proximity (walk into a ripe plot to harvest, walk to the hen to feed,
 * walk to the stand to serve customers). Hard rules honored: game logic
 * runs only on the fixed-step engine clock (no setTimeout, no tween-
 * completion gating); gsap is re-rooted on the engine clock; slow-mo is a
 * presentation-layer dip on rare events. */
import gsap from 'gsap'
import { ACESFilmicToneMapping, PCFSoftShadowMap, Scene, Vector3, WebGLRenderer } from 'three'
import { BloomEffect, EffectComposer, EffectPass, RenderPass, VignetteEffect } from 'postprocessing'
import { Sfx } from './audio/sfx'
import { Engine } from './engine/Engine'
import { CROPS, fountainCount, splitCoins, xpNeeded, type CropKind, type GoodKind } from './game/economy'
import { Customers } from './game/customers'
import { Game, type Suggestion } from './game/Game'
import { catchUp, deserialize, initialState, SAVE_KEY, serialize, type GameState } from './game/state'
import { Joystick } from './input/joystick'
import { Hud, type ActionDef } from './ui/hud'
import { Assets } from './world/assets'
import { ChickenView } from './world/Chicken'
import { CustomerView } from './world/Customer'
import { DogView } from './world/Dog'
import { FollowCamera, CAM_YAW } from './world/FollowCamera'
import { heartBurst, sparkleBurst } from './world/fx'
import { AmbientLife } from './world/fxAmbient'
import { PlayerView } from './world/Player'
import { PlotView } from './world/Plot'
import {
  buildClouds,
  buildGround,
  buildLights,
  buildMeadow,
  buildSky,
  buildStand,
  CRATE_POS,
  DOG_HOME,
  NEST_POS,
  PLAYER_SPAWN,
  STAND_POS,
  WORLD_BOUNDS,
} from './world/scenery'

const PLOT_POSITIONS = [
  new Vector3(1.6, 0, 0.6),
  new Vector3(4.4, 0, 0.6),
  new Vector3(1.6, 0, 3.4),
  new Vector3(4.4, 0, 3.4),
]
const HEN_NAMES = ['Henrietta', 'Clucky', 'Pearl', 'Butterscotch', 'Nugget', 'Daisy', 'Pepper', 'Marigold']
const GOOD_EMOJI: Record<GoodKind, string> = { wheat: '\u{1F33E}', corn: '\u{1F33D}', egg: '\u{1F95A}' }

// interaction radii (diner grammar: you go to it)
const PLOT_R = 2.1
const CHICK_R = 2.4
const CRATE_R = 2.6
const STAND_R = 2.9
const AUTOPLANT_AFTER = 0.6

// picket fence collision: thin walls with the two gate gaps left open
const FENCE = { minX: -8.4, maxX: 8.2, minZ: -3.4, maxZ: 10.2 }
const GATE_SOUTH = { center: STAND_POS.x + 0.4, half: 1.7 }
const GATE_WEST = { center: 3.2, half: 1.5 }

declare global {
  interface Window {
    __farm: {
      state: () => GameState
      give: (n: number) => void
      step: (s: number) => void
      wipe: () => void
      pos: () => [number, number]
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

  const renderer = new WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance' })
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  document.body.appendChild(renderer.domElement)

  const scene = new Scene()
  const cam = new FollowCamera(renderer.domElement, PLAYER_SPAWN)

  // warm ACES grade + gentle bloom + soft vignette (postprocessing pkg)
  const composer = new EffectComposer(renderer, { multisampling: 4 })
  composer.addPass(new RenderPass(scene, cam.camera))
  composer.addPass(
    new EffectPass(
      cam.camera,
      new BloomEffect({ intensity: 0.42, luminanceThreshold: 0.82, mipmapBlur: true }),
      new VignetteEffect({ darkness: 0.3, offset: 0.26 }),
    ),
  )
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

  buildLights(scene)
  buildSky(scene)
  buildGround(scene)
  buildMeadow(scene, assets)
  buildStand(scene, assets)
  const clouds = buildClouds(scene)
  const ambient = new AmbientLife(scene)

  // ---- state + game -------------------------------------------------------
  const loaded = deserialize(localStorage.getItem(SAVE_KEY))
  const state = loaded ?? initialState((Math.random() * 0xffffffff) >>> 0)
  const offline = loaded ? catchUp(state, (Date.now() - loaded.savedAt) / 1000) : null
  const game = new Game(state)
  const sfx = new Sfx()
  const hud = new Hud()
  const joy = new Joystick()

  const plots = PLOT_POSITIONS.map((p) => {
    const v = new PlotView(assets, p, scene)
    scene.add(v.group)
    return v
  })
  const lastGlow: Array<'none' | 'shimmer' | 'ready'> = plots.map(() => 'none')
  const chicken = new ChickenView(assets, scene, NEST_POS, CRATE_POS, state.chicken.seed)
  const dog = new DogView(assets, scene, DOG_HOME)
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
    sfx.fanfare()
  })
  game.on('cropReady', (e) => {
    sfx.chime()
    sparkleBurst(scene, plots[e.plot].center.clone().setY(0.8), false, 5)
  })
  game.on('eggReady', () => {
    sfx.chime()
    chicken.showEgg(false)
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
  for (let i = 0; i < state.plots.length; i++) {
    const crop = state.plots[i].crop
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
    state.plots.forEach((p, i) => {
      if (p.crop && p.crop.remaining <= 0) readySpots.push(plots[i].center)
    })
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
      sparkleBurst(scene, NEST_POS.clone().setY(1), true, 16)
      rareSlowMo()
    } else {
      sfx.pop()
    }
    fountainFrom(NEST_POS.clone().setY(1), res.coins, res.golden)
    saveNow()
  }

  // ---- customers ----------------------------------------------------------------
  const reflowQueue = (): void => {
    for (const c of customers.queue) customerViews.get(c.id)?.moveToSpot(customers.spotOf(c.id))
  }
  customers.onSpawn = (c) => {
    const view = new CustomerView(assets, scene, c.id, c.seed, customers.spotOf(c.id))
    view.onArrive = () => {
      customers.notifyArrived(c.id)
      sfx.bell()
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
      touch()
    },
    { capture: true },
  )

  // proximity snapshot shared between fixed step (logic) and taps (handlers)
  const near = { emptyPlot: -1, growingPlot: -1, chicken: false }
  const onAction = (id: string): void => {
    touch()
    if (id === 'wheat' && near.emptyPlot >= 0) plantAt(near.emptyPlot, 'wheat')
    else if (id === 'corn' && near.emptyPlot >= 0) plantAt(near.emptyPlot, 'corn')
    else if (id === 'feed' && game.canFeed()) {
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

  // picket fence is solid except at its two gates
  const prevPos = { x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z }
  const fenceBlock = (): void => {
    const p = player.pos
    const inX = Math.max(prevPos.x, p.x) > FENCE.minX - 0.2 && Math.min(prevPos.x, p.x) < FENCE.maxX + 0.2
    const inZ = Math.max(prevPos.z, p.z) > FENCE.minZ - 0.2 && Math.min(prevPos.z, p.z) < FENCE.maxZ + 0.2
    for (const line of [FENCE.minZ, FENCE.maxZ]) {
      if (inX && (prevPos.z - line) * (p.z - line) < 0) {
        const isGate = line === FENCE.maxZ && Math.abs(p.x - GATE_SOUTH.center) < GATE_SOUTH.half
        if (!isGate) p.z = prevPos.z
      }
    }
    for (const line of [FENCE.minX, FENCE.maxX]) {
      if (inZ && (prevPos.x - line) * (p.x - line) < 0) {
        const isGate = line === FENCE.minX && Math.abs(p.z - GATE_WEST.center) < GATE_WEST.half
        if (!isGate) p.x = prevPos.x
      }
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
    customers.active = state.harvests >= 1
    customers.update(dt, game.stock())
    player.update(dt, joy.value, CAM_YAW)
    fenceBlock()
    chicken.update(dt)
    dog.update(dt)
    for (const v of customerViews.values()) v.update(dt)
    serveCooldown = Math.max(0, serveCooldown - dt)
    if (joy.active) {
      touch()
      movedEver = true
    }

    // glow tiers from growth progress
    for (let i = 0; i < state.plots.length; i++) {
      const crop = state.plots[i].crop
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
      for (let i = 0; i < state.plots.length; i++) {
        if (p.distanceTo(plots[i].center) > PLOT_R) continue
        const crop = state.plots[i].crop
        if (!crop) {
          if (near.emptyPlot < 0) near.emptyPlot = i
        } else if (crop.remaining <= 0) doHarvest(i)
        else near.growingPlot = i
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
    }
    hud.setActions(actions, onAction)

    // ---- contextual top chip: top suggestion whose chip hasn't been retired ----
    const sug = game.suggestion()
    const customerWaiting = customers.frontServiceable(game.stock())
    let chipText: string | null = null
    if (!hud.modalOpen) {
      if (!movedEver && !state.chipsDone.plant) {
        chipText = 'Drag the joystick to take a walk \u{1F33B}'
      } else if (customerWaiting) {
        chipText = 'A customer is waiting at the stand!'
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
      const pos = chicken.cratePending
        ? chicken.crateWorldPos
        : customerWaiting
          ? STAND_POS
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
    cam.follow(player.pos, player.vel, dt)
    player.frame(dt, t)
    chicken.frame(dt, t)
    dog.frame(dt)
    for (const v of customerViews.values()) v.frame(dt)
    for (const p of plots) p.pulse(t)
    clouds.update(dt)
    ambient.update(t)

    // countdown ring while standing by a growing crop
    const gi = near.growingPlot
    const rp = gi >= 0 ? state.plots[gi]?.crop : null
    if (rp && rp.remaining > 0) {
      const s = cam.screenPos(plots[gi].center.clone().setY(1.2))
      hud.setRing(!s.behind, s.x, s.y, 1 - rp.remaining / rp.total, rp.remaining)
    } else {
      hud.setRing(false)
    }

    // nest pip while an egg is cooking / ready
    const eggT = state.chicken.eggTimer
    if (eggT || state.chicken.eggReady) {
      const s = cam.screenPos(NEST_POS.clone().setY(1.1))
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow()
  })

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
