/** Celestial layer for the sleep cutscene — a starfield and a crescent moon
 * that live just inside the 240u sky dome and fade in/out on one scalar.
 * Design intent (owner ask: 'absolutely premium... emotionally satisfying'):
 * when the farm tucks in, the dome goes dark and ~700 stars bloom with a
 * soft Milky Way band sweeping high across the sky, the crescent hanging at
 * a fixed lovely spot in the high south-east. The cutscene only feeds set(k)
 * linearly — all easing, twinkle and per-star character live in here.
 * Performance: ONE Points draw call + one sprite, zero per-frame allocations;
 * twinkle runs entirely in the vertex shader off uTime, and the master fade
 * is a single uNight uniform — colors are never rebuilt on the CPU. At k<0.01
 * both objects flip visible=false so the day pays nothing for the night. */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Points,
  PointsMaterial,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { mulberry32 } from '../game/rng'

const DEG = Math.PI / 180
/** star shell radius — inside the 240u dome, outside everything else */
const SKY_R = 158
const STAR_COUNT = 700
/** uniform field / Milky Way band split (band rejection-samples the rest) */
const FIELD_COUNT = 480
/** stars never spawn below this elevation — keeps them off the fog line */
const MIN_ELEV_SIN = Math.sin(12 * DEG)
/** half-width of the Milky Way band around its great-circle plane */
const BAND_SIN = Math.sin(12 * DEG)
/** how many oversized 'hero' stars anchor the field */
const HERO_COUNT = 9
/** moon: high in the south-east (daycycle azimuth convention: 90=east, 0=south) */
const MOON_AZ = 47 * DEG
const MOON_ELEV = 50 * DEG
const MOON_DIST = 150
/** sprite span chosen so the painted disc itself reads ~9 world units */
const MOON_SPAN = 16

/** Milky Way great-circle plane normal — small y so the band arcs near the
 * zenith; tuned so the moon sits just off the band's bright edge */
const BAND_NORMAL = new Vector3(0.78, 0.16, -0.61).normalize()

/** paint the crescent on a small canvas: bright disc, soft dark bite erased
 * out of it, then a wide glow composited BEHIND so the bite stays clean */
function paintMoon(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const ctx = c.getContext('2d')!
  const cx = 64
  const cy = 64
  const r = 36
  // full disc — faintly warmer toward the limb, like real moonlight
  const disc = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r)
  disc.addColorStop(0, '#fffdf4')
  disc.addColorStop(0.82, '#fff3d6')
  disc.addColorStop(1, '#f6e7c2')
  ctx.fillStyle = disc
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  // dark inner bite — offset toward the upper-left, soft-edged so the
  // terminator glows instead of cutting; erases only the disc
  const bx = cx - r * 0.52
  const by = cy - r * 0.3
  const bite = ctx.createRadialGradient(bx, by, r * 0.55, bx, by, r * 0.98)
  bite.addColorStop(0, 'rgba(0,0,0,1)')
  bite.addColorStop(0.78, 'rgba(0,0,0,1)')
  bite.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = bite
  ctx.beginPath()
  ctx.arc(bx, by, r * 0.98, 0, Math.PI * 2)
  ctx.fill()
  // wide soft halo painted underneath everything (additive blend at render
  // time turns this into the gentle sky-glow around the crescent)
  ctx.globalCompositeOperation = 'destination-over'
  const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, 63)
  glow.addColorStop(0, 'rgba(255,242,208,0.5)')
  glow.addColorStop(0.4, 'rgba(255,238,198,0.16)')
  glow.addColorStop(1, 'rgba(255,238,198,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 128, 128)
  ctx.globalCompositeOperation = 'source-over'
  return c
}

/** scratch for star placement — module-level so generation never allocates */
const tmpV = new Vector3()

/** one uniform draw from the spherical cap above MIN_ELEV (writes tmpV) */
function capSample(next: () => number): Vector3 {
  const y = MIN_ELEV_SIN + (1 - MIN_ELEV_SIN) * next()
  const ring = Math.sqrt(Math.max(0, 1 - y * y))
  const th = next() * Math.PI * 2
  return tmpV.set(Math.cos(th) * ring, y, Math.sin(th) * ring)
}

export class NightSky {
  private readonly stars: Points
  private readonly moon: Sprite
  private readonly moonMat: SpriteMaterial
  /** shared with the injected shader — writing .value is the whole API */
  private readonly uTime = { value: 0 }
  private readonly uNight = { value: 0 }

