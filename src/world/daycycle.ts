/** Looping day cycle — dawn > morning > noon > golden hour > dusk > dawn.
 * Drives every light, the sky dome's vertex gradient, fog, background and a
 * visible sun disk so god rays have a real source. Design intent (owner ask:
 * 'a ray of sunlight or a real sun setting'): GOLDEN HOUR is the showpiece —
 * the sun drops long and low in the west, everything goes amber, the fill
 * light swells so characters rim warm; dusk is a brief rosy-lavender beat,
 * then the sun glides along the horizon back to the eastern dawn. There is NO
 * dark night — elevation never dips below ~8 degrees, so shadows stay valid
 * and the farm stays readable at every phase.
 * All motion is a keyframe table over phase in [0,1] with smoothstep easing
 * between adjacent keys; every interpolation writes into preallocated scratch
 * (zero allocations in update). Deterministic: phase is pure accumulated dt. */
import {
  AmbientLight,
  BufferAttribute,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector3,
} from 'three'

/** everything the cycle animates — created by scenery/main, handed in once */
export interface SkyHandles {
  /** shadow-casting key light; we move .position on a ~27u orbit so the
   * pre-configured shadow camera keeps covering the farm */
  sun: DirectionalLight
  /** warm rim fill, no shadows — kept opposite the sun's azimuth */
  fill: DirectionalLight
  hemi: HemisphereLight
  ambient: AmbientLight
  /** SphereGeometry(240, 24, 10) with a 'color' BufferAttribute and
   * MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false }) */
  dome: Mesh
  /** MeshBasicMaterial sphere floated at sunDirection * 150, inside the dome */
  sunDisk: Mesh
  /** scene.fog must be a THREE.Fog, scene.background a THREE.Color */
  scene: Scene
}

const DEG = Math.PI / 180
// the starlit palette setNight() pulls toward (preallocated, never mutated)
const NIGHT_SUN = new Color('#9db8ff')
const NIGHT_HEMI_SKY = new Color('#1c2b4d')
const NIGHT_HEMI_GROUND = new Color('#101820')
const NIGHT_AMBIENT = new Color('#25304a')
const NIGHT_FOG = new Color('#0e1626')
const NIGHT_BG = new Color('#0b1322')
const NIGHT_DOME_H = new Color('#16223d')
const NIGHT_DOME_M = new Color('#0c1530')
const NIGHT_DOME_T = new Color('#060c1e')
/** sun orbit radius — keep within ~24-30 so the shadow frustum stays valid */
const SUN_DIST = 27
const DISK_DIST = 150
const FILL_DIST = 16
const FILL_HEIGHT = 11
/** dome radius — must match the SphereGeometry handed in via SkyHandles */
const DOME_R = 240

/** one column of the keyframe table — all colors preallocated at module load */
interface Keyframe {
  phase: number
  /** sun azimuth in degrees: 90 = east (+x), 180 = north (-z), 270 = west */
  az: number
  /** sun elevation in degrees — never below ~8 so shadows never break */
  elev: number
  sun: Color
  sunI: number
  hemiSky: Color
  hemiGround: Color
  ambient: Color
  ambientI: number
  fill: Color
  fillI: number
  fog: Color
  bg: Color
  domeH: Color
  domeM: Color
  domeT: Color
  disk: Color
}

function key(
  phase: number, az: number, elev: number,
  sun: string, sunI: number,
  hemiSky: string, hemiGround: string,
  ambient: string, ambientI: number,
  fill: string, fillI: number,
  fog: string, bg: string,
  domeH: string, domeM: string, domeT: string,
  disk: string,
): Keyframe {
  return {
    phase, az, elev,
    sun: new Color(sun), sunI,
    hemiSky: new Color(hemiSky), hemiGround: new Color(hemiGround),
    ambient: new Color(ambient), ambientI,
    fill: new Color(fill), fillI,
    fog: new Color(fog), bg: new Color(bg),
    domeH: new Color(domeH), domeM: new Color(domeM), domeT: new Color(domeT),
    disk: new Color(disk),
  }
}

/** The whole look of the game, one row per moment. The sun sweeps east > north
 * (camera side) > west through the day, then slides low across the south
 * horizon during the brief dusk-to-dawn wrap (az 268 > 450 ≡ 90). The final
 * row duplicates dawn (+360 azimuth) so interpolation wraps seamlessly. */
