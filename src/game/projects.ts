/** BUILD-YOUR-FARM ladder — the construction-project spine of the game.
 * The player funds projects at their build-site signs; a crew raises them in
 * a cutscene. Pure module (no three/DOM imports): the ladder table, the
 * gameplay constants each finished project unlocks, and the gating math.
 * World code (signs, cutscenes, buildings) and Game actions derive from this
 * single table; unit-tested against src/game/expansion.ts geometry. */

export type ProjectId =
  | 'stand'
  | 'sheep'
  | 'goats'
  | 'coop'
  | 'stable'
  | 'horse'
  | 'shop'
  | 'greenhouse'
  | 'farmhand'

export interface ProjectDef {
  id: ProjectId
  name: string
  /** story beat for the completion banner */
  flavor: string
  cost: number
  /** player level gate */
  level: number
  /** land tier gate (0..4), see src/game/expansion.ts — the deed is always
   * bought BEFORE the building it hosts (storytelling: deed, then build) */
  requiresExpansion: number
  /** another project that must exist first */
  requires?: ProjectId
  /** world x,z of the build site (sign + cutscene focus) */
  site: [number, number]
  /** building facing */
  yaw: number
  footprint: { w: number; d: number }
  kind: 'building' | 'animals' | 'staff'
  /** one plain-spoken line: what this purchase DOES for the player — shown
   * on build-site signs and completion banners */
  earns: string
}

/** the ladder, in build order — costs ascend (Hazel, a follow-on companion
 * to the stable, is the one priced add-on), level gates never dip.
 * The first level starts from SCRATCH: no stand, no flock — the player earns
 * each piece of the farm. */
export const PROJECTS: ProjectDef[] = [
  {
    id: 'stand',
    name: 'The Roadside Stand',
    flavor: 'Open for business — the road brings customers now.',
    cost: 25,
    level: 2,
    requiresExpansion: 0,
    site: [0.5, 7.0],
    yaw: 0,
    footprint: { w: 3.8, d: 2.4 },
    kind: 'building',
    earns: 'Passers-by stop and buy your goods for coins.',
  },
  {
    id: 'sheep',
    name: 'The Sheep Pen',
    flavor: 'Three woolly tenants — and Rex finally has a job.',
    cost: 100,
    level: 3,
    requiresExpansion: 0,
    site: [-12.3, 5.3],
    yaw: 0,
    footprint: { w: 2, d: 2 },
    kind: 'animals',
    earns: 'Wool to shear every few minutes.',
  },
  {
    id: 'goats',
    name: 'Goat Friends',
    flavor: 'Two goats join the pasture — double trouble.',
    cost: 300,
    level: 5,
    requiresExpansion: 0,
    requires: 'sheep',
    site: [-12.3, 5.3],
    yaw: 0,
    footprint: { w: 2, d: 2 },
    kind: 'animals',
    earns: 'Milk money beside the wool.',
  },
  {
    id: 'coop',
    name: 'The Chicken Coop',
    flavor: 'A dozen little voices at sunrise.',
    cost: 380,
    level: 6,
    requiresExpansion: 0,
    site: [-6.4, 8.4],
    yaw: Math.PI,
    footprint: { w: 3.4, d: 2.2 },
    kind: 'building',
    earns: 'Four hens laying baskets of eggs.',
  },
  {
    id: 'stable',
    name: 'The Stable',
    flavor: 'Fresh straw, oiled hinges — an empty stall, waiting.',
    cost: 450,
    level: 6,
    requiresExpansion: 3,
    site: [-12.3, -0.6],
    yaw: 1.35,
    footprint: { w: 5.4, d: 4.0 },
    kind: 'building',
    earns: 'A home for a horse — kept ready.',
  },
  {
    id: 'horse',
    name: 'Hazel the Horse',
    flavor: 'Hoofbeats at sunrise — Hazel is home.',
    cost: 250,
    level: 6,
    requiresExpansion: 3,
    requires: 'stable',
    site: [-12.3, -0.6],
    yaw: 0,
    footprint: { w: 1.4, d: 1.4 },
    kind: 'animals',
    earns: 'Town deliveries — feed her wheat and she brings back coins.',
  },
  {
    id: 'shop',
    name: 'The Farm Shop',
    flavor: 'No more roadside table. Real shelves, real prices.',
    cost: 550,
    level: 8,
    requiresExpansion: 4,
    requires: 'stand',
    site: [2.5, 15.6],
    yaw: 3.14159,
    footprint: { w: 4.6, d: 3.4 },
    kind: 'building',
    earns: 'One more customer at a time — and city prices across the road.',
  },
  {
    id: 'greenhouse',
    name: 'The Greenhouse',
    flavor: 'Glass and warmth — crops that never wait for weather.',
    cost: 800,
    level: 9,
    requiresExpansion: 2,
    site: [-5.2, -2.0],
    yaw: 0.1,
    footprint: { w: 4.8, d: 3.4 },
    kind: 'building',
    earns: 'A walk-in glasshouse: rare, pricier crops on beds that grow 40 percent faster.',
  },
  {
    id: 'farmhand',
    name: 'Hire a Farmhand',
    flavor: 'You are not farming alone anymore.',
    cost: 1000,
    level: 10,
    requiresExpansion: 2,
    site: [-0.5, 5.2],
    yaw: 0,
    footprint: { w: 1.2, d: 1.2 },
    kind: 'staff',
    earns: 'A helper who harvests ripe crops for you.',
  },
]

/** horse paddock on the WEST pasture lot, wrapping the stable (rails + gate
 * live in world code) */
export const PADDOCK = { x0: -14.4, z0: -2.9, x1: -10.4, z1: 2.2 }

/** raised beds inside the WALKABLE glasshouse set (positions live in
 * world/greenhouseInterior.ts — the small shed exterior is just the door) */
export const GREENHOUSE_BEDS = 8

/** greenhouse crops grow 40% faster (growSec multiplier) */
export const GREENHOUSE_GROW_MULT = 0.6

/** customer pay multiplier once the shop exists (base elsewhere is 1.6) */
export const SHOP_PREMIUM = 2.2

export const SHOP_QUEUE_MAX = 3

export interface ProjectGateState {
  level: number
  coins: number
  expansion: number
  projects: Partial<Record<ProjectId, boolean>>
}

/** Why a project can(not) be funded right now. Precedence mirrors what the
 * sign should say: owned beats everything; missing LAND beats level (the
 * site does not even exist yet); level beats coins (coins churn every
 * minute, so it is the friendliest blocker to show last). */
export function projectStatus(
  def: ProjectDef,
  s: ProjectGateState
): 'owned' | 'ok' | 'level' | 'coins' | 'land' | 'needs' {
  if (s.projects[def.id]) return 'owned'
  if (s.expansion < def.requiresExpansion) return 'land'
  if (def.requires && !s.projects[def.requires]) return 'needs'
  if (s.level < def.level) return 'level'
  if (s.coins < def.cost) return 'coins'
  return 'ok'
}

/** not-owned projects whose land gate is met — these get build-site signs
 * (level/coins blockers still show ON the sign, so they stay visible goals) */
export function availableProjects(s: ProjectGateState): ProjectDef[] {
  return PROJECTS.filter((p) => !s.projects[p.id] && s.expansion >= p.requiresExpansion)
}
