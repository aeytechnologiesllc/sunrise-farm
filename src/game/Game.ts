/** Game orchestrator: owns state, fixed-step timers, and all actions.
 * Emits events; never depends on rendering, tweens, or wall-clock timers. */
import {
  CROPS,
  type CropKind,
  FETCH_TREASURE,
  FETCH_TREASURE_CHANCE,
  GOLDEN_CROP_CHANCE,
  GOLDEN_EGG_BASE,
  GOLDEN_MULT,
  type GoodKind,
  HERD_COIN_PER_SHEEP,
  XP_GAIN,
  eggTimerFor,
  eggValue,
  goldenEggChance,
  rollGolden,
  sellValue,
  xpNeeded,
} from './economy'
import { nextTier, plotCount, type TierDef } from './expansion'
import {
  canDeliver,
  collectMilk,
  DELIVERY_FEED_WHEAT,
  deliveryPay,
  MILK_COIN_PER_GOAT,
  shearWool,
  startDelivery,
  tickProduce,
  WOOL_COIN_PER_SHEEP,
} from './produce'
import {
  GREENHOUSE_BEDS,
  GREENHOUSE_GROW_MULT,
  PROJECTS,
  projectStatus,
  type ProjectDef,
  type ProjectId,
} from './projects'
import {
  buyHen,
  collectAllBoxes,
  collectBox,
  EGG_BOX_COIN,
  henBuyStatus,
  henCost,
  openWing,
  tickHenhouse,
  WING_COST,
  wingStatus,
  type HenDef,
} from './henhouse'
import {
  BAKERY_RATE,
  BAKERY_WHEAT,
  bakeryOrderReady,
  townActDef,
  townStatus,
  woolMult,
  type TownActId,
} from './town'
import { mulberry32, type Rng } from './rng'
import type { ChipId, GameState, PlotState } from './state'

export interface HarvestResult {
  kind: CropKind
  golden: boolean
  coins: number
}

export interface EggResult {
  golden: boolean
  coins: number
}

export type Suggestion =
  | { kind: 'harvest'; plot: number }
  | { kind: 'collect' }
  | { kind: 'feed' }
  | { kind: 'pet' }
  | { kind: 'plant'; plot: number }

export interface GameEvents {
  coins: { total: number; delta: number }
  xp: { xp: number; need: number; level: number }
  levelup: { level: number; unlocked: CropKind[] }
  stage: { plot: number; stage: number }
  cropReady: { plot: number }
  chickenArrive: undefined
  eggReady: undefined
  chipDone: { chip: ChipId }
  expanded: { tier: number; def: TierDef }
  built: { def: ProjectDef }
  woolReady: undefined
  milkReady: undefined
  coopReady: undefined
  deliveryDone: { coins: number }
  townBuilt: { id: TownActId }
  bakerySold: { coins: number }
}

type Listener<K extends keyof GameEvents> = (payload: GameEvents[K]) => void

export class Game {
  readonly state: GameState
  private rng: Rng
  private listeners: { [K in keyof GameEvents]?: Listener<K>[] } = {}
  private todayFn: () => string

  constructor(state: GameState, today?: () => string) {
    this.state = state
    this.rng = mulberry32(state.rng)
    // "once a day" means the GAME's day — sleeping into Day N+1 re-opens the
    // daily pet, exactly as the ritual promises
    this.todayFn = today ?? (() => `day-${this.state.day}`)
  }

  on<K extends keyof GameEvents>(type: K, fn: Listener<K>): void {
    const arr = (this.listeners[type] ??= []) as Listener<K>[]
    arr.push(fn)
  }

