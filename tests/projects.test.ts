/** Project-ladder invariants: every build site must keep the world coherent
 * with the land-deed geometry from src/game/expansion.ts. */
import { describe, expect, it } from 'vitest'
import { allFieldRects, fenceFor, PEN } from '../src/game/expansion'
import {
  availableProjects,
  GREENHOUSE_PLOTS,
  PROJECTS,
  projectStatus,
  type ProjectDef,
  type ProjectId,
} from '../src/game/projects'

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
  return { level: 99, coins: 99999, expansion: 3, projects: {}, ...over }
}

describe('project ladder', () => {
  it('costs strictly ascend in ladder order', () => {
    for (let i = 1; i < PROJECTS.length; i++)
      expect(PROJECTS[i].cost).toBeGreaterThan(PROJECTS[i - 1].cost)
  })

  it('level gates never decrease along the ladder', () => {
    for (let i = 1; i < PROJECTS.length; i++)
      expect(PROJECTS[i].level).toBeGreaterThanOrEqual(PROJECTS[i - 1].level)
  })

  it('every site sits inside the fence ring of its land tier (pen projects: the pen)', () => {
    for (const p of PROJECTS) {
      const [x, z] = p.site
      if (p.id === 'goats' || p.id === 'sheep') {
        expect(x).toBeGreaterThan(PEN.x0)
        expect(x).toBeLessThan(PEN.x1)
        expect(z).toBeGreaterThan(PEN.z0)
        expect(z).toBeLessThan(PEN.z1)
        continue
      }
      const f = fenceFor(p.requiresExpansion)
      expect(x).toBeGreaterThan(f.minX)
      expect(x).toBeLessThan(f.maxX)
      expect(z).toBeGreaterThan(f.minZ)
      expect(z).toBeLessThan(f.maxZ)
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

  it('greenhouse plots all lie inside the greenhouse footprint', () => {
    const gh = PROJECTS.find((p) => p.id === 'greenhouse')!
    const r = footprintRect(gh)
    expect(GREENHOUSE_PLOTS).toHaveLength(4)
    for (const [x, z] of GREENHOUSE_PLOTS) {
      expect(x).toBeGreaterThan(r.x0)
      expect(x).toBeLessThan(r.x1)
      expect(z).toBeGreaterThan(r.z0)
      expect(z).toBeLessThan(r.z1)
    }
  })

  it('projectStatus reports every gate with the right precedence', () => {
    const stable = PROJECTS.find((p) => p.id === 'stable')!
    expect(projectStatus(stable, gate({ projects: { stable: true } }))).toBe('owned')
    expect(projectStatus(stable, gate({ expansion: 0, level: 1, coins: 0 }))).toBe('land')
    expect(projectStatus(stable, gate({ level: stable.level - 1, coins: 0 }))).toBe('level')
    expect(projectStatus(stable, gate({ coins: stable.cost - 1 }))).toBe('coins')
    expect(projectStatus(stable, gate({ coins: stable.cost, level: stable.level }))).toBe('ok')
    // dependency gate: goats need the sheep pen first, shop needs the stand
    const goats = PROJECTS.find((p) => p.id === 'goats')!
    expect(projectStatus(goats, gate({}))).toBe('needs')
    expect(projectStatus(goats, gate({ projects: { sheep: true } }))).toBe('ok')
    const shop = PROJECTS.find((p) => p.id === 'shop')!
    expect(projectStatus(shop, gate({}))).toBe('needs')
    expect(projectStatus(shop, gate({ projects: { stand: true } }))).toBe('ok')
  })

  it('availableProjects respects the land gate and omits owned projects', () => {
    const atTier0 = availableProjects(gate({ expansion: 0 }))
    expect(atTier0.map((p) => p.id)).toEqual(['stand', 'sheep', 'goats', 'shop'])

    const atTier2 = availableProjects(gate({ expansion: 2 }))
    expect(atTier2.map((p) => p.id)).toEqual(PROJECTS.map((p) => p.id))

    const owned = availableProjects(
      gate({ expansion: 3, projects: { stand: true, sheep: true, goats: true, shop: true } }),
    )
    expect(owned.map((p) => p.id)).toEqual(['stable', 'greenhouse', 'farmhand'])
  })
})
