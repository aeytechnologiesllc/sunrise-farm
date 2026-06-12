/** Layout invariants — the "invisible refactor" pins. Phase 0 moved every
 * building position into the saved layout; these tests pin the defaults to
 * the legacy literals, the delivery route to the legacy waypoints, and the
 * placement rules to the authored farm (every default must be legal where
 * it already stands — walking a building back home can never fail). */
import { describe, expect, it } from 'vitest'
import {
  canPlace,
  DEFAULT_PLACES,
  deliveryRoute,
  footprintOf,
  layoutView,
  PLACE_IDS,
  placeOf,
  paddockRect,
  setPlace,
  type LayoutHost,
  type PlaceId,
} from '../src/game/layout'
import { PADDOCK, PROJECTS } from '../src/game/projects'
import { ROAD_Z, TOWN_GATE_X } from '../src/game/geo'
import { deserialize, initialState, serialize } from '../src/game/state'

/** a host with everything owned — the fullest farm */
function fullHost(over: Partial<LayoutHost> = {}): LayoutHost {
  return {
    layout: {},
    expansion: 4,
    projects: { stand: false, shop: true, coop: true, stable: true, horse: true, greenhouse: true, farmhand: true, sheep: true, goats: true },
    produce: { deliveryT: 0 },
    ...over,
  }
}

describe('defaults pin (the refactor must be invisible)', () => {
  it('DEFAULT_PLACES equals the legacy literals', () => {
    expect(DEFAULT_PLACES.stand).toEqual({ x: 0.5, z: 7.0, yaw: 0 })
    expect(DEFAULT_PLACES.shop).toEqual({ x: 2.5, z: 15.6, yaw: 3.14159 })
    expect(DEFAULT_PLACES.coop).toEqual({ x: -6.4, z: 8.4, yaw: Math.PI })
    expect(DEFAULT_PLACES.stable).toEqual({ x: -12.3, z: -0.6, yaw: 1.35 })
    expect(DEFAULT_PLACES.greenhouse).toEqual({ x: -5.2, z: -2.0, yaw: 0.1 })
    expect(DEFAULT_PLACES.tractor).toEqual({ x: -7.2, z: -6.6, yaw: -0.35 })
    expect(DEFAULT_PLACES.farmhand).toEqual({ x: -0.5, z: 5.2, yaw: 0 })
  })

  it('footprints come from the project ladder', () => {
    for (const p of PROJECTS) {
      if (p.id in DEFAULT_PLACES) expect(footprintOf(p.id as PlaceId)).toEqual(p.footprint)
    }
  })

  it('paddockRect at the default layout IS the authored PADDOCK', () => {
    expect(paddockRect(fullHost())).toEqual(PADDOCK)
  })

  it('deliveryRoute at the default layout IS the legacy hand-tuned route', () => {
    const legacy = [
      [-8.2, 0.6],
      [0.9, 9.4],
      [0.9, 11],
      [TOWN_GATE_X + 1.8, 11.2],
    ]
    const route = deliveryRoute(fullHost())
    expect(route).toHaveLength(legacy.length)
    for (let i = 0; i < legacy.length; i++) {
      expect(route[i][0]).toBeCloseTo(legacy[i][0], 10)
      expect(route[i][1]).toBeCloseTo(legacy[i][1], 10)
    }
  })

  it('a moved stable still routes through the gate column and past the town gate', () => {
    const h = fullHost({ layout: { stable: { x: 14, z: 2 } } })
    const route = deliveryRoute(h)
    expect(route[1][0]).toBe(0.9) // the fence gate column never moves
    expect(route[2]).toEqual([0.9, ROAD_Z])
    expect(route[route.length - 1][0]).toBeGreaterThan(TOWN_GATE_X)
  })
})

describe('placeOf / setPlace', () => {
  it('falls back to defaults and overlays moved buildings (yaw preserved)', () => {
    const h = fullHost()
    expect(placeOf(h, 'coop')).toEqual(DEFAULT_PLACES.coop)
    setPlace(h, 'coop', 3, -1)
    expect(placeOf(h, 'coop')).toEqual({ x: 3, z: -1, yaw: Math.PI })
    expect(h.layout!.coop).toEqual({ x: 3, z: -1 })
  })

  it('moving back home erases the overlay (saves stay sparse)', () => {
    const h = fullHost()
    setPlace(h, 'coop', 3, -1)
    setPlace(h, 'coop', DEFAULT_PLACES.coop.x, DEFAULT_PLACES.coop.z)
    expect(h.layout!.coop).toBeUndefined()
  })

  it('layoutView resolves every PlaceId', () => {
    const lv = layoutView(fullHost({ layout: { tractor: { x: 1, z: 1 } } }))
    expect(lv.tractor).toEqual({ x: 1, z: 1, yaw: -0.35 })
    expect(lv.stand).toEqual(DEFAULT_PLACES.stand)
  })
})

