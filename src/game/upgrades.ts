/** BUILDING UPGRADES — registry and pure effect helpers.
 * A player who owns a building (project) can pay to improve it.
 * Pure module: no three/DOM/Date/Math.random.
 *
 * NOTE: GameState does not yet have an `upgrades` field in its interface.
 * All helpers access it defensively as `s.upgrades?.[id]` so this module
 * compiles and runs safely against any existing save. */

import type { ProjectId } from './projects'
import type { GameState } from './state'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpgradeId = 'ghwing' | 'market' | 'pasture' | 'tackroom' | 'homereno'

export interface UpgradeDef {
  id: UpgradeId
  name: string
  emoji: string
  cost: number
  /** player level gate */
  level: number
  /** the project (building) this upgrade improves — must be owned first */
  requiresProject: ProjectId | null
  /** one line shown on the upgrade sign / buy panel */
  blurb: string
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'ghwing',
    name: 'A Bigger Greenhouse',
    emoji: '🌿',
    cost: 2400,
    level: 16,
    requiresProject: 'greenhouse',
    blurb: 'Four more beds under glass',
  },
  {
    id: 'market',
    name: 'The Market Awning',
    emoji: '🏪',
    cost: 3200,
    level: 20,
    requiresProject: 'shop',
    blurb: 'Richer customers, a longer queue',
  },
  {
    id: 'pasture',
    name: 'The Pasture Loft',
    emoji: '🐑',
    cost: 3600,
    level: 22,
    requiresProject: 'goats',
    blurb: 'Room for two more sheep and a goat',
  },
  {
    id: 'tackroom',
    name: "Hazel's Tack Room",
    emoji: '🐴',
    cost: 4800,
    level: 24,
    requiresProject: 'horse',
    blurb: 'Saddle up — ride her around the farm',
  },
  {
    id: 'homereno',
    name: 'A Cosier Home',
    emoji: '🏡',
    cost: 6000,
    level: 26,
    requiresProject: null,
    blurb: 'New shelves, warm curtains, a tiled hearth',
  },
]

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function upgradeDef(id: UpgradeId): UpgradeDef {
  const def = UPGRADES.find((u) => u.id === id)
  if (!def) throw new Error(`Unknown upgrade id: ${id}`)
  return def
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/** Returns true if the upgrade has been purchased in this save. */
export function hasUpgrade(s: GameState, id: UpgradeId): boolean {
  // s.upgrades may not exist on saves predating this module
  return (s as { upgrades?: Partial<Record<UpgradeId, boolean>> }).upgrades?.[id] === true
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Full status for a single upgrade — mirrors projectStatus precedence.
 *
 * Precedence: owned → needs (project not owned) → level → coins → ok */
export function upgradeStatus(
  def: UpgradeDef,
  s: GameState,
): 'owned' | 'needs' | 'level' | 'coins' | 'ok' {
  if (hasUpgrade(s, def.id)) return 'owned'
  if (def.requiresProject !== null && !s.projects[def.requiresProject]) return 'needs'
  if (s.level < def.level) return 'level'
  if (s.coins < def.cost) return 'coins'
  return 'ok'
}

// ---------------------------------------------------------------------------
// Available upgrades (what to surface as signs)
// ---------------------------------------------------------------------------

/** Upgrades to show as buyable signs right now: not yet owned, required
 * project owned (or no requirement), and level gate met.
 * Coins-blocked upgrades still surface — the sign shows the price. */
export function availableUpgrades(s: GameState): UpgradeDef[] {
  return UPGRADES.filter(
    (u) =>
      !hasUpgrade(s, u.id) &&
      (u.requiresProject === null || s.projects[u.requiresProject] === true) &&
      s.level >= u.level,
  )
}

// ---------------------------------------------------------------------------
// Pure effect helpers — the rest of the game reads THESE, never raw upgrades
// ---------------------------------------------------------------------------

/** Number of greenhouse beds available. Base 8; expands to 12 once the
 * Greenhouse Wing upgrade is owned. Safe when s.upgrades is undefined. */
export function greenhouseBeds(s: GameState): number {
  return hasUpgrade(s, 'ghwing') ? 12 : 8
}

/** Extra coin multiplier from the Market Awning upgrade.
 * 0 base; +0.4 when market upgrade is owned. */
export function marketPremiumBonus(s: GameState): number {
  return hasUpgrade(s, 'market') ? 0.4 : 0
}

/** Extra customer-queue slots from the Market Awning upgrade.
 * 0 base; +1 when market upgrade is owned. */
export function marketQueueBonus(s: GameState): number {
  return hasUpgrade(s, 'market') ? 1 : 0
}

/** Extra sheep count from the Pasture Loft upgrade.
 * 0 base; +2 when pasture upgrade is owned. */
export function pastureSheepBonus(s: GameState): number {
  return hasUpgrade(s, 'pasture') ? 2 : 0
}

/** Extra goat count from the Pasture Loft upgrade.
 * 0 base; +1 when pasture upgrade is owned. */
export function pastureGoatBonus(s: GameState): number {
  return hasUpgrade(s, 'pasture') ? 1 : 0
}

/** True once both the tack room upgrade AND the horse project are owned —
 * the two conditions required to ride Hazel around the farm. */
export function canRideHazel(s: GameState): boolean {
  return hasUpgrade(s, 'tackroom') && s.projects['horse'] === true
}
