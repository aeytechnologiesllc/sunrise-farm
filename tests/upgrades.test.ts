/** Upgrade registry, status precedence, availableUpgrades filter, and
 * all pure effect helpers — mirrors tests/town.test.ts style. */
import { describe, expect, it } from 'vitest'
import { initialState, type GameState } from '../src/game/state'
import {
  availableUpgrades,
  canRideHazel,
  greenhouseBeds,
  hasUpgrade,
  marketPremiumBonus,
  marketQueueBonus,
  pastureGoatBonus,
  pastureSheepBonus,
  UPGRADES,
  upgradeDef,
  upgradeStatus,
  type UpgradeId,
} from '../src/game/upgrades'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A base save — level 1, broke, no projects. */
function fresh(mut?: (s: GameState) => void): GameState {
  const s = initialState(1)
  mut?.(s)
  return s
}

/** A rich, high-level save with optional mutations. */
function rich(mut?: (s: GameState) => void): GameState {
  const s = initialState(1)
  s.coins = 99_999
  s.level = 30
  mut?.(s)
  return s
}

/** Give a save a specific upgrade. */
function giveUpgrade(s: GameState, id: UpgradeId): GameState {
  const u = s as unknown as { upgrades?: Partial<Record<UpgradeId, boolean>> }
  u.upgrades ??= {}
  u.upgrades[id] = true
  return s
}

