/** Next-goal oracle — tells the player what to save for next.
 * Pure module: no three/DOM imports, no rng, no Date, no side effects.
 * Single entry point: nextGoal(s) → the highest-priority actionable goal.
 *
 * Priority chain (highest → lowest):
 *  1. Affordable project (level + coins met)
 *  2. Affordable deed (level + coins met)
 *  3. Affordable town act (status === 'ok')
 *  4. Bridge case — stable blocked by missing deed
 *  5. First-delivery nudge (horse owned, delivered === 0)
 *  6. Coins-blocked project / deed / town act (cheapest)
 *  7. Wheat-blocked town act
 *  8. Affordable building upgrade (upgradeStatus === 'ok', cheapest)
 *  9. Affordable fence skin (level met, coins met, not yet owned)
 * 10. Affordable decor (level met, coins met, decor.length < DECOR_MAX)
 * 11. Level wall (lowest level gate above s.level across ALL content)
 * 12. Order board (s.town.delivered >= 1) — evergreen endgame goal
 * 13. Gentle harvest nudge ('🌾 Tend your farm') — compass never goes dark */

import { contractSlots } from './contracts'
import { CROPS } from './economy'
import { nextTier, TIERS } from './expansion'
import { DECOR, DECOR_MAX } from './decor'
import { FENCE_STYLES } from './fence'
import { availableProjects, PROJECTS, projectStatus } from './projects'
import type { GameState } from './state'
import { nextTownAct, townStatus } from './town'
import { availableUpgrades, upgradeStatus } from './upgrades'

export interface Goal {
  kind: 'project' | 'deed' | 'townact' | 'delivery' | 'levelwall' | 'contract' | 'upgrade' | 'fencestyle' | 'decor'
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
      s.expansion < stableDef.requiresExpansion &&
      // only when the NEXT deed is the one that unblocks the stable — otherwise
      // we'd point at a deed the player can't buy yet (deeds are sequential)
      s.expansion + 1 === stableDef.requiresExpansion
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

  // ─── 8. Cheapest AFFORDABLE building upgrade ──────────────────────────────
  {
    const avail = availableUpgrades(s)
    const affordable = avail.filter((u) => upgradeStatus(u, s) === 'ok')
    if (affordable.length > 0) {
      const def = affordable.reduce((a, b) => (a.cost <= b.cost ? a : b))
      return {
        kind: 'upgrade',
        id: def.id,
        pill: pill40('🔧 ', def.name, ` — ${def.cost}c`),
        blocked: null,
      }
    }
  }

  // ─── 9. Cheapest AFFORDABLE fence skin not yet owned ─────────────────────
  {
    const affordable = FENCE_STYLES.filter(
      (f) =>
        s.level >= f.level &&
        s.coins >= f.cost &&
        !(s.fenceStyles as Partial<Record<string, boolean>>)[f.id],
    )
    if (affordable.length > 0) {
      const def = affordable.reduce((a, b) => (a.cost <= b.cost ? a : b))
      return {
        kind: 'fencestyle',
        id: def.id,
        pill: pill40('🎨 ', def.name, ` fence — ${def.cost}c`),
        blocked: null,
      }
    }
  }

  // ─── 10. Cheapest AFFORDABLE decoration ───────────────────────────────────
  {
    const placed = (s as GameState & { decor?: unknown[] }).decor ?? []
    if (placed.length < DECOR_MAX) {
      const affordable = DECOR.filter((d) => s.level >= d.level && s.coins >= d.cost)
      if (affordable.length > 0) {
        const def = affordable.reduce((a, b) => (a.cost <= b.cost ? a : b))
        return {
          kind: 'decor',
          id: def.id,
          pill: pill40('🌷 ', def.name, ` — ${def.cost}c`),
          blocked: null,
        }
      }
    }
  }

  // ─── 11. LEVEL WALL ───────────────────────────────────────────────────────
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

  // ─── 12. THE ORDER BOARD never runs dry — the evergreen endgame goal ──────
  // Once the town knows the farm (first delivery), there are always daily
  // orders to fill. This is what keeps a maxed-out farm from going silent.
  {
    if (s.town.delivered >= 1) {
      const slots = contractSlots(s)
      // read the FROZEN daily board, not a fresh roll — nextGoal runs ~20Hz and
      // rollContracts allocates an Rng + arrays every call (hot-loop law)
      let open = 0
      for (let i = 0; i < slots; i++) if (!(s.contracts.done[i] ?? false)) open++
      if (open > 0 && s.contracts.goods.length > 0) {
        return {
          kind: 'contract',
          id: 'orders',
          pill: pill40('📋 ', `${open} order${open === 1 ? '' : 's'} on the board`, ''),
          blocked: null,
          at: [17.4, 13.6],
        }
      }
    }
  }

  // ─── 13. GENTLE FALLBACK — the compass must never go dark ────────────────
  // If we reach here: no purchases remain, no level gate, and the town board
  // is completely quiet. This is theoretically unreachable in a live game (the
  // level-wall and order-board catches always have content), but we return a
  // soft nudge rather than null so the compass pin is never empty. The only
  // way nextGoal returns null is the truly-impossible edge case: a test state
  // that has no projects/deeds/town/content AND no deliveries AND no level
  // gates ahead AND no affordable cosmetics — in practice this cannot happen
  // in a live save, but the function contract allows it for purity.
  return {
    kind: 'contract',
    id: 'tend',
    pill: '🌾 Tend your farm',
    blocked: null,
  }
}
