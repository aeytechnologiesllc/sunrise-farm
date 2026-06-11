/** Procedural fleece for the Quaternius Sheep rig (also reused, re-coated, as
 * the goat) — the de-blob pass. The CC0 GLB is the only animated sheep
 * available anywhere, but its body is a literal box and the owner reads it as
 * a blob. At spawn we displace the WOOL vertices only (face, legs, ears keep
 * their authored shape) along seam-welded normals by a seeded, spatially
 * smooth sine field, so every animal grows its own lumpy fleece silhouette.
 *
 * Why this survives skinning: only the position attribute moves, in bind
 * space, so skinIndex/skinWeight stay aligned per vertex and every animation
 * clip plays untouched. Why the geometry is cloned first: SkeletonUtils.clone
 * SHARES geometry buffers between clones — without the clone, displacing one
 * sheep would deform the entire flock identically. Why normals are welded
 * before displacing: the mesh is flat-shaded (2088 verts over 1292 unique
 * positions), and pushing coincident vertices along their own facet normals
 * would crack the surface open at every hard edge. Normals are NOT recomputed
 * afterwards — the amplitude is small enough that the authored faceted
 * shading still reads right, and recomputing would fight the skinned
 * lighting for no visible gain.
 *
 * Cost: one O(verts) CPU pass per spawn (~2k verts, well under a
 * millisecond), zero per-frame work, zero extra draw calls — every
 * SkeletonUtils clone is already its own draw call; this only un-shares the
 * vertex buffer of the body mesh (~130KB per animal). */
import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SkinnedMesh,
  SphereGeometry,
  Texture,
  Vector3,
  type BufferAttribute,
  type InterleavedBufferAttribute,
  type Object3D,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, type Rng } from '../game/rng'

type Attr = BufferAttribute | InterleavedBufferAttribute

/** displacement amplitude as a fraction of the body's bind-space height —
 * big enough that the box silhouette reads as lumpy fleece, small enough
 * that the un-recomputed normals still shade believably */
const AMP_OF_HEIGHT = 0.095
/** uniform outward inflation that rounds off the box's hard corners */
const INFLATE_OF_HEIGHT = 0.02
/** sine-field octaves: two low-frequency lumps (slightly detuned so they do
 * not align into stripes) plus one faint high-frequency ripple. `cycles`
 * counts waves across the body's largest bind-space dimension; weights sum
 * to 1 so the field stays inside ±1. */
const OCTAVES = [
  { cycles: 2.6, weight: 0.42 },
  { cycles: 3.4, weight: 0.42 },
  { cycles: 8, weight: 0.16 },
] as const
/** the fleece must own at least this vertex share for UV detection to win */
const MIN_WOOL_SHARE = 0.25
/** more distinct UV cells than this means a gradient atlas — detection off */
const MAX_UV_CELLS = 16

/** Grow seeded wool on the largest skinned mesh under `model` (the fleece
 * body — face/leg meshes, where split out, are far smaller). Safe on any rig:
 * every unexpected shape (no skinned mesh, missing attributes, mismatched
 * counts, degenerate bounds) leaves the model exactly as authored. */
