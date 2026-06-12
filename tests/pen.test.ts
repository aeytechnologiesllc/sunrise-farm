/** Movable-pen pins: the derived rect must reproduce the authored PEN at the
 * default layout, and placement rules must follow the pen wherever it goes. */
import { describe, expect, it } from 'vitest'
import { PEN } from '../src/game/expansion'
import { canPlace, DEFAULT_PLACES, penRect, placeOf, setPlace, type LayoutHost } from '../src/game/layout'

function host(): LayoutHost {
  return {
    layout: {},
    expansion: 4,
    projects: { shop: true, coop: true, stable: true, horse: true, greenhouse: true, farmhand: true, sheep: true, goats: true },
    produce: { deliveryT: 0 },
  }
}

describe('the pen travels', () => {
  it('penRect at the default layout IS the authored PEN', () => {
    const r = penRect(host())
    expect(r.x0).toBeCloseTo(PEN.x0, 10)
    expect(r.x1).toBeCloseTo(PEN.x1, 10)
    expect(r.z0).toBeCloseTo(PEN.z0, 10)
    expect(r.z1).toBeCloseTo(PEN.z1, 10)
    expect(r.gate.z0).toBeCloseTo(PEN.gate.z0, 10)
    expect(r.gate.z1).toBeCloseTo(PEN.gate.z1, 10)
  })

  it('a moved pen carries its rect and gate offsets along', () => {
    const h = host()
    setPlace(h, 'pen', 10, -5)
    const r = penRect(h)
    expect(r.x1 - r.x0).toBeCloseTo(PEN.x1 - PEN.x0, 10)
    expect((r.gate.z0 + r.gate.z1) / 2 - (r.z0 + r.z1) / 2).toBeCloseTo(
      (PEN.gate.z0 + PEN.gate.z1) / 2 - (PEN.z0 + PEN.z1) / 2,
      10,
    )
    expect(placeOf(h, 'pen')).toEqual({ x: 10, z: -5, yaw: 0 })
  })

  it('buildings refuse the pen ground WHEREVER it stands', () => {
    const h = host()
    // default spot is hot
    expect(canPlace(h, 'coop', DEFAULT_PLACES.pen.x, DEFAULT_PLACES.pen.z).reason).toBe('pen')
    // find a legal new pen spot, move it, and the NEW ground goes hot
    let spot: [number, number] | null = null
    outer: for (let x = -14; x <= 20; x += 0.5) {
      for (let z = -8; z <= 9; z += 0.5) {
        if (Math.hypot(x - DEFAULT_PLACES.pen.x, z - DEFAULT_PLACES.pen.z) < 4) continue
        if (canPlace(host(), 'pen', x, z).ok) {
          spot = [x, z]
          break outer
        }
      }
    }
    expect(spot, 'a legal pen spot exists').not.toBeNull()
    setPlace(h, 'pen', spot![0], spot![1])
    expect(canPlace(h, 'coop', spot![0], spot![1]).reason).toBe('pen')
    // and the OLD pen ground frees up (a hair east — the west fence gate's
    // keep-clear strip grazes the pen's old west edge)
    expect(canPlace(h, 'tractor', DEFAULT_PLACES.pen.x + 0.5, DEFAULT_PLACES.pen.z).ok).toBe(true)
  })
})