/** Return a clone of `s` with s.upgrades deleted entirely. */
function noUpgrades(s: GameState): GameState {
  const clone = { ...s }
  delete (clone as { upgrades?: unknown }).upgrades
  return clone
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('UPGRADES registry', () => {
  it('contains exactly 5 upgrades', () => {
    expect(UPGRADES).toHaveLength(5)
  })

  it('ids are unique', () => {
    const ids = UPGRADES.map((u) => u.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('upgradeDef returns the right entry', () => {
    const def = upgradeDef('ghwing')
    expect(def.name).toBe('A Bigger Greenhouse')
    expect(def.cost).toBe(2400)
    expect(def.level).toBe(16)
    expect(def.requiresProject).toBe('greenhouse')
  })

  it('upgradeDef throws on unknown id', () => {
    expect(() => upgradeDef('nonexistent' as UpgradeId)).toThrow()
  })

  it('homereno has null requiresProject', () => {
    expect(upgradeDef('homereno').requiresProject).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// upgradeStatus — precedence
// ---------------------------------------------------------------------------

describe('upgradeStatus precedence', () => {
  it("'needs' when the required project is not owned", () => {
    // ghwing needs 'greenhouse' — fresh save has none
    const s = fresh((x) => {
      x.level = 30
      x.coins = 99_999
    })
    const def = upgradeDef('ghwing')
    expect(upgradeStatus(def, s)).toBe('needs')
  })

  it("'level' when project is owned but level is too low", () => {
    const s = fresh((x) => {
      x.projects['greenhouse'] = true
      x.coins = 99_999
      x.level = 10 // below the ghwing gate of 16
    })
    expect(upgradeStatus(upgradeDef('ghwing'), s)).toBe('level')
  })

  it("'coins' when level ok but insufficient funds", () => {
    const s = fresh((x) => {
      x.projects['greenhouse'] = true
      x.level = 20
      x.coins = 100 // far short of 2400
    })
    expect(upgradeStatus(upgradeDef('ghwing'), s)).toBe('coins')
  })

  it("'ok' when project owned, level met, and coins sufficient", () => {
    const s = rich((x) => {
      x.projects['greenhouse'] = true
    })
    expect(upgradeStatus(upgradeDef('ghwing'), s)).toBe('ok')
  })

  it("'owned' beats all other conditions", () => {
    // owns it but has no project and is broke — owned still wins
    const s = fresh()
    giveUpgrade(s, 'ghwing')
    expect(upgradeStatus(upgradeDef('ghwing'), s)).toBe('owned')
  })

  it('homereno (null requiresProject) skips needs gate', () => {
    // fresh save, low level, no project — no 'needs' step possible
    const s = fresh((x) => {
      x.level = 30
      x.coins = 0
    })
    expect(upgradeStatus(upgradeDef('homereno'), s)).toBe('coins')
  })

  it('homereno ok when rich enough', () => {
    const s = rich()
    expect(upgradeStatus(upgradeDef('homereno'), s)).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// availableUpgrades
// ---------------------------------------------------------------------------

describe('availableUpgrades', () => {
  it('is empty on a fresh low-level save', () => {
    expect(availableUpgrades(fresh())).toHaveLength(0)
  })

  it('includes ghwing once greenhouse is owned and level >= 16', () => {
    const s = fresh((x) => {
      x.projects['greenhouse'] = true
      x.level = 16
    })
    const ids = availableUpgrades(s).map((u) => u.id)
    expect(ids).toContain('ghwing')
  })

  it('never includes an upgrade whose required project is unowned', () => {
    // high level, rich, but NO projects
    const s = rich()
    const avail = availableUpgrades(s)
    // only homereno (null requiresProject) can appear; all others need projects
    for (const u of avail) {
      if (u.requiresProject !== null) {
        // this would be a failure — the project is not owned
        expect(s.projects[u.requiresProject]).toBe(true)
      }
    }
  })

  it('homereno appears for a rich high-level save with no projects', () => {
    const s = rich()
    const ids = availableUpgrades(s).map((u) => u.id)
    expect(ids).toContain('homereno')
  })

  it('does not include an already-owned upgrade', () => {
    const s = rich((x) => {
      x.projects['greenhouse'] = true
    })
    giveUpgrade(s, 'ghwing')
    const ids = availableUpgrades(s).map((u) => u.id)
    expect(ids).not.toContain('ghwing')
  })

  it('does not include upgrades below level gate', () => {
    // own ALL projects but keep level at 1
    const s = fresh((x) => {
      x.coins = 99_999
      x.level = 1
      x.projects['greenhouse'] = true
      x.projects['shop'] = true
      x.projects['goats'] = true
      x.projects['horse'] = true
    })
    expect(availableUpgrades(s)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Effect helpers
// ---------------------------------------------------------------------------

describe('greenhouseBeds', () => {
  it('returns 8 without ghwing', () => {
    expect(greenhouseBeds(fresh())).toBe(8)
  })

  it('returns 12 with ghwing', () => {
    const s = fresh()
    giveUpgrade(s, 'ghwing')
    expect(greenhouseBeds(s)).toBe(12)
  })
})

describe('marketPremiumBonus', () => {
  it('returns 0 without market', () => {
    expect(marketPremiumBonus(fresh())).toBe(0)
  })

  it('returns 0.4 with market', () => {
    const s = fresh()
    giveUpgrade(s, 'market')
    expect(marketPremiumBonus(s)).toBeCloseTo(0.4)
  })
})

describe('marketQueueBonus', () => {
  it('returns 0 without market', () => {
    expect(marketQueueBonus(fresh())).toBe(0)
  })

  it('returns 1 with market', () => {
    const s = fresh()
    giveUpgrade(s, 'market')
    expect(marketQueueBonus(s)).toBe(1)
  })
})

describe('pastureSheepBonus', () => {
  it('returns 0 without pasture', () => {
    expect(pastureSheepBonus(fresh())).toBe(0)
  })

  it('returns 2 with pasture', () => {
    const s = fresh()
    giveUpgrade(s, 'pasture')
    expect(pastureSheepBonus(s)).toBe(2)
  })
})

describe('pastureGoatBonus', () => {
  it('returns 0 without pasture', () => {
    expect(pastureGoatBonus(fresh())).toBe(0)
  })

  it('returns 1 with pasture', () => {
    const s = fresh()
    giveUpgrade(s, 'pasture')
    expect(pastureGoatBonus(s)).toBe(1)
  })
})

describe('canRideHazel', () => {
  it('false without tackroom or horse', () => {
    expect(canRideHazel(fresh())).toBe(false)
  })

  it('false with tackroom but no horse project', () => {
    const s = fresh()
    giveUpgrade(s, 'tackroom')
    expect(canRideHazel(s)).toBe(false)
  })

  it('false with horse project but no tackroom upgrade', () => {
    const s = fresh((x) => {
      x.projects['horse'] = true
    })
    expect(canRideHazel(s)).toBe(false)
  })

  it('true with both tackroom upgrade and horse project', () => {
    const s = fresh((x) => {
      x.projects['horse'] = true
    })
    giveUpgrade(s, 'tackroom')
    expect(canRideHazel(s)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Safety: every helper must work when s.upgrades is undefined
// ---------------------------------------------------------------------------

describe('undefined s.upgrades safety', () => {
  it('hasUpgrade returns false', () => {
    const s = noUpgrades(fresh())
    expect(hasUpgrade(s, 'ghwing')).toBe(false)
  })

  it('upgradeStatus works (no throw)', () => {
    const s = noUpgrades(rich((x) => { x.projects['greenhouse'] = true }))
    expect(() => upgradeStatus(upgradeDef('ghwing'), s)).not.toThrow()
  })

  it('availableUpgrades works (no throw)', () => {
    const s = noUpgrades(rich())
    expect(() => availableUpgrades(s)).not.toThrow()
  })

  it('greenhouseBeds is 8', () => {
    expect(greenhouseBeds(noUpgrades(fresh()))).toBe(8)
  })

  it('marketPremiumBonus is 0', () => {
    expect(marketPremiumBonus(noUpgrades(fresh()))).toBe(0)
  })

  it('marketQueueBonus is 0', () => {
    expect(marketQueueBonus(noUpgrades(fresh()))).toBe(0)
  })

  it('pastureSheepBonus is 0', () => {
    expect(pastureSheepBonus(noUpgrades(fresh()))).toBe(0)
  })

  it('pastureGoatBonus is 0', () => {
    expect(pastureGoatBonus(noUpgrades(fresh()))).toBe(0)
  })

  it('canRideHazel is false', () => {
    expect(canRideHazel(noUpgrades(fresh()))).toBe(false)
  })
})
