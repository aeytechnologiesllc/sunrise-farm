/** Sunrise Farm — vertical slice boot + wiring.
 * Hard rules honored here: game logic runs only on the fixed-step engine
 * clock (no setTimeout, no tween-completion gating); gsap is re-rooted on
 * the engine clock; slow-mo is a presentation-layer dip on rare events. */
import gsap from 'gsap'
import { ACESFilmicToneMapping, PCFSoftShadowMap, Raycaster, Scene, Vector2, Vector3, WebGLRenderer, type Object3D } from 'three'
import { Sfx } from './audio/sfx'
import { Engine } from './engine/Engine'
import { CROPS, fountainCount, splitCoins, xpNeeded, type CropKind } from './game/economy'
import { Game, type Suggestion } from './game/Game'
import { catchUp, deserialize, initialState, SAVE_KEY, serialize, type GameState } from './game/state'
import { Hud } from './ui/hud'
import { Assets } from './world/assets'
import { CameraRig } from './world/CameraRig'
import { ChickenView } from './world/Chicken'
import { DogView } from './world/Dog'
import { heartBurst, sparkleBurst } from './world/fx'
import { PlotView } from './world/Plot'
import { buildLights, buildMeadow, buildStand, CRATE_POS, DOG_HOME, NEST_POS } from './world/scenery'

const PLOT_POSITIONS = [
  new Vector3(1.6, 0, 0.6),
  new Vector3(4.4, 0, 0.6),
  new Vector3(1.6, 0, 3.4),
  new Vector3(4.4, 0, 3.4),
]
const HEN_NAMES = ['Henrietta', 'Clucky', 'Pearl', 'Butterscotch', 'Nugget', 'Daisy', 'Pepper', 'Marigold']