  constructor(scene: Scene) {
    this.stars = this.buildStars()
    scene.add(this.stars)

    const tex = new CanvasTexture(paintMoon())
    tex.colorSpace = SRGBColorSpace
    this.moonMat = new SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    })
    this.moon = new Sprite(this.moonMat)
    const cosE = Math.cos(MOON_ELEV)
    this.moon.position.set(
      Math.sin(MOON_AZ) * cosE * MOON_DIST,
      Math.sin(MOON_ELEV) * MOON_DIST,
      Math.cos(MOON_AZ) * cosE * MOON_DIST,
    )
    this.moon.scale.setScalar(MOON_SPAN)
    this.moon.visible = false
    scene.add(this.moon)
  }

  /** 0 = invisible (day) .. 1 = full night splendor; fed linearly by the
   * cutscene every frame — smoothstepped here, moon leading slightly so the
   * crescent greets you before the faintest stars resolve */
  set(k: number): void {
    const c = Math.min(1, Math.max(0, k))
    const e = c * c * (3 - 2 * c)
    this.uNight.value = e
    this.moonMat.opacity = Math.pow(e, 0.8)
    const on = c >= 0.01
    this.stars.visible = on
    this.moon.visible = on
  }

  /** time for twinkle (engine seconds) — the only per-frame cost is one
   * uniform write; the wobble itself runs on the GPU */
  update(t: number): void {
    this.uTime.value = t
  }

  /** ~700 stars as ONE Points cloud: uniform field above 12 degrees plus a
   * denser, slightly brighter band within ~12 degrees of a great circle (a
   * simple Milky Way). Sizes 0.6-2.2 with a few ~3 heroes; blue-white to
   * warm-white vertex colors. Deterministic via mulberry32. */
  private buildStars(): Points {
    const rng = mulberry32(0xc0ffee)
    const next = (): number => rng.next()
    const pos = new Float32Array(STAR_COUNT * 3)
    const col = new Float32Array(STAR_COUNT * 3)
    const size = new Float32Array(STAR_COUNT)

    let guard = STAR_COUNT * 400
    for (let i = 0; i < STAR_COUNT; i++) {
      const inBand = i >= FIELD_COUNT
      let p = capSample(next)
      if (inBand) {
        // rejection-sample into the band; shrinking the acceptance width by
        // a random factor piles density toward the band's center line
        let w = BAND_SIN * (0.35 + 0.65 * next())
        while (Math.abs(p.dot(BAND_NORMAL)) > w && guard-- > 0) {
          p = capSample(next)
          w = BAND_SIN * (0.35 + 0.65 * next())
        }
      }
      pos[i * 3] = p.x * SKY_R
      pos[i * 3 + 1] = p.y * SKY_R
      pos[i * 3 + 2] = p.z * SKY_R

      const hero = i < HERO_COUNT
      // heroes blaze, band stars run a touch brighter than the open field
      const bright = hero ? 1 : (0.5 + 0.5 * next()) * (inBand ? 1.12 : 1)
      const t = next()
      let r = 1
      let g = 1
      let b = 1
      if (t < 0.42) {
        // blue-white
        r = 0.76 + 0.14 * next()
        g = 0.84 + 0.1 * next()
      } else if (t > 0.78) {
        // warm-white
        g = 0.88 + 0.07 * next()
        b = 0.72 + 0.16 * next()
      }
      const v = Math.min(1, bright)
      col[i * 3] = r * v
      col[i * 3 + 1] = g * v
      col[i * 3 + 2] = b * v
      // squared roll skews small so the heavens read dusted, not gravelly
      const s = next()
      size[i] = hero ? 2.9 + 0.4 * next() : 0.6 + 1.6 * s * s
    }

    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    geo.setAttribute('color', new BufferAttribute(col, 3))
    geo.setAttribute('aSize', new BufferAttribute(size, 1))

    const mat = new PointsMaterial({
      size: 1,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    })
    const uTime = this.uTime
    const uNight = this.uNight
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime
      shader.uniforms.uNight = uNight
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          [
            '#include <common>',
            'uniform float uTime;',
            'uniform float uNight;',
            'attribute float aSize;',
            'varying float vFade;',
          ].join('\n'),
        )
        .replace(
          'gl_PointSize = size;',
          // per-star phase + rate hashed from position: each star wobbles
          // +-25% somewhere in 0.5-1.5Hz, with a whisper of size shimmer
          `float tw1 = fract(sin(dot(position, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float tw2 = fract(sin(dot(position, vec3(26.651, 11.633, 53.731))) * 24634.6345);
          float twk = sin(uTime * mix(3.14159, 9.42478, tw2) + tw1 * 6.28318);
          vFade = uNight * (1.0 + 0.25 * twk);
          gl_PointSize = size * aSize * (1.0 + 0.06 * twk);`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;')
        .replace(
          '#include <color_fragment>',
          // round the square point into a soft-edged glow disc
          `#include <color_fragment>
          float nsD = length(gl_PointCoord - 0.5) * 2.0;
          diffuseColor.a *= vFade * smoothstep(1.0, 0.3, nsD);`,
        )
    }

    const stars = new Points(geo, mat)
    // the shell always surrounds the camera when visible — skip the
    // per-frame bounding-sphere frustum test; set(k) handles culling
    stars.frustumCulled = false
    stars.visible = false
    return stars
  }
}
