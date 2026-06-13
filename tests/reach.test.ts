/** Reachability pins: nothing places beyond the walkable world, and saves
 * that already stranded something get rescued on load. */
import { describe, expect, it } from 'vitest'
import { WORLD_BOUNDS } from '../src/game/geo'
import { canPlace } from '../src/game/layout'
import { deserialize, initialState, serialize } from '../src/game/state'

describe('the reach guard', () => {
  it('refuses any placement the farmer could never walk back to', () => {
    const s = initialState(4)
    s.expansion = 4
    // beyond the south wall (the exact strand the owner hit)
    expect(canPlace(s, 'field0', 2, WORLD_BOUNDS.maxZ + 2).reason).toBe('far')
    // beyond every other wall too
    expect(canPlace(s, 'stand', WORLD_BOUNDS.maxX + 1, 8).reason).toBe('far')
    expect(canPlace(s, 'stand', WORLD_BOUNDS.minX - 1, 8).reason).toBe('far')
    expect(canPlace(s, 'stand', 0, WORLD_BOUNDS.minZ - 1).reason).toBe('far')
  })

  it('a building AUTHORED home is never rejected as far', () => {
    const s = initialState(5)
    // defaults all live inside the walkable world — the guard must not
    // contradict the "authored home is always legal" law
    expect(canPlace(s, 'stand', 0.5, 7.0).reason).not.toBe('far')
  })
})

describe('the stranded-save rescue', () => {
  it('out-of-reach layout entries walk home on load; sane ones stay', () => {
    const s = initialState(6)
    s.layout = {
      field0: { x: 2, z: WORLD_BOUNDS.maxZ + 3 }, // stranded
      stand: { x: 4, z: 8 }, // legitimately moved
    }
    const back = deserialize(serialize(s))!
    expect(back.layout.field0).toBeUndefined()
    expect(back.layout.stand).toEqual({ x: 4, z: 8 })
  })
})
