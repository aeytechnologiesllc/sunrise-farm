/** Carry & place pure-math pins (the interactive feel is E2E'd in preview). */
import { describe, expect, it } from 'vitest'
import { CARRY_GRID, snapToGrid } from '../src/world/carry'
import { canPlace, DEFAULT_PLACES, placeOf, setPlace, type LayoutHost } from '../src/game/layout'

function host(): LayoutHost {
  return {
    layout: {},
    expansion: 4,
    fieldParcels: 1,
    projects: { shop: true, coop: true, stable: true, horse: true, greenhouse: true, sheep: true, goats: true },
    produce: { deliveryT: 0 },
  }
}

describe('carry math', () => {
  it('snapToGrid lands on half-units', () => {
    expect(snapToGrid(3.26)).toBeCloseTo(3.5)
    expect(snapToGrid(-7.24)).toBeCloseTo(-7.0)
    expect(snapToGrid(0)).toBe(0)
  })

  it('a commit at a snapped legal spot round-trips through the layout', () => {
    const h = host()
    // scan for a legal coop spot on the grid (same way the ghost works)
    let spot: [number, number] | null = null
    outer: for (let x = -14; x <= 20; x += CARRY_GRID) {
      for (let z = -8; z <= 9; z += CARRY_GRID) {
        if (Math.hypot(x - DEFAULT_PLACES.coop.x, z - DEFAULT_PLACES.coop.z) < 2) continue
        if (canPlace(h, 'coop', x, z).ok) {
          spot = [x, z]
          break outer
        }
      }
    }
    expect(spot).not.toBeNull()
    setPlace(h, 'coop', spot![0], spot![1])
    expect(placeOf(h, 'coop')).toEqual({ x: spot![0], z: spot![1], yaw: DEFAULT_PLACES.coop.yaw })
    // and the OLD coop ground is free again for something else (a touch
    // south — the tractor's rotated corners reach closer to the road)
    expect(canPlace(h, 'tractor', DEFAULT_PLACES.coop.x, DEFAULT_PLACES.coop.z - 1.0).ok).toBe(true)
  })

  it('every movable has at least a handful of legal grid spots on the full farm', () => {
    const h = host()
    const ids = ['coop', 'tractor', 'greenhouse', 'stable'] as const
    for (const id of ids) {
      let count = 0
      for (let x = -14; x <= 20; x += 1) {
        for (let z = -8; z <= 9; z += 1) {
          if (canPlace(h, id, x, z).ok) count++
        }
      }
      expect(count, `${id} has room to move`).toBeGreaterThan(5)
    }
  })
})
