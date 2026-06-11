/** Homestead evening dressing for the red barn — the farmer's home.
 * Design intent (owner: 'absolutely premium... emotionally satisfying'): at
 * dusk the windows wake with warm lamplight behind curtains, amber light
 * spills out of the doorway onto the dirt, and a thin wisp of supper-smoke
 * curls from the chimney — the unmistakable read of "family is home".
 * Everything lives in the barn's local frame inside one Group placed exactly
 * like buildBarn() in scenery.ts (BARN_POS + rotation.y 0.55), so window
 * quads sit flush on the painted walls. Budget: ONE PointLight, one merged
 * window mesh, two additive planes, four tiny smoke spheres — all glow
 * geometry fully hidden during the day. Zero allocations in update(). */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../game/rng'
import { BARN_POS } from './scenery'
import { makeCanvas, toTexture } from './textures'

/** must match buildBarn() in scenery.ts — group rot + body dimensions */
const BARN_ROT = 0.55
const W = 5.2
const D = 4.2
const H = 2.6
/** wall-glow planes float this far outside the wall to dodge z-fighting */
const INSET = 0.06
/** chimney mouth in barn-local coords — where the smoke wisp is born */
const SMOKE_X = 0
const SMOKE_Y = 4.9
const SMOKE_Z = -1.2
const UP = new Vector3(0, 1, 0)

/** lamplit window seen from outside: warm radial glow (brightest low-center,
 * where the lamp would sit), pale curtain drapes pulled to each side, and a
 * dark painted cross-frame so it reads as a real window, not a sticker */
function windowCanvas(): HTMLCanvasElement {
  const { c, g } = makeCanvas(96, 120)
  const glow = g.createRadialGradient(48, 76, 6, 48, 70, 84)
  glow.addColorStop(0, '#ffeec6')
  glow.addColorStop(0.45, '#f7b35a')
  glow.addColorStop(1, '#b96a20')
  g.fillStyle = glow
  g.fillRect(0, 0, 96, 120)
  // curtain hints: translucent drapes narrowing toward the sill + a valance
  g.fillStyle = 'rgba(255, 240, 214, 0.42)'
  g.beginPath()
  g.moveTo(6, 6)
  g.lineTo(30, 6)
  g.quadraticCurveTo(20, 64, 13, 114)
  g.lineTo(6, 114)
  g.closePath()
  g.fill()
  g.beginPath()
  g.moveTo(90, 6)
  g.lineTo(66, 6)
  g.quadraticCurveTo(76, 64, 83, 114)
  g.lineTo(90, 114)
  g.closePath()
  g.fill()
  g.fillStyle = 'rgba(255, 240, 214, 0.3)'
  g.fillRect(6, 6, 84, 12)
  // cross-frame painted dark over the glow
  g.fillStyle = '#33261b'
  g.fillRect(0, 0, 96, 7)
  g.fillRect(0, 113, 96, 7)
  g.fillRect(0, 0, 7, 120)
  g.fillRect(89, 0, 7, 120)
  g.fillRect(45, 0, 6, 120)
  g.fillRect(0, 55, 96, 6)
  return c
}

/** doorway spill, vertical: amber rising from the threshold and fading out,
 * masked to a soft horizontal falloff so the additive quad has no hard edges */
function doorGlowCanvas(): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 128)
  const v = g.createLinearGradient(0, 0, 0, 128)
  v.addColorStop(0, 'rgba(255, 196, 128, 0)')
  v.addColorStop(0.5, 'rgba(255, 180, 106, 0.4)')
  v.addColorStop(1, 'rgba(255, 172, 92, 0.9)')
  g.fillStyle = v
  g.fillRect(0, 0, 64, 128)
  const mask = g.createLinearGradient(0, 0, 64, 0)
  mask.addColorStop(0, 'rgba(0, 0, 0, 0)')
  mask.addColorStop(0.3, 'rgba(0, 0, 0, 1)')
  mask.addColorStop(0.7, 'rgba(0, 0, 0, 1)')
  mask.addColorStop(1, 'rgba(0, 0, 0, 0)')
  g.globalCompositeOperation = 'destination-in'
  g.fillStyle = mask
  g.fillRect(0, 0, 64, 128)
  return c
}

