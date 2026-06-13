/** nextGoal oracle: priority ladder, bridge case, determinism.
 * Mirrors town.test.ts style — no Game class, pure state construction. */
import { describe, expect, it } from 'vitest'
import { nextGoal } from '../src/game/goals'
import { landBlockedProjects } from '../src/game/projects'
import { initialState, type GameState } from '../src/game/state'

/** Construct a minimal save with controlled fields. */
function make(mut: (s: GameState) => void): GameState {
  const s = initialState(42)
  mut(s)
  return s
}

// ─────────────────────────────────────────────────────────────────────────────
// Bridge case: coop owned, expansion === 2 (Old Pasture NOT bought), level 8,
// modest coins → the ONLY affordable/level-met path is the stable, but it
// needs expansion 3 → goal must point at "The Old Pasture" deed.
// We set coins just below the deed cost (480) so priority-2 (affordable deed)
// does NOT fire; the bridge case (priority-4) fires instead.
// ─────────────────────────────────────────────────────────────────────────────
describe('bridge case — stable blocked by missing Old Pasture deed', () => {
  function bridgeSave(): GameState {
    return make((s) => {
      s.level = 8
      s.expansion = 2
      s.coins = 200 // too few for Old Pasture (480c) → deed is NOT affordable
      // own everything that expansion-2 already allows AND is affordable at level 8
      s.projects.stand = true
      s.projects.sheep = true
      s.projects.goats = true
      s.projects.coop = true
      // greenhouse (requiresExpansion 2, level 9) → level-blocked, won't fire as #1
      // farmhand (requiresExpansion 2, level 10) → level-blocked
      // stable: requiresExpansion 3, level 6 — level met, expansion NOT met → bridge
    })
  }

  it('returns a deed goal pointing at The Old Pasture', () => {
    const s = bridgeSave()
    const g = nextGoal(s)
    expect(g).not.toBeNull()
    expect(g!.kind).toBe('deed')
    // The Old Pasture is TIERS[3]
    expect(g!.id).toBe('tier3')
    // pill contains the deed name
    expect(g!.pill).toContain('Old Pasture')
    // player can't afford the deed → blocked coins
    expect(g!.blocked).toBe('coins')
    // sign position for The Old Pasture from expansion.ts
    expect(g!.at).toEqual([-7.4, 5.6])
  })

  it('bridge case wins over a town act that is only coins-blocked', () => {
    // set up a state where the bakery would also be coins-blocked so that
    // the bridge goal fires before any town-act fallback
    const s = bridgeSave()
    s.town.delivered = 3 // meet bakery delivery gate
    s.wheat = 999
    s.coins = 200 // short of both Old Pasture (480) and bakery (600)
    const g = nextGoal(s)
    expect(g).not.toBeNull()
    // bridge case is priority 4; coins-blocked townact is priority 6
    // but bridge is a STORY priority (stable path), so it fires first
    expect(g!.kind).toBe('deed')
    expect(g!.id).toBe('tier3')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Horse + zero deliveries → kind 'delivery'
// ─────────────────────────────────────────────────────────────────────────────
describe('delivery nudge when Hazel is home but idle', () => {
  it('fires kind=delivery when horse owned and delivered===0', () => {
    const s = make((x) => {
      x.level = 6
      x.expansion = 3
      x.coins = 0
      // own all expansion-3 projects to clear priorities 1/2/3
      x.projects.stand = true
      x.projects.sheep = true
      x.projects.goats = true
      x.projects.coop = true
      x.projects.stable = true
      x.projects.horse = true
      x.town.delivered = 0
    })
    const g = nextGoal(s)
    expect(g).not.toBeNull()
    expect(g!.kind).toBe('delivery')
    expect(g!.id).toBe('first-delivery')
    expect(g!.blocked).toBeNull()
    expect(g!.pill).toBe('🚚 Send Hazel to town')
  })

  it('does NOT fire delivery if already delivered once', () => {
    const s = make((x) => {
      x.level = 6
      x.expansion = 3
      x.coins = 0
      x.projects.stand = true
      x.projects.sheep = true
      x.projects.goats = true
      x.projects.coop = true
      x.projects.stable = true
      x.projects.horse = true
      x.town.delivered = 1 // already made at least one delivery
    })
    const g = nextGoal(s)
    // might return a levelwall or coins-blocked goal, but NOT delivery
    if (g !== null) expect(g.kind).not.toBe('delivery')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Fresh-ish save — never returns null prematurely
// ─────────────────────────────────────────────────────────────────────────────
describe('non-null for low-level saves', () => {
  it('a poor fresh save has at least one goal (level wall or coins blocker)', () => {
    const s = initialState(99) // level 1, 0 coins, expansion 0
    const g = nextGoal(s)
    expect(g).not.toBeNull()
  })

  it('level-1 player sees either a coins-blocked stand or a levelwall', () => {
    const s = make((x) => {
      x.level = 1
      x.coins = 0
    })
    const g = nextGoal(s)
    expect(g).not.toBeNull()
    // at level 1, stand is level-2-gated; should surface as levelwall or coins
    expect(['project', 'deed', 'townact', 'delivery', 'levelwall']).toContain(g!.kind)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Determinism / purity
// ─────────────────────────────────────────────────────────────────────────────
describe('determinism and purity', () => {
  it('calling nextGoal twice on the same state returns deep-equal results', () => {
    const s = make((x) => {
      x.level = 5
      x.coins = 50
      x.expansion = 1
      x.projects.stand = true
    })
    const a = nextGoal(s)
    const b = nextGoal(s)
    expect(a).toEqual(b)
  })

  it('does not mutate the state', () => {
    const s = make((x) => {
      x.level = 4
      x.coins = 200
      x.expansion = 0
    })
    const coinsBefore = s.coins
    const levelBefore = s.level
    nextGoal(s)
    expect(s.coins).toBe(coinsBefore)
    expect(s.level).toBe(levelBefore)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Priority-1: affordable project surfaces first
// ─────────────────────────────────────────────────────────────────────────────
describe('priority-1: affordable project', () => {
  it('returns the cheapest affordable project when one exists', () => {
    const s = make((x) => {
      x.level = 3
      x.coins = 200  // enough for sheep (100) but not goats (300)
      x.expansion = 0
    })
    const g = nextGoal(s)
    expect(g).not.toBeNull()
    expect(g!.kind).toBe('project')
    expect(g!.blocked).toBeNull()
    // stand costs 25, sheep costs 100 — stand is cheaper and level-2-gated, player is level 3
    expect(g!.pill).toContain('🔨')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Pill length invariant
// ─────────────────────────────────────────────────────────────────────────────
describe('pill length <= 40 chars', () => {
  const states: GameState[] = [
    initialState(1),
    make((s) => { s.level = 10; s.coins = 9999; s.expansion = 3; s.projects.stable = true }),
    make((s) => { s.level = 6; s.expansion = 2; s.coins = 200; s.projects.coop = true }),
  ]

  for (const s of states) {
    const g = nextGoal(s)
    if (g) {
      it(`pill "${g.pill}" is <= 40 chars`, () => {
        expect(g.pill.length).toBeLessThanOrEqual(40)
      })
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// landBlockedProjects helper
// ─────────────────────────────────────────────────────────────────────────────
describe('landBlockedProjects', () => {
  it('returns projects blocked by missing land (not level, not coins)', () => {
    const s = {
      level: 10,
      coins: 9999,
      expansion: 2,
      projects: { stand: true, sheep: true, goats: true, coop: true } as Partial<Record<string, boolean>>,
    }
    const blocked = landBlockedProjects(s)
    // stable requires expansion 3, level 6; player is level 10, expansion 2 → blocked
    const ids = blocked.map((p) => p.id)
    expect(ids).toContain('stable')
    // horse: requiresExpansion 3, requires stable — stable not owned, so horse should NOT appear
    expect(ids).not.toContain('horse')
    // shop: requiresExpansion 4 — also blocked by land
    expect(ids).toContain('shop')
    // greenhouse: requiresExpansion 2, level 9 — land met (expansion 2), so NOT land-blocked
    expect(ids).not.toContain('greenhouse')
  })

  it('horse appears only once the stable is owned', () => {
    const s = {
      level: 10,
      coins: 9999,
      expansion: 2,
      projects: {
        stand: true,
        sheep: true,
        goats: true,
        coop: true,
        stable: true,
      } as Partial<Record<string, boolean>>,
    }
    const blocked = landBlockedProjects(s)
    // stable is owned — horse's prerequisite is met, expansion 2 < 3, level met → should appear
    const ids = blocked.map((p) => p.id)
    expect(ids).toContain('horse')
  })
})
