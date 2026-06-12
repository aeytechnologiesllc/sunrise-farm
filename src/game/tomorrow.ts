/** The "Tomorrow:" tease on the goodnight card, and who signs the
 * welcome-back note. Pure peeks at the save — anticipation is the cheapest
 * retention there is, and it must never lie. */
import type { GameState } from './state'
import { PROJECTS, projectStatus } from './projects'

/** up to three true things to look forward to in the morning */
export function tomorrowLines(s: GameState): string[] {
  const lines: string[] = []
  // the soonest crop still growing (field or glasshouse)
  let best: { kind: string; remaining: number } | null = null
  for (const p of [...s.plots, ...s.ghPlots]) {
    const c = p.crop
    if (c && c.remaining > 0 && (!best || c.remaining < best.remaining)) {
      best = { kind: c.kind, remaining: c.remaining }
    }
  }
  if (best) lines.push(`the ${best.kind} comes in`)
  // eggs: waiting beats on-the-way (never both — one line per truth)
  if (s.projects.coop) {
    const ready = s.coopFlock.boxes.filter((b) => b.ready).length
    const due = s.coopFlock.boxes.filter((b, i) => s.coopFlock.hens[i] && !b.ready).length
    if (ready > 0) lines.push(`${ready} egg${ready === 1 ? '' : 's'} waiting in the henhouse`)
    else if (due > 0) lines.push(`${due} egg${due === 1 ? '' : 's'} on the way`)
  }
  // one affordable dream — the cheapest project you could fund right now
  const gate = { level: s.level, coins: s.coins, expansion: s.expansion, projects: s.projects }
  const buyable = PROJECTS.filter((d) => projectStatus(d, gate) === 'ok').sort((a, b) => a.cost - b.cost)
  if (buyable.length > 0) lines.push(`the ${buyable[0].name} sign is waiting — you can afford it`)
  return lines.slice(0, 3)
}

/** who kept watch while the player was away — the most-loved named animal */
export function keeperName(s: GameState): string {
  if (s.chicken.name) return s.chicken.name
  if (s.projects.horse) return 'Hazel'
  return s.coopFlock.hens[0]?.name ?? 'the flock'
}