declare global {
  interface Window {
    __farm: {
      state: () => GameState
      give: (n: number) => void
      step: (s: number) => void
      wipe: () => void
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

  const renderer = new WebGLRenderer({ antialias: true })
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  document.body.appendChild(renderer.domElement)

  const scene = new Scene()
  const rig = new CameraRig(renderer.domElement)
  const engine = new Engine(() => renderer.render(scene, rig.camera))

  // gsap re-rooted on the engine clock: tweens advance only when the engine
  // does, so __farm.step() fast-forwards visuals deterministically too.
  gsap.ticker.remove(gsap.updateRoot)
  engine.onFrame(() => gsap.updateRoot(engine.uTime.value))

  const assets = new Assets()
  const ldp = veil.querySelector('#ldp')!
  await assets.loadAll((d, t) => (ldp.textContent = `loading ${d}/${t}`))

  buildLights(scene)
  buildMeadow(scene, assets)
  buildStand(scene, assets)

  // ---- state + game -------------------------------------------------------
  const loaded = deserialize(localStorage.getItem(SAVE_KEY))
  const state = loaded ?? initialState((Math.random() * 0xffffffff) >>> 0)
  const offline = loaded ? catchUp(state, (Date.now() - loaded.savedAt) / 1000) : null
  const game = new Game(state)
  const sfx = new Sfx()
  const hud = new Hud()

  const plots = PLOT_POSITIONS.map((p) => {
    const v = new PlotView(assets, p, scene)
    scene.add(v.group)
    return v
  })
  const lastGlow: Array<'none' | 'shimmer' | 'ready'> = plots.map(() => 'none')
  const chicken = new ChickenView(assets, scene, NEST_POS, CRATE_POS, state.chicken.seed)
  const dog = new DogView(assets, scene, DOG_HOME)

  const saveNow = (): void => localStorage.setItem(SAVE_KEY, serialize(state))

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
      chicken.acknowledge(rig.camera.position)
      saveNow()
    })
  }
  game.on('chickenArrive', () => {
    rig.panTo(CRATE_POS, 0.9)
    chicken.beginArrival(
      () => sfx.crate(),
      () => runNaming(),
    )
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
      const tl = gsap.timeline()
      for (const spot of readySpots) {
        tl.add(rig.panTo(spot, 0.9))
        tl.to({}, { duration: 0.55 })
      }
      tl.add(rig.panTo(new Vector3(0, 0, 1.5), 0.9))
    }
  }

  // ---- actions --------------------------------------------------------------
  let lastInteract = 0
  const touch = (): void => {
    lastInteract = engine.uTime.value
  }

  const fountainFrom = (world: Vector3, coins: number, golden: boolean): void => {
    const from = rig.screenPos(world)
    hud.coinFountain(from, splitCoins(coins, fountainCount(coins)), golden, () => sfx.tink())
  }

  let slowUntilReal = 0
  const rareSlowMo = (): void => {
    slowUntilReal = performance.now() + 100
  }

  const doHarvest = (i: number): void => {
    const center = plots[i].center.clone().setY(0.9)
    const res = game.harvest(i)
    if (!res) return
    plots[i].harvestPop(res.golden)
    plots[i].setCrop(null, 0, false)
    lastGlow[i] = 'none'
    sfx.pop()
    if (res.golden) {
      sfx.golden()
      sparkleBurst(scene, center, true, 16)
      rareSlowMo()
    } else {
      sparkleBurst(scene, center, false, 6)
    }
    fountainFrom(center, res.coins, res.golden)
    hud.setWheat(state.wheat)
    saveNow()
  }

  const ringState = { plot: -1, until: -1 }

  const onPlotTap = (i: number, screen: { x: number; y: number }): void => {
    const crop = state.plots[i].crop
    if (!crop) {
      hud.showSeedPicker(
        screen,
        [
          { kind: 'wheat', label: 'Wheat', emoji: '🌾', time: '90s', locked: false, lockText: '' },
          {
            kind: 'corn',
            label: 'Corn',
            emoji: '🌽',
            time: '4m',
            locked: !game.cropUnlocked('corn'),
            lockText: `Lv ${CROPS.corn.unlockLevel}`,
          },
        ],
        (kind: CropKind) => {
          if (game.plant(i, kind)) {
            plots[i].setCrop(kind, 0, true)
            sfx.plant()
            saveNow()
          }
        },
      )
    } else if (crop.remaining > 0) {
      // poke: countdown ring + a little acknowledgement wiggle
      ringState.plot = i
      ringState.until = engine.uTime.value + 2.5
      gsap.fromTo(plots[i].group.scale, { x: 1.06, z: 1.06 }, { x: 1, z: 1, duration: 0.3, ease: 'back.out(3)' })
    } else {
      doHarvest(i)
    }
  }

  const onChickenTap = (): void => {
    if (state.chicken.eggReady) {
      const res = game.collectEgg()
      if (!res) return
      chicken.collectEggFx()
      if (res.golden) {
        sfx.golden()
        sparkleBurst(scene, NEST_POS.clone().setY(1), true, 16)
        rareSlowMo()
      } else {
        sfx.pop()
      }
      fountainFrom(NEST_POS.clone().setY(1), res.coins, res.golden)
      saveNow()
    } else if (game.canFeed()) {
      if (game.feed()) {
        hud.setWheat(state.wheat)
        chicken.eat(engine.uTime.value)
        sfx.cluck()
        saveNow()
      }
    } else if (game.canPet()) {
      if (game.pet()) {
        heartBurst(scene, chicken.tagWorldPos())
        sfx.heart()
        chicken.acknowledge(rig.camera.position)
        saveNow()
      }
    } else {
      chicken.acknowledge(rig.camera.position)
      sfx.cluck()
    }
  }

  // ---- tap routing -----------------------------------------------------------
  const raycaster = new Raycaster()
  rig.onTap = (ndc: Vector2, screen) => {
    touch()
    if (hud.modalOpen) return
    raycaster.setFromCamera(ndc, rig.camera)
    const targets: Array<{ roots: Object3D[]; act: () => void }> = plots.map((p, i) => ({
      roots: [p.group],
      act: () => onPlotTap(i, screen),
    }))
    if (chicken.visible) targets.push({ roots: chicken.hitRoots(), act: onChickenTap })
    // whole-scene pass acts as an occluder: a tree in front of a plot blocks it
    targets.push({ roots: [scene], act: () => undefined })
    // nearest hit wins; interactive targets are checked first so ties go to them
    let best: { dist: number; act: () => void } | null = null
    for (const t of targets) {
      for (const root of t.roots) {
        const hits = raycaster.intersectObject(root, true)
        if (hits.length && (!best || hits[0].distance < best.dist)) best = { dist: hits[0].distance, act: t.act }
      }
    }
    best?.act()
  }

  addEventListener('pointerdown', () => {
    sfx.unlock()
    touch()
  })

  // ---- fixed-step systems ------------------------------------------------------
  let saveAccum = 0
  let coinMismatchFor = 0
  engine.onUpdate((dt) => {
    game.update(dt)
    chicken.update(dt)
    dog.update(dt)

    // glow tiers from growth progress
    for (let i = 0; i < state.plots.length; i++) {
      const crop = state.plots[i].crop
      const mode = !crop ? 'none' : crop.remaining <= 0 ? 'ready' : 1 - crop.remaining / crop.total >= 0.9 ? 'shimmer' : 'none'
      if (mode !== lastGlow[i]) {
        plots[i].setGlow(mode)
        lastGlow[i] = mode
      }
    }

    // contextual chip: top suggestion whose chip hasn't been retired
    const sug = game.suggestion()
    let chipText: string | null = null
    if (sug && !hud.modalOpen) {
      const name = state.chicken.name ?? 'her'
      const texts: Record<Suggestion['kind'], string> = {
        plant: 'Tap a field plot to plant 🌾',
        harvest: 'Your crop is ready — tap it!',
        feed: `Feed ${name} a wheat — tap her 🌾`,
        collect: `${name} laid an egg — tap to collect!`,
        pet: `Pet ${name} — once a day ♥`,
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
    hud.showChip(chipText)

    // dog guide: idle 5s + an obvious next action -> walk near it and bounce
    if (sug && engine.uTime.value - lastInteract > 5 && !hud.modalOpen && !chicken.ceremonyActive) {
      const pos =
        sug.kind === 'plant' || sug.kind === 'harvest'
          ? plots[sug.plot].center
          : sug.kind === 'collect'
            ? NEST_POS
            : chicken.tagWorldPos().setY(0)
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
    rig.update()
    chicken.frame(dt, t)
    dog.frame(dt)
    for (const p of plots) p.pulse(t)

    // countdown ring on poked crops
    const rp = ringState.plot >= 0 ? state.plots[ringState.plot]?.crop : null
    if (rp && rp.remaining > 0 && t < ringState.until) {
      const s = rig.screenPos(plots[ringState.plot].center.clone().setY(1.2))
      hud.setRing(!s.behind, s.x, s.y, 1 - rp.remaining / rp.total, rp.remaining)
    } else {
      hud.setRing(false)
    }

    // nest pip while an egg is cooking / ready
    const eggT = state.chicken.eggTimer
    if (eggT || state.chicken.eggReady) {
      const s = rig.screenPos(NEST_POS.clone().setY(1.1))
      const frac = state.chicken.eggReady ? 1 : 1 - (eggT ? eggT.remaining / eggT.total : 0)
      hud.setPip(!s.behind, s.x, s.y, frac, state.chicken.eggReady)
    } else {
      hud.setPip(false)
    }

    // floating name tag with hearts
    if (state.chicken.name && chicken.visible) {
      const s = rig.screenPos(chicken.tagWorldPos())
      hud.setNameTag(!s.behind, s.x, s.y, state.chicken.name, state.chicken.hearts)
    } else {
      hud.setNameTag(false)
    }
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
    rig.resize()
    renderer.setSize(innerWidth, innerHeight)
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
      localStorage.removeItem(SAVE_KEY)
      location.reload()
    },
  }
  window.__step = window.__farm.step

  gsap.to(veil, { opacity: 0, duration: 0.5, onComplete: () => veil.remove() })
}

void boot()
