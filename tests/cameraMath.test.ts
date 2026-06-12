/** Camera-math pins: the lens NEVER lands beyond a wall (the 48c58e0
 * regression), near-plane safe radii, box clamps, and room-box derivation. */
import { describe, expect, it } from 'vitest'
import { camBoxFromRect, clampToBox, nearSafeRadius, occlusionWant } from '../src/world/cameraMath'

describe('nearSafeRadius', () => {
  it('matches the two live camera configs', () => {
    // opaque room: near 0.15, fov ~46, landscape aspect ~2.16
    expect(nearSafeRadius(0.15, 46, 2.16)).toBeGreaterThan(0.2)
    expect(nearSafeRadius(0.15, 46, 2.16)).toBeLessThan(0.55)
    // outdoors/glass: near 0.5
    expect(nearSafeRadius(0.5, 46.5, 2.16)).toBeGreaterThan(0.8)
    expect(nearSafeRadius(0.5, 46.5, 2.16)).toBeLessThan(1.6)
  })

  it('is monotonic in fov and aspect', () => {
    expect(nearSafeRadius(0.5, 60, 2.16)).toBeGreaterThan(nearSafeRadius(0.5, 42, 2.16))
    expect(nearSafeRadius(0.5, 46, 2.4)).toBeGreaterThan(nearSafeRadius(0.5, 46, 1.6))
  })
})

describe('occlusionWant — the wall invariant', () => {
  it('NEVER places the lens past blocked - margin (regression 48c58e0)', () => {
    for (const m of [0.26, 0.86]) {
      for (let blocked = 0.4; blocked <= 12; blocked += 0.05) {
        const want = occlusionWant(blocked, 11, m)
        if (blocked > m + 0.06) {
          expect(want).toBeLessThanOrEqual(blocked - m + 1e-9)
        } else {
          // wall at/inside the focus margin: degenerate park, never negative
          expect(want).toBe(0.05)
        }
        expect(want).toBeGreaterThan(0)
      }
    }
  })

  it('clear ray returns the asked distance untouched', () => {
    expect(occlusionWant(null, 8.14, 0.86)).toBe(8.14)
    expect(occlusionWant(null, 4.5, 0.26)).toBe(4.5)
  })

  it('keeps the over-the-shoulder floor when the wall allows it', () => {
    // far hit: classic pull to just in front of the building
    expect(occlusionWant(8, 11, 0.86)).toBeCloseTo(7.14, 5)
    // mid hit: lands at the 1.0 shoulder floor, still in front of the wall
    expect(occlusionWant(2.2, 11, 0.86)).toBeCloseTo(1.34, 5)
    // hugging: hard cap rules, even below the degenerate guard
    expect(occlusionWant(0.5, 11, 0.26)).toBeCloseTo(0.24, 5)
  })
})

describe('clampToBox', () => {
  const box = { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: -3, maxZ: 3 }
  it('clamps componentwise and reports movement', () => {
    const v = { x: 5, y: -1, z: 0 }
    expect(clampToBox(v, box)).toBe(true)
    expect(v).toEqual({ x: 1, y: 0, z: 0 })
  })
  it('is a no-op inside the box', () => {
    const v = { x: 0.5, y: 1, z: -2 }
    expect(clampToBox(v, box)).toBe(false)
    expect(v).toEqual({ x: 0.5, y: 1, z: -2 })
  })
  it('is idempotent', () => {
    const v = { x: 9, y: 9, z: 9 }
    clampToBox(v, box)
    const once = { ...v }
    clampToBox(v, box)
    expect(v).toEqual(once)
  })
})

describe('camBoxFromRect', () => {
  const rect = { minX: 112.55, maxX: 126.45, minZ: -123.95, maxZ: -115.8 }
  it('positive inset shrinks, negative grows', () => {
    const inner = camBoxFromRect(rect, 0.4, 1, 5.7)
    expect(inner.minX).toBeCloseTo(112.95)
    expect(inner.maxZ).toBeCloseTo(-116.2)
    const outer = camBoxFromRect(rect, -0.1, 1, 3.9)
    expect(outer.minX).toBeCloseTo(112.45)
    expect(outer.maxX).toBeCloseTo(126.55)
    expect(outer.minY).toBe(1)
    expect(outer.maxY).toBe(3.9)
  })
  it('collapses to the centerline instead of inverting on tiny rooms', () => {
    const tiny = camBoxFromRect({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, 5, 0, 2)
    expect(tiny.minX).toBeLessThanOrEqual(tiny.maxX)
    expect(tiny.minZ).toBeLessThanOrEqual(tiny.maxZ)
    expect(tiny.minX).toBeCloseTo(0.5)
  })
})