describe('canPlace — the authored farm is legal', () => {
  it('every default place is valid where it already stands', () => {
    // pre-shop farm (stand exists), then the full farm (shop replaced it)
    const early = fullHost({ expansion: 2, projects: { stand: true, coop: true, greenhouse: true } })
    for (const id of ['stand', 'coop', 'greenhouse', 'tractor'] as PlaceId[]) {
      const d = DEFAULT_PLACES[id]
      expect(canPlace(early, id, d.x, d.z), `${id} at home (early farm)`).toEqual({ ok: true })
    }
    const late = fullHost()
    for (const id of PLACE_IDS) {
      if (id === 'stand') continue // replaced by the shop on the late farm
      const d = DEFAULT_PLACES[id]
      expect(canPlace(late, id, d.x, d.z), `${id} at home (full farm)`).toEqual({ ok: true })
    }
  })
})

describe('canPlace — forbidden zones', () => {
  const h = fullHost()

  it('the road stays clear', () => {
    expect(canPlace(h, 'coop', 0, ROAD_Z).reason).toBe('road')
    expect(canPlace(h, 'coop', 5, ROAD_Z + 1).reason).toBe('road')
  })

  it('soil is sacred — every tier field, even unbought ones', () => {
    expect(canPlace(fullHost({ expansion: 2, projects: { coop: true } }), 'coop', 18.4, 2).reason).toMatch(/field|land/)
    expect(canPlace(h, 'coop', 3, 2).reason).toBe('field') // home field
    expect(canPlace(h, 'coop', 13, 2).reason).toBe('field') // far east field
  })

  it('the pen, the paddock, the homestead', () => {
    expect(canPlace(h, 'coop', -12.3, 5.3).reason).toBe('pen')
    expect(canPlace(h, 'coop', -12.4, -0.4).reason).toMatch(/paddock|building/)
    expect(canPlace(h, 'coop', -11.5, -3.5).reason).toMatch(/home|paddock/)
  })

  it('the paddock travels with a moved stable (the unit validates whole)', () => {
    // find a legal new stable spot by scanning the grid — robust to tuning
    let spot: [number, number] | null = null
    outer: for (let gx = -14; gx <= 20; gx += 0.5) {
      for (let gz = -8; gz <= 9; gz += 0.5) {
        if (Math.hypot(gx - DEFAULT_PLACES.stable.x, gz - DEFAULT_PLACES.stable.z) < 4) continue
        if (canPlace(fullHost(), 'stable', gx, gz).ok) {
          spot = [gx, gz]
          break outer
        }
      }
    }
    expect(spot, 'a legal non-default stable spot exists').not.toBeNull()
    const moved = fullHost({ layout: { stable: { x: spot![0], z: spot![1] } } })
    // the NEW paddock (around the moved stable) refuses other buildings
    const p = paddockRect(moved)
    expect(canPlace(moved, 'coop', (p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2).ok).toBe(false)
  })

  it('landmark spots: nest, crate, dog house', () => {
    expect(canPlace(h, 'tractor', -4.5, 1.5).reason).toBe('spot') // the nest
    expect(canPlace(h, 'tractor', -2.2, 5).reason).toBe('spot') // dog house
  })

  it('fence gate passages stay walkable', () => {
    expect(canPlace(h, 'coop', 0.9, 10.2).reason).toMatch(/gate|road/)
    const early = fullHost({ expansion: 0, projects: { stand: true } })
    expect(canPlace(early, 'stand', 0.9, 10).reason).toMatch(/gate|road/)
  })

  it('buildings keep breathing room from each other', () => {
    expect(canPlace(h, 'coop', -12.3, -0.6).reason).toMatch(/building|paddock|home/)
    const d = DEFAULT_PLACES.greenhouse
    expect(canPlace(h, 'coop', d.x + 0.5, d.z).reason).toBe('building')
  })

  it('outside the deeds is not yours; the lot opens at tier 4', () => {
    expect(canPlace(fullHost({ expansion: 0, projects: { stand: true } }), 'stand', 14, 2).reason).toBe('land')
    expect(canPlace(fullHost({ expansion: 3 }), 'coop', 2.5, 15.6).reason).toMatch(/land|road/)
    // the shop itself may shuffle within its lot once tier 4 is owned
    expect(canPlace(h, 'shop', 2.5, 15.8)).toEqual({ ok: true })
  })

  it('the stable is locked while Hazel is on the road', () => {
    const out = fullHost({ produce: { deliveryT: 30 } })
    expect(canPlace(out, 'stable', -12.3, -0.6).reason).toBe('hazel-out')
  })

  it('open lawn is fine — east lawn and the far fence line', () => {
    expect(canPlace(h, 'coop', 9, 6.9)).toEqual({ ok: true })
    expect(canPlace(h, 'greenhouse', 18.5, 7.5)).toEqual({ ok: true })
  })
})

describe('save round-trip', () => {
  it('layout survives serialize/deserialize and backfills when absent', () => {
    const s = initialState(7)
    s.layout = { coop: { x: 3, z: -1 } }
    const back = deserialize(serialize(s))!
    expect(back.layout).toEqual({ coop: { x: 3, z: -1 } })
    // pre-layout saves get the empty overlay
    const raw = JSON.parse(serialize(initialState(8))) as Record<string, unknown>
    delete raw.layout
    const old = deserialize(JSON.stringify(raw))!
    expect(old.layout).toEqual({})
  })
})