const KEYS: Keyframe[] = [
  // dawn — cool lilac sky, low peach sun in the east
  key(0.0, 90, 12, '#ffc89a', 1.6, '#cfd8f0', '#6f7d4e', '#ffe1c9', 0.4,
    '#ffd9ad', 0.7, '#e7d9c4', '#b7c6e6', '#ffd9ac', '#c9d4ea', '#7e9ed6', '#ffd9a8'),
  // morning — the boot look: pale green-gold fog, fresh blue dome
  key(0.18, 128, 34, '#ffe9bd', 2.3, '#bfe0ff', '#74934e', '#fff1da', 0.42,
    '#ffd9ad', 1.0, '#dfe8c2', '#9fd0ee', '#f2ecca', '#a8d4ef', '#5fa8e0', '#fff2cf'),
  // noon — white-gold sun high in the north, crispest shadows of the day
  key(0.45, 180, 62, '#fff4e0', 2.7, '#cfe8ff', '#7a9a52', '#fff6e8', 0.45,
    '#ffe2c0', 0.9, '#e3ecca', '#8ecbf2', '#f4f0d2', '#9fd2f0', '#4fa0e0', '#fffbe8'),
  // golden hour — THE shot: deep orange sun low in the west, amber sky,
  // peach fog, fill swollen so everything rims warm
  key(0.72, 240, 18, '#ffb066', 2.2, '#ffd9b0', '#8a7a48', '#ffd9b0', 0.4,
    '#ffbf86', 1.3, '#ffd9a8', '#ffc98e', '#ffb866', '#ffd9a0', '#9fb4d8', '#ff9633'),
  // dusk — brief and rosy: lavender fog, pink-coral sun kissing the horizon
  key(0.85, 268, 9, '#ff9a8a', 1.5, '#d8b8d8', '#7a6a58', '#e8c8d8', 0.38,
    '#ff9a9a', 0.8, '#d8b8d0', '#c9a8cc', '#ff9e8e', '#d8aed0', '#8d92c8', '#ff8a70'),
  // wrap — dawn again, azimuth +360 so the sweep stays monotonic
  key(1.0, 450, 12, '#ffc89a', 1.6, '#cfd8f0', '#6f7d4e', '#ffe1c9', 0.4,
    '#ffd9ad', 0.7, '#e7d9c4', '#b7c6e6', '#ffd9ac', '#c9d4ea', '#7e9ed6', '#ffd9a8'),
]

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Owns the whole sky look. Construct once with the live handles, then call
 * update(dt) every frame — it repositions the sun/fill/sun disk, retints all
 * four lights, fog, background, the dome gradient and the disk. */
export class DayCycle {
  private readonly h: SkyHandles
  private readonly dayLengthS: number
  private p: number
  private readonly dir = new Vector3()
  /** scratch colors for the dome stops (lerp targets, reused every frame) */
  private readonly sH = new Color()
  private readonly sM = new Color()
  private readonly sT = new Color()
  /** live references resolved once so update never touches material unions */
  private readonly fogColor: Color
  private readonly bgColor: Color
  private readonly diskColor: Color
  private readonly domeColors: BufferAttribute
  /** per-vertex dome blend weights, cached from geometry once:
   * color = lerp(lerp(horizon, mid, a), top, b) — the branchless equivalent
   * of buildSky's horizon/mid/top split (vertex y / 170 picks the band) */
  private readonly blendA: Float32Array
  private readonly blendB: Float32Array

