/** PRODUCE — the owner's law in code: everything the player buys EARNS.
 * Sheep grow wool to shear, goats fill the milk pail, and the stable's horse
 * runs paid deliveries — but she must be FED (wheat upkeep) before each run.
 * Pure module (no three/DOM imports): constants, state shape, tick + action
 * functions. The Game class wires coins, feed deduction and FX on top. */

export interface Produce {
  /** seconds until the flock's wool is ready (counts down while sheep exist) */
  woolT: number
  woolReady: boolean
  milkT: number
  milkReady: boolean
  /** >0 while the horse is out on a run (counts down to payday) */
  deliveryT: number
  /** cooldown after a run before the next one */
  deliveryCd: number
  /** coop nesting boxes filling with eggs */
  eggsT: number
  eggsReady: boolean
}

/** a beat slower than crops so income moments interleave instead of clumping */
export const WOOL_TIME = 170
export const WOOL_COIN_PER_SHEEP = 6
export const MILK_TIME = 140
export const MILK_COIN_PER_GOAT = 9
/** horse round trip */
export const DELIVERY_RUN_TIME = 75
export const DELIVERY_COOLDOWN = 200
/** upkeep: feed before she runs */
export const DELIVERY_FEED_WHEAT = 1
/** payday range, inclusive both ends */
export const DELIVERY_PAY: [number, number] = [26, 42]
/** the coop's nesting boxes fill on this cadence */
export const COOP_TIME = 150
export const COOP_COIN_PER_HEN = 7
export const COOP_HENS = 4

export function initialProduce(): Produce {
  return {
    woolT: WOOL_TIME,
    woolReady: false,
    milkT: MILK_TIME,
    milkReady: false,
    deliveryT: 0,
    deliveryCd: 0,
    eggsT: COOP_TIME,
    eggsReady: false,
  }
}

/** which earners exist in the world right now (projects built) */
export interface ProduceFlags {
  sheep: boolean
  goats: boolean
  stable: boolean
  coop?: boolean
}

/** one-frame edges for the Game to turn into chimes, banners and coin bursts */
export interface ProduceEvents {
  woolBecameReady: boolean
  milkBecameReady: boolean
  deliveryReturned: boolean
  eggsBecameReady: boolean
}

/** Advance all produce timers by dt seconds. Wool/milk timers run only while
 * the matching flag is true; on hitting 0 the ready flag LATCHES (the timer
 * parks at 0 until collected, so each batch fires its event exactly once).
 * The horse's run counts down only while she is out (deliveryT > 0); the
 * moment she returns the rest cooldown starts at full. The cooldown itself
 * always drains toward 0. */
export function tickProduce(p: Produce, dt: number, has: ProduceFlags): ProduceEvents {
  const ev: ProduceEvents = {
    woolBecameReady: false,
    milkBecameReady: false,
    deliveryReturned: false,
    eggsBecameReady: false,
  }
  if (has.coop && !p.eggsReady) {
    p.eggsT = Math.max(0, p.eggsT - dt)
    if (p.eggsT === 0) {
      p.eggsReady = true
      ev.eggsBecameReady = true
    }
  }
  if (has.sheep && !p.woolReady) {
    p.woolT = Math.max(0, p.woolT - dt)
    if (p.woolT === 0) {
      p.woolReady = true
      ev.woolBecameReady = true
    }
  }
  if (has.goats && !p.milkReady) {
    p.milkT = Math.max(0, p.milkT - dt)
    if (p.milkT === 0) {
      p.milkReady = true
      ev.milkBecameReady = true
    }
  }
  // drain the existing cooldown BEFORE a fresh one can start, so a new rest
  // period never loses its first frame to the same tick that began it
  p.deliveryCd = Math.max(0, p.deliveryCd - dt)
  if (p.deliveryT > 0) {
    p.deliveryT = Math.max(0, p.deliveryT - dt)
    if (p.deliveryT === 0) {
      ev.deliveryReturned = true
      p.deliveryCd = DELIVERY_COOLDOWN
    }
  }
  return ev
}

/** Shear the flock: consumes the ready batch and restarts the grow timer.
 * No-op (false) when nothing is ready — safe to call from any button. */
export function shearWool(p: Produce): boolean {
  if (!p.woolReady) return false
  p.woolReady = false
  p.woolT = WOOL_TIME
  return true
}

/** Collect the milk pail: consumes the ready batch and restarts the timer. */
export function collectMilk(p: Produce): boolean {
  if (!p.milkReady) return false
  p.milkReady = false
  p.milkT = MILK_TIME
  return true
}

/** Gather the coop's egg baskets: consumes the batch and restarts the timer. */
export function collectCoopEggs(p: Produce): boolean {
  if (!p.eggsReady) return false
  p.eggsReady = false
  p.eggsT = COOP_TIME
  return true
}

/** Why the delivery button is (or is not) available, most-blocking first:
 * no stable at all > horse already out > resting after a run > needs feed. */
export function canDeliver(
  p: Produce,
  has: ProduceFlags,
  wheat: number
): 'ok' | 'no-stable' | 'resting' | 'out' | 'feed' {
  if (!has.stable) return 'no-stable'
  if (p.deliveryT > 0) return 'out'
  if (p.deliveryCd > 0) return 'resting'
  if (wheat < DELIVERY_FEED_WHEAT) return 'feed'
  return 'ok'
}

/** Send the horse out on a run. The caller has already passed canDeliver and
 * deducted the wheat feed; this only refuses mid-run or while resting. */
export function startDelivery(p: Produce): boolean {
  if (p.deliveryT > 0 || p.deliveryCd > 0) return false
  p.deliveryT = DELIVERY_RUN_TIME
  return true
}

/** Map a uniform roll in [0,1) to an integer payday in DELIVERY_PAY,
 * inclusive on both ends — the jackpot is genuinely reachable. */
export function deliveryPay(roll: number): number {
  const [lo, hi] = DELIVERY_PAY
  return lo + Math.floor(roll * (hi - lo + 1))
}
