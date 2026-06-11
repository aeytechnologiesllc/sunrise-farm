/** Land-deed table invariants: every tier must keep the world coherent. */
import { describe, expect, it } from 'vitest'
import {
  allFieldRects,
  fenceFor,
  gatesFor,
  inRect,
  MAX_TIER,
  nextTier,
  PEN,
  plotCount,
  plotPositions,
  sheepCount,
  TIERS,
} from '../src/game/expansion'

describe('expansion tiers', () => {
  it('plot positions accumulate (the crossroad lot adds land, not plots)', () => {
    let prev = 0
    for (let t = 0; t <= MAX_TIER; t++) {
      const n = plotCount(t)
      expect(n).toBeGreaterThanOrEqual(prev)
      expect(plotPositions(t)).toHaveLength(n)
      prev = n
    }
  })

  it('cumulative plot counts are exact and cover legacy saves', () => {
    expect([0, 1, 2, 3, 4].map(plotCount)).toEqual([4, 8, 12, 14, 14])
    // SAVE-COMPAT GUARD: old saves sized their plots array from the legacy
    // table (cumulative 4/8/11/13). Every tier must unlock AT LEAST that
    // many plots, or a reloaded save would hold crop state for plot indices
    // the new table never creates.
    const legacy = [4, 8, 11, 13]
    for (let t = 0; t < legacy.length; t++) {
      expect(plotCount(t)).toBeGreaterThanOrEqual(legacy[t])
    }
  })

  it('fields grow contiguously east — each deed touches the previous field', () => {
    for (let t = 0; t < 3; t++) {
      const a = TIERS[t].field
      const b = TIERS[t + 1].field
      expect(a).not.toBeNull()
      expect(b).not.toBeNull()
      // edge-to-edge: the new field starts exactly where the last one ends
      expect(b!.x0).toBe(a!.x1)
      expect(b!.z0).toBe(a!.z0)
      expect(b!.z1).toBe(a!.z1)
    }
    // the final deed is a bare lot across the road, not a field
    expect(TIERS[4].field).toBeNull()
    expect(TIERS[4].lot).toBeDefined()
    expect(TIERS[4].plots).toHaveLength(0)
  })

  it('the crossroad lot sits across the road, outside the fence ring', () => {
    const lot = TIERS[4].lot!
    // road runs east-west at z=11 (half-width ~1.45); across means z >= 13
    expect(lot[1]).toBeGreaterThanOrEqual(13)
    expect(lot[1]).toBeGreaterThan(TIERS[4].fence.maxZ)
    // buying the lot does not move the farm fence
    expect(TIERS[4].fence).toEqual(TIERS[3].fence)
  })

  it('fence only ever grows (each tier contains the previous ring)', () => {
    for (let t = 1; t <= MAX_TIER; t++) {
      const a = fenceFor(t - 1)
      const b = fenceFor(t)
      expect(b.minX).toBeLessThanOrEqual(a.minX)
      expect(b.maxX).toBeGreaterThanOrEqual(a.maxX)
      expect(b.minZ).toBeLessThanOrEqual(a.minZ)
      expect(b.maxZ).toBeGreaterThanOrEqual(a.maxZ)
    }
  })

  it('every plot lies inside its tier fence and inside a field rect', () => {
    for (let t = 0; t <= MAX_TIER; t++) {
      const f = fenceFor(t)
      for (const [x, z] of plotPositions(t)) {
        expect(x).toBeGreaterThan(f.minX)
        expect(x).toBeLessThan(f.maxX)
        expect(z).toBeGreaterThan(f.minZ)
        expect(z).toBeLessThan(f.maxZ)
        expect(allFieldRects().some((r) => inRect(x, z, r))).toBe(true)
      }
    }
  })

  it('plots never overlap (frames need >= 2.4u separation)', () => {
    const pts = plotPositions(MAX_TIER)
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])
        expect(d).toBeGreaterThanOrEqual(2.4)
      }
  })

  it('level gates escalate; the cheaper pass never raised a deed price', () => {
    for (let t = 2; t <= MAX_TIER; t++) {
      expect(TIERS[t].level).toBeGreaterThan(TIERS[t - 1].level)
    }
    // field deeds (T1..T3) still ascend in price; the crossroad lot (T4)
    // is a bare plot with no field, deliberately priced below the pasture
    for (let t = 2; t <= 3; t++) {
      expect(TIERS[t].cost).toBeGreaterThan(TIERS[t - 1].cost)
    }
    // CHEAPER PASS: no deed may cost more than it did in the legacy table
    const legacyCosts = [0, 150, 400, 900]
    for (let t = 0; t < legacyCosts.length; t++) {
      expect(TIERS[t].cost).toBeLessThanOrEqual(legacyCosts[t])
    }
  })

  it('every buyable tier has a sign; the base tier does not', () => {
    expect(TIERS[0].sign).toBeNull()
    for (let t = 1; t <= MAX_TIER; t++) expect(TIERS[t].sign).not.toBeNull()
    expect(nextTier(MAX_TIER)).toBeNull()
  })

  it('every tier keeps a south gate and a west gate', () => {
    for (let t = 0; t <= MAX_TIER; t++) {
      const walls = gatesFor(t).map((g) => g.wall)
      expect(walls).toContain('S')
      expect(walls).toContain('W')
    }
  })

  it('the flock grows with the pasture deed', () => {
    expect(sheepCount(0)).toBe(3)
    expect(sheepCount(MAX_TIER)).toBeGreaterThan(3)
  })

  it('fields never collide with the sheep pen', () => {
    for (const r of allFieldRects()) {
      const overlap = r.x0 < PEN.x1 && r.x1 > PEN.x0 && r.z0 < PEN.z1 && r.z1 > PEN.z0
      expect(overlap).toBe(false)
    }
  })
})
