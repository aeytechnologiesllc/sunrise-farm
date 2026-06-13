/** nextGoal oracle: priority ladder, bridge case, determinism.
 * Mirrors town.test.ts style — no Game class, pure state construction. */
import { describe, expect, it } from 'vitest'
import { nextGoal } from '../src/game/goals'
import { DECOR_MAX } from '../src/game/decor'
import { initialState, type GameState } from '../src/game/state'

/** Construct a minimal save with controlled fields. */
function make(mut: (s: GameState) => void): GameState {
  const s = initialState(42)
  mut(s)
  return s
}

// ─────────────────────────────────────────────────────────────────────────────
// The old "bridge case" (a deed standing between the player and the stable) is
// GONE: buildings dropped the land gate, so the stable is now just a level/coins
// -gated project. A player who's level-met but coins-short on the stable sees it
// surface directly as a coins-blocked PROJECT goal — no deed detour.
// ─────────────────────────────────────────────────────────────────────────────
describe('the stable surfaces as a direct project goal (no land bridge anymore)', () => {
  function stableSave(): GameState {
    return make((s) => {
      s.level = 8
      s.coins = 200 // short of the stable (450c) → coins-blocked, not affordable
      // own everything affordable/level-met below the stable
      s.projects.stand = true
      s.projects.sheep = true
      s.projects.goats = true
      s.projects.coop = true
      // stable: level 6 (met), 450c (short) → coins-blocked PROJECT goal
    })
  }

  it('returns a coins-blocked PROJECT goal for the stable (no deed)', () => {
    const s = stableSave()
    const g = nextGoal(s)
    expect(g).not.toBeNull()
    expect(g!.kind).toBe('project')
    expect(g!.id).toBe('stable')
    expect(g!.blocked).toBe('coins')
    expect(g!.pill).toContain('Stable')
  })

  it('the cheapest coins-blocked goal wins (stable beats a pricier town act)', () => {
    const s = stableSave()
    s.town.delivered = 3 // meet bakery delivery gate
    s.wheat = 999
    s.coins = 200 // short of both the stable (450) and the bakery (600)
    const g = nextGoal(s)
    expect(g).not.toBeNull()
    // the stable (450c) is cheaper than the bakery → it surfaces first
    expect(g!.kind).toBe('project')
    expect(g!.id).toBe('stable')
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

  it('keeps nudging deliveries toward the next town act after the first run', () => {
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
      x.town.delivered = 1 // one run in; the bakery still needs more
    })
    const g = nextGoal(s)
    // the thread must NOT die after one run — the compass keeps pointing at the
    // deliveries that unlock the next act (the gap this fixed)
    expect(g?.kind).toBe('delivery')
    expect(g?.id).toBe('more-deliveries')
  })

  it('stops the delivery nudge once the next act is fully unlocked', () => {
    const s = make((x) => {
      x.projects.horse = true
      x.town.built.bakery = true // bakery done; cottages needs 6, give it 6
      x.town.delivered = 6
      x.coins = 0
      x.wheat = 0
    })
    const g = nextGoal(s)
    // cottages is now delivery-met (only coins/wheat short) — no delivery nudge
    if (g !== null) expect(g.id).not.toBe('more-deliveries')
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
// Priority 8: affordable upgrade fires after coins-blocked checks
// ─────────────────────────────────────────────────────────────────────────────
describe('priority 8: affordable upgrade', () => {
  it('surfaces an upgrade when all projects/deeds/town owned but upgrade affordable', () => {
    const s = make((x) => {
      // High level so all level gates clear
      x.level = 30
      // Max expansion so no deeds remain
      x.expansion = 6
      // All projects owned
      x.projects.stand = true
      x.projects.sheep = true
      x.projects.goats = true
      x.projects.coop = true
      x.projects.stable = true
      x.projects.horse = true
      x.projects.shop = true
      x.projects.greenhouse = true
      // All town acts built
      x.town.built.bakery = true
      x.town.built.cottages = true
      x.town.built.school = true
      x.town.built.works = true
      x.town.built.cafe = true
      x.town.built.square = true
      x.town.built.station = true
      x.town.delivered = 20
      x.wheat = 999
      // No upgrades owned yet; ghwing costs 2400 — cheapest
      x.upgrades = {}
      x.coins = 2400
    })
    const g = nextGoal(s)
    expect(g).not.toBeNull()
    expect(g!.kind).toBe('upgrade')
    expect(g!.blocked).toBeNull()
    expect(g!.pill).toContain('🔧')
    expect(g!.pill.length).toBeLessThanOrEqual(40)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Priority 9: affordable fence skin
// ─────────────────────────────────────────────────────────────────────────────
describe('priority 9: affordable fence skin', () => {
  it('surfaces a fence skin when everything else owned/unaffordable but skin affordable', () => {
    const s = make((x) => {
      x.level = 30
      x.expansion = 6
      x.projects.stand = true
      x.projects.sheep = true
      x.projects.goats = true
      x.projects.coop = true
      x.projects.stable = true
      x.projects.horse = true
      x.projects.shop = true
      x.projects.greenhouse = true
      x.town.built.bakery = true
      x.town.built.cottages = true
      x.town.built.school = true
      x.town.built.works = true
      x.town.built.cafe = true
      x.town.built.square = true
      x.town.built.station = true
      x.town.delivered = 20
      x.wheat = 999
      // All upgrades owned
      x.upgrades = { ghwing: true, market: true, pasture: true, tackroom: true, homereno: true }
      // No fence skins owned yet (picket costs 600, level 9 — both met)
      x.fenceStyles = {}
      x.coins = 600
    })
    const g = nextGoal(s)
    expect(g).not.toBeNull()
    expect(g!.kind).toBe('fencestyle')
    expect(g!.blocked).toBeNull()
    expect(g!.pill).toContain('🎨')
    expect(g!.pill.length).toBeLessThanOrEqual(40)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Priority 10: affordable decor
// ─────────────────────────────────────────────────────────────────────────────
describe('priority 10: affordable decor', () => {
  it('surfaces decor when upgrades+fences all owned but decor below DECOR_MAX', () => {
    const s = make((x) => {
      x.level = 30
      x.expansion = 6
      x.projects.stand = true
      x.projects.sheep = true
      x.projects.goats = true
      x.projects.coop = true
      x.projects.stable = true
      x.projects.horse = true
      x.projects.shop = true
      x.projects.greenhouse = true
      x.town.built.bakery = true
      x.town.built.cottages = true
      x.town.built.school = true
      x.town.built.works = true
      x.town.built.cafe = true
      x.town.built.square = true
      x.town.built.station = true
      x.town.delivered = 20
      x.wheat = 999
      x.upgrades = { ghwing: true, market: true, pasture: true, tackroom: true, homereno: true }
      // All fence skins owned
      x.fenceStyles = { picket: true, cedar: true, stone: true }
      // Decor below DECOR_MAX, flowerbed costs 150 (cheapest, level 8 — met)
      x.decor = []
      x.coins = 150
    })
    const g = nextGoal(s)
    expect(g).not.toBeNull()
    expect(g!.kind).toBe('decor')
    expect(g!.blocked).toBeNull()
    expect(g!.pill).toContain('🌷')
    expect(g!.pill.length).toBeLessThanOrEqual(40)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE CRITICAL PIN: whale save — compass must NEVER go dark
// ─────────────────────────────────────────────────────────────────────────────
describe('whale save — nextGoal is never null', () => {
  /** A save that owns literally everything purchasable. The design law is
   * "the player must always have something to save for" — nextGoal must
   * return a non-null contract/tend goal even for the most maxed-out farm. */
  function whaleSave(): GameState {
    return make((x) => {
      x.level = 30
      x.expansion = 6
      // All projects
      x.projects.stand = true
      x.projects.sheep = true
      x.projects.goats = true
      x.projects.coop = true
      x.projects.stable = true
      x.projects.horse = true
      x.projects.shop = true
      x.projects.greenhouse = true
      // All town acts
      x.town.built.bakery = true
      x.town.built.cottages = true
      x.town.built.school = true
      x.town.built.works = true
      x.town.built.cafe = true
      x.town.built.square = true
      x.town.built.station = true
      x.town.delivered = 50
      x.wheat = 0
      // All upgrades
      x.upgrades = { ghwing: true, market: true, pasture: true, tackroom: true, homereno: true }
      // All fence skins
      x.fenceStyles = { picket: true, cedar: true, stone: true }
      // Decor at cap
      x.decor = Array.from({ length: DECOR_MAX }, (_, i) => ({
        item: 'flowerbed' as const,
        x: i * 2,
        z: 0,
        rot: 0,
        d: 1,
      }))
      // Not enough coins or wheat for anything
      x.coins = 0
      // Contracts all done for this day
      x.contracts = { day: x.day, goods: [], progress: [], done: [true, true, true] }
    })
  }

  it('returns a non-null goal for a fully maxed farm (the compass never goes dark)', () => {
    const g = nextGoal(whaleSave())
    expect(g).not.toBeNull()
  })

  it('whale save goal has blocked null (not a blocked goal — a real invitation)', () => {
    const g = nextGoal(whaleSave())
    expect(g!.blocked).toBeNull()
  })

  it('whale save goal kind is contract (order board or tend fallback)', () => {
    const g = nextGoal(whaleSave())
    expect(g!.kind).toBe('contract')
  })

  it('whale save pill is <= 40 chars', () => {
    const g = nextGoal(whaleSave())
    expect(g!.pill.length).toBeLessThanOrEqual(40)
  })
})
