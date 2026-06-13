/** Project-ladder invariants: every build site must keep the world coherent
 * with the land-deed geometry from src/game/expansion.ts. */
import { describe, expect, it } from 'vitest'
import { allFieldRects, fenceFor, PEN, TIERS } from '../src/game/expansion'
import {
  availableProjects,
  GREENHOUSE_BEDS,
  PROJECTS,
  projectStatus,
  type ProjectDef,
  type ProjectId,
} from '../src/game/projects'
import { deserialize, initialState, serialize } from '../src/game/state'

interface Rect {
  x0: number
  z0: number
  x1: number
  z1: number
}

function footprintRect(p: ProjectDef): Rect {
  const [x, z] = p.site
  return {
    x0: x - p.footprint.w / 2,
    z0: z - p.footprint.d / 2,
    x1: x + p.footprint.w / 2,
    z1: z + p.footprint.d / 2,
  }
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0
}

function gate(over: {
  level?: number
  coins?: number
  expansion?: number
  projects?: Partial<Record<ProjectId, boolean>>
}) {
  return { level: 99, coins: 99999, expansion: 4, projects: {}, ...over }
}

function byId(id: ProjectId): ProjectDef {
  return PROJECTS.find((p) => p.id === id)!
}

describe('project ladder', () => {
  it('costs ascend in ladder order (Hazel exempt: a follow-on priced below her stable)', () => {
    // the horse is bought SEPARATELY after the stable — she is an add-on to
    // a building already paid for, so she alone may dip below her neighbor
    const ladder = PROJECTS.filter((p) => p.id !== 'horse')
    for (let i = 1; i < ladder.length; i++)
      expect(ladder[i].cost).toBeGreaterThan(ladder[i - 1].cost)
    expect(byId('horse').cost).toBeLessThan(byId('stable').cost)
  })

  it('the cheaper pass never raised a project price', () => {
    // CHEAPER PASS GUARD: every project that existed before costs the same
    // or less now (the horse is new — her old cost was folded into the stable)
    const legacy: Partial<Record<ProjectId, number>> = {
      stand: 25,
      sheep: 140,
      goats: 450,
      coop: 550,
      stable: 650,
      shop: 800,
      greenhouse: 1200,
    }
    for (const p of PROJECTS) {
      const old = legacy[p.id]
      if (old !== undefined) expect(p.cost).toBeLessThanOrEqual(old)
    }
  })

  it('level gates never decrease along the ladder', () => {
    for (let i = 1; i < PROJECTS.length; i++)
      expect(PROJECTS[i].level).toBeGreaterThanOrEqual(PROJECTS[i - 1].level)
  })

  it('every project says what it earns', () => {
    for (const p of PROJECTS) {
      expect(typeof p.earns).toBe('string')
      expect(p.earns.trim().length).toBeGreaterThan(0)
    }
  })

  it('buildings dropped the land gate; prerequisite chains stay (stable→Hazel, stand→shop)', () => {
    // the redesign froze the homestead yard and freed every building from the
    // land gate — requiresExpansion is 0 for all of them now. The PROJECT
    // prerequisite chains (the story spine) are what remain.
    for (const p of PROJECTS) expect(p.requiresExpansion).toBe(0)
    // horse: separate purchase AFTER the stable, on the same west lot
    const horse = byId('horse')
    expect(horse.requires).toBe('stable')
    expect(horse.site).toEqual(byId('stable').site)
    // shop: still replaces the stand it grows out of
    expect(byId('shop').requires).toBe('stand')
  })

  it('every site sits on real placeable land (pen, the crossroad lot, or the fixed yard)', () => {
    const yard = fenceFor(0) // the FIXED homestead yard now
    for (const p of PROJECTS) {
      const [x, z] = p.site
      if (p.id === 'goats' || p.id === 'sheep') {
        expect(x).toBeGreaterThan(PEN.x0)
        expect(x).toBeLessThan(PEN.x1)
        expect(z).toBeGreaterThan(PEN.z0)
        expect(z).toBeLessThan(PEN.z1)
        continue
      }
      if (p.id === 'shop') {
        // the shop lives on the crossroad lot, across the road
        expect(p.site).toEqual(TIERS[4].lot)
        expect(z).toBeGreaterThanOrEqual(13)
        continue
      }
      // every other building sits inside the fixed homestead yard
      expect(x).toBeGreaterThan(yard.minX)
      expect(x).toBeLessThan(yard.maxX)
      expect(z).toBeGreaterThan(yard.minZ)
      expect(z).toBeLessThan(yard.maxZ)
    }
  })

  it('no footprint collides with any field rect or the sheep pen (pen projects exempt)', () => {
    for (const p of PROJECTS) {
      if (p.id === 'goats' || p.id === 'sheep') continue
      const r = footprintRect(p)
      for (const field of allFieldRects()) expect(rectsOverlap(r, field)).toBe(false)
      expect(rectsOverlap(r, PEN)).toBe(false)
    }
  })

  it('the glasshouse opens its beds on build, and old saves top up on load', () => {
    expect(GREENHOUSE_BEDS).toBeGreaterThanOrEqual(4)
    // a save that owned the original 4-bed greenhouse grows to the full set
    const s = initialState(11)
    s.projects.greenhouse = true
    s.ghPlots = [{ crop: null }, { crop: null }, { crop: null }, { crop: null }]
    // pre-pepper saves never carried the new counters — strip them
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>
    delete raw.peppers
    delete raw.eggplants
    const back = deserialize(JSON.stringify(raw))
    expect(back?.ghPlots).toHaveLength(GREENHOUSE_BEDS)
    // and the new stand-stock counters backfill to zero
    expect(back?.peppers).toBe(0)
    expect(back?.eggplants).toBe(0)
    // a save WITHOUT the project gains no free beds
    const fresh = deserialize(serialize(initialState(12)))
    expect(fresh?.ghPlots).toHaveLength(0)
  })

  it('projectStatus reports every gate with the right precedence', () => {
    const stable = byId('stable')
    expect(projectStatus(stable, gate({ projects: { stable: true } }))).toBe('owned')
    // the land gate is GONE — even at expansion 0 the stable is never 'land',
    // only level/coins/prereq stand between the player and the build
    expect(projectStatus(stable, gate({ expansion: 0, level: stable.level, coins: stable.cost }))).toBe('ok')
    expect(projectStatus(stable, gate({ level: stable.level - 1, coins: 0 }))).toBe('level')
    expect(projectStatus(stable, gate({ coins: stable.cost - 1 }))).toBe('coins')
    expect(projectStatus(stable, gate({ coins: stable.cost, level: stable.level }))).toBe('ok')
    // dependency gates: goats need the sheep pen, Hazel needs her stable,
    // the shop needs the stand it replaces
    const goats = byId('goats')
    expect(projectStatus(goats, gate({}))).toBe('needs')
    expect(projectStatus(goats, gate({ projects: { sheep: true } }))).toBe('ok')
    const horse = byId('horse')
    expect(projectStatus(horse, gate({}))).toBe('needs')
    expect(projectStatus(horse, gate({ projects: { stable: true } }))).toBe('ok')
    const shop = byId('shop')
    expect(projectStatus(shop, gate({}))).toBe('needs')
    expect(projectStatus(shop, gate({ projects: { stand: true } }))).toBe('ok')
  })

  it('availableProjects omits owned projects and no longer land-gates (every project at any tier)', () => {
    // the land gate is gone — every unowned project is available regardless of
    // expansion (level/coins blockers still show ON its sign, so they stay goals)
    for (const expansion of [0, 2, 3, 4]) {
      const all = availableProjects(gate({ expansion }))
      expect(all.map((p) => p.id)).toEqual(PROJECTS.map((p) => p.id))
    }

    const owned = availableProjects(
      gate({
        expansion: 0,
        projects: { stand: true, sheep: true, goats: true, coop: true, shop: true },
      }),
    )
    expect(owned.map((p) => p.id)).toEqual(['stable', 'horse', 'greenhouse'])
  })
})
