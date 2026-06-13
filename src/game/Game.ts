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
import { canPlaceDecor, decorDef, type DecorId } from './decor'
import {
  fieldParcel,
  fieldPlotCount,
  HOMESTEAD_FENCE,
  HOMESTEAD_GATES,
  parcelCost,
  parcelLevel,
  type TierDef,
} from './expansion'
import { fenceStyleDef, type FenceStyle } from './fence'
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
  GREENHOUSE_GROW_MULT,
  PROJECTS,
  projectStatus,
  type ProjectDef,
  type ProjectId,
} from './projects'
import {
  type Contract,
  type ContractGood,
  contractSlots,
  type FestivalOrder,
  rollContracts,
  rollFestival,
} from './contracts'
import {
  greenhouseBeds,
  type UpgradeDef,
  upgradeDef,
  type UpgradeId,
  upgradeStatus,
} from './upgrades'
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
  CAFE_EGGS,
  CAFE_RATE,
  cafeOrderReady,
  townActDef,
  townStatus,
  woolMult,
  type TownActId,
} from './town'
import { mulberry32, type Rng } from './rng'
import type { ChipId, GameState, PlotState } from './state'

/** the renovated farmhouse's daily family-breakfast coin treat */
const HOMERENO_BREAKFAST = 75
/** the most a seasoned sheepdog adds per sheep (on top of HERD_COIN_PER_SHEEP) */
const HERD_SEASONED_CAP = 6

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
  xp: { xp: number; need: number; level: number }
  levelup: { level: number; unlocked: CropKind[] }
  stage: { plot: number; stage: number }
  cropReady: { plot: number }
  chickenArrive: undefined
  eggReady: undefined
  coopReady: undefined
  deliveryDone: { coins: number }
  bakerySold: { coins: number }
  cafeSold: { coins: number }
  contractDone: { slot: number; contract: Contract }
  festivalDone: { payout: number; ribbons: number }
  upgraded: { def: UpgradeDef }
  decorChanged: undefined
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
    this.ensureContractsFresh()
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
    // The Copper Kettle's standing order: 3 eggs at a premium, once a day
    if (cafeOrderReady(s, this.todayFn())) {
      s.town.lastCafeDay = this.todayFn()
      s.eggs -= CAFE_EGGS
      const pay = CAFE_EGGS * CAFE_RATE
      this.grantCoins(pay)
      this.emit('cafeSold', { coins: pay })
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

  // ---- the order board: daily contracts + a weekly festival --------------
  // The evergreen money sink. Contracts are NOT stored (deterministic rolls
  // per save-seed + day); only PROGRESS lives on the save. noteProduce() ticks
  // them as goods are made; a filled order pays out once.

  /** which week of farm life this is (0-indexed) — the festival cadence */
  private weekOf(): number {
    return Math.floor((this.state.day - 1) / 7)
  }

  /** roll the day/week forward: a new day re-rolls the board (fresh progress);
   * a new week re-rolls the festival. Also resizes the progress arrays if the
   * slot count changed (the train station adds a 4th slot in a later arc). */
  private ensureContractsFresh(): void {
    const s = this.state
    const slots = contractSlots(s)
    // re-roll only when the DAY turns (or the slot count changed, or an old save
    // has no frozen list yet) — never on a mid-day level-up, which would reshuffle
    // the goods under progress already banked into a slot
    if (s.contracts.day !== s.day) {
      // a new day turns the whole board over (fresh orders, fresh progress)
      s.contracts = {
        day: s.day,
        goods: rollContracts(s.chicken.seed, s.day, s),
        progress: new Array(slots).fill(0),
        done: new Array(slots).fill(false),
      }
    } else if (s.contracts.goods.length < slots) {
      // the Station added a slot mid-day (or an old save had no frozen board):
      // APPEND the new slot(s) instead of re-rolling, so today's banked progress
      // survives. The first N goods are the same deterministic roll regardless
      // of total slot count, so the existing orders are untouched.
      const full = rollContracts(s.chicken.seed, s.day, s)
      for (let i = s.contracts.goods.length; i < slots; i++) {
        s.contracts.goods.push(full[i])
        s.contracts.progress.push(0)
        s.contracts.done.push(false)
      }
    }
    if (s.town.built.cottages === true) {
      const week = this.weekOf()
      if (s.festival.week !== week || s.festival.order.goods.length === 0) {
        const order = rollFestival(s.chicken.seed, week, s)
        s.festival = { week, order, progress: new Array(order.goods.length).fill(0), done: false }
      }
    }
  }

  /** count a freshly-made good toward any matching open order — the single
   * hook every production site calls (harvest/egg/coop/shear/milk). */
  private noteProduce(good: ContractGood, qty: number): void {
    if (qty <= 0) return
    const s = this.state
    this.ensureContractsFresh()
    const list = s.contracts.goods // the FROZEN list, immune to mid-day re-rolls
    for (let i = 0; i < list.length; i++) {
      if (s.contracts.done[i] || list[i].good !== good) continue
      s.contracts.progress[i] += qty
      if (s.contracts.progress[i] >= list[i].qty) {
        s.contracts.done[i] = true
        this.grantCoins(list[i].payout)
        this.grantXp(XP_GAIN.serve)
        this.emit('contractDone', { slot: i, contract: list[i] })
      }
    }
    if (s.town.built.cottages === true && !s.festival.done) {
      const fest = s.festival.order // frozen for the week
      let touched = false
      for (let j = 0; j < fest.goods.length; j++) {
        if (fest.goods[j].good === good) {
          s.festival.progress[j] += qty
          touched = true
        }
      }
      if (touched && fest.goods.every((g, j) => (s.festival.progress[j] ?? 0) >= g.qty)) {
        s.festival.done = true
        s.festivalRibbons += 1
        this.grantCoins(fest.payout)
        this.grantXp(XP_GAIN.expand)
        this.emit('festivalDone', { payout: fest.payout, ribbons: s.festivalRibbons })
      }
    }
  }

  /** today's board (for the HUD): the contracts and their live progress */
  contractBoard(): { contract: Contract; progress: number; done: boolean }[] {
    this.ensureContractsFresh()
    const s = this.state
    return s.contracts.goods.map((contract, i) => ({
      contract,
      progress: s.contracts.progress[i] ?? 0,
      done: s.contracts.done[i] ?? false,
    }))
  }

  /** this week's festival order + progress, or null before the cottages exist */
  festivalBoard(): { order: FestivalOrder; progress: number[]; done: boolean } | null {
    const s = this.state
    if (s.town.built.cottages !== true) return null
    this.ensureContractsFresh()
    return { order: s.festival.order, progress: [...s.festival.progress], done: s.festival.done }
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
    // crop races (FTUE: the player tastes the harvest loop in ~20s)
    const ftue = this.state.harvests === 0 ? 0.25 : 1
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
    this.noteProduce(kind, 1)
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
    this.noteProduce('egg', 1)
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
    // "A Cosier Home" finally earns its keep: the renovated farmhouse lays on a
    // warm family breakfast once a day — a small, cosy daily treat (was purely
    // cosmetic for 6000c before)
    if (this.state.upgrades.homereno) this.grantCoins(HOMERENO_BREAKFAST)
    return true
  }

  /** the daily family breakfast pays this once the home is renovated */
  get breakfastBonus(): number {
    return this.state.upgrades.homereno ? HOMERENO_BREAKFAST : 0
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

  // ---- land expansion: the ENDLESS east field -----------------------------

  /** the deed on offer — ALWAYS the next field parcel (the field extends east
   * forever, so there is never a null deed). Synthesized as a TierDef so every
   * existing consumer (the sign, the ceremony, the action sheet) is unchanged:
   * its `field`/`plots` come straight from the parcel generator, its `fence`/
   * `gates` are the now-fixed homestead yard, and its `sign` stands at the
   * parcel's west edge (z 2.0). */
  nextDeed(): TierDef {
    const owned = this.state.fieldParcels
    const parcel = fieldParcel(owned) // the NEXT parcel (0-indexed → owned)
    return {
      name: 'The East Field',
      flavor: 'Another run of soil, east as far as you like.',
      cost: parcelCost(owned),
      level: parcelLevel(owned),
      field: parcel.rect,
      plots: parcel.plots,
      fence: HOMESTEAD_FENCE,
      gates: HOMESTEAD_GATES,
      sign: [parcel.rect.x0 + 0.5, 2.0],
      lot: undefined,
      tractor: false,
    }
  }

  /** what's blocking the purchase ('ok' = buyable now). Never null — the deed
   * always exists. */
  deedStatus(): 'ok' | 'level' | 'coins' {
    const def = this.nextDeed()
    if (this.state.level < def.level) return 'level'
    if (this.state.coins < def.cost) return 'coins'
    return 'ok'
  }

  /** buy the next field parcel: extends the strip east, grows the plot array
   * by one parcel's worth, grants expand XP. Returns the synthetic deed for
   * the ceremony (built from the parcel JUST bought), or null if unaffordable. */
  expand(): TierDef | null {
    if (this.deedStatus() !== 'ok') return null
    const def = this.nextDeed()
    const s = this.state
    s.coins -= def.cost
    s.fieldParcels += 1
    while (s.plots.length < fieldPlotCount(s.fieldParcels)) s.plots.push({ crop: null })
    this.grantXp(XP_GAIN.expand)
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
    s.projects[id] = true
    if (id === 'greenhouse') {
      while (s.ghPlots.length < greenhouseBeds(s)) s.ghPlots.push({ crop: null })
    }
    this.grantXp(XP_GAIN.expand)
    return entry.def
  }

  /** buy a building upgrade (the greenhouse wing, market, pasture, etc.).
   * Side effects beyond the flag live HERE so the save stays the source of
   * truth — main.ts mirrors the visuals off the resulting state. */
  buyUpgrade(id: UpgradeId): UpgradeDef | null {
    const s = this.state
    const def = upgradeDef(id)
    if (upgradeStatus(def, s) !== 'ok') return null
    s.coins -= def.cost
    s.upgrades[id] = true
    // the bigger greenhouse grows its planting beds immediately
    if (id === 'ghwing') {
      while (s.ghPlots.length < greenhouseBeds(s)) s.ghPlots.push({ crop: null })
    }
    this.grantXp(XP_GAIN.expand)
    this.emit('upgraded', { def })
    return def
  }

  hasUpgrade(id: UpgradeId): boolean {
    return this.state.upgrades[id] === true
  }

  // ---- the decoration shop --------------------------------------------------

  /** can the player afford + legally place this decoration here? */
  canBuyDecor(id: DecorId, x: number, z: number): boolean {
    const s = this.state
    const def = decorDef(id)
    return s.level >= def.level && s.coins >= def.cost && canPlaceDecor(s, x, z).ok
  }

  /** buy + place a decoration at (x,z,rot). Deducts coins, appends to s.decor,
   * stamps the day (saplings grow from it). Returns false if not allowed. */
  placeDecor(id: DecorId, x: number, z: number, rot: number): boolean {
    if (!this.canBuyDecor(id, x, z)) return false
    const s = this.state
    const def = decorDef(id)
    s.coins -= def.cost
    s.decor.push({ item: id, x, z, rot, d: s.day })
    this.grantXp(XP_GAIN.plant)
    this.emit('decorChanged', undefined)
    return true
  }

  /** pick up the nearest decoration within `r` (refunds nothing — it's removed
   * from the world so the player can re-arrange). Returns true if one went. */
  removeDecorNear(x: number, z: number, r: number): boolean {
    const s = this.state
    let best = -1
    let bestD = r * r
    for (let i = 0; i < s.decor.length; i++) {
      const p = s.decor[i]
      const d = (p.x - x) ** 2 + (p.z - z) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best < 0) return false
    s.decor.splice(best, 1)
    this.emit('decorChanged', undefined)
    return true
  }

  /** buy a fence skin (and switch to it). 'classic' is always owned. */
  buyFenceStyle(id: FenceStyle): boolean {
    const s = this.state
    const def = fenceStyleDef(id)
    if (!def || s.fenceStyles[id] || s.level < def.level || s.coins < def.cost) return false
    s.coins -= def.cost
    s.fenceStyles[id] = true
    s.fenceStyle = id
    this.grantXp(XP_GAIN.expand)
    return true
  }

  /** the skins the player owns, classic always first */
  ownedFenceStyles(): FenceStyle[] {
    const owned: FenceStyle[] = ['classic']
    for (const id of ['picket', 'cedar', 'stone'] as const) {
      if (this.state.fenceStyles[id]) owned.push(id)
    }
    return owned
  }

  setFenceStyle(id: FenceStyle): void {
    if (id === 'classic' || this.state.fenceStyles[id]) this.state.fenceStyle = id
  }

  hasProject(id: ProjectId): boolean {
    return this.state.projects[id] === true
  }

  // ---- dog missions ---------------------------------------------------------

  /** all sheep home: pay out (scales with flock size) */
  herdComplete(sheepHomed: number): { coins: number } {
    // a seasoned sheepdog earns his keep: every few completed herds, Rex brings
    // them in a touch tighter for +1c/sheep, capped — so repeat herding (the
    // herdsDone counter was dead before) keeps getting a little more rewarding
    const seasoned = Math.min(HERD_SEASONED_CAP, Math.floor(this.state.herdsDone / 3))
    const coins = (HERD_COIN_PER_SHEEP + seasoned) * sheepHomed
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
    // the Festival Square pays its 1.5x from THIS week, not next: the festival
    // order is frozen for the week, so apply the bonus to the live order in
    // place (preserving goods + progress) instead of waiting for a re-roll
    if (id === 'square') {
      const fest = this.state.festival
      if (!fest.done && fest.order.goods.length > 0) {
        fest.order.payout = Math.round(fest.order.payout * 1.5)
      }
    }
    this.grantXp(XP_GAIN.expand)
    return true
  }

  /** shear the whole flock: coins per sheep, wool timer restarts */
  shearFlock(sheepCount: number): number {
    if (sheepCount <= 0 || !shearWool(this.state.produce)) return 0
    // the wool works pays half again more (town additions only ever ADD)
    const coins = Math.round(WOOL_COIN_PER_SHEEP * sheepCount * woolMult(this.state))
    this.grantCoins(coins)
    this.noteProduce('wool', sheepCount)
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
    this.noteProduce('egg', n)
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
    this.noteProduce('egg', 1)
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
    this.noteProduce('milk', goatCount)
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
  }

  // ---- internals --------------------------------------------------------

  private grantCoins(n: number): void {
    this.state.coins += n
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

  /** a deterministic 0..1 draw from the save's seeded stream — for any sim
   * value that must not use the non-seeded JS RNG (e.g. the saved herd timer) */
  rollFloat(): number {
    const v = this.rng.next()
    this.syncRng()
    return v
  }
}