/** pool of lamplight on the dirt outside the door — brightest at the
 * threshold (canvas top maps toward the barn after the plane's -90° rotX) */
function spillCanvas(): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  const r = g.createRadialGradient(32, 10, 2, 32, 14, 52)
  r.addColorStop(0, 'rgba(255, 190, 120, 0.8)')
  r.addColorStop(0.5, 'rgba(255, 176, 100, 0.32)')
  r.addColorStop(1, 'rgba(255, 170, 90, 0)')
  g.fillStyle = r
  g.fillRect(0, 0, 64, 64)
  return c
}

interface Puff {
  mesh: Mesh
  mat: MeshBasicMaterial
  /** loop position 0..1: born at the chimney mouth, gone by 1 */
  t: number
  /** 1 / loop duration in seconds */
  speed: number
  sway: number
  driftX: number
  driftZ: number
}

export class Homestead {
  private readonly root = new Group()
  /** everything that only exists at dusk — windows, door glow, spill, light */
  private readonly glow = new Group()
  private readonly smoke = new Group()
  private readonly light: PointLight
  private readonly windowMat: MeshBasicMaterial
  private readonly doorGlowMat: MeshBasicMaterial
  private readonly spillMat: MeshBasicMaterial
  private readonly puffs: Puff[] = []
  private readonly _doorPos: Vector3
  private readonly _thresholdPos: Vector3
  private k = 0
  private time = 0
  private windowBase = 0
  private lightBase = 0

