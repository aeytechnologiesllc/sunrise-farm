/** Real geometry grass: ONE InstancedMesh of curved blade ribbons, no
 * textures and no alpha test. The previous crossed-card billboards always
 * betrayed themselves (flat quads, X-intersections, fuzzy cutout edges), so
 * this pass models the blade itself: a hand-built tapered strip with a baked
 * forward bend, tinted per instance and darkened toward the root with a
 * per-vertex gradient. Blades grow in clumps that share a tint family — real
 * grass tillers from a crown, and uniform scatter is what reads as fake.
 * SOFT LAWN retune: the first geometry pass read as sparse spiky weeds in
 * the farmyard, so blades are now shorter, finer, denser and more upright —
 * a smooth even carpet underfoot — and the taller, wilder look is reserved
 * for the far meadow. Per pixel this stays cheaper than the cards: zero
 * overdraw discard, zero texture fetches, ~0.51M tris desktop / ~0.29M on
 * coarse-pointer devices (each blade is much smaller on screen, so fill
 * cost drops even as counts rise), still a single draw call. */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  Sphere,
  Vector3,
} from 'three'
import { mulberry32 } from '../game/rng'

export interface GrassField {
  update(t: number): void
  /** hide the whole lawn (inside opaque interiors the farm doesn't render) */
  setVisible(on: boolean): void
  /** zero-scale every blade inside the rect — the cheap commit-time pass
   * when a building lands on lawn (full re-scatter waits for the night) */
  hideIn(rect: { x0: number; z0: number; x1: number; z1: number }): void
  /** re-run placement against the CURRENT exclusion predicate (same seed,
   * same look) — fired behind the sleep ritual's dip to black */
  rebuild(): void
}

/** blade root width in object space (instances scale it 0.7..1.6) — fine
 * blades are what separate a soft lawn from coarse weeds */
const BLADE_W = 0.022
/** vertical segments per blade: 5 vertex rows = 10 verts, 8 indexed tris */
const SEGS = 4
/** baked forward lean of the tip, as a fraction of blade height */
const LEAN = 0.25
/** the farmyard reads as a kept lawn: blades inside the fence ring stay
 * short; the wild meadow beyond grows tall */
const YARD = { minX: -15.2, maxX: 15.0, minZ: -9.0, maxZ: 10.2 }

/** One blade: a tapered ribbon in the x/y plane, bending forward along +z.
 * Width holds near the root then narrows to a point (real blades are not
 * triangles); the bend is quadratic so the root stays planted and the tip
 * leans. A 'gradient' attribute (0 root -> 1 tip) drives both the shader's
 * root-darkening and the wind weight. Normals all point straight up so every
 * blade shades exactly like the lawn beneath it — no dark backfaces, no
 * lighting pop as blades yaw. */
