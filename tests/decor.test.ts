/** Decoration catalog pins: sorted order, decorDef round-trip,
 * canPlaceDecor reach guard (mirrors reach.test.ts), occupancy, cap. */
import { describe, expect, it } from 'vitest'
import { WORLD_BOUNDS } from '../src/game/geo'
import {
  canPlaceDecor,
  DECOR,
  DECOR_CLEAR,
  DECOR_MAX,
  decorDef,
  type DecorPlacement,
} from '../src/game/decor'
import { placeOf } from '../src/game/layout'
import { initialState, type GameState } from '../src/game/state'

/** state with decor injected (field not yet in GameState proper) */
function withDecor(decor: DecorPlacement[], mut?: (s: GameState) => void): GameState {
  const s = initialState(1)
  mut?.(s)
  ;(s as GameState & { decor: DecorPlacement[] }).decor = decor
  return s
}

function placement(x: number, z: number): DecorPlacement {
  return { item: 'flowerbed', x, z, rot: 0, d: 1 }
}

// ── catalog ──────────────────────────────────────────────────────────────────

describe('DECOR catalog', () => {
  it('is sorted by cost ascending', () => {
    for (let i = 1; i < DECOR.length; i++) {
      expect(DECOR[i].cost).toBeGreaterThanOrEqual(DECOR[i - 1].cost)
    }
  })

  it('has exactly 10 entries', () => {
    expect(DECOR).toHaveLength(10)
  })

  it('first entry is flowerbed at cost 150', () => {
    expect(DECOR[0].id).toBe('flowerbed')
    expect(DECOR[0].cost).toBe(150)
  })

  it('last entry is wellpump at cost 1200', () => {
    expect(DECOR[DECOR.length - 1].id).toBe('wellpump')
    expect(DECOR[DECOR.length - 1].cost).toBe(1200)
  })
})

// ── decorDef round-trip ───────────────────────────────────────────────────────

describe('decorDef', () => {
  it('round-trips every catalog id', () => {
    for (const d of DECOR) {
      const got = decorDef(d.id)
      expect(got).toBe(d) // same object reference
      expect(got.name).toBeTruthy()
      expect(got.emoji).toBeTruthy()
      expect(got.blurb).toBeTruthy()
    }
  })

  it('returns the correct level gate for sapling (9) and wellpump (16)', () => {
    expect(decorDef('sapling').level).toBe(9)
    expect(decorDef('wellpump').level).toBe(16)
  })
})

// ── canPlaceDecor: full cap ───────────────────────────────────────────────────

describe('canPlaceDecor: full', () => {
  it('blocks when DECOR_MAX items are already placed', () => {
    const spots = Array.from({ length: DECOR_MAX }, (_, i) =>
      placement(WORLD_BOUNDS.minX + 2 + i * (DECOR_CLEAR + 0.1), 0),
    )
    const s = withDecor(spots)
    expect(canPlaceDecor(s, 0, 0).reason).toBe('full')
  })

  it('allows when one below the cap', () => {
    const spots = Array.from({ length: DECOR_MAX - 1 }, (_, i) =>
      placement(WORLD_BOUNDS.minX + 2 + i * (DECOR_CLEAR + 0.1), 0),
    )
    const s = withDecor(spots)
    // open homestead lawn (NOT the east crop field, NOT near the z=0 decor line)
    expect(canPlaceDecor(s, 3, -6).ok).toBe(true)
  })
})

// ── canPlaceDecor: far (mirrors reach.test.ts) ────────────────────────────────

describe('canPlaceDecor: far', () => {
  it('rejects a point beyond the south wall', () => {
    const s = withDecor([])
    expect(canPlaceDecor(s, 2, WORLD_BOUNDS.maxZ + 2).reason).toBe('far')
  })

  it('rejects a point beyond the north wall', () => {
    const s = withDecor([])
    expect(canPlaceDecor(s, 0, WORLD_BOUNDS.minZ - 1).reason).toBe('far')
  })

  it('rejects a point beyond the east wall', () => {
    const s = withDecor([])
    expect(canPlaceDecor(s, WORLD_BOUNDS.maxX + 1, 0).reason).toBe('far')
  })

  it('rejects a point beyond the west wall', () => {
    const s = withDecor([])
    expect(canPlaceDecor(s, WORLD_BOUNDS.minX - 1, 0).reason).toBe('far')
  })

  it('accepts a point just inside on all sides (inset by exactly 1)', () => {
    const s = withDecor([])
    // exactly on the inset border: still ok
    expect(canPlaceDecor(s, WORLD_BOUNDS.minX + 1, 0).ok).toBe(true)
    expect(canPlaceDecor(s, WORLD_BOUNDS.maxX - 1, 0).ok).toBe(true)
    expect(canPlaceDecor(s, 0, WORLD_BOUNDS.minZ + 1).ok).toBe(true)
    expect(canPlaceDecor(s, 0, WORLD_BOUNDS.maxZ - 1).ok).toBe(true)
  })
})

// ── canPlaceDecor: occupied ───────────────────────────────────────────────────

describe('canPlaceDecor: occupied', () => {
  it('blocks when the new point is within DECOR_CLEAR of an existing item', () => {
    const s = withDecor([placement(5, 5)])
    // just inside the clear radius
    expect(canPlaceDecor(s, 5, 5 + DECOR_CLEAR - 0.01).reason).toBe('occupied')
  })

  it('allows when just outside DECOR_CLEAR', () => {
    const s = withDecor([placement(5, 5)])
    expect(canPlaceDecor(s, 5, 5 + DECOR_CLEAR).ok).toBe(true)
  })

  it('uses hypot (diagonal distance counts)', () => {
    const s = withDecor([placement(0, 0)])
    const diag = (DECOR_CLEAR - 0.01) / Math.SQRT2
    expect(canPlaceDecor(s, diag, diag).reason).toBe('occupied')
    const outside = (DECOR_CLEAR + 0.01) / Math.SQRT2
    expect(canPlaceDecor(s, outside, outside).ok).toBe(true)
  })
})

// ── canPlaceDecor: ok on open ground ─────────────────────────────────────────

describe('canPlaceDecor: ok', () => {
  it('allows placing on open ground with no existing decor', () => {
    const s = withDecor([])
    expect(canPlaceDecor(s, 2, 2)).toEqual({ ok: true })
  })

  it('allows placing next to (but not on top of) an existing item', () => {
    const s = withDecor([placement(2, 2)])
    expect(canPlaceDecor(s, 2 + DECOR_CLEAR + 0.1, 2).ok).toBe(true)
  })

  it('rejects decor placed on top of an owned building footprint', () => {
    const s = withDecor([], (x) => {
      x.projects.coop = true
    })
    const coop = placeOf(s, 'coop')
    // dead center of the coop is inside its footprint — no bench in the henhouse
    expect(canPlaceDecor(s, coop.x, coop.z).reason).toBe('occupied')
  })
})

// ── canPlaceDecor: undefined s.decor ────────────────────────────────────────

describe('canPlaceDecor: safe with undefined s.decor', () => {
  it('does not throw when s.decor is absent', () => {
    const s = initialState(42)
    // s.decor is not set at all — must not throw
    expect(() => canPlaceDecor(s, 0, 0)).not.toThrow()
    expect(canPlaceDecor(s, 0, 0).ok).toBe(true)
  })
})
