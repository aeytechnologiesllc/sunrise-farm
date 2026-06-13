/** Next-goal oracle — tells the player what to save for next.
 * Pure module: no three/DOM imports, no rng, no Date, no side effects.
 * Single entry point: nextGoal(s) → the highest-priority actionable goal. */

import { CROPS } from './economy'
import { nextTier, TIERS } from './expansion'
import { availableProjects, PROJECTS, projectStatus } from './projects'
import type { GameState } from './state'
import { nextTownAct, townStatus } from './town'

export interface Goal {
  kind: 'project' | 'deed' | 'townact' | 'delivery' | 'levelwall'
  id: string
  /** <= 40 chars incl emoji — what the HUD shows */
  pill: string
  blocked: 'level' | 'coins' | 'wheat' | 'delivered' | 'land' | null
  /** world x,z of the relevant sign/board, if known */
  at?: [number, number]
}

/** Truncate a name to fit inside a pill of maxLen chars (including the
 * surrounding label text). */
function trunc(name: string, max: number): string {
  return name.length <= max ? name : name.slice(0, max - 1) + '…'
}

/** Build a pill string, clamping the whole thing to 40 chars. */
function pill40(prefix: string, name: string, suffix: string): string {
  // prefix + name + suffix <= 40
  const budget = 40 - prefix.length - suffix.length
  return prefix + trunc(name, budget) + suffix
}

/** The town board always shows at the same world position. */
const TOWN_BOARD: [number, number] = [19.4, 13.2]

