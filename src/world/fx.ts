/** Tiny sprite-burst effects (sparkles, hearts). Visual only — gsap-driven. */
import gsap from 'gsap'
import { CanvasTexture, Scene, Sprite, SpriteMaterial, Vector3 } from 'three'

function discTexture(color: string): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30)
  grad.addColorStop(0, color)
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new CanvasTexture(c)
}

function heartTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#ff5d7e'
  g.font = '48px serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('❤', 32, 36)
  return new CanvasTexture(c)
}

const sparkleTex = { gold: null as CanvasTexture | null, soft: null as CanvasTexture | null }
let heartTex: CanvasTexture | null = null

function burst(
  scene: Scene,
  at: Vector3,
  tex: CanvasTexture,
  count: number,
  size: number,
  spread: number,
  rise: number,
): void {
  for (let i = 0; i < count; i++) {
    const mat = new SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
    const s = new Sprite(mat)
    const sc = size * (0.6 + Math.random() * 0.8)
    s.scale.setScalar(sc)
    s.position.copy(at)
    scene.add(s)
    const dx = (Math.random() - 0.5) * spread
    const dz = (Math.random() - 0.5) * spread
    const dy = rise * (0.5 + Math.random())
    gsap.to(s.position, { x: at.x + dx, y: at.y + dy, z: at.z + dz, duration: 0.7 + Math.random() * 0.4, ease: 'power2.out' })
    gsap.to(mat, {
      opacity: 0,
      duration: 0.8 + Math.random() * 0.3,
      ease: 'power1.in',
      onComplete: () => {
        scene.remove(s)
        mat.dispose()
      },
    })
  }
}

export function sparkleBurst(scene: Scene, at: Vector3, golden: boolean, count = 10): void {
  sparkleTex.gold ??= discTexture('rgba(255,216,84,1)')
  sparkleTex.soft ??= discTexture('rgba(255,250,220,0.9)')
  burst(scene, at, golden ? sparkleTex.gold : sparkleTex.soft, count, golden ? 0.45 : 0.28, golden ? 2.2 : 1.4, 1.6)
}

export function heartBurst(scene: Scene, at: Vector3): void {
  heartTex ??= heartTexture()
  burst(scene, at, heartTex, 6, 0.5, 1.2, 1.8)
}