function bladeGeometry(): BufferGeometry {
  const rows = SEGS + 1
  const positions = new Float32Array(rows * 2 * 3)
  const normals = new Float32Array(rows * 2 * 3)
  const gradient = new Float32Array(rows * 2)
  for (let i = 0; i < rows; i++) {
    const t = i / SEGS
    // convex taper: near-parallel edges low, quick pinch at the tip
    const half = (BLADE_W / 2) * (1 - t) * (1 + 0.6 * t)
    const y = t
    const z = LEAN * t * t
    for (let s = 0; s < 2; s++) {
      const v = i * 2 + s
      positions[v * 3] = s === 0 ? -half : half
      positions[v * 3 + 1] = y
      positions[v * 3 + 2] = z
      normals[v * 3 + 1] = 1
      gradient[v] = t
    }
  }
  const index: number[] = []
  for (let i = 0; i < SEGS; i++) {
    const a = i * 2
    index.push(a, a + 1, a + 3, a, a + 3, a + 2)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('normal', new BufferAttribute(normals, 3))
  geo.setAttribute('gradient', new BufferAttribute(gradient, 1))
  geo.setIndex(index)
  return geo
}

export function buildGrass(scene: Scene, isClear: (x: number, z: number) => boolean): GrassField {
  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  // CHUNKED instancing (the smooth-fps pass): the meadow is split into a
  // grid of cells, each its own InstancedMesh with a hand-set bounding
  // sphere — so the camera only pays vertex+wind cost for cells actually
  // on screen (typically a third of the field). That headroom buys the
  // phone lawn DENSITY back (40k blades, up from the 28k 'airier' cut
  // the owner clocked as lost quality) and still comes out far cheaper.
  const COUNT = coarse ? 40000 : 64000

  const mat = new MeshStandardMaterial({ side: DoubleSide, roughness: 1 })
  let timeU: { value: number } | null = null
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 }
    timeU = shader.uniforms.uTime as { value: number }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nattribute float gradient;\nvarying float vGradient;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGradient = gradient;
        #ifdef USE_INSTANCING
          // wind weight grows with gradient^2: tips swing, roots stay planted
          vec4 gIpos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float gPh = gIpos.x * 1.7 + gIpos.z * 1.3;
          float gW = gradient * gradient;
          // amplitude must ride the blade's HEIGHT so the short yard lawn
          // barely moves while the tall meadow keeps its gust wave. The z
          // displacement gets that for free (instanceMatrix scales z by hy)
          // but x is scaled by the independent width factor, so recover the
          // height from column 1 of the instance matrix — the rotated y
          // basis, whose length is exactly hy
          float gH = length(instanceMatrix[1].xyz);
          // fine flutter: two detuned sines on the blade's world phase;
          // 0.35 * meadow-height ~0.29 keeps the old meadow amplitude while
          // the ~0.12 yard blades drop to well under half of it
          transformed.x += (sin(uTime * 1.9 + gPh) * 0.5 + sin(uTime * 3.7 + gPh * 1.7) * 0.25) * 0.35 * gH * gW;
          transformed.z += cos(uTime * 1.4 + gPh * 1.3) * 0.05 * gW;
          // slow large gust: long wavelength across world space, so whole
          // patches of meadow lean together and a wave rolls through
          float gGust = sin((gIpos.x + gIpos.z) * 0.13 + uTime * 0.7);
          transformed.x += gGust * 0.42 * gH * gW;
          transformed.z += gGust * 0.07 * gW;
        #endif`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGradient;')
      .replace(
        '#include <color_fragment>',
        // root -> tip light gradient: shaded crown under the canopy, bright
        // tips catching the sun — this is what sells depth without a texture
        '#include <color_fragment>\n  diffuseColor.rgb *= mix(0.45, 1.0, vGradient);',
      )
  }

  // world span of the scatter (matches the placement loops below)
  const SPAN = { x0: -34, x1: 34, z0: -28, z1: 28 }
  const CELL = 12
  const COLS = Math.ceil((SPAN.x1 - SPAN.x0) / CELL)
  const ROWS = Math.ceil((SPAN.z1 - SPAN.z0) / CELL)
  const bladeGeo = bladeGeometry()
  interface Chunk {
    mesh: InstancedMesh
    bladeAt: Float32Array
    n: number
  }
  const cap = Math.ceil((COUNT / (COLS * ROWS)) * 3.2) // clustering headroom
  const chunks: Chunk[] = []
  for (let r = 0; r < ROWS; r++) {
    for (let cI = 0; cI < COLS; cI++) {
      const cx = SPAN.x0 + (cI + 0.5) * CELL
      const cz = SPAN.z0 + (r + 0.5) * CELL
      const mesh = new InstancedMesh(bladeGeo, mat, cap)
      // culling reads the MESH-level sphere on InstancedMesh — hand it the
      // cell (NEVER the geometry's: instance matrices re-offset a geometry
      // sphere per blade and the union balloons to world size — found the
      // hard way when nothing culled)
      mesh.boundingSphere = new Sphere(new Vector3(cx, 0.25, cz), CELL * 0.75 + 1.4)
      mesh.frustumCulled = true
      mesh.castShadow = false
      // no shadow sampling on the biggest fill surface in the game — the
      // GROUND under the blades still receives, which is what the eye reads
      mesh.receiveShadow = false
      mesh.count = 0
      scene.add(mesh)
      chunks.push({ mesh, bladeAt: new Float32Array(cap * 2), n: 0 })
    }
  }
  const chunkFor = (x: number, z: number): Chunk | null => {
    const cI = Math.floor((x - SPAN.x0) / CELL)
    const r = Math.floor((z - SPAN.z0) / CELL)
    if (cI < 0 || cI >= COLS || r < 0 || r >= ROWS) return null
    return chunks[r * COLS + cI]
  }

  const m = new Matrix4()
  const pos = new Vector3()
  const quat = new Quaternion()
  const tilt = new Quaternion()
  const scl = new Vector3()
  const up = new Vector3(0, 1, 0)
  const side = new Vector3(1, 0, 0)
  const col = new Color()
  const scatter = (): number => {
  const rng = mulberry32(48151623)
  for (const c of chunks) c.n = 0
  let placed = 0
  let attempts = 0
  while (placed < COUNT && attempts < COUNT * 10) {
    attempts++
    // 72% of clumps pack the play space so the lawn carpet is continuous
    // underfoot with no bald patches; the rest fade into the far meadow
    const inner = rng.next() < 0.72
    const cx = inner ? -17 + rng.next() * 34 : -34 + rng.next() * 68
    const cz = inner ? -11 + rng.next() * 24 : -28 + rng.next() * 56
    if (!inner && cx > -17 && cx < 17 && cz > -11 && cz < 13) continue
    if (isClear(cx, cz)) continue
    const inYard = cx > YARD.minX && cx < YARD.maxX && cz > YARD.minZ && cz < YARD.maxZ
    // each clump shares a tint family and a base height; a kept lawn is
    // close to uniform green, so straw clumps are rare (~5% overall) and
    // live almost entirely out in the wild meadow
    // a KEPT lawn has no weeds: straw clumps live only out in the wild meadow
    const dry = inYard ? false : rng.next() < 0.09
    const ch = dry ? 0.115 + rng.next() * 0.035 : 0.275 + rng.next() * 0.055
    const cs = dry ? 0.38 + rng.next() * 0.2 : 0.43 + rng.next() * 0.15
    const cl = dry ? 0.42 + rng.next() * 0.18 : 0.3 + rng.next() * 0.16
    // yard blades hug the ground (0.045..0.075 world units) and stay nearly
    // uniform height so the play space reads as a smooth mown carpet, not
    // sprigs sticking up (owner: people found the tall blades "weird"); the
    // meadow beyond keeps the taller, wilder look for character
    const baseH = inYard ? 0.045 + rng.next() * 0.03 : 0.2 + rng.next() * 0.14
    const blades = 4 + Math.floor(rng.next() * 4)
    for (let b = 0; b < blades && placed < COUNT; b++) {
      const a = rng.next() * Math.PI * 2
      const r = rng.next() * 0.11
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r
      if (isClear(x, z)) continue
      // width varies independently of height so the silhouette breaks up
      const sw = 0.7 + rng.next() * 0.9
      const hy = baseH + rng.next() * (inYard ? 0.02 : 0.04)
      pos.set(x, 0, z)
      quat.setFromAxisAngle(up, rng.next() * Math.PI * 2)
      // barely off vertical — neat upright blades are the lawn look, and
      // splayed tilts were what read as weeds sticking out
      quat.multiply(tilt.setFromAxisAngle(side, rng.next() * 0.1))
      // z scales with height so the baked lean stays proportional to it
      const chunk = chunkFor(x, z)
      if (!chunk || chunk.n >= cap) continue
      scl.set(sw, hy, hy)
      m.compose(pos, quat, scl)
      chunk.mesh.setMatrixAt(chunk.n, m)
      chunk.bladeAt[chunk.n * 2] = x
      chunk.bladeAt[chunk.n * 2 + 1] = z
      col.setHSL(
        ch + (rng.next() - 0.5) * 0.01,
        cs + (rng.next() - 0.5) * 0.06,
        cl + (rng.next() - 0.5) * 0.12,
      )
      chunk.mesh.setColorAt(chunk.n, col)
      chunk.n++
      placed++
    }
  }
  for (const c of chunks) {
    c.mesh.count = c.n
    c.mesh.instanceMatrix.needsUpdate = true
    if (c.mesh.instanceColor) c.mesh.instanceColor.needsUpdate = true
  }
  return placed
  }
  scatter()

  const zero = new Matrix4().makeScale(0, 0, 0)
  return {
    update(t: number): void {
      if (timeU) timeU.value = t
    },
    setVisible(on: boolean): void {
      for (const c of chunks) c.mesh.visible = on
    },
    hideIn(rect): void {
      for (const c of chunks) {
        // only chunks that overlap the rect pay the scan (the cell sphere
        // lives on the MESH — the instanced-culling fix moved it there)
        const s = (c.mesh as unknown as { boundingSphere: Sphere }).boundingSphere
        if (
          s.center.x + s.radius < rect.x0 ||
          s.center.x - s.radius > rect.x1 ||
          s.center.z + s.radius < rect.z0 ||
          s.center.z - s.radius > rect.z1
        )
          continue
        let touched = false
        for (let i = 0; i < c.n; i++) {
          const x = c.bladeAt[i * 2]
          const z = c.bladeAt[i * 2 + 1]
          if (x > rect.x0 && x < rect.x1 && z > rect.z0 && z < rect.z1) {
            c.mesh.setMatrixAt(i, zero)
            touched = true
          }
        }
        if (touched) c.mesh.instanceMatrix.needsUpdate = true
      }
    },
    rebuild(): void {
      scatter()
    },
  }
}
