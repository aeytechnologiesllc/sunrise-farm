/** The hen: crate-arrival ceremony (sim-time state machine, never timeout-
 * gated), nest + egg, seeded tint/size variation, head-turn + peck clips. */
import gsap from 'gsap'
import {
  AnimationAction,
  AnimationMixer,
  Bone,
  Group,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three'
import { mulberry32 } from '../game/rng'
import { tint, type Assets } from './assets'

function findAction(mixer: AnimationMixer, root: Group, clips: import('three').AnimationClip[], suffix: string): AnimationAction | null {
  const clip = clips.find((c) => c.name.toLowerCase().endsWith(suffix.toLowerCase()))
  return clip ? mixer.clipAction(clip, root) : null
}

type Phase = 'hidden' | 'crateDrop' | 'crateWait' | 'opening' | 'popOut' | 'walking' | 'home'

export class ChickenView {
  readonly group = new Group()
  readonly nestPos: Vector3
  readonly headAnchor = new Vector3()
  private hen: Group
  private henMixer: AnimationMixer
  private idle: AnimationAction | null
  private peck: AnimationAction | null
  private run: AnimationAction | null
  private current: AnimationAction | null = null
  private crate: Group | null = null
  private crateMixer: AnimationMixer | null = null
  private egg: Group | null = null
  private nest: Mesh
  private phase: Phase = 'hidden'
  private phaseT = 0
  private peckUntil = -1
  private cratePos: Vector3
  private onOpen: (() => void) | null = null
  private onReady: (() => void) | null = null
  private headBone: Bone | null = null

  constructor(private assets: Assets, private scene: Scene, nestPos: Vector3, cratePos: Vector3, seed: number) {
    this.nestPos = nestPos.clone()
    this.cratePos = cratePos.clone()
    this.hen = assets.spawnSkinned('hen')
    this.hen.scale.setScalar(0.001)
    this.group.add(this.hen)
    this.group.position.copy(cratePos)
    scene.add(this.group)

    this.henMixer = new AnimationMixer(this.hen)
    const clips = assets.clips('hen')
    this.idle = findAction(this.henMixer, this.hen, clips, 'Idle')
    this.peck = findAction(this.henMixer, this.hen, clips, 'Idle_Peck')
    this.run = findAction(this.henMixer, this.hen, clips, 'Run')
    this.idle?.play()
    this.current = this.idle

    // seeded per-animal variation: tint + size, stable across sessions
    const rng = mulberry32(seed)
    tint(this.hen, (rng.next() - 0.5) * 0.08, (rng.next() - 0.5) * 0.12)
    this.henScale = 1.45 * (0.92 + rng.next() * 0.16)

    this.hen.traverse((o) => {
      if (o instanceof Bone && /head/i.test(o.name) && !this.headBone) this.headBone = o
    })

    this.nest = new Mesh(
      new TorusGeometry(0.55, 0.22, 8, 14),
      new MeshStandardMaterial({ color: '#b78a4e', roughness: 1 }),
    )
    this.nest.rotation.x = Math.PI / 2
    this.nest.position.copy(nestPos).setY(0.16)
    this.nest.castShadow = true
    this.nest.scale.setScalar(0.001)
    scene.add(this.nest)
  }

  private henScale = 1.45

  get visible(): boolean {
    return (
      this.phase !== 'hidden' && this.phase !== 'crateDrop' && this.phase !== 'crateWait' && this.phase !== 'opening'
    )
  }

  get settled(): boolean {
    return this.phase === 'home'
  }

  get ceremonyActive(): boolean {
    return this.phase !== 'hidden' && this.phase !== 'home' && this.phase !== 'crateWait'
  }

  /** a crate has landed and is waiting for the player to walk up to it */
  get cratePending(): boolean {
    return this.phase === 'crateWait'
  }

  /** where the dropped crate sits (proximity checks) */
  get crateWorldPos(): Vector3 {
    return this.cratePos
  }

  /** step 1 (after first harvest): the crate thuds down… and waits.
   * Walking up to it is what opens it — go-to-it grammar. */
  dropCrate(): void {
    if (this.phase !== 'hidden') return
    this.phase = 'crateDrop'
    this.phaseT = 0
    this.crate = this.assets.spawn('chest')
    this.crate.position.copy(this.cratePos).setY(7)
    this.crate.scale.setScalar(2)
    this.scene.add(this.crate)
    this.crateMixer = new AnimationMixer(this.crate)
    gsap.to(this.crate.position, { y: 0, duration: 0.7, ease: 'bounce.out' })
  }

  /** step 2 (player reached the crate): lid opens, hen pops out, ceremony
   * continues on the sim-time state machine. */
  beginOpen(onOpen: () => void, onReady: () => void): void {
    if (this.phase !== 'crateWait') return
    this.onOpen = onOpen
    this.onReady = onReady
    this.phase = 'opening'
    this.phaseT = 0
    const clips = this.assets.clips('chest')
    const open = clips.find((c) => c.name.toLowerCase() === 'open')
    if (open && this.crate && this.crateMixer) {
      const a = this.crateMixer.clipAction(open, this.crate)
      a.setLoop(LoopOnce, 1)
      a.clampWhenFinished = true
      a.play()
    }
    this.onOpen?.()
  }

  /** instantly settle (loading a save where she already lives here) */
  settle(): void {
    this.phase = 'home'
    this.group.position.copy(this.nestPos).add(new Vector3(0.9, 0, 0.3))
    this.hen.scale.setScalar(this.henScale)
    this.nest.scale.setScalar(1)
    this.group.rotation.y = -0.8
  }

  /** sim-time ceremony driver */
  update(dt: number): void {
    if (this.phase === 'hidden' || this.phase === 'home') return
    this.phaseT += dt
    if (this.phase === 'crateDrop' && this.phaseT >= 1.0) {
      this.phase = 'crateWait'
      this.phaseT = 0
    } else if (this.phase === 'opening' && this.phaseT >= 0.9) {
      this.phase = 'popOut'
      this.phaseT = 0
      gsap.to(this.hen.scale, {
        x: this.henScale,
        y: this.henScale,
        z: this.henScale,
        duration: 0.5,
        ease: 'back.out(2.2)',
      })
      gsap.to(this.group.position, { y: 1.2, duration: 0.3, ease: 'power2.out', yoyo: true, repeat: 1 })
      gsap.to(this.nest.scale, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'back.out(2)', delay: 0.3 })
    } else if (this.phase === 'popOut' && this.phaseT >= 0.9) {
      this.phase = 'walking'
      this.phaseT = 0
      this.swapAction(this.run, 0.7)
      const dest = this.nestPos.clone().add(new Vector3(0.9, 0, 0.3))
      this.group.lookAt(dest.x, 0, dest.z)
      gsap.to(this.group.position, { x: dest.x, z: dest.z, duration: 1.1, ease: 'power1.inOut' })
    } else if (this.phase === 'walking' && this.phaseT >= 1.2) {
      this.phase = 'home'
      this.swapAction(this.idle)
      this.group.rotation.y = -0.8
      if (this.crate) {
        const crate = this.crate
        gsap.to(crate.scale, {
          x: 0.01,
          y: 0.01,
          z: 0.01,
          duration: 0.4,
          delay: 0.5,
          ease: 'back.in(1.7)',
          onComplete: () => this.scene.remove(crate),
        })
        this.crate = null
      }
      this.onReady?.()
    }
  }

  /** render-rate: mixers + transient peck recovery + crate invite pulse */
  frame(dt: number, t: number): void {
    this.henMixer.update(dt)
    this.crateMixer?.update(dt)
    if (this.phase === 'crateWait' && this.crate) {
      const s = 2 + Math.sin(t * 3.4) * 0.05
      this.crate.scale.set(s, 2 - Math.sin(t * 3.4) * 0.04, s)
    }
    if (this.peckUntil > 0 && t >= this.peckUntil) {
      this.peckUntil = -1
      this.swapAction(this.idle)
    }
  }

  private swapAction(next: AnimationAction | null, timeScale = 1): void {
    if (!next || next === this.current) return
    next.reset()
    next.timeScale = timeScale
    next.play()
    if (this.current) this.current.crossFadeTo(next, 0.25, false)
    this.current = next
  }

  /** feeding visual: peck the ground for a few seconds */
  eat(now: number): void {
    this.swapAction(this.peck)
    this.peckUntil = now + 3.2
  }

  /** tap response: head turn toward camera + a small hop */
  acknowledge(camPos: Vector3): void {
    if (this.headBone) {
      gsap.killTweensOf(this.headBone.rotation)
      gsap
        .timeline()
        .to(this.headBone.rotation, { y: 0.6, duration: 0.18, ease: 'power2.out' })
        .to(this.headBone.rotation, { y: 0, duration: 0.4, ease: 'power2.inOut' }, '+=0.5')
    } else {
      const target = Math.atan2(camPos.x - this.group.position.x, camPos.z - this.group.position.z)
      gsap.to(this.group.rotation, { y: target, duration: 0.3, ease: 'power2.out' })
    }
    gsap.fromTo(this.group.position, { y: 0 }, { y: 0.35, duration: 0.16, yoyo: true, repeat: 1, ease: 'power1.out' })
  }

  showEgg(golden: boolean): void {
    if (this.egg) return
    this.egg = this.assets.spawn('egg', true)
    this.egg.scale.setScalar(0.01)
    this.egg.position.copy(this.nestPos).setY(0.28)
    this.scene.add(this.egg)
    gsap.to(this.egg.scale, { x: 3, y: 3, z: 3, duration: 0.5, ease: 'back.out(2.6)' })
    void golden
  }

  collectEggFx(): void {
    if (!this.egg) return
    const egg = this.egg
    this.egg = null
    gsap.to(egg.position, { y: 2.4, duration: 0.45, ease: 'power2.out' })
    gsap.to(egg.scale, {
      x: 0.01,
      y: 0.01,
      z: 0.01,
      delay: 0.35,
      duration: 0.3,
      ease: 'power2.in',
      onComplete: () => this.scene.remove(egg),
    })
  }

  get hasEggShown(): boolean {
    return this.egg !== null
  }

  /** everything that should route a tap to the chicken (hen, nest, egg) */
  hitRoots(): import('three').Object3D[] {
    const roots: import('three').Object3D[] = [this.group, this.nest]
    if (this.egg) roots.push(this.egg)
    return roots
  }

  /** anchor for the floating name tag */
  tagWorldPos(): Vector3 {
    return this.headAnchor.copy(this.group.position).add(new Vector3(0, 2.1, 0))
  }
}
