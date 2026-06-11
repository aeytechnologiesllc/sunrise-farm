/** BUILD-YOUR-FARM ladder — the construction-project spine of the game.
 * The player funds projects at their build-site signs; a crew raises them in
 * a cutscene. Pure module (no three/DOM imports): the ladder table, the
 * gameplay constants each finished project unlocks, and the gating math.
 * World code (signs, cutscenes, buildings) and Game actions derive from this
 * single table; unit-tested against src/game/expansion.ts geometry. */

export type ProjectId = 'stand' | 'sheep' | 'goats' | 'stable' | 'shop' | 'greenhouse' | 'farmhand'

export interface ProjectDef {
  id: ProjectId
  name: string
  /** story beat for the completion banner */
  flavor: string
  cost: number
  /** player level gate */
  level: number
  /** land tier gate (0..3), see src/game/expansion.ts */
  requiresExpansion: number
  /** another project that must exist first */
  requires?: ProjectId
  /** world x,z of the build site (sign + cutscene focus) */
  site: [number, number]
  /** building facing */
  yaw: number
  footprint: { w: number; d: number }
  kind: 'building' | 'animals' | 'staff'
}

/** the ladder, in build order — costs strictly ascend, level gates never dip.
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
  },
  {
    id: 'sheep',
    name: 'The Sheep Pen',
    flavor: 'Three woolly tenants — and Rex finally has a job.',
    cost: 140,
    level: 3,
    requiresExpansion: 0,
    site: [-12.3, 5.3],
    yaw: 0,
    footprint: { w: 2, d: 2 },
    kind: 'animals',
  },
  {
    id: 'goats',
    name: 'Goat Friends',
    flavor: 'Two goats join the pasture — double trouble.',
    cost: 450,
    level: 5,
    requiresExpansion: 0,
    requires: 'sheep',
    site: [-12.3, 5.3],
    yaw: 0,
    footprint: { w: 2, d: 2 },
    kind: 'animals',
  },
  {
    id: 'stable',
    name: 'The Stable',
    flavor: 'Hoofbeats at sunrise — the farm has a horse now.',
    cost: 650,
    level: 6,
    requiresExpansion: 1,
    site: [11.6, 7.3],
    yaw: 3.14,
    footprint: { w: 5.4, d: 4.0 },
    kind: 'building',
  },
  {
    id: 'shop',
    name: 'The Farm Shop',
    flavor: 'No more roadside table. Real shelves, real prices.',
    cost: 800,
    level: 8,
    requiresExpansion: 0,
    requires: 'stand',
    site: [0.5, 7.0],
    yaw: 0,
    footprint: { w: 4.6, d: 3.4 },
    kind: 'building',
  },
  {
    id: 'greenhouse',
    name: 'The Greenhouse',
    flavor: 'Glass and warmth — crops that never wait for weather.',
    cost: 1200,
    level: 9,
    requiresExpansion: 2,
    site: [-5.2, -2.0],
    yaw: 0.1,
    footprint: { w: 4.8, d: 3.4 },
    kind: 'building',
  },
  {
    id: 'farmhand',
    name: 'Hire a Farmhand',
    flavor: 'You are not farming alone anymore.',
    cost: 1500,
    level: 10,
    requiresExpansion: 2,
    site: [-0.5, 5.2],
    yaw: 0,
    footprint: { w: 1.2, d: 1.2 },
    kind: 'staff',
  },
]

/** horse paddock by the stable (rails + gate live in world code) */
export const PADDOCK = { x0: 9.0, z0: 5.6, x1: 14.6, z1: 9.6 }

/** 4 plot centers inside the greenhouse footprint at site [-5.2, -2.0] */
export const GREENHOUSE_PLOTS: Array<[number, number]> = [
  [-6.35, -2.75],
  [-4.05, -2.75],
  [-6.35, -1.25],
  [-4.05, -1.25],
]

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
