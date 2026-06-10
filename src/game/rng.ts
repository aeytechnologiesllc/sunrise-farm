/** Seeded RNG (mulberry32). State is a single uint32 so it round-trips
 * through the save file — golden rolls stay deterministic across reloads. */
export interface Rng {
  next(): number
  state(): number
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
    state(): number {
      return a
    },
  }
}
