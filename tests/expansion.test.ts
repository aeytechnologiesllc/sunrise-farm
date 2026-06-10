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
  it('plot positions accumulate monotonically', () => {
    let prev = 0
    for (let t = 0; t <= MAX_TIER; t++) {
      const n = plotCount(t)
      expect(n).toBeGreaterThan(prev)
      expect(plotPositions(t)).toHaveLength(n)
      prev = n
    }
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

  it('costs and level gates escalate', () => {
    for (let t = 2; t <= MAX_TIER; t++) {
      expect(TIERS[t].cost).toBeGreaterThan(TIERS[t - 1].cost)
      expect(TIERS[t].level).toBeGreaterThan(TIERS[t - 1].level)
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