export function nextGoal(s: GameState): Goal | null {
  // ─── 1. Cheapest AFFORDABLE project (level met, coins met) ────────────────
  {
    const available = availableProjects(s)
    const affordable = available.filter((p) => projectStatus(p, s) === 'ok')
    if (affordable.length > 0) {
      // sort by cost ascending to surface the cheapest first
      const def = affordable.reduce((a, b) => (a.cost <= b.cost ? a : b))
      return {
        kind: 'project',
        id: def.id,
        pill: pill40('🔨 Build ', def.name, ` — ${def.cost}c`),
        blocked: null,
        // at: build-sign world pos requires main.ts imports; leave undefined
      }
    }
  }

  // ─── 2. AFFORDABLE land deed (level met, coins met) ───────────────────────
  {
    const next = nextTier(s.expansion)
    if (next) {
      const tierIndex = s.expansion + 1
      const t = TIERS[tierIndex]
      if (t && s.level >= t.level && s.coins >= t.cost) {
        return {
          kind: 'deed',
          id: `tier${tierIndex}`,
          pill: pill40('🪧 ', t.name, ` — ${t.cost}c`),
          blocked: null,
          at: t.sign ?? undefined,
        }
      }
    }
  }

  // ─── 3. AFFORDABLE town act (status === 'ok') ─────────────────────────────
  {
    const act = nextTownAct(s)
    if (act) {
      const status = townStatus(act, s)
      if (status === 'ok') {
        return {
          kind: 'townact',
          id: act.id,
          pill: pill40('🏛 ', act.name, ` — ${act.coins}c`),
          blocked: null,
          at: TOWN_BOARD,
        }
      }
    }
  }

  // ─── 4. THE BRIDGE CASE: stable is unowned, level met, but expansion short ─
  {
    const stableDef = PROJECTS.find((p) => p.id === 'stable')
    if (
      stableDef &&
      !s.projects.stable &&
      s.level >= stableDef.level &&
      s.expansion < stableDef.requiresExpansion
    ) {
      // find the deed tier that unblocks the stable
      const tierIndex = stableDef.requiresExpansion
      const t = TIERS[tierIndex]
      // determine what blocks the deed for the player
      let blocked: Goal['blocked'] = null
      if (s.level < t.level) blocked = 'level'
      else if (s.coins < t.cost) blocked = 'coins'

      const hint = ` (stable needs it) — ${t.cost}c`
      return {
        kind: 'deed',
        id: `tier${tierIndex}`,
        pill: pill40('🪧 ', t.name, hint.length <= 24 ? hint : ` — ${t.cost}c`),
        blocked,
        at: t.sign ?? undefined,
      }
    }
  }

  // ─── 5. Horse owned + delivered === 0 ─────────────────────────────────────
  {
    if (s.projects.horse && s.town.delivered === 0) {
      return {
        kind: 'delivery',
        id: 'first-delivery',
        pill: '🚚 Send Hazel to town',
        blocked: null,
        at: undefined,
      }
    }
  }

  // ─── 6. Blocked-on-COINS: cheapest level-met project / deed / act ─────────
  {
    // projects: level met but coins short
    const available = availableProjects(s)
    const levelOkCoinsShort = available.filter((p) => {
      const st = projectStatus(p, s)
      return st === 'coins'
    })
    let bestCost: number | null = null
    let bestGoal: Goal | null = null

    if (levelOkCoinsShort.length > 0) {
      const def = levelOkCoinsShort.reduce((a, b) => (a.cost <= b.cost ? a : b))
      bestCost = def.cost
      bestGoal = {
        kind: 'project',
        id: def.id,
        pill: pill40('🔨 Build ', def.name, ` — ${def.cost}c`),
        blocked: 'coins',
      }
    }

    // deed: level met but coins short
    const next = nextTier(s.expansion)
    if (next) {
      const tierIndex = s.expansion + 1
      const t = TIERS[tierIndex]
      if (t && s.level >= t.level && s.coins < t.cost) {
        if (bestCost === null || t.cost < bestCost) {
          bestCost = t.cost
          bestGoal = {
            kind: 'deed',
            id: `tier${tierIndex}`,
            pill: pill40('🪧 ', t.name, ` — ${t.cost}c`),
            blocked: 'coins',
            at: t.sign ?? undefined,
          }
        }
      }
    }

    // town act: level/delivery met but coins short
    const act = nextTownAct(s)
    if (act) {
      const status = townStatus(act, s)
      if (status === 'coins') {
        if (bestCost === null || act.coins < bestCost) {
          bestGoal = {
            kind: 'townact',
            id: act.id,
            pill: pill40('🏛 ', act.name, ` — ${act.coins}c`),
            blocked: 'coins',
            at: TOWN_BOARD,
          }
        }
      }
    }

    if (bestGoal) return bestGoal
  }

  // ─── 7. Blocked-on-WHEAT town act ─────────────────────────────────────────
  {
    const act = nextTownAct(s)
    if (act && townStatus(act, s) === 'wheat') {
      return {
        kind: 'townact',
        id: act.id,
        pill: pill40('🏛 ', act.name, ` — ${act.wheat}w`),
        blocked: 'wheat',
        at: TOWN_BOARD,
      }
    }
  }

  // ─── 8. LEVEL WALL ────────────────────────────────────────────────────────
  {
    // collect every level gate strictly above s.level from unowned things
    const walls: Array<{ level: number; label: string }> = []

    // from projects (not owned, level > s.level)
    for (const p of PROJECTS) {
      if (!s.projects[p.id] && p.level > s.level) {
        walls.push({ level: p.level, label: p.name })
      }
    }

    // from deeds (not yet bought, level > s.level)
    for (let i = s.expansion + 1; i < TIERS.length; i++) {
      const t = TIERS[i]
      if (t.level > s.level) {
        walls.push({ level: t.level, label: t.name })
      }
    }

    // from town acts (not yet built, level would be a delivery block, but we
    // check level-like gates via delivered/coins — town has no explicit level
    // gate, so we skip acts here and focus on projects/deeds)

    // from crop unlocks (greenhouse crops: unlockLevel > s.level)
    for (const def of Object.values(CROPS)) {
      if (def.unlockLevel > s.level) {
        walls.push({ level: def.unlockLevel, label: `${def.label} crop` })
      }
    }

    if (walls.length > 0) {
      // pick the lowest level gate
      walls.sort((a, b) => a.level - b.level)
      const w = walls[0]
      return {
        kind: 'levelwall',
        id: `level${w.level}`,
        pill: pill40('🌱 Level ', `${w.level}: ${w.label}`, ''),
        blocked: 'level',
      }
    }
  }

  // ─── 9. Nothing remains ────────────────────────────────────────────────────
  return null
}