export function applyWool(model: Object3D, seed: number): void {
  let body: SkinnedMesh | null = null
  let bodyVerts = 0
  model.traverse((o) => {
    if (o instanceof SkinnedMesh) {
      const c = o.geometry.hasAttribute('position') ? o.geometry.getAttribute('position').count : 0
      if (c > bodyVerts) {
        body = o
        bodyVerts = c
      }
    }
  })
  if (!body) return
  const mesh: SkinnedMesh = body
  if (
    !mesh.geometry.hasAttribute('position') ||
    !mesh.geometry.hasAttribute('normal') ||
    !mesh.geometry.hasAttribute('skinIndex') ||
    !mesh.geometry.hasAttribute('skinWeight')
  ) return
  // clone BEFORE touching attributes: SkeletonUtils clones share buffers,
  // and the displaced clone is only swapped in after verification below
  const geo = mesh.geometry.clone()
  const pos = geo.getAttribute('position')
  const nor = geo.getAttribute('normal')
  const skinIndex = geo.getAttribute('skinIndex')
  const skinWeight = geo.getAttribute('skinWeight')
  const vertCount = pos.count
  if (nor.count !== vertCount || skinIndex.count !== vertCount || skinWeight.count !== vertCount) return
  geo.computeBoundingBox()
  const bb = geo.boundingBox
  if (!bb) return
  const height = bb.max.y - bb.min.y
  const maxDim = Math.max(bb.max.x - bb.min.x, height, bb.max.z - bb.min.z)
  if (!(height > 0) || !(maxDim > 0)) return

  const wool = woolFlags(geo.hasAttribute('uv') ? geo.getAttribute('uv') : null, vertCount)

  // weld coincident vertices (flat-shading duplicates carry bit-identical
  // float positions) so each point displaces along ONE averaged normal — no
  // cracks along hard edges, and fleece/skin seam verts move as one piece
  interface WeldPoint {
    px: number
    py: number
    pz: number
    nx: number
    ny: number
    nz: number
    wool: boolean
    dx: number
    dy: number
    dz: number
  }
  const points = new Map<string, WeldPoint>()
  const keyOf = new Array<string>(vertCount)
  for (let i = 0; i < vertCount; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const key = x + ',' + y + ',' + z
    keyOf[i] = key
    let p = points.get(key)
    if (!p) {
      p = { px: x, py: y, pz: z, nx: 0, ny: 0, nz: 0, wool: false, dx: 0, dy: 0, dz: 0 }
      points.set(key, p)
    }
    p.nx += nor.getX(i)
    p.ny += nor.getY(i)
    p.nz += nor.getZ(i)
    if (!wool || wool[i] === 1) p.wool = true
  }

  // seeded smooth field: each octave is one sine wave along its own seeded
  // direction with a seeded phase. Purely position-driven, so coincident
  // vertices always agree and neighbours move together — wool lumps, never
  // per-vertex noise spikes.
  const rng = mulberry32(seed)
  const waves = OCTAVES.map((o) => ({
    dir: seededDirection(rng),
    freq: (Math.PI * 2 * o.cycles) / maxDim,
    phase: rng.next() * Math.PI * 2,
    weight: o.weight,
  }))
  const amp = AMP_OF_HEIGHT * height
  const inflate = INFLATE_OF_HEIGHT * height
  for (const p of points.values()) {
    if (!p.wool) continue
    const len = Math.sqrt(p.nx * p.nx + p.ny * p.ny + p.nz * p.nz)
    if (len < 1e-12) continue
    let field = 0
    for (const w of waves) {
      field += w.weight * Math.sin((p.px * w.dir.x + p.py * w.dir.y + p.pz * w.dir.z) * w.freq + w.phase)
    }
    const scale = (inflate + amp * field) / len
    p.dx = p.nx * scale
    p.dy = p.ny * scale
    p.dz = p.nz * scale
  }

  for (let i = 0; i < vertCount; i++) {
    const p = points.get(keyOf[i])
    if (!p || !p.wool) continue
    pos.setXYZ(i, pos.getX(i) + p.dx, pos.getY(i) + p.dy, pos.getZ(i) + p.dz)
  }
  pos.needsUpdate = true

  // skinning stays aligned only while attribute lengths agree — verify after
  // displacing, before the swap, so a regression is loud and harmless
  if (pos.count !== vertCount || skinIndex.count !== vertCount || skinWeight.count !== vertCount) {
    console.warn('[wool] attribute counts diverged — keeping the undisplaced body')
    return
  }
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  mesh.geometry = geo

  // vertex displacement softens the silhouette, but a flat-shaded box still
  // SHADES like a box — so the torso also gets a real wool VOLUME riding the
  // Body bone. The boxy trunk hides inside the puff; face, legs and the
  // animations stay authored.
  addFleecePuff(model, mesh, rng)
}

