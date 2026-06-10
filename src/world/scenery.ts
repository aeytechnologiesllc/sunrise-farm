/** Static meadow dressing: lights, ground, trees, fences, roadside stand. */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  Vector3,
  type Group,
} from 'three'
import { mulberry32 } from '../game/rng'
import type { Assets, ModelKey } from './assets'

export const STAND_POS = new Vector3(0.5, 0, 7)
export const NEST_POS = new Vector3(-4.5, 0, 1.5)
export const CRATE_POS = new Vector3(-5.5, 0, 4.5)
export const DOG_HOME = new Vector3(-1.5, 0, 5)

export function buildLights(scene: Scene): void {
  scene.background = new Color('#a8ddf5')
  scene.fog = new Fog('#a8ddf5', 55, 130)
  const sun = new DirectionalLight('#fff2cf', 2.7)
  sun.position.set(16, 26, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0004
  const c = sun.shadow.camera
  c.left = c.bottom = -26
  c.right = c.top = 26
  scene.add(sun)
  scene.add(new HemisphereLight('#cfe8ff', '#8a9f5a', 0.75))
  scene.add(new AmbientLight('#fff6e3', 0.35))
}

export function buildMeadow(scene: Scene, assets: Assets): void {
  const ground = new Mesh(
    new PlaneGeometry(220, 220),
    new MeshStandardMaterial({ color: '#8cba6b', roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  const place = (key: ModelKey, x: number, z: number, rot = 0, scale = 1): Group => {
    const g = assets.spawn(key)
    g.position.set(x, 0, z)
    g.rotation.y = rot
    g.scale.setScalar(scale)
    scene.add(g)
    return g
  }

  // ring of trees + scatter, seeded so the meadow is stable between runs
  const rng = mulberry32(1234)
  const trees: ModelKey[] = ['treeA', 'treeB', 'treeC', 'pine']
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rng.next() * 0.3
    const r = 17 + rng.next() * 9
    place(trees[Math.floor(rng.next() * trees.length)], Math.cos(a) * r, Math.sin(a) * r, rng.next() * Math.PI * 2, 2.2 + rng.next() * 1.6)
  }
  const scatter: ModelKey[] = ['bush', 'flowerR', 'flowerY', 'flowerP', 'rock', 'stump']
  for (let i = 0; i < 34; i++) {
    const a = rng.next() * Math.PI * 2
    const r = 9 + rng.next() * 8
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (x > 0 && x < 7 && z > -1 && z < 6) continue // keep the field clear
    place(scatter[Math.floor(rng.next() * scatter.length)], x, z, rng.next() * Math.PI * 2, 1.4 + rng.next() * 1.2)
  }

  // fence along the field's far edge + chicken yard corner
  for (let i = 0; i < 5; i++) place('fence', 0.6 + i * 1.55, -1.4, 0, 1.5)
  place('fenceCorner', -1, -1.4, 0, 1.5)
  for (let i = 0; i < 3; i++) place('fence', -7.2, 0 + i * 1.55, Math.PI / 2, 1.5)
  place('fenceGate', -6.4, 5.6, Math.PI / 2 + Math.PI / 2, 1.5)

  // stone path from the stand outward
  for (let i = 0; i < 6; i++) place('pathStone', STAND_POS.x + 0.2 * (i % 2), STAND_POS.z + 1.6 + i * 1.1, (i * Math.PI) / 3, 1.6)
}

/** Roadside stand: crates + barrel + a fabric awning (auto-sell is the v1
 * mechanic; the stand anchors it spatially). */
export function buildStand(scene: Scene, assets: Assets): void {
  const base = assets.spawn('boxLarge')
  base.position.copy(STAND_POS)
  base.scale.setScalar(2.4)
  scene.add(base)
  const box = assets.spawn('box')
  box.position.set(STAND_POS.x - 1.2, 0, STAND_POS.z + 0.4)
  box.scale.setScalar(1.8)
  box.rotation.y = 0.4
  scene.add(box)
  const barrel = assets.spawn('barrel')
  barrel.position.set(STAND_POS.x + 1.3, 0, STAND_POS.z + 0.2)
  barrel.scale.setScalar(1.8)
  scene.add(barrel)
  const awning = new Mesh(
    new PlaneGeometry(3.4, 2),
    new MeshStandardMaterial({ color: '#e0526e', roughness: 0.9 }),
  )
  awning.position.set(STAND_POS.x, 2.6, STAND_POS.z - 0.4)
  awning.rotation.x = -Math.PI / 2 + 0.35
  awning.castShadow = true
  scene.add(awning)
  const post = new Mesh(
    new PlaneGeometry(0.12, 2.6),
    new MeshStandardMaterial({ color: '#9a6b3f', roughness: 1 }),
  )
  post.position.set(STAND_POS.x - 1.5, 1.3, STAND_POS.z - 1.1)
  scene.add(post)
  const post2 = post.clone()
  post2.position.x = STAND_POS.x + 1.5
  scene.add(post2)
}