  constructor(h: SkyHandles, opts?: { dayLengthS?: number; startPhase?: number }) {
    this.h = h
    this.dayLengthS = opts?.dayLengthS ?? 480
    this.p = (opts?.startPhase ?? 0.32) % 1
    this.fogColor = (h.scene.fog as Fog).color
    this.bgColor = h.scene.background as Color
    this.diskColor = (h.sunDisk.material as MeshBasicMaterial).color
    this.domeColors = h.dome.geometry.getAttribute('color') as BufferAttribute
    const pos = h.dome.geometry.getAttribute('position')
    this.blendA = new Float32Array(pos.count)
    this.blendB = new Float32Array(pos.count)
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / DOME_R
      const t = Math.max(0, Math.min(1, (y + 0.12) / 0.9))
      this.blendA[i] = Math.min(1, t / 0.35)
      this.blendB[i] = Math.max(0, (t - 0.35) / 0.65)
    }
    this.apply()
  }

  /** the evening holds HERE until the farmer goes to bed (sleep ritual) */
  private static readonly DUSK_HOLD = 0.88
  /** 0 = keyframe look, 1 = full starlit night (sleep cutscene drives this) */
  private nightK = 0

  /** advance the cycle — dt in seconds, time only ever flows through here.
   * The sun never wraps past dusk on its own: it parks at DUSK_HOLD and waits
   * for startNewDay() — bedtime is a player ritual, not a timer. */
  update(dt: number): void {
    this.p = Math.min(DayCycle.DUSK_HOLD, this.p + dt / this.dayLengthS)
    this.apply()
  }

  /** true once the sun has parked at the dusk hold (time to head home) */
  get atDusk(): boolean {
    return this.p >= DayCycle.DUSK_HOLD - 1e-6
  }

  /** the sleep cutscene's master dial: fades every light/sky channel toward
   * a deep starlit night, on top of whatever the keyframes say */
  setNight(k: number): void {
    this.nightK = Math.max(0, Math.min(1, k))
    this.apply()
  }

  /** dawn of a brand-new day (the cutscene calls this under full night) */
  startNewDay(): void {
    this.p = 0.02
    this.apply()
  }

  setPhase(p: number): void {
    this.p = Math.max(0, Math.min(DayCycle.DUSK_HOLD, p))
    this.apply()
  }

  /** current position in the day, 0..1 (0 = dawn) */
  get phase(): number {
    return this.p
  }

  /** coarse name for the current phase band (HUD copy, music moods, tests) */
  get label(): 'dawn' | 'morning' | 'noon' | 'golden' | 'dusk' {
    const p = this.p
    if (p < 0.07) return 'dawn'
    if (p < 0.32) return 'morning'
    if (p < 0.6) return 'noon'
    if (p < 0.8) return 'golden'
    if (p < 0.92) return 'dusk'
    return 'dawn'
  }

  /** sample the keyframe table at the current phase and write every handle */
  private apply(): void {
    const p = this.p
    let i = 0
    while (i < KEYS.length - 2 && p >= KEYS[i + 1].phase) i++
    const a = KEYS[i]
    const b = KEYS[i + 1]
    const span = b.phase - a.phase
    const t = span > 0 ? (p - a.phase) / span : 0
    const e = t * t * (3 - 2 * t) // smoothstep on the segment

    // sun direction from azimuth/elevation, then sun + disk + opposing fill
    const az = lerp(a.az, b.az, e) * DEG
    const el = lerp(a.elev, b.elev, e) * DEG
    const cosE = Math.cos(el)
    this.dir.set(Math.sin(az) * cosE, Math.sin(el), Math.cos(az) * cosE)
    this.h.sun.position.copy(this.dir).multiplyScalar(SUN_DIST)
    this.h.sunDisk.position.copy(this.dir).multiplyScalar(DISK_DIST)
    const xz = Math.hypot(this.dir.x, this.dir.z)
    this.h.fill.position.set(
      (-this.dir.x / xz) * FILL_DIST,
      FILL_HEIGHT,
      (-this.dir.z / xz) * FILL_DIST,
    )

    this.h.sun.color.lerpColors(a.sun, b.sun, e)
    this.h.sun.intensity = lerp(a.sunI, b.sunI, e)
    this.h.hemi.color.lerpColors(a.hemiSky, b.hemiSky, e)
    this.h.hemi.groundColor.lerpColors(a.hemiGround, b.hemiGround, e)
    this.h.ambient.color.lerpColors(a.ambient, b.ambient, e)
    this.h.ambient.intensity = lerp(a.ambientI, b.ambientI, e)
    this.h.fill.color.lerpColors(a.fill, b.fill, e)
    this.h.fill.intensity = lerp(a.fillI, b.fillI, e)
    this.fogColor.lerpColors(a.fog, b.fog, e)
    this.bgColor.lerpColors(a.bg, b.bg, e)
    this.diskColor.lerpColors(a.disk, b.disk, e)

    this.sH.lerpColors(a.domeH, b.domeH, e)
    this.sM.lerpColors(a.domeM, b.domeM, e)
    this.sT.lerpColors(a.domeT, b.domeT, e)

    // night override: pull every channel toward deep starlit blue. Moonlight
    // is a faint cool key so silhouettes stay readable; the sun disk melts
    // into the sky color so the god rays die with the light.
    const n = this.nightK
    if (n > 0) {
      this.h.sun.color.lerp(NIGHT_SUN, n)
      this.h.sun.intensity = lerp(this.h.sun.intensity, 0.14, n)
      this.h.hemi.color.lerp(NIGHT_HEMI_SKY, n)
      this.h.hemi.groundColor.lerp(NIGHT_HEMI_GROUND, n)
      this.h.hemi.intensity = lerp(this.h.hemi.intensity, 0.32, n)
      this.h.ambient.color.lerp(NIGHT_AMBIENT, n)
      this.h.ambient.intensity = lerp(this.h.ambient.intensity, 0.26, n)
      this.h.fill.intensity = lerp(this.h.fill.intensity, 0.05, n)
      this.fogColor.lerp(NIGHT_FOG, n)
      this.bgColor.lerp(NIGHT_BG, n)
      this.diskColor.lerp(NIGHT_BG, n)
      this.sH.lerp(NIGHT_DOME_H, n)
      this.sM.lerp(NIGHT_DOME_M, n)
      this.sT.lerp(NIGHT_DOME_T, n)
    }
    this.writeDome(this.sH, this.sM, this.sT)
  }

  /** rewrite the dome's vertex colors from the three gradient stops —
   * ~275 verts, branchless, cheap enough to run every frame */
  private writeDome(h: Color, m: Color, top: Color): void {
    const arr = this.domeColors.array as Float32Array
    const wa = this.blendA
    const wb = this.blendB
    for (let i = 0; i < wa.length; i++) {
      const ai = wa[i]
      const bi = wb[i]
      const r = h.r + (m.r - h.r) * ai
      const g = h.g + (m.g - h.g) * ai
      const bl = h.b + (m.b - h.b) * ai
      const j = i * 3
      arr[j] = r + (top.r - r) * bi
      arr[j + 1] = g + (top.g - g) * bi
      arr[j + 2] = bl + (top.b - bl) * bi
    }
    this.domeColors.needsUpdate = true
  }
}