/** wool VOLUME parented to the Body bone (rigid ride is fine — that bone
 * carries the torso through every clip): a cluster of small low-poly,
 * flat-shaded balls along the back, the timeless cartoon-sheep read. Flat
 * facets keep it matte and matched to the pack's art style (a single smooth
 * ellipsoid read as a slick metal blob — tried and rejected). Merged into
 * one geometry: +1 draw call per animal. */
function addFleecePuff(model: Object3D, body: SkinnedMesh, rng: Rng): void {
  const bone = model.getObjectByName('Body')
  if (!bone) return
  model.updateMatrixWorld(true)
  body.computeBoundingBox()
  if (!body.boundingBox) return
  const bb = body.boundingBox.clone().applyMatrix4(body.matrixWorld)
  const size = bb.getSize(new Vector3())
  const center = bb.getCenter(new Vector3())
  if (!(size.y > 0)) return

  // coat color comes from the (already re-coated) body material, lifted a hair
  const m = Array.isArray(body.material) ? body.material[0] : body.material
  const coat = m instanceof MeshStandardMaterial ? m.color.clone() : new Color('#e8e0d0')
  coat.offsetHSL(0, -0.02, 0.06)

  // curls: balls marching down the spine with seeded jitter, plus haunch and
  // shoulder balls — sized against the torso (model faces +z, legs below)
  const baseR = size.y * 0.21
  const spineY = size.y * 0.16
  const balls: Array<[number, number, number, number]> = []
  const n = 5
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5
    balls.push([
      (rng.next() - 0.5) * size.x * 0.16,
      spineY + (rng.next() - 0.5) * size.y * 0.07,
      t * size.z * 0.52,
      baseR * (0.92 + rng.next() * 0.3),
    ])
  }
  for (const sx of [-1, 1]) {
    balls.push([sx * size.x * 0.22, spineY * 0.35, -size.z * 0.2 + rng.next() * 0.05, baseR * (1.0 + rng.next() * 0.2)])
    balls.push([sx * size.x * 0.2, spineY * 0.45, size.z * 0.16 + rng.next() * 0.05, baseR * (0.9 + rng.next() * 0.2)])
  }
  const geos: SphereGeometry[] = []
  for (const [bx, by, bz, r] of balls) {
    const s = new SphereGeometry(r, 7, 6)
    s.rotateY(rng.next() * Math.PI)
    s.translate(bx, by, bz)
    geos.push(s)
  }
  const merged = mergeGeometries(geos.map((g) => g.toNonIndexed()))
  if (!merged) return
  const puff = new Mesh(merged, new MeshStandardMaterial({ color: coat, roughness: 1, flatShading: true }))
  puff.castShadow = true

  // align-space = model/world axes: cancel the bone's bind rotation, then
  // place the cluster at the measured torso center (converted to bone scale)
  const align = new Group()
  align.quaternion.copy(bone.getWorldQuaternion(new Quaternion()).invert())
  const bs = bone.getWorldScale(new Vector3()).x || 1
  const bonePos = bone.getWorldPosition(new Vector3())
  puff.position.copy(center).sub(bonePos).divideScalar(bs)
  puff.scale.setScalar(1 / bs)
  align.add(puff)
  bone.add(align)
}

/** Set a saturated base coat on every standard material under `model`.
 * assets.tint() can only OFFSET hue/lightness, and the sheep atlas material
 * starts pure white (saturation 0) — offsetting the hue of white is a no-op,
 * so a goat could only ever be a gray sheep. Setting an HSL base first gives
 * the shared rig a real coat color that the per-animal tint then drifts
 * around. (spawnSkinned clones materials per animal, so this never bleeds.) */
