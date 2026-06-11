/** Customer queue logic: pure, fixed-step, seeded — no three/DOM imports.
 * Diner grammar: customers arrive on a relaxed cadence, ask for something
 * the stand can actually supply (want rolled against live stock), and they
 * NEVER leave angry — unserved customers wait/browse forever (no-punishment
 * rule). Queue is capped so the road never feels like pressure. */
import {
  CUSTOMER_DELAY,
  CUSTOMER_FIRST_DELAY,
  CUSTOMER_PREMIUM,
  CUSTOMER_QUEUE_MAX,
  type GoodKind,
  offerFor,
  tipFor,
} from './economy'
import { mulberry32, type Rng } from './rng'

export interface Want {
  kind: GoodKind
  count: number
  /** coins shown in the bubble (premium over auto-sell, additive bonus) */
  offer: number
  /** extra coins revealed at hand-over — the little surprise on top */
  tip: number
}

export type CustomerPhase = 'arriving' | 'waiting' | 'leaving'

export interface Customer {
  id: number
  /** seeded look (which character model / tint the view picks) */
  seed: number
  want: Want
  phase: CustomerPhase
}

export type Stock = Record<GoodKind, number>

export class Customers {
  readonly queue: Customer[] = []
  /** set false during FTUE; main flips it on after the first harvest */
  active = false
  /** pay multiplier — the Farm Shop project raises it above the base */
  premium = CUSTOMER_PREMIUM
  /** queue cap — the Farm Shop fits more browsers */
  queueMax = CUSTOMER_QUEUE_MAX
  onSpawn: ((c: Customer) => void) | null = null

  private rng: Rng
  private nextIn: number
  private nextId = 1

  constructor(seed: number) {
    this.rng = mulberry32(seed)
    this.nextIn = this.roll(CUSTOMER_FIRST_DELAY)
  }

  private roll([lo, hi]: [number, number]): number {
    return lo + this.rng.next() * (hi - lo)
  }

  /** fixed-step tick. Spawns at most one customer per call. */
  update(dt: number, stock: Stock): void {
    if (!this.active) return
    if (this.queue.length >= this.queueMax) return
    this.nextIn -= dt
    if (this.nextIn > 0) return
    // hold (don't reset) the timer until something is in stock, so the
    // very next restock produces a visitor — feels alive, never unfair
    const want = this.rollWant(stock)
    if (!want) return
    this.nextIn = this.roll(CUSTOMER_DELAY)
    const c: Customer = {
      id: this.nextId++,
      seed: (this.rng.next() * 0xffffffff) >>> 0,
      want,
      phase: 'arriving',
    }
    this.queue.push(c)
    this.onSpawn?.(c)
  }

  /** want scaled to stock: only kinds in stock, count never above stock,
   * so the ask is fulfillable the moment it is made */
  private rollWant(stock: Stock): Want | null {
    const kinds = (Object.keys(stock) as GoodKind[]).filter((k) => stock[k] > 0)
    if (kinds.length === 0) return null
    const kind = kinds[Math.floor(this.rng.next() * kinds.length)]
    const count = Math.max(1, Math.min(2, Math.floor(this.rng.next() * stock[kind]) + 1))
    const offer = offerFor(kind, count, this.premium)
    return { kind, count, offer, tip: tipFor(offer, this.rng.next()) }
  }

  /** view reports the walk-up finished; only waiting customers can be served */
  notifyArrived(id: number): void {
    const c = this.queue.find((q) => q.id === id)
    if (c && c.phase === 'arriving') c.phase = 'waiting'
  }

  /** first customer at the counter whose want the stand can cover right now */
  frontServiceable(stock: Stock): Customer | null {
    for (const c of this.queue) {
      if (c.phase === 'waiting' && stock[c.want.kind] >= c.want.count) return c
    }
    return null
  }

  /** mark served: leaves happy; the view animates the walk-away */
  serve(id: number): void {
    const c = this.queue.find((q) => q.id === id)
    if (c) c.phase = 'leaving'
  }

  /** view finished the walk-away */
  remove(id: number): void {
    const i = this.queue.findIndex((q) => q.id === id)
    if (i >= 0) this.queue.splice(i, 1)
  }

  /** queue position among not-yet-leaving customers (0 = front spot) */
  spotOf(id: number): number {
    let spot = 0
    for (const c of this.queue) {
      if (c.id === id) return spot
      if (c.phase !== 'leaving') spot += 1
    }
    return spot
  }
}
