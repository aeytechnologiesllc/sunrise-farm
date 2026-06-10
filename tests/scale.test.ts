/** PHASE 1 contract: one SCALE table, every view spawns inside it.
 * The owner's screenshot diagnosis (dog ≈ human, hen ≈ human) can never
 * regress silently — these tests sweep the exact seeded sizing code the
 * views run at spawn time. */
import { describe, expect, it } from 'vitest'
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { mulberry32 } from '../src/game/rng'
import { buildHen } from '../src/world/Chicken'
import { FARMER_HEIGHT } from '../src/world/Player'
import {
  customerHeightFor,
  DOG_SHOULDER_OF_HEIGHT,
  dogScaleForHeight,
  henScaleFor,
  measuredHeight,
  normalizeHeight,
  SCALE,
} from '../src/world/scale'

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 1)

describe('the SCALE table matches the owner spec', () => {
  it('farmer is the 1.6u reference', () => {
    expect(SCALE.farmer).toBe(1.6)
    expect(FARMER_HEIGHT).toBe(SCALE.farmer) // the view imports the table
  })

  it('customers are farmer ±10%', () => {
    expect(SCALE.customer.min).toBeCloseTo(1.6 * 0.9, 10)
    expect(SCALE.customer.max).toBeCloseTo(1.6 * 1.1, 10)
  })

  it('dog shoulder is 0.45u (knee height), hen is 0.28u (shin height)', () => {
    expect(SCALE.dogShoulder).toBe(0.45)
    expect(SCALE.hen.target).toBe(0.28)
    expect(SCALE.chick).toBeLessThan(SCALE.hen.min) // babies smaller still
  })

  it('the ladder is strictly ordered: farmer > customer floor > dog > hen > chick', () => {
    expect(SCALE.customer.max).toBeLessThanOrEqual(SCALE.farmer * 1.1)
    expect(SCALE.customer.min).toBeGreaterThan(SCALE.dogShoulder)
    expect(SCALE.dog.min).toBeGreaterThan(SCALE.hen.max)
    expect(SCALE.hen.min).toBeGreaterThan(SCALE.chick)
  })
})

describe('every view spawns inside its band', () => {
  it('customer seeded heights stay in farmer ±10% — and actually vary', () => {
    const heights = SEEDS.map((s) => customerHeightFor(mulberry32(s)))
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(SCALE.customer.min)
      expect(h).toBeLessThanOrEqual(SCALE.customer.max)
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.2)
  })

  it('the procedural hen sculpt lands in the 0.28u band for every seed', () => {
    const { group } = buildHen()
    const built = new Box3().setFromObject(group).getSize(new Vector3()).y
    expect(built).toBeGreaterThan(0.5) // sanity: the sculpt is ~1u tall raw
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      rng.next() // the view draws hue + lightness before size — same order
      rng.next()
      const world = built * henScaleFor(rng, built)
      expect(world).toBeGreaterThanOrEqual(SCALE.hen.min - 1e-9)
      expect(world).toBeLessThanOrEqual(SCALE.hen.max + 1e-9)
    }
  })

  it('dog normalization puts the shoulder at 0.45u for any source model size', () => {
    for (const rawHeight of [1.5, 2.0, 3.07, 4.2]) {
      const s = dogScaleForHeight(rawHeight)
      expect(rawHeight * DOG_SHOULDER_OF_HEIGHT * s).toBeCloseTo(SCALE.dogShoulder, 10)
    }
    // the view's ±3% seeded variety stays inside the dog band
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const s = dogScaleForHeight(3.07) * (0.97 + rng.next() * 0.06)
      const shoulder = 3.07 * DOG_SHOULDER_OF_HEIGHT * s
      expect(shoulder).toBeGreaterThanOrEqual(SCALE.dog.min - 1e-9)
      expect(shoulder).toBeLessThanOrEqual(SCALE.dog.max + 1e-9)
    }
  })

  it('normalizeHeight hits the target exactly (farmer/customer spawn path)', () => {
    for (const target of [SCALE.farmer, SCALE.customer.min, SCALE.customer.max]) {
      const model = new Group()
      const mesh = new Mesh(new BoxGeometry(0.6, 2.43, 0.4), new MeshStandardMaterial())
      mesh.position.y = 2.43 / 2
      model.add(mesh)
      normalizeHeight(model, target)
      expect(measuredHeight(model)).toBeCloseTo(target, 6)
    }
  })
})
