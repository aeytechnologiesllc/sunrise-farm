/** The old farm tractor — a proper little machine built from primitives with
 * painted texture detail (treaded tires, grilled hood), parked by the north
 * field once The North Acres deed is bought. Walking up offers "sow ALL
 * plots"; chug() gives it a happy engine wobble + smoke puffs. */
import gsap from 'gsap'
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../game/rng'
import { makeCanvas, toTexture } from './textures'

function tireCanvas(): HTMLCanvasElement {
  const rng = mulberry32(909)
  const { c, g } = makeCanvas(128, 64)
  g.fillStyle = '#2e2a26'
  g.fillRect(0, 0, 128, 64)
  // tread blocks
  for (let x = 0; x < 128; x += 16) {
    g.fillStyle = '#403a34'
    g.fillRect(x + 2, 4, 7, 56)
    g.fillStyle = '#1f1c19'
    g.fillRect(x + 11, 4, 3, 56)
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = 'rgba(120,110,95,0.25)'
    g.fillRect(rng.next() * 128, rng.next() * 64, 2, 2)
  }
  return c
}

function grillCanvas(): HTMLCanvasElement {
  const { c, g } = makeCanvas(64, 64)
  g.fillStyle = '#7e2c1e'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = '#3a3a3a'
  g.fillRect(8, 10, 48, 44)
  g.fillStyle = '#181818'
  for (let y = 14; y < 52; y += 7) g.fillRect(10, y, 44, 3)
  return c
}

export class TractorView {
  readonly group = new Group()
  private smokeAt = new Vector3()

  constructor(private scene: Scene, pos: Vector3, yaw: number) {
    const red = new MeshStandardMaterial({ color: '#b73b26', roughness: 0.55, metalness: 0.15 })
    const dark = new MeshStandardMaterial({ color: '#33302c', roughness: 0.8 })
    const hub = new MeshStandardMaterial({ color: '#e8b53a', roughness: 0.6 })
    const tire = new MeshStandardMaterial({ map: toTexture(tireCanvas(), true), roughness: 0.95 })
    const seatM = new MeshStandardMaterial({ color: '#4a3b2a', roughness: 0.9 })

    const bodyGeos: BufferGeometry[] = []
    // hood + cab floor (tractor faces +x)
    const hood = new BoxGeometry(1.5, 0.62, 0.78)
    hood.translate(0.45, 0.92, 0)
    bodyGeos.push(hood)
    const cowl = new BoxGeometry(0.5, 0.78, 0.84)
    cowl.translate(-0.45, 1.0, 0)
    bodyGeos.push(cowl)
    const fenderL = new BoxGeometry(0.9, 0.1, 0.26)
    fenderL.translate(-0.75, 1.42, 0.56)
    bodyGeos.push(fenderL)
    const fenderR = fenderL.clone()
    fenderR.translate(0, 0, -1.12)
    bodyGeos.push(fenderR)
    const bodyMerged = mergeGeometries(bodyGeos)
    if (bodyMerged) {
      const body = new Mesh(bodyMerged, red)
      body.castShadow = true
      body.receiveShadow = true
      this.group.add(body)
    }
    // grill on the nose
    const grill = new Mesh(new BoxGeometry(0.06, 0.5, 0.6), new MeshStandardMaterial({ map: toTexture(grillCanvas()), roughness: 0.7 }))
    grill.position.set(1.24, 0.92, 0)
    this.group.add(grill)
    // seat + steering
    const seat = new Mesh(new BoxGeometry(0.42, 0.1, 0.46), seatM)
    seat.position.set(-0.85, 1.06, 0)
    seat.castShadow = true
    this.group.add(seat)
    const back = new Mesh(new BoxGeometry(0.1, 0.5, 0.46), seatM)
    back.position.set(-1.06, 1.32, 0)
    this.group.add(back)
    const column = new Mesh(new CylinderGeometry(0.035, 0.035, 0.5, 6), dark)
    column.position.set(-0.18, 1.5, 0)
    column.rotation.z = 0.5
    this.group.add(column)
    const wheel = new Mesh(new CylinderGeometry(0.16, 0.16, 0.04, 10), dark)
    wheel.position.set(-0.06, 1.62, 0)
    wheel.rotation.z = 0.5 + Math.PI / 2
    this.group.add(wheel)
    // exhaust stack
    const pipe = new Mesh(new CylinderGeometry(0.05, 0.06, 0.62, 7), dark)
    pipe.position.set(0.7, 1.5, 0.18)
    pipe.castShadow = true
    this.group.add(pipe)
    this.smokeAt.set(0.7, 1.85, 0.18)
    // wheels: big rear, small front
    const mkWheel = (r: number, w: number, x: number, z: number): void => {
      const t = new Mesh(new CylinderGeometry(r, r, w, 14), tire)
      t.rotation.x = Math.PI / 2
      t.position.set(x, r, z)
      t.castShadow = true
      this.group.add(t)
      const h = new Mesh(new CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 12), hub)
      h.rotation.x = Math.PI / 2
      h.position.set(x, r, z)
      this.group.add(h)
    }
    mkWheel(0.62, 0.26, -0.75, 0.56)
    mkWheel(0.62, 0.26, -0.75, -0.56)
    mkWheel(0.34, 0.2, 0.78, 0.46)
    mkWheel(0.34, 0.2, 0.78, -0.46)

    this.group.position.copy(pos)
    this.group.rotation.y = yaw
    scene.add(this.group)
  }

  get position(): Vector3 {
    return this.group.position
  }

  /** happy sow ceremony: body wobble + a few smoke puffs */
  chug(): void {
    gsap
      .timeline()
      .to(this.group.rotation, { z: 0.03, duration: 0.08, yoyo: true, repeat: 7 })
      .set(this.group.rotation, { z: 0 })
    const smokeMat = new MeshBasicMaterial({ color: '#9a9a92', transparent: true, opacity: 0.7 })
    for (let i = 0; i < 5; i++) {
      const puff = new Mesh(new SphereGeometry(0.09 + i * 0.015, 8, 6), smokeMat.clone())
      puff.position.copy(this.smokeAt).applyMatrix4(this.group.matrixWorld)
      this.scene.add(puff)
      gsap.to(puff.position, { y: puff.position.y + 0.9 + i * 0.18, duration: 1.1, delay: i * 0.16, ease: 'power1.out' })
      gsap.to(puff.scale, { x: 2.4, y: 2.4, z: 2.4, duration: 1.1, delay: i * 0.16 })
      gsap.to(puff.material, {
        opacity: 0,
        duration: 1.0,
        delay: 0.15 + i * 0.16,
        onComplete: () => this.scene.remove(puff),
      })
    }
  }
}
