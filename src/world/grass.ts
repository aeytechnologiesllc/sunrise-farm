/** Real 3D grass: ~18k GPU-instanced alpha-cutout blade tufts in ONE draw
 * call. Realism pass over the first version: a denser, finer blade card
 * (lateral light gradients, dry blades, seed heads), independent width/height
 * variance so the field silhouette breaks up, a slow large-scale gust layered
 * under the per-tuft flutter so the meadow waves in visible patches, and a
 * deeper natural-green tint palette. Normals are forced straight up so blades
 * shade exactly like the ground under them (no dark backfaces), and the
 * per-instance tint stays a near-white multiplier so the card's painted
 * colors carry. */
import {
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32 } from '../game/rng'
import { grassBladeCanvas, toTexture } from './textures'

export interface GrassField {
  update(t: number): void
}

const COUNT = 18000
const TUFT_W = 0.46
const TUFT_H = 0.36
/** the farmyard reads as a kept lawn: tufts inside the (max) fence ring are
 * short; the wild meadow beyond grows tall */
const YARD = { minX: -15.2, maxX: 15.0, minZ: -9.0, maxZ: 10.2 }

export function buildGrass(scene: Scene, isClear: (x: number, z: number) => boolean): GrassField {
  const rng = mulberry32(48151623)
  const tex = toTexture(grassBladeCanvas(rng))

  // tuft = 3 crossed quads so it reads full from every camera yaw
  const quads: PlaneGeometry[] = []
  for (let i = 0; i < 3; i++) {
    const p = new PlaneGeometry(TUFT_W, TUFT_H, 1, 1)
    p.translate(0, TUFT_H / 2, 0)
    p.rotateY((i / 3) * Math.PI)
    quads.push(p)
  }
  const geo = mergeGeometries(quads)!
  const nrm = geo.getAttribute('normal')
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0)

  const mat = new MeshStandardMaterial({
    map: tex,
    alphaTest: 0.38,
    side: DoubleSide,
    roughness: 1,
  })
  let timeU: { value: number } | null = null
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 }
    timeU = shader.uniforms.uTime as { value: number }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 gIpos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float gPh = gIpos.x * 1.7 + gIpos.z * 1.3;
          float gW = pow(clamp(transformed.y / ${TUFT_H.toFixed(3)}, 0.0, 1.5), 1.7);
          // fine flutter: fast, small, per-tuft phase
          transformed.x += (sin(uTime * 1.9 + gPh) * 0.5 + sin(uTime * 3.7 + gPh * 1.7) * 0.25) * 0.09 * gW;
          transformed.z += cos(uTime * 1.4 + gPh * 1.3) * 0.05 * gW;
          // slow large-scale gust: long wavelength across world space, so
          // whole patches of meadow lean together and a wave rolls through
          float gGust = sin((gIpos.x + gIpos.z) * 0.13 + uTime * 0.7) * 0.05;
          transformed.x += gGust * gW;
          transformed.z += gGust * 0.6 * gW;
        #endif`,
      )
  }

  const mesh = new InstancedMesh(geo, mat, COUNT)
  mesh.frustumCulled = false // instances span the whole meadow
  mesh.castShadow = false
  mesh.receiveShadow = true

  const m = new Matrix4()
  const pos = new Vector3()
  const quat = new Quaternion()
  const scl = new Vector3()
  const up = new Vector3(0, 1, 0)
  const col = new Color()
  let placed = 0
  let attempts = 0
  while (placed < COUNT && attempts < COUNT * 10) {
    attempts++
    // 62% of tufts pack the play space; the rest fade into the far meadow
    const inner = rng.next() < 0.62
    const x = inner ? -17 + rng.next() * 34 : -34 + rng.next() * 68
    const z = inner ? -11 + rng.next() * 24 : -28 + rng.next() * 56
    if (!inner && x > -17 && x < 17 && z > -11 && z < 13) continue
    if (isClear(x, z)) continue
    const inYard = x > YARD.minX && x < YARD.maxX && z > YARD.minZ && z < YARD.maxZ
    // width and height vary INDEPENDENTLY — wide-short and narrow-tall tufts
    // both exist, which breaks the repeated-billboard read at a glance
    const sw = 0.55 + rng.next() * 0.95
    const hy = inYard ? 0.38 + rng.next() * 0.24 : 0.8 + rng.next() * 0.7
    pos.set(x, 0, z)
    quat.setFromAxisAngle(up, rng.next() * Math.PI)
    scl.set(sw, hy, sw)
    m.compose(pos, quat, scl)
    mesh.setMatrixAt(placed, m)
    // near-white multipliers nudged toward deeper natural greens (away from
    // yellow-lime); subtle per-tuft saturation variance keeps it patchy and
    // alive without ever going muddy
    col.setHSL(0.275 + (rng.next() - 0.5) * 0.03, 0.24 + rng.next() * 0.18, 0.62 + rng.next() * 0.28)
    mesh.setColorAt(placed, col)
    placed++
  }
  mesh.count = placed
  scene.add(mesh)

  return {
    update(t: number): void {
      if (timeU) timeU.value = t
    },
  }
}
