/** Procedural canvas textures — every surface gets real texel detail.
 * HARD RULE (owner): no flat-color "blob" look anywhere. Grass blades, bark,
 * leafy foliage, tilled soil and plank wood are all painted here at boot —
 * no network fetches, fully deterministic via the seeded rng. */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'
import type { Rng } from '../game/rng'

export function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { c, g: c.getContext('2d')! }
}

export function toTexture(c: HTMLCanvasElement, repeat = false): CanvasTexture {
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  if (repeat) {
    t.wrapS = RepeatWrapping
    t.wrapT = RepeatWrapping
  }
  return t
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** Neutral-luminance grass grain: short blade strokes + speckle around a
 * mid gray, tiled ~40x across the ground and blended in the shader as
 * `rgb *= 0.72 + 0.56 * detail`. Up close the lawn reads as thousands of
 * crisp blades instead of a blurry painted wash; at distance it averages
 * out to no tint at all. Drawn with x/y wrap offsets so it tiles seamlessly. */
export function groundDetailCanvas(rng: Rng): HTMLCanvasElement {
  const S = 256
  const { c, g } = makeCanvas(S, S)
  g.fillStyle = '#7f7f7f'
  g.fillRect(0, 0, S, S)
  const wrap: Array<[number, number]> = [[0, 0], [-S, 0], [S, 0], [0, -S], [0, S]]
  for (let i = 0; i < 900; i++) {
    const x = rng.next() * S
    const y = rng.next() * S
    const len = 3 + rng.next() * 7
    const lean = (rng.next() - 0.5) * 4
    const tone = rng.next()
    g.strokeStyle = tone > 0.62 ? '#9a9a9a' : tone > 0.3 ? '#646464' : '#8c8c8c'
    g.globalAlpha = 0.5 + rng.next() * 0.4
    g.lineWidth = 1 + rng.next() * 0.8
    for (const [ox, oy] of wrap) {
      g.beginPath()
      g.moveTo(x + ox, y + oy)
      g.lineTo(x + ox + lean, y + oy - len)
      g.stroke()
    }
  }
  // soft mottling so the grain has patches, not uniform noise
  for (let i = 0; i < 26; i++) {
    const x = rng.next() * S
    const y = rng.next() * S
    const r = 14 + rng.next() * 30
    g.fillStyle = rng.next() > 0.5 ? '#8a8a8a' : '#737373'
    g.globalAlpha = 0.18
    for (const [ox, oy] of wrap) {
      g.beginPath()
      g.arc(x + ox, y + oy, r, 0, Math.PI * 2)
      g.fill()
    }
  }
  g.globalAlpha = 1
  return c
}

// ---- bark (tiling, wraps a cylinder trunk) ----------------------------------

export function barkCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 256)
  g.fillStyle = '#6b4f33'
  g.fillRect(0, 0, 128, 256)
  // vertical fiber streaks — drawn thrice (x, x±128) so the seam tiles
  for (let i = 0; i < 260; i++) {
    const x = rng.next() * 128
    const y = rng.next() * 256 - 30
    const len = 20 + rng.next() * 70
    const tone = rng.next()
    g.strokeStyle = tone > 0.62 ? '#7d6040' : tone > 0.28 ? '#5d432a' : '#49341f'
    g.globalAlpha = 0.22 + rng.next() * 0.38
    g.lineWidth = 1 + rng.next() * 2.6
    const wob = (rng.next() - 0.5) * 9
    const ex = (rng.next() - 0.5) * 7
    for (const ox of [-128, 0, 128]) {
      g.beginPath()
      g.moveTo(x + ox, y)
      g.quadraticCurveTo(x + ox + wob, y + len / 2, x + ox + ex, y + len)
      g.stroke()
    }
  }
  // knots
  for (let i = 0; i < 5; i++) {
    const x = 14 + rng.next() * 100
    const y = 14 + rng.next() * 228
    const r = 3.5 + rng.next() * 5
    g.globalAlpha = 0.5
    g.fillStyle = '#43301c'
    g.beginPath()
    g.ellipse(x, y, r * 0.7, r, rng.next(), 0, Math.PI * 2)
    g.fill()
    g.globalAlpha = 0.35
    g.strokeStyle = '#7d6040'
    g.lineWidth = 1.6
    g.beginPath()
    g.ellipse(x, y, r * 1.05, r * 1.45, rng.next(), 0, Math.PI * 2)
    g.stroke()
  }
  g.globalAlpha = 1
  return c
}

// ---- leafy foliage cluster (alpha cutout card) -------------------------------

