/** Game orchestrator: owns state, fixed-step timers, and all actions.
 * Emits events; never depends on rendering, tweens, or wall-clock timers. */
import {
  CROPS,
  type CropKind,
  GOLDEN_CROP_CHANCE,
  type GoodKind,
  XP_GAIN,
  eggTimerFor,
  eggValue,
  goldenEggChance,
  rollGolden,
  sellValue,
  xpNeeded,
} from './economy'
import { mulberry32, type Rng } from './rng'
import type { ChipId, GameState } from './state'

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
    this.todayFn = today ?? (() => new Date().toLocaleDateString('en-CA'))
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

  update(dt: number): void {
    const s = this.state
    for (let i = 0; i < s.plots.length; i++) {
      const crop = s.plots[i].crop
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
  }

  // ---- actions ----------------------------------------------------------

  cropUnlocked(kind: CropKind): boolean {
    return this.state.level >= CROPS[kind].unlockLevel
  }

  plant(plot: number, kind: CropKind): boolean {
    const p = this.state.plots[plot]
    if (!p || p.crop || !this.cropUnlocked(kind)) return false
    p.crop = { kind, total: CROPS[kind].growSec, remaining: CROPS[kind].growSec, chimed: false }
    this.grantXp(XP_GAIN.plant)
    this.retireChip('plant')
    return true
  }

  harvest(plot: number): HarvestResult | null {
    const p = this.state.plots[plot]
    if (!p?.crop || p.crop.remaining > 0) return null
    const kind = p.crop.kind
    p.crop = null
    const golden = rollGolden(this.rng, GOLDEN_CROP_CHANCE)
    this.syncRng()
    const coins = sellValue(kind, golden)
    this.grantCoins(coins)
    // bank the good as stand stock too (wheat doubles as feed) — customers
    // buying it later is a pure bonus on top of the auto-sell
    if (kind === 'wheat') this.state.wheat += 1
    else this.state.corn += 1
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
    return { wheat: this.state.wheat, corn: this.state.corn, egg: this.state.eggs }
  }

  /** hand goods to a customer: decrements stock, pays the offered coins.
   * Fails (returns false) only when stock ran out since the want was rolled —
   * the customer simply keeps waiting (no-punishment rule). */
  fulfill(kind: GoodKind, count: number, coins: number): boolean {
    const s = this.state
    const have = kind === 'wheat' ? s.wheat : kind === 'corn' ? s.corn : s.eggs
    if (have < count) return false
    if (kind === 'wheat') s.wheat -= count
    else if (kind === 'corn') s.corn -= count
    else s.eggs -= count
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

  give(n: number): void {
    this.grantCoins(n)
  }

  // ---- guidance ---------------------------------------------------------

  /** Highest-priority obvious next action, used by dog guide + chips. */
  suggestion(): Suggestion | null {
    const s = this.state
    const ready = s.plots.findIndex((p) => p.crop && p.crop.remaining <= 0)
    if (ready >= 0) return { kind: 'harvest', plot: ready }
    if (s.chicken.eggReady) return { kind: 'collect' }
    if (this.canFeed()) return { kind: 'feed' }
    if (this.canPet()) return { kind: 'pet' }
    const empty = s.plots.findIndex((p) => !p.crop)
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
