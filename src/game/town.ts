/** MILLBROOK — the town the farm builds. Pure module.
 *
 * The story law: the town grows because the FARM sells. Every act is funded
 * with coins AND wheat (Hazel hauls it), and gated on lifetime deliveries —
 * you can't buy a town, you have to feed one. Acts, in order:
 *   1. bakery   — Rosie's ovens + the bus stop (visitors start arriving)
 *   2. cottages — two homes; named neighbors join the customer pool
 *   3. school   — the kids arrive (recess on the day clock)
 *   4. works    — butcher, market square and the wool works (wool pays more)
 * The two farmstead deeds (Act 4 of the owner's plan) live in expansion.ts
 * as land tiers 5 and 6 — land is land, the deed flow already knows it. */
import type { GameState } from './state'

export type TownActId = 'bakery' | 'cottages' | 'school' | 'works' | 'cafe' | 'square' | 'station'

export interface TownActDef {
  id: TownActId
  name: string
  /** what the purchase banner promises (purpose first, always) */
  earns: string
  coins: number
  wheat: number
  /** lifetime deliveries Hazel must have made (the town knows your bread) */
  needDelivered: number
  after: TownActId | null
  /** construction footprint at the town lot (the crew builds it) */
  footprint: { w: number; d: number }
  /** lot center along the east road, world coords (scenery zone, x > 22) */
  lot: [number, number]
  yaw: number
}

export const TOWN_ACTS: TownActDef[] = [
  {
    id: 'bakery',
    name: "Rosie's Bakery",
    earns: 'fresh bread for Millbrook — the morning bus brings customers',
    coins: 600,
    wheat: 16,
    needDelivered: 3,
    after: null,
    footprint: { w: 5.0, d: 4.2 },
    lot: [27.5, 8.6],
    yaw: Math.PI,
  },
  {
    id: 'cottages',
    name: 'The Cottages',
    earns: 'two families move in — and they love shopping at your stand',
    coins: 500,
    wheat: 10,
    needDelivered: 6,
    after: 'bakery',
    footprint: { w: 8.5, d: 4.0 },
    lot: [34.5, 8.4],
    yaw: Math.PI,
  },
  {
    id: 'school',
    name: 'The Schoolhouse',
    earns: 'Millbrook kids at recess — listen for the bell',
    coins: 900,
    wheat: 24,
    needDelivered: 10,
    after: 'cottages',
    footprint: { w: 6.0, d: 4.6 },
    lot: [28.5, 14.6],
    yaw: 0,
  },
  {
    id: 'works',
    name: 'The Wool Works',
    earns: 'butcher, market square and the mill — your wool pays half again more',
    coins: 1400,
    wheat: 30,
    needDelivered: 14,
    after: 'school',
    footprint: { w: 7.5, d: 5.0 },
    lot: [40.5, 14.8],
    yaw: 0,
  },
  {
    id: 'cafe',
    name: 'The Copper Kettle',
    earns: 'coffee and cake in the village — and a daily egg order that starts the morning right',
    coins: 1800,
    wheat: 40,
    needDelivered: 20,
    after: 'works',
    footprint: { w: 5.5, d: 4.2 },
    lot: [46.0, 8.0],
    yaw: Math.PI,
  },
  {
    id: 'square',
    name: 'Festival Square',
    earns: 'the village green is open — the weekly festival pays more when crowds fill the square',
    coins: 2600,
    wheat: 50,
    needDelivered: 28,
    after: 'cafe',
    footprint: { w: 9.0, d: 9.0 },
    lot: [37.5, 15.5],
    yaw: 0,
  },
  {
    id: 'station',
    name: 'Millbrook Station',
    earns: 'the railway arrives — a fourth daily order comes in by rail every morning',
    coins: 4200,
    wheat: 60,
    needDelivered: 36,
    after: 'square',
    footprint: { w: 10.0, d: 5.5 },
    lot: [50.5, 11.0],
    yaw: Math.PI,
  },
]

export function townActDef(id: TownActId): TownActDef {
  return TOWN_ACTS.find((a) => a.id === id)!
}

export type TownBlock = 'owned' | 'after' | 'delivered' | 'coins' | 'wheat' | 'ok'

/** why an act can(not) be funded — precedence mirrors what the sign says:
 * story gates (the previous act, the deliveries) before money gates */
export function townStatus(def: TownActDef, s: GameState): TownBlock {
  if (s.town.built[def.id]) return 'owned'
  if (def.after && !s.town.built[def.after]) return 'after'
  if (s.town.delivered < def.needDelivered) return 'delivered'
  if (s.coins < def.coins) return 'coins'
  if (s.wheat < def.wheat) return 'wheat'
  return 'ok'
}

/** the next act with a sign up (one dream at a time on the town board) */
export function nextTownAct(s: GameState): TownActDef | null {
  for (const a of TOWN_ACTS) if (!s.town.built[a.id]) return a
  return null
}

/** the morning bakery contract: Rosie buys 4 wheat at a premium, once per
 * day, automatically — the first standing order the farm ever had */
export const BAKERY_WHEAT = 4
export const BAKERY_RATE = 9

export function bakeryOrderReady(s: GameState, today: string): boolean {
  return s.town.built.bakery === true && s.town.lastBakeryDay !== today && s.wheat >= BAKERY_WHEAT
}

/** the café's standing egg order: the Copper Kettle buys 3 eggs at a premium
 * once per day, automatically — the farm's second standing order */
export const CAFE_EGGS = 3
export const CAFE_RATE = 20

export function cafeOrderReady(s: GameState, today: string): boolean {
  return s.town.built.cafe === true && s.town.lastCafeDay !== today && s.eggs >= CAFE_EGGS
}

/** wool pays half again more once the works spin (cozy law: town additions
 * only ever ADD — nothing existing pays less) */
export function woolMult(s: GameState): number {
  return s.town.built.works ? 1.5 : 1
}

/** named regulars the cottages bring — they shop like customers but tip */
export const NEIGHBORS = ['Rosie', 'Martha', 'Tom'] as const

/** the bus: one morning arrival per day once the bakery stands. The window
 * is a day-phase band so reloads can't double-run it; main latches per day. */
export function busWindow(phase: number): boolean {
  return phase >= 0.3 && phase <= 0.42
}

/** afternoon return bus — Millbrook's second run, mirrors the morning latch */
export function busWindowPm(phase: number): boolean {
  return phase >= 0.66 && phase <= 0.78
}

/** recess: kids spill into the schoolyard mid-day — two bands: morning recess
 * and post-lunch play (~47% of the day, up from ~17%) */
export function recessNow(phase: number): boolean {
  return (phase >= 0.3 && phase <= 0.44) || (phase >= 0.48 && phase <= 0.66)
}