export function setCoatHSL(model: Object3D, h: number, s: number, l: number): void {
  model.traverse((o) => {
    if (o instanceof Mesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (m instanceof MeshStandardMaterial) {
          m.color.setHSL(h, s, l)
          // the FBX2glTF export ships metallicFactor=1 — that's why the
          // fleece read as dark polished steel; wool is the opposite of metal
          m.metalness = 0
          m.roughness = 1
          // the atlas paints the fleece cell mid-gray rgb(~159): every coat
          // multiplies DOWN to stone. Brighten the near-gray cells once so
          // coats actually show (face/hoof cells are colored — untouched).
          if (m.map && m.map.image) m.map = brightenGrayCells(m.map)
        }
      }
    }
  })
}

const brightened = new WeakMap<object, Texture>()

/** push near-neutral mid-gray atlas cells toward white, preserving GLTF
 * texture orientation/colorspace; cached per source texture */
function brightenGrayCells(src: Texture): Texture {
  const hit = brightened.get(src.image as object)
  if (hit) return hit
  try {
    const img = src.image as { width: number; height: number }
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')!
    g.drawImage(src.image as CanvasImageSource, 0, 0)
    const data = g.getImageData(0, 0, c.width, c.height)
    const d = data.data
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]
      const gg = d[i + 1]
      const b = d[i + 2]
      if (Math.abs(r - gg) < 10 && Math.abs(gg - b) < 10 && r > 120 && r < 195) {
        const k = 240 / r
        d[i] = Math.min(255, r * k)
        d[i + 1] = Math.min(255, gg * k)
        d[i + 2] = Math.min(255, b * k)
      }
    }
    g.putImageData(data, 0, 0)
    const out = new CanvasTexture(c)
    out.flipY = src.flipY
    out.colorSpace = src.colorSpace
    out.wrapS = src.wrapS
    out.wrapT = src.wrapT
    out.magFilter = src.magFilter
    out.minFilter = src.minFilter
    brightened.set(src.image as object, out)
    return out
  } catch {
    return src // tainted/unreadable image: keep the original
  }
}

/** Per-vertex fleece flags, or null to displace the whole mesh. The
 * Quaternius atlas point-samples flat color cells, so every vertex carries
 * one of a handful of exact UV values (measured on Sheep.glb: fleece gray
 * rgb(159,159,159) at uv≈(0.41, 0.91) on 792 of 2088 verts; the skin, hoof
 * and ear cells are all smaller). The texture itself is not readable here
 * (tests run in node — no canvas), but the fleece is reliably the LARGEST UV
 * cluster: it shells most of the body. Anything that breaks the assumption
 * (no uv channel, a single cell, a true gradient atlas, no dominant cluster)
 * falls back to all-wool rather than guessing. */
function woolFlags(uv: Attr | null, count: number): Uint8Array | null {
  if (!uv || uv.count !== count) return null
  const cells = new Map<string, number>()
  const cellOf = new Array<string>(count)
  for (let i = 0; i < count; i++) {
    const key = Math.round(uv.getX(i) * 1000) + ':' + Math.round(uv.getY(i) * 1000)
    cellOf[i] = key
    cells.set(key, (cells.get(key) ?? 0) + 1)
  }
  if (cells.size < 2 || cells.size > MAX_UV_CELLS) return null
  let best = ''
  let bestN = 0
  for (const [key, n] of cells) {
    if (n > bestN) {
      best = key
      bestN = n
    }
  }
  if (bestN < count * MIN_WOOL_SHARE) return null
  const flags = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    if (cellOf[i] === best) flags[i] = 1
  }
  return flags
}

/** uniformly distributed unit vector drawn from the seeded stream */
function seededDirection(rng: Rng): Vector3 {
  const z = rng.next() * 2 - 1
  const a = rng.next() * Math.PI * 2
  const r = Math.sqrt(Math.max(0, 1 - z * z))
  return new Vector3(Math.cos(a) * r, Math.sin(a) * r, z)
}