  constructor(scene: Scene) {
    this.root.position.copy(BARN_POS)
    this.root.rotation.y = BARN_ROT
    scene.add(this.root)

    // ---- chimney (always there — homes have chimneys in daylight too) ----
    const stack = new BoxGeometry(0.36, 1.3, 0.36)
    stack.translate(SMOKE_X, 4.15, SMOKE_Z)
    const cap = new BoxGeometry(0.46, 0.1, 0.46)
    cap.translate(SMOKE_X, 4.84, SMOKE_Z)
    const chimneyGeo = mergeGeometries([stack, cap])
    if (chimneyGeo) {
      const chimney = new Mesh(chimneyGeo, new MeshStandardMaterial({ color: '#4a423c', roughness: 0.92 }))
      chimney.castShadow = true
      this.root.add(chimney)
    }

    // ---- window glow: five quads flanking door + sides + loft, one mesh ----
    this.windowMat = new MeshBasicMaterial({
      map: toTexture(windowCanvas()),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const quads: BufferGeometry[] = []
    for (const x of [-1.7, 1.7]) {
      const q = new PlaneGeometry(0.7, 0.85)
      q.translate(x, 1.5, D / 2 + INSET)
      quads.push(q)
    }
    const sideL = new PlaneGeometry(0.7, 0.85)
    sideL.rotateY(-Math.PI / 2)
    sideL.translate(-(W / 2 + INSET), 1.5, 0.4)
    quads.push(sideL)
    const sideR = new PlaneGeometry(0.7, 0.85)
    sideR.rotateY(Math.PI / 2)
    sideR.translate(W / 2 + INSET, 1.5, 0.4)
    quads.push(sideR)
    // loft overlay sits a hair past the trim panel (its face is at D/2+0.06)
    const loft = new PlaneGeometry(0.82, 0.82)
    loft.translate(0, H + 0.55, D / 2 + 0.075)
    quads.push(loft)
    const windowGeo = mergeGeometries(quads)
    if (windowGeo) {
      const windows = new Mesh(windowGeo, this.windowMat)
      windows.renderOrder = 1
      this.glow.add(windows)
    }

    // ---- doorway: vertical gradient sheet + pooled light on the ground ----
    this.doorGlowMat = new MeshBasicMaterial({
      map: toTexture(doorGlowCanvas()),
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    })
    const doorGlow = new PlaneGeometry(1.5, 2.0)
    doorGlow.translate(0, 1.0, D / 2 + 0.17)
    const doorGlowMesh = new Mesh(doorGlow, this.doorGlowMat)
    doorGlowMesh.renderOrder = 2
    this.glow.add(doorGlowMesh)

    this.spillMat = new MeshBasicMaterial({
      map: toTexture(spillCanvas()),
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    })
    const spill = new PlaneGeometry(2.4, 2.8)
    spill.rotateX(-Math.PI / 2)
    spill.translate(0, 0.02, D / 2 + 1.5)
    const spillMesh = new Mesh(spill, this.spillMat)
    spillMesh.renderOrder = 2
    this.glow.add(spillMesh)

    // the ONE warm light — no shadows, tight falloff (mobile budget)
    this.light = new PointLight('#ffb46a', 0, 7, 2)
    this.light.position.set(0, 1.05, D / 2 + 0.5)
    this.glow.add(this.light)

    this.glow.visible = false
    this.root.add(this.glow)

    // ---- supper smoke: four looping puffs, staggered up the wisp ----------
    const rng = mulberry32(6061)
    for (let i = 0; i < 4; i++) {
      const mat = new MeshBasicMaterial({ color: '#9c968e', transparent: true, opacity: 0, depthWrite: false })
      const mesh = new Mesh(new SphereGeometry(0.085 + i * 0.012, 8, 6), mat)
      this.smoke.add(mesh)
      this.puffs.push({
        mesh,
        mat,
        t: (i + rng.next() * 0.6) / 4,
        speed: 1 / (2.6 + rng.next() * 0.8),
        sway: rng.next() * Math.PI * 2,
        driftX: (rng.next() - 0.5) * 0.5,
        driftZ: (rng.next() - 0.5) * 0.3,
      })
    }
    this.smoke.visible = false
    this.root.add(this.smoke)

    // door points, computed in world space (barn local +z, rotated + offset)
    const toWorld = (x: number, y: number, z: number): Vector3 =>
      new Vector3(x, y, z).applyAxisAngle(UP, BARN_ROT).add(BARN_POS)
    this._doorPos = toWorld(0, 0, D / 2 + 1.1)
    this._thresholdPos = toWorld(0, 0, D / 2 - 0.15)
  }

  /** 0 = day (no glow) .. 1 = full cozy evening */
  setEvening(k: number): void {
    this.k = Math.min(1, Math.max(0, k))
    // smoothstep so the lamps wake gently instead of snapping on
    const e = this.k * this.k * (3 - 2 * this.k)
    this.windowBase = 0.95 * e
    this.windowMat.opacity = this.windowBase
    this.doorGlowMat.opacity = 0.5 * this.k
    this.spillMat.opacity = 0.38 * e
    this.lightBase = 2.2 * this.k
    this.light.intensity = this.lightBase
    this.glow.visible = this.k >= 0.01
    this.smoke.visible = this.k > 0.2
  }

  /** smoke drift + lamplight flicker — call once per frame */
  update(dt: number): void {
    if (!this.glow.visible) return
    this.time += dt
    // candle-ish flicker: two incommensurate sines, ±4% — alive, never strobing
    const n = Math.sin(this.time * 7.7) * 0.6 + Math.sin(this.time * 2.9 + 1.7) * 0.4
    this.windowMat.opacity = this.windowBase * (1 + 0.04 * n)
    this.light.intensity = this.lightBase * (1 + 0.05 * n)
    if (!this.smoke.visible) return
    const smokeK = Math.min(1, (this.k - 0.2) / 0.3)
    for (const p of this.puffs) {
      p.t += dt * p.speed
      if (p.t >= 1) p.t -= 1
      const t = p.t
      p.mesh.position.set(
        SMOKE_X + p.driftX * t + Math.sin(this.time * 1.6 + p.sway) * 0.05 * t,
        SMOKE_Y + t * 1.5,
        SMOKE_Z + p.driftZ * t,
      )
      p.mesh.scale.setScalar(0.55 + 1.5 * t)
      // fade in fast off the chimney mouth, thin out as the wisp rises
      p.mat.opacity = 0.42 * smokeK * (1 - t) * Math.min(1, t * 6)
    }
  }

  /** world-space point just OUTSIDE the door (the farmer walks here) */
  get doorPos(): Vector3 {
    return this._doorPos.clone()
  }

  /** world-space point at the doorway threshold (where he 'steps inside') */
  get thresholdPos(): Vector3 {
    return this._thresholdPos.clone()
  }
}
