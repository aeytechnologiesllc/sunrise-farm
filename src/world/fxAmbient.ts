/** Ambient life: butterflies looping lazy figure-eights over the flowers and
 * sun-lit pollen motes. Two Points systems = two draw calls total. */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Points,
  PointsMaterial,
  Scene,
} from 'three'
import { mulberry32 } from '../game/rng'

function softDot(color: string, core = 0.4): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 15)
  grad.addColorStop(0, color)
  grad.addColorStop(core, color)
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 32, 32)
  return new CanvasTexture(c)
}

function wingDot(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.beginPath()
  g.ellipse(10, 16, 7, 10, -0.35, 0, Math.PI * 2)
  g.ellipse(22, 16, 7, 10, 0.35, 0, Math.PI * 2)
  g.fill()
  return new CanvasTexture(c)
}

interface Flyer {
  cx: number
  cz: number
  r: number
  h: number
  speed: number
  phase: number
}

export class AmbientLife {
  private butterflies: Points
  private bData: Flyer[] = []
  private pollen: Points
  private pBase: Float32Array
  private readonly coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  private lastCoarseUpdate = 0

  constructor(scene: Scene) {
    const rng = mulberry32(4242)
    // butterflies
    const B = this.coarse ? 6 : 12
    const bPos = new Float32Array(B * 3)
    const bCol = new Float32Array(B * 3)
    const palette = [
      [1, 0.72, 0.2],
      [1, 0.95, 0.6],
      [0.95, 0.55, 0.75],
      [0.7, 0.85, 1],
    ]
    for (let i = 0; i < B; i++) {
      this.bData.push({
        cx: (rng.next() - 0.5) * 24,
        cz: (rng.next() - 0.5) * 18 + 2,
        r: 1.2 + rng.next() * 2.6,
        h: 0.7 + rng.next() * 1.3,
        speed: 0.5 + rng.next() * 0.7,
        phase: rng.next() * Math.PI * 2,
      })
      const col = palette[Math.floor(rng.next() * palette.length)]
      bCol.set(col, i * 3)
    }
    const bGeo = new BufferGeometry()
    bGeo.setAttribute('position', new BufferAttribute(bPos, 3))
    bGeo.setAttribute('color', new BufferAttribute(bCol, 3))
    this.butterflies = new Points(
      bGeo,
      new PointsMaterial({ map: wingDot(), size: 0.34, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }),
    )
    scene.add(this.butterflies)

    // pollen — slow golden drift, additive so it catches the bloom
    const P = this.coarse ? 14 : 40
    this.pBase = new Float32Array(P * 3)
    for (let i = 0; i < P; i++) {
      this.pBase[i * 3] = (rng.next() - 0.5) * 30
      this.pBase[i * 3 + 1] = 0.4 + rng.next() * 2.6
      this.pBase[i * 3 + 2] = (rng.next() - 0.5) * 24 + 2
    }
    const pGeo = new BufferGeometry()
    pGeo.setAttribute('position', new BufferAttribute(this.pBase.slice(), 3))
    this.pollen = new Points(
      pGeo,
      new PointsMaterial({
        map: softDot('rgba(255,236,170,0.9)'),
        color: '#ffedb0',
        size: 0.1,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    )
    scene.add(this.pollen)
  }

  update(t: number): void {
    if (this.coarse && t - this.lastCoarseUpdate < 0.066) return
    this.lastCoarseUpdate = t
    const bp = this.butterflies.geometry.getAttribute('position') as BufferAttribute
    for (let i = 0; i < this.bData.length; i++) {
      const f = this.bData[i]
      const a = t * f.speed + f.phase
      bp.setXYZ(
        i,
        f.cx + Math.cos(a) * f.r,
        f.h + Math.sin(a * 2.3) * 0.3 + Math.sin(t * 9 + f.phase) * 0.07,
        f.cz + Math.sin(a * 1.3) * f.r * 0.8,
      )
    }
    bp.needsUpdate = true
    const pp = this.pollen.geometry.getAttribute('position') as BufferAttribute
    for (let i = 0; i < this.pBase.length / 3; i++) {
      const ph = i * 1.7
      pp.setXYZ(
        i,
        this.pBase[i * 3] + Math.sin(t * 0.22 + ph) * 1.4,
        this.pBase[i * 3 + 1] + Math.sin(t * 0.4 + ph * 2) * 0.5,
        this.pBase[i * 3 + 2] + Math.cos(t * 0.18 + ph) * 1.2,
      )
    }
    pp.needsUpdate = true
  }
}
