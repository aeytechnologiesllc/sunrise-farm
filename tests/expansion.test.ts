/** Land-deed table invariants: every tier must keep the world coherent. */
import { describe, expect, it } from 'vitest'
import {
  allFieldRects,
  fenceFor,
  fieldParcel,
  fieldParcelRects,
  fieldPlotCount,
  fieldPlotsAll,
  FIELD_Z0,
  FIELD_Z1,
  gatesFor,
  HOMESTEAD_FENCE,
  inRect,
  MAX_TIER,
  nextTier,
  PARCEL_W,
  parcelCost,
  parcelLevel,
  PEN,
  PLOTS_PER,
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

  it('the homestead fence is FIXED — the same cosy yard at every tier', () => {
    // the redesign froze the fence: it no longer grows with deeds. fenceFor /
    // gatesFor ignore the tier and always return the homestead yard.
    const yard = { minX: -15.2, maxX: 6.5, minZ: -9.0, maxZ: 10.2 }
    for (let t = 0; t <= MAX_TIER + 3; t++) {
      expect(fenceFor(t)).toEqual(yard)
      expect(fenceFor(t)).toBe(HOMESTEAD_FENCE) // the constant itself, not a copy
    }
  })

  it('every TIERS plot still lies inside a TIERS field rect (the frozen table)', () => {
    // TIERS is retained for save-compat + the sheep counter; its plots/fields
    // are no longer the live crop field, but they must stay self-consistent.
    for (let t = 0; t <= MAX_TIER; t++) {
      for (const [x, z] of plotPositions(t)) {
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

  it('the fixed yard keeps a south gate, a west gate, and an east field-lane gate', () => {
    for (let t = 0; t <= MAX_TIER + 3; t++) {
      const walls = gatesFor(t).map((g) => g.wall)
      expect(walls).toContain('S') // customer road
      expect(walls).toContain('W') // pasture lot
      expect(walls).toContain('E') // the lane out to the endless crop field
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

describe('the endless field — parcel generator', () => {
  it('parcels tile edge-to-edge east at a fixed depth', () => {
    for (let n = 0; n < 20; n++) {
      const a = fieldParcel(n)
      const b = fieldParcel(n + 1)
      expect(b.rect.x0).toBeCloseTo(a.rect.x1) // no gap, no overlap
      expect(a.rect.x1 - a.rect.x0).toBeCloseTo(PARCEL_W)
      expect(a.rect.z0).toBe(FIELD_Z0)
      expect(a.rect.z1).toBe(FIELD_Z1)
    }
  })

  it('every parcel holds 4 plots, all inside its own rect', () => {
    for (let n = 0; n < 12; n++) {
      const p = fieldParcel(n)
      expect(p.plots).toHaveLength(PLOTS_PER)
      for (const [x, z] of p.plots) {
        expect(x).toBeGreaterThan(p.rect.x0)
        expect(x).toBeLessThan(p.rect.x1)
        expect(z).toBeGreaterThan(p.rect.z0)
        expect(z).toBeLessThan(p.rect.z1)
      }
    }
  })

  it('plots never overlap across parcels (>= 2.4u apart)', () => {
    const pts = fieldPlotsAll(16)
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])
        expect(d).toBeGreaterThanOrEqual(2.4)
      }
  })

  it('plot count + positions track the parcel count in index order', () => {
    expect(fieldPlotCount(1)).toBe(4)
    expect(fieldPlotCount(5)).toBe(20)
    expect(fieldPlotsAll(3)).toHaveLength(12)
    // parcel 0's plots come first (index 0 stays index 0 across growth)
    expect(fieldPlotsAll(5).slice(0, 4)).toEqual(fieldParcel(0).plots)
    expect(fieldParcelRects(3)).toHaveLength(3)
    // a save with 0/negative parcels still exposes the starter parcel (never empty)
    expect(fieldPlotCount(0)).toBe(4)
    expect(fieldPlotsAll(0)).toHaveLength(4)
  })

  it('the price climbs forever — there is always a pricier next parcel', () => {
    let prev = 0
    for (let owned = 1; owned <= 40; owned++) {
      const c = parcelCost(owned)
      expect(c).toBeGreaterThan(prev)
      prev = c
    }
    // and it really outruns income — deep parcels cost a fortune
    expect(parcelCost(20)).toBeGreaterThan(50_000)
    // gentle, capped level gate
    expect(parcelLevel(1)).toBeLessThanOrEqual(parcelLevel(5))
    expect(parcelLevel(999)).toBeLessThanOrEqual(30)
  })

  it('the whole field stays south of the road (never collides with town)', () => {
    // ROAD_Z is 11; the town lives north of/along it. The field band is z<=4.8,
    // so an infinitely long east field never reaches the road or the town.
    for (const r of fieldParcelRects(60)) expect(r.z1).toBeLessThan(8)
  })
})