  private emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    for (const fn of this.listeners[type] ?? []) fn(payload)
  }

  /** crop growth stage 0..3 (3 = full size; ready when remaining hits 0) */
  static stageOf(total: number, remaining: number): number {
    if (remaining <= 0) return 3
    const p = 1 - remaining / total
    return Math.min(3, Math.floor(p * 4))
  }

  /** combined plot index space: field plots first, then greenhouse planters
   * (a separate array so land expansions never reindex saved greenhouse crops) */
  plotAt(i: number): PlotState | undefined {
    const s = this.state
    return i < s.plots.length ? s.plots[i] : s.ghPlots[i - s.plots.length]
  }

  get plotTotal(): number {
    return this.state.plots.length + this.state.ghPlots.length
  }

  /** true when the combined index is a greenhouse planter */
  isGreenhouse(i: number): boolean {
    return i >= this.state.plots.length
  }

  update(dt: number): void {
    const s = this.state
    for (let i = 0; i < this.plotTotal; i++) {
      const crop = this.plotAt(i)!.crop
      if (!crop || crop.remaining <= 0) continue
      const before = Game.stageOf(crop.total, crop.remaining)
      crop.remaining = Math.max(0, crop.remaining - dt)
      const after = Game.stageOf(crop.total, crop.remaining)
      if (after !== before) this.emit('stage', { plot: i, stage: after })
      if (crop.remaining <= 0 && !crop.chimed) {
        crop.chimed = true
        this.emit('cropReady', { plot: i })
      }
    }
    const t = s.chicken.eggTimer
    if (t) {
      t.remaining = Math.max(0, t.remaining - dt)
      if (t.remaining <= 0) {
        s.chicken.eggTimer = null
        s.chicken.eggReady = true
        s.chicken.eggsLaid += 1
        this.emit('eggReady', undefined)
      }
    }
    // production: wool grows, milk fills, the delivery horse earns her keep.
    // The produce gate keeps its historical 'stable' key, but deliveries need
    // HAZEL — the stable and the horse are separate purchases now
    const pev = tickProduce(s.produce, dt, {
      sheep: this.hasProject('sheep'),
      goats: this.hasProject('goats'),
      stable: this.hasProject('horse'),
      coop: this.hasProject('coop'),
    })
    if (pev.woolBecameReady) this.emit('woolReady', undefined)
    if (pev.milkBecameReady) this.emit('milkReady', undefined)
    // the henhouse boxes are the coop's truth now (eggsT keeps ticking only
    // so a rolled-back client stays coherent)
    if (this.hasProject('coop')) {
      const hev = tickHenhouse(s.coopFlock, dt)
      if (hev.readyBoxes.length) this.emit('coopReady', undefined)
    }
    // Rosie's standing order: 4 wheat at a premium, once a day, hands-free
    if (bakeryOrderReady(s, this.todayFn())) {
      s.town.lastBakeryDay = this.todayFn()
      s.wheat -= BAKERY_WHEAT
      const pay = BAKERY_WHEAT * BAKERY_RATE
      this.grantCoins(pay)
      this.emit('bakerySold', { coins: pay })
    }
    if (pev.deliveryReturned) {
      // a loved horse haggles better: +1c per heart on LIVE returns only
      // (offline catch-up stays the flat 34 — the absentee-landlord rule)
      const coins = deliveryPay(this.rng.next()) + Math.min(8, s.hazel.hearts)
      this.syncRng()
      this.grantCoins(coins)
      this.grantXp(XP_GAIN.deliver)
      s.town.delivered += 1
      this.emit('deliveryDone', { coins })
    }
  }

  // ---- actions ----------------------------------------------------------

  cropUnlocked(kind: CropKind): boolean {
    return this.state.level >= CROPS[kind].unlockLevel
  }

  plant(plot: number, kind: CropKind): boolean {
    const p = this.plotAt(plot)
    if (!p || p.crop || !this.cropUnlocked(kind)) return false
    // greenhouse exclusives only thrive under glass — the rare crops are
    // what makes the building an upgrade, not a skin
    if (CROPS[kind].greenhouse && !this.isGreenhouse(plot)) return false
    // greenhouse warmth: crops mature faster under glass; the very FIRST
    // crop races (FTUE: the player tastes the harvest loop in ~30s)
    const ftue = this.state.harvests === 0 ? 0.35 : 1
    const total = CROPS[kind].growSec * (this.isGreenhouse(plot) ? GREENHOUSE_GROW_MULT : 1) * ftue
    p.crop = { kind, total, remaining: total, chimed: false }
    this.grantXp(XP_GAIN.plant)
    this.retireChip('plant')
    return true
  }

  harvest(plot: number): HarvestResult | null {
    const p = this.plotAt(plot)
    if (!p?.crop || p.crop.remaining > 0) return null
    const kind = p.crop.kind
    p.crop = null
    const golden = rollGolden(this.rng, GOLDEN_CROP_CHANCE)
    this.syncRng()
    const coins = sellValue(kind, golden)
    this.grantCoins(coins)
    // bank the good as stand stock too (wheat doubles as feed) — customers
    // buying it later is a pure bonus on top of the auto-sell
    this.bank(kind, 1)
    this.state.harvests += 1
    this.grantXp(XP_GAIN.harvest)
    this.retireChip('harvest')
    if (this.state.harvests === 1 && !this.state.chicken.arrived) {
      this.state.chicken.arrived = true
      this.emit('chickenArrive', undefined)
    }
    return { kind, golden, coins }
  }

  setChickenName(name: string): void {
    const n = name.trim()
    if (n) this.state.chicken.name = n
  }

  canFeed(): boolean {
    const c = this.state.chicken
    return c.arrived && c.name !== null && this.state.wheat > 0 && !c.eggTimer && !c.eggReady
  }

  feed(): boolean {
    if (!this.canFeed()) return false
    const c = this.state.chicken
    this.state.wheat -= 1
    const total = eggTimerFor(c.eggsLaid)
    c.eggTimer = { total, remaining: total }
    this.grantXp(XP_GAIN.feed)
    this.retireChip('feed')
    return true
  }

  collectEgg(): EggResult | null {
    const c = this.state.chicken
    if (!c.eggReady) return null
    c.eggReady = false
    const golden = rollGolden(this.rng, goldenEggChance(c.hearts))
    this.syncRng()
    const coins = eggValue(golden)
    this.grantCoins(coins)
    this.state.eggs += 1
    this.grantXp(XP_GAIN.collectEgg)
    this.retireChip('collect')
    return { golden, coins }
  }

  /** current stand stock, used to scale customer wants */
  stock(): Record<GoodKind, number> {
    const s = this.state
    return { wheat: s.wheat, corn: s.corn, tomato: s.tomatoes, pepper: s.peppers, eggplant: s.eggplants, egg: s.eggs }
  }

  /** adjust the stand-stock counter for a good (wheat doubles as feed) */
  private bank(kind: GoodKind, delta: number): void {
    const s = this.state
    if (kind === 'wheat') s.wheat += delta
    else if (kind === 'corn') s.corn += delta
    else if (kind === 'tomato') s.tomatoes += delta
    else if (kind === 'pepper') s.peppers += delta
    else if (kind === 'eggplant') s.eggplants += delta
    else s.eggs += delta
  }

  /** hand goods to a customer: decrements stock, pays the offered coins.
   * Fails (returns false) only when stock ran out since the want was rolled —
   * the customer simply keeps waiting (no-punishment rule). */
  fulfill(kind: GoodKind, count: number, coins: number): boolean {
    if (this.stock()[kind] < count) return false
    this.bank(kind, -count)
    this.grantCoins(coins)
    this.grantXp(XP_GAIN.serve)
    return true
  }

  canPet(): boolean {
    const c = this.state.chicken
    return c.arrived && c.name !== null && c.lastPetDay !== this.todayFn()
  }

  pet(): boolean {
    if (!this.canPet()) return false
    const c = this.state.chicken
    c.lastPetDay = this.todayFn()
    c.hearts += 1
    this.grantXp(XP_GAIN.pet)
    this.retireChip('pet')
    return true
  }

  /** a daily hello for Hazel in her stall — hearts cap at 8 and pay +1c
   * each on live delivery returns (the chicken-pet grammar, horse-sized) */
  canPetHorse(): boolean {
    return this.hasProject('horse') && this.state.hazel.lastPetDay !== this.todayFn()
  }

  petHorse(): boolean {
    if (!this.canPetHorse()) return false
    const h = this.state.hazel
    h.lastPetDay = this.todayFn()
    h.hearts = Math.min(8, h.hearts + 1)
    this.grantXp(XP_GAIN.pet)
    return true
  }

  /** the once-a-day hello at home — no coins, a dab of XP; love is free */
  canGreetFamily(): boolean {
    return this.state.familyGreetDay !== this.todayFn()
  }

  greetFamily(): boolean {
    if (!this.canGreetFamily()) return false
    this.state.familyGreetDay = this.todayFn()
    this.grantXp(XP_GAIN.pet)
    return true
  }

  /** a scoop of oats (costs 1 wheat) — pure affection; the first scoop of
   * the day also warms a heart. Only while she's HOME (cozy law: no
   * feeding an empty stall, no stacking hearts by spamming) */
  feedHorse(): boolean {
    const s = this.state
    if (!this.hasProject('horse') || s.wheat < 1 || s.produce.deliveryT > 0) return false
    s.wheat -= 1
    if (s.hazel.lastFedDay !== this.todayFn()) {
      s.hazel.lastFedDay = this.todayFn()
      s.hazel.hearts = Math.min(8, s.hazel.hearts + 1)
    }
    return true
  }

  give(n: number): void {
    this.grantCoins(n)
  }

  // ---- land expansion -----------------------------------------------------

  /** the deed on offer, if any */
  nextDeed(): TierDef | null {
    return nextTier(this.state.expansion)
  }

  /** what's blocking the purchase ('ok' = buyable now) */
  deedStatus(): 'ok' | 'level' | 'coins' | null {
    const def = this.nextDeed()
    if (!def) return null
    if (this.state.level < def.level) return 'level'
    if (this.state.coins < def.cost) return 'coins'
    return 'ok'
  }

  expand(): TierDef | null {
    const def = this.nextDeed()
    if (!def || this.deedStatus() !== 'ok') return null
    const s = this.state
    s.coins -= def.cost
    this.emit('coins', { total: s.coins, delta: -def.cost })
    s.expansion += 1
    while (s.plots.length < plotCount(s.expansion)) s.plots.push({ crop: null })
    this.grantXp(XP_GAIN.expand)
    this.emit('expanded', { tier: s.expansion, def })
    return def
  }

  /** tractor: sow every empty FIELD plot at once; returns plot indices.
   * Greenhouse beds are off-limits — they're hand-planted with rare crops */
  plantAll(kind: CropKind): number[] {
    if (!this.cropUnlocked(kind) || CROPS[kind].greenhouse) return []
    const planted: number[] = []
    for (let i = 0; i < this.plotTotal; i++) {
      const p = this.plotAt(i)!
      if (p.crop || this.isGreenhouse(i)) continue
      const total = CROPS[kind].growSec
      p.crop = { kind, total, remaining: total, chimed: false }
      planted.push(i)
    }
    if (planted.length) {
      this.grantXp(XP_GAIN.plant * planted.length)
      this.retireChip('plant')
    }
    return planted
  }

  // ---- construction projects ------------------------------------------------

  /** status of every project on the board (for signs + chips) */
  projectBoard(): Array<{ def: ProjectDef; status: ReturnType<typeof projectStatus> }> {
    const s = this.state
    return PROJECTS.map((def) => ({
      def,
      status: projectStatus(def, {
        level: s.level,
        coins: s.coins,
        expansion: s.expansion,
        projects: s.projects as Partial<Record<ProjectId, boolean>>,
      }),
    }))
  }

  /** fund a project: deducts, marks owned, opens greenhouse planters */
  buildProject(id: ProjectId): ProjectDef | null {
    const entry = this.projectBoard().find((e) => e.def.id === id)
    if (!entry || entry.status !== 'ok') return null
    const s = this.state
    s.coins -= entry.def.cost
    this.emit('coins', { total: s.coins, delta: -entry.def.cost })
    s.projects[id] = true
    if (id === 'greenhouse') {
      while (s.ghPlots.length < GREENHOUSE_BEDS) s.ghPlots.push({ crop: null })
    }
    this.grantXp(XP_GAIN.expand)
    this.emit('built', { def: entry.def })
    return entry.def
  }

  hasProject(id: ProjectId): boolean {
    return this.state.projects[id] === true
  }

  // ---- dog missions ---------------------------------------------------------

  /** all sheep home: pay out (scales with flock size) */
  herdComplete(sheepHomed: number): { coins: number } {
    const coins = HERD_COIN_PER_SHEEP * sheepHomed
    this.state.herdsDone += 1
    this.grantCoins(coins)
    this.grantXp(XP_GAIN.herd)
    return { coins }
  }

  /** stick fetch returned; sometimes Rex digs up a coin or two */
  fetchReturned(treasure: number): void {
    this.grantXp(XP_GAIN.fetch)
    if (treasure > 0) this.grantCoins(treasure)
  }

  // ---- produce (everything you own EARNS — with a little upkeep) ------------

  /** fund the next act of Millbrook: coins AND wheat (Hazel hauled it) */
  townStatusOf(id: TownActId): ReturnType<typeof townStatus> {
    return townStatus(townActDef(id), this.state)
  }

  buyTownAct(id: TownActId): boolean {
    const def = townActDef(id)
    if (townStatus(def, this.state) !== 'ok') return false
    this.state.coins -= def.coins
    this.state.wheat -= def.wheat
    this.state.town.built[id] = true
    this.emit('coins', { total: this.state.coins, delta: -def.coins })
    this.grantXp(XP_GAIN.expand)
    this.emit('townBuilt', { id })
    return true
  }

  /** shear the whole flock: coins per sheep, wool timer restarts */
  shearFlock(sheepCount: number): number {
    if (sheepCount <= 0 || !shearWool(this.state.produce)) return 0
    // the wool works pays half again more (town additions only ever ADD)
    const coins = Math.round(WOOL_COIN_PER_SHEEP * sheepCount * woolMult(this.state))
    this.grantCoins(coins)
    this.grantXp(XP_GAIN.shear)
    return coins
  }

  /** how many nesting boxes hold an egg right now */
  coopReadyCount(): number {
    return this.state.coopFlock.boxes.filter((b) => b.ready).length
  }

  /** the outside one-tap: every ready box at flat value (never required to
   * walk in — the inside walk-past is the additive golden-roll bonus) */
  collectCoop(): number {
    const n = collectAllBoxes(this.state.coopFlock)
    if (n <= 0) return 0
    const coins = EGG_BOX_COIN * n
    this.grantCoins(coins)
    this.state.eggs += n
    this.grantXp(XP_GAIN.collectEgg)
    return coins
  }

  /** the inside walk-past: ONE box, with a golden roll (4x) — jackpot
   * texture for visiting the henhouse */
  collectBoxInside(i: number): { coins: number; golden: boolean } | null {
    if (!collectBox(this.state.coopFlock, i)) return null
    const golden = rollGolden(this.rng, GOLDEN_EGG_BASE)
    this.syncRng()
    const coins = EGG_BOX_COIN * (golden ? GOLDEN_MULT : 1)
    this.grantCoins(coins)
    this.state.eggs += 1
    this.grantXp(XP_GAIN.collectEgg)
    return { coins, golden }
  }

  /** the crate by the henhouse door: a new hen joins (capacity gates it) */
  henBuyStatus(): ReturnType<typeof henBuyStatus> {
    return henBuyStatus(this.state.coopFlock, this.state.coins)
  }

  buyHen(): HenDef | null {
    if (this.henBuyStatus() !== 'ok') return null
    const cost = henCost(this.state.coopFlock.hens.length)
    this.state.coins -= cost
    this.emit('coins', { total: this.state.coins, delta: -cost })
    const hen = buyHen(this.state.coopFlock, (Math.floor(this.rng.next() * 0xffffffff)) >>> 0)
    this.syncRng()
    this.grantXp(XP_GAIN.feed)
    return hen
  }

  /** open the next boarded wing — more boxes, more hens */
  wingStatus(): ReturnType<typeof wingStatus> {
    return wingStatus(this.state.coopFlock, this.state.level, this.state.coins)
  }

  openWing(): boolean {
    if (this.wingStatus() !== 'ok') return false
    const cost = WING_COST[this.state.coopFlock.tier]
    this.state.coins -= cost
    this.emit('coins', { total: this.state.coins, delta: -cost })
    openWing(this.state.coopFlock)
    this.grantXp(XP_GAIN.expand)
    return true
  }

  /** toss a handful of wheat for the flock — they come running (the
   * henhouse's 10-second delight; costs the wheat, pays in charm + a dab
   * of XP, never coins — feeding must not out-earn farming) */
  scatterFeed(): boolean {
    if (this.state.wheat < 1) return false
    this.state.wheat -= 1
    this.grantXp(XP_GAIN.feed)
    return true
  }

  /** milk every goat: coins per goat, milk timer restarts */
  milkGoats(goatCount: number): number {
    if (goatCount <= 0 || !collectMilk(this.state.produce)) return 0
    const coins = MILK_COIN_PER_GOAT * goatCount
    this.grantCoins(coins)
    this.grantXp(XP_GAIN.milk)
    return coins
  }

  /** the horse runs a paid delivery — after you FEED her (1 wheat upkeep).
   * Keyed on the HORSE project: an empty stable can't deliver anything */
  deliveryStatus(): ReturnType<typeof canDeliver> {
    return canDeliver(this.state.produce, {
      sheep: this.hasProject('sheep'),
      goats: this.hasProject('goats'),
      stable: this.hasProject('horse'),
    }, this.state.wheat)
  }

  sendDelivery(): boolean {
    if (this.deliveryStatus() !== 'ok') return false
    this.state.wheat -= DELIVERY_FEED_WHEAT
    const ok = startDelivery(this.state.produce)
    if (ok) this.state.deliveriesSent += 1
    return ok
  }

  /** what today was worth — read BEFORE sleep() resets the ledger (the
   * star-gaze card: research says the bed must double as the reward tally) */
  daySummary(): { coins: number; harvests: number; eggs: number } {
    const s = this.state
    return {
      coins: s.coins - s.dayStart.coins,
      harvests: s.harvests - s.dayStart.harvests,
      eggs: s.chicken.eggsLaid - s.dayStart.eggs,
    }
  }

  /** the sleep ritual: a new day dawns — and crops grow overnight (the
   * plant-before-bed / wake-to-harvest loop is the genre's strongest hook:
   * the dawn walk-out should greet you with glowing ready plots) */
  sleep(): number {
    this.state.day += 1
    for (let i = 0; i < this.plotTotal; i++) {
      const crop = this.plotAt(i)?.crop
      if (crop) crop.remaining = 0
    }
    this.state.dayStart = { coins: this.state.coins, harvests: this.state.harvests, eggs: this.state.chicken.eggsLaid }
    this.grantXp(XP_GAIN.sleep)
    return this.state.day
  }

  /** seeded roll: what Rex dug up alongside the stick (0 = just the stick) */
  rollFetchTreasure(): number {
    let out = 0
    if (this.rng.next() < FETCH_TREASURE_CHANCE) {
      const [a, b] = FETCH_TREASURE
      out = a + Math.floor(this.rng.next() * (b - a + 1))
    }
    this.syncRng()
    return out
  }

  // ---- guidance ---------------------------------------------------------

  /** Highest-priority obvious next action, used by dog guide + chips. */
  suggestion(): Suggestion | null {
    const s = this.state
    let ready = -1
    let empty = -1
    for (let i = 0; i < this.plotTotal; i++) {
      const crop = this.plotAt(i)!.crop
      if (crop && crop.remaining <= 0 && ready < 0) ready = i
      // never steer the player (or the guide dog) toward the off-world
      // glasshouse beds — those are found by walking through the door
      if (!crop && empty < 0 && !this.isGreenhouse(i)) empty = i
    }
    if (ready >= 0) return { kind: 'harvest', plot: ready }
    if (s.chicken.eggReady) return { kind: 'collect' }
    if (this.canFeed()) return { kind: 'feed' }
    if (this.canPet()) return { kind: 'pet' }
    if (empty >= 0) return { kind: 'plant', plot: empty }
    return null
  }

  retireChip(chip: ChipId): void {
    if (this.state.chipsDone[chip]) return
    this.state.chipsDone[chip] = true
    this.emit('chipDone', { chip })
  }

  // ---- internals --------------------------------------------------------

  private grantCoins(n: number): void {
    this.state.coins += n
    this.emit('coins', { total: this.state.coins, delta: n })
  }

  private grantXp(n: number): void {
    const s = this.state
    s.xp += n
    let leveled = false
    while (s.xp >= xpNeeded(s.level)) {
      s.xp -= xpNeeded(s.level)
      s.level += 1
      leveled = true
    }
    this.emit('xp', { xp: s.xp, need: xpNeeded(s.level), level: s.level })
    if (leveled) {
      const unlocked = (Object.keys(CROPS) as CropKind[]).filter(
        (k) => CROPS[k].unlockLevel === s.level,
      )
      this.emit('levelup', { level: s.level, unlocked })
    }
  }

  private syncRng(): void {
    this.state.rng = this.rng.state()
  }
}
