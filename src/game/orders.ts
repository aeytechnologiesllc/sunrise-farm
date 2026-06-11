/** Delivery orders — WHO in Millbrook buys what Hazel carries. Pure module.
 * The same six neighbors recur (they are the future named regulars of the
 * town story), so receipts build familiarity: "Rosie again!" The roll is
 * seeded per (day, run) — deterministic for saves and tests, and the same
 * delivery always names the same buyer. */
import { mulberry32 } from './rng'

export interface DeliveryOrder {
  buyer: string
  /** what the buyer does with it — receipt flavor */
  use: string
}

/** the Millbrook cast: bakers and builders the town acts will reuse */
const BUYERS: Array<{ name: string; uses: string[] }> = [
  { name: 'Rosie', uses: ['for her famous bread', 'for tomorrow’s pies'] },
  { name: 'Martha', uses: ['for the boarding-house kitchen', 'for sunday supper'] },
  { name: 'Old Tom', uses: ['for his hens', 'for the feed store'] },
  { name: 'Eli the miller', uses: ['for the mill', 'ground fresh for flour'] },
  { name: 'June', uses: ['for the schoolhouse lunches', 'for the harvest social'] },
  { name: 'the Hartley farm', uses: ['their own wheat failed this year', 'to tide them over'] },
]

/** which neighbor takes today's load (seeded; varies day to day) */
export function orderFor(day: number, deliveriesSent: number): DeliveryOrder {
  const rng = mulberry32(((day * 73856093) ^ (deliveriesSent * 19349663) ^ 0x5ee1) >>> 0)
  const b = BUYERS[Math.floor(rng.next() * BUYERS.length)]
  return { buyer: b.name, use: b.uses[Math.floor(rng.next() * b.uses.length)] }
}