/** Hundreds of overlapping leaf ellipses clumped into an organic mass with a
 * ragged silhouette. Light comes from the top-right; `hueShift` (-1..1) gives
 * each tree species/individual its own cast. */
export function foliageCanvas(rng: Rng, hueShift = 0): HTMLCanvasElement {
  const { c, g } = makeCanvas(256, 256)
  const leaf = (x: number, y: number, s: number, lightK: number): void => {
    const hue = 96 + hueShift * 26 + (rng.next() - 0.5) * 14
    const sat = 38 + rng.next() * 18
    const lit = 22 + clamp01(lightK) * 32
    g.fillStyle = `hsl(${hue},${sat}%,${lit}%)`
    g.save()
    g.translate(x, y)
    g.rotate(rng.next() * Math.PI * 2)
    g.beginPath()
    g.ellipse(0, 0, s, s * (0.55 + rng.next() * 0.4), 0, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
  for (let i = 0; i < 380; i++) {
    const a = rng.next() * Math.PI * 2
    const r = Math.pow(rng.next(), 0.6) * 106
    const x = 128 + Math.cos(a) * r
    const y = 128 + Math.sin(a) * r * 0.94
    const lightK = 0.5 + (x - 128) / 290 - (y - 128) / 250 + (rng.next() - 0.5) * 0.34
    leaf(x, y, 4.5 + rng.next() * 6.5, lightK)
  }
  // bright top-right rim catches the sun
  for (let i = 0; i < 60; i++) {
    const a = -0.9 + rng.next() * 1.6
    const r = 62 + rng.next() * 46
    leaf(128 + Math.cos(a) * r, 128 + Math.sin(a) * r * 0.9 - 14, 3.5 + rng.next() * 4.5, 0.85 + rng.next() * 0.3)
  }
  return c
}

// ---- pine needles (tiling, wraps cones) --------------------------------------

export function needleCanvas(rng: Rng): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 128)
  g.fillStyle = '#33582f'
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 420; i++) {
    const x = rng.next() * 128
    const y = rng.next() * 128
    const tone = rng.next()
    g.strokeStyle = tone > 0.6 ? '#4a7a40' : tone > 0.3 ? '#2a4d26' : '#5d8f4b'
    g.globalAlpha = 0.3 + rng.next() * 0.4
    g.lineWidth = 1 + rng.next()
    const dx = (rng.next() - 0.5) * 5
    const dy = 5 + rng.next() * 9
    for (const [ox, oy] of [[0, 0], [-128, 0], [128, 0], [0, -128], [0, 128]]) {
      g.beginPath()
      g.moveTo(x + ox, y + oy)
      g.lineTo(x + ox + dx, y + oy + dy)
      g.stroke()
    }
  }
  g.globalAlpha = 1
  return c
}

// ---- plank wood (tiling) ------------------------------------------------------

export function woodCanvas(rng: Rng, base = '#8a6a42'): HTMLCanvasElement {
  const { c, g } = makeCanvas(128, 128)
  g.fillStyle = base
  g.fillRect(0, 0, 128, 128)
  // four planks with grain
  for (let p = 0; p < 4; p++) {
    const y0 = p * 32
    g.strokeStyle = 'rgba(60,40,18,0.55)'
    g.lineWidth = 1.6
    g.beginPath()
    g.moveTo(0, y0 + 0.5)
    g.lineTo(128, y0 + 0.5)
    g.stroke()
    for (let i = 0; i < 26; i++) {
      const gy = y0 + 4 + rng.next() * 25
      const x = rng.next() * 128
      const len = 14 + rng.next() * 50
      const tone = rng.next()
      g.strokeStyle = tone > 0.55 ? 'rgba(120,90,52,0.5)' : 'rgba(80,56,28,0.45)'
      g.lineWidth = 0.8 + rng.next() * 1.1
      for (const ox of [-128, 0, 128]) {
        g.beginPath()
        g.moveTo(x + ox, gy)
        g.quadraticCurveTo(x + ox + len / 2, gy + (rng.next() - 0.5) * 3, x + ox + len, gy)
        g.stroke()
      }
    }
    // a knot per plank or so
    if (rng.next() > 0.4) {
      const x = 10 + rng.next() * 108
      const y = y0 + 8 + rng.next() * 16
      g.fillStyle = 'rgba(70,48,24,0.7)'
      g.beginPath()
      g.ellipse(x, y, 2.5 + rng.next() * 2, 1.6 + rng.next() * 1.4, 0, 0, Math.PI * 2)
      g.fill()
    }
  }
  return c
}
