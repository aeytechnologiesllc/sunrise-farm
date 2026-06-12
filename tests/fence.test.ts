/** Fence edge-set invariants: encoding, the tier-ring migration, expansion
 * re-ringing that preserves player work, and the collision math. */
import { describe, expect, it } from 'vitest'
import {
  blockByEdges,
  crossedEdge,
  decodeEdge,
  encodeEdge,
  expandRing,
  nearestEdge,
  ringEdges,
  toSets,
  toState,
} from '../src/game/fence'
import { fenceFor, gatesFor } from '../src/game/expansion'
import { deserialize, initialState, serialize } from '../src/game/state'

describe('edge encoding', () => {
  it('round-trips across the whole world range', () => {
    for (const [cx, cz, axis] of [[0, 0, 0], [-16, 10, 1], [20, -9, 0], [-64, -64, 1], [191, 191, 0]] as Array<[number, number, 0 | 1]>) {
      expect(decodeEdge(encodeEdge(cx, cz, axis))).toEqual({ cx, cz, axis })
    }
  })
})

describe('the authored ring becomes player fence', () => {
  it('ringEdges traces the tier fence with gate gaps', () => {
    for (const tier of [0, 3]) {
      const f = fenceFor(tier)
      const ring = ringEdges(tier)
      const w = Math.round(f.maxX) - Math.round(f.minX)
      const d = Math.round(f.maxZ) - Math.round(f.minZ)
      // every wall cell is either fence or gate — none missing
      expect(ring.edges.length + ring.gates.length).toBe(2 * w + 2 * d)
      // gate cells exist for every authored gate span
      expect(ring.gates.length).toBeGreaterThanOrEqual(gatesFor(tier).length * 2)
      // edges decode onto the snapped walls
      for (const k of ring.edges) {
        const { cx, cz, axis } = decodeEdge(k)
        if (axis === 0) expect([Math.round(f.minZ), Math.round(f.maxZ)]).toContain(cz)
        else expect([Math.round(f.minX), Math.round(f.maxX)]).toContain(cx)
      }
    }
  })

  it('expandRing swaps default rings and preserves player fence', () => {
    const sets = toSets(ringEdges(0))
    const custom = encodeEdge(2, 2, 0) // a player fence in the middle of the farm
    sets.edges.add(custom)
    const removed = ringEdges(0).edges[0]
    sets.edges.delete(removed) // the player tore one ring piece down
    expandRing(sets, 0, 3)
    expect(sets.edges.has(custom)).toBe(true) // their work survives
    const ring3 = toSets(ringEdges(3))
    for (const k of ring3.edges) expect(sets.edges.has(k)).toBe(true)
    // idempotent
    const before = toState(sets)
    expandRing(sets, 0, 3)
    expect(toState(sets)).toEqual(before)
  })

  it('old saves migrate on load; new saves are born fenced', () => {
    expect(initialState(5).fences.edges.length).toBeGreaterThan(20)
    const raw = JSON.parse(serialize(initialState(6))) as Record<string, unknown>
    delete raw.fences
    const back = deserialize(JSON.stringify(raw))!
    expect(back.fences.edges.length).toBeGreaterThan(20)
  })
})

describe('collision', () => {
  it('blocks a step across a fence edge, passes through a gate', () => {
    const sets = { edges: new Set([encodeEdge(2, 3, 1)]), gates: new Set<number>() }
    const next = { x: 2.3, z: 3.5 }
    expect(blockByEdges({ x: 1.7, z: 3.5 }, next, sets)).toBe(true)
    expect(next.x).toBe(1.7) // step cancelled
    sets.gates.add(encodeEdge(2, 3, 1))
    sets.edges.delete(encodeEdge(2, 3, 1))
    const pass = { x: 2.3, z: 3.5 }
    expect(blockByEdges({ x: 1.7, z: 3.5 }, pass, sets)).toBe(false)
    expect(pass.x).toBe(2.3)
  })

  it('blocks horizontal edges crossed vertically', () => {
    const sets = { edges: new Set([encodeEdge(5, -2, 0)]), gates: new Set<number>() }
    const next = { x: 5.4, z: -1.8 }
    expect(blockByEdges({ x: 5.4, z: -2.2 }, next, sets)).toBe(true)
    expect(next.z).toBe(-2.2)
  })

  it('free ground never blocks', () => {
    const sets = { edges: new Set<number>(), gates: new Set<number>() }
    const next = { x: 9.7, z: 4.1 }
    expect(blockByEdges({ x: 9.2, z: 3.6 }, next, sets)).toBe(false)
  })

  it('crossedEdge reports the line just walked over (walk-to-draw)', () => {
    expect(crossedEdge({ x: 1.8, z: 3.5 }, { x: 2.1, z: 3.5 })).toBe(encodeEdge(2, 3, 1))
    expect(crossedEdge({ x: 5.5, z: -2.1 }, { x: 5.5, z: -1.9 })).toBe(encodeEdge(5, -2, 0))
    expect(crossedEdge({ x: 1.2, z: 3.5 }, { x: 1.4, z: 3.5 })).toBeNull()
  })

  it('nearestEdge finds the closest piece for remove/gate actions', () => {
    const sets = { edges: new Set([encodeEdge(0, 0, 0), encodeEdge(10, 10, 1)]), gates: new Set<number>() }
    expect(nearestEdge(sets, 0.6, 0.3)).toBe(encodeEdge(0, 0, 0))
    expect(nearestEdge(sets, 10.2, 10.4)).toBe(encodeEdge(10, 10, 1))
    expect(nearestEdge(sets, -20, -20)).toBeNull()
  })
})
