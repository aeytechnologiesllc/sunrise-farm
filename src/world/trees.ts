/** Proper trees — textured bark trunks + branches, crowns made of dozens of
 * leafy alpha-cutout cards with spherical normals (they shade like a volume,
 * not like flat posters), pines as needle-textured cone stacks.
 * Everything bakes into a handful of merged meshes: 1 bark draw, 2 foliage
 * draws (two leaf palettes), 1 needle draw. Foliage casts REAL cutout
 * shadows via a custom depth material. */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Matrix4,
  Mesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Object3D,
  Quaternion,
  RGBADepthPacking,
  Scene,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, type Rng } from '../game/rng'
import { barkCanvas, foliageCanvas, needleCanvas, toTexture } from './textures'

interface TreeBins {
  bark: BufferGeometry[]
  leafA: BufferGeometry[]
  leafB: BufferGeometry[]
  needle: BufferGeometry[]
}

const tmpM = new Matrix4()
const tmpQ = new Quaternion()
const tmpV = new Vector3()

/** one leafy card: world-space quad, spherical normals around `crown`,
 * per-vertex tint color */
function leafCard(
  rng: Rng,
  at: Vector3,
  size: number,
  crown: Vector3,
  tint: Color,
): BufferGeometry {
  const p = new PlaneGeometry(size, size)
  tmpQ.setFromEuler(new Euler(rng.next() * Math.PI, rng.next() * Math.PI * 2, rng.next() * Math.PI))
  tmpM.compose(at, tmpQ, tmpV.set(1, 1, 1))
  p.applyMatrix4(tmpM)
  const pos = p.getAttribute('position')
  const nrm = p.getAttribute('normal')
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const n = tmpV.set(pos.getX(i) - crown.x, pos.getY(i) - crown.y, pos.getZ(i) - crown.z).normalize()
    nrm.setXYZ(i, n.x, n.y, n.z)
    col[i * 3] = tint.r
    col[i * 3 + 1] = tint.g
    col[i * 3 + 2] = tint.b
  }
  p.setAttribute('color', new BufferAttribute(col, 3))
  return p
}

function makeOak(bins: TreeBins, rng: Rng, x: number, z: number, big = false): void {
  const h = (big ? 2.6 : 2.0) + rng.next() * 0.9
  const lean = (rng.next() - 0.5) * 0.14
  const trunk = new CylinderGeometry(0.13 + rng.next() * 0.05, 0.26 + rng.next() * 0.09, h, 7, 2)
  trunk.translate(0, h / 2, 0)
  trunk.rotateZ(lean)
  trunk.rotateY(rng.next() * Math.PI * 2)
  trunk.translate(x, 0, z)
  bins.bark.push(trunk)

  const crown = new Vector3(x - Math.sin(lean) * h * 0.5, h + 0.8 + rng.next() * 0.3, z)
  const crownR = (big ? 1.9 : 1.55) + rng.next() * 0.5

  // a few branches reaching into the crown
  const branches = 2 + Math.floor(rng.next() * 2)
  for (let b = 0; b < branches; b++) {
    const len = 0.9 + rng.next() * 0.6
    const br = new CylinderGeometry(0.045, 0.085, len, 5, 1)
    br.translate(0, len / 2, 0)
    br.rotateZ(0.55 + rng.next() * 0.5)
    br.rotateY(rng.next() * Math.PI * 2)
    br.translate(x, h - 0.25 - rng.next() * 0.3, z)
    bins.bark.push(br)
  }

  // crown cards in an ellipsoid shell
  const bin = rng.next() > 0.5 ? bins.leafA : bins.leafB
  const cards = 13 + Math.floor(rng.next() * 5)
  const treeTint = 0.84 + rng.next() * 0.22
  for (let i = 0; i < cards; i++) {
    const a = rng.next() * Math.PI * 2
    const b = Math.acos(2 * rng.next() - 1)
    const rr = crownR * (0.35 + 0.65 * rng.next())
    const at = new Vector3(
      crown.x + Math.sin(b) * Math.cos(a) * rr,
      crown.y + Math.cos(b) * rr * 0.78,
      crown.z + Math.sin(b) * Math.sin(a) * rr,
    )
    // upper cards brighter, lower cards in shade
    const heightK = 0.72 + 0.45 * ((at.y - crown.y) / crownR + 1) * 0.5
    const k = Math.min(1.15, heightK * treeTint + rng.next() * 0.06)
    const tint = new Color(k, k * (0.98 + rng.next() * 0.04), k * 0.92)
    bin.push(leafCard(rng, at, (big ? 2.5 : 2.1) + rng.next() * 0.9, crown, tint))
  }
}

function makePine(bins: TreeBins, rng: Rng, x: number, z: number): void {
  const trunkH = 1.3 + rng.next() * 0.5
  const trunk = new CylinderGeometry(0.12, 0.2, trunkH + 0.6, 7, 1)
  trunk.translate(x, (trunkH + 0.6) / 2, z)
  bins.bark.push(trunk)
  let y = trunkH
  let r = 1.3 + rng.next() * 0.35
  const tiers = 3 + (rng.next() > 0.55 ? 1 : 0)
  for (let i = 0; i < tiers; i++) {
    const ch = 1.5 - i * 0.18
    const cone = new ConeGeometry(r, ch, 9, 1)
    cone.translate(x, y + ch * 0.42, z)
    bins.needle.push(cone)
    y += ch * 0.55
    r *= 0.74
  }
}

function makeBush(bins: TreeBins, rng: Rng, x: number, z: number): void {
  const crown = new Vector3(x, 0.34, z)
  const bin = rng.next() > 0.5 ? bins.leafA : bins.leafB
  const n = 5 + Math.floor(rng.next() * 3)
  for (let i = 0; i < n; i++) {
    const at = new Vector3(
      x + (rng.next() - 0.5) * 0.7,
      0.22 + rng.next() * 0.4,
      z + (rng.next() - 0.5) * 0.7,
    )
    const k = 0.8 + rng.next() * 0.3
    bin.push(leafCard(rng, at, 0.8 + rng.next() * 0.5, crown, new Color(k, k, k * 0.94)))
  }
}

/** plant the whole forest + bush scatter; isClear says where NOT to grow */
export function buildForest(scene: Scene, isClear: (x: number, z: number) => boolean): Group {
  // everything lands in one group so interiors can hide the whole forest
  const forestRoot = new Group()
  scene.add(forestRoot)
  const sceneProxy = { add: (o: Object3D) => forestRoot.add(o) } as unknown as Scene
  scene = sceneProxy
  const rng = mulberry32(7771234)
  const bins: TreeBins = { bark: [], leafA: [], leafB: [], needle: [] }

  // ring of mature trees pushed WELL outside the maximum farm footprint —
  // the owner kept losing the farmer behind trunks as the farm expanded
  // toward the old 18.5u ring, and no tree may ever stand between the
  // follow-camera and the play space
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + rng.next() * 0.26
    const r = 23.5 + rng.next() * 8.5
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r * 0.92
    if (isClear(x, z)) continue
    const roll = rng.next()
    if (roll < 0.3) makePine(bins, rng, x, z)
    else makeOak(bins, rng, x, z, roll > 0.8)
  }

  // bush scatter
  for (let i = 0; i < 26; i++) {
    const x = (rng.next() - 0.5) * 38
    const z = (rng.next() - 0.5) * 32 + 1
    if (isClear(x, z)) continue
    makeBush(bins, rng, x, z)
  }

  // ---- bake to 4 meshes -------------------------------------------------
  const texRng = mulberry32(555888)
  const barkTex = toTexture(barkCanvas(texRng), true)
  barkTex.repeat.set(1, 2)
  const needleTex = toTexture(needleCanvas(texRng), true)
  needleTex.repeat.set(3, 1.5)
  const leafTexA = toTexture(foliageCanvas(texRng, -0.12))
  const leafTexB = toTexture(foliageCanvas(texRng, 0.38))

  const addMerged = (geos: BufferGeometry[], mat: MeshStandardMaterial, leafTexture?: ReturnType<typeof toTexture>): void => {
    if (geos.length === 0) return
    const merged = mergeGeometries(geos)
    if (!merged) return
    const mesh = new Mesh(merged, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    if (leafTexture) {
      // cutout-correct shadows for alpha-tested foliage
      mesh.customDepthMaterial = new MeshDepthMaterial({
        depthPacking: RGBADepthPacking,
        map: leafTexture,
        alphaTest: 0.42,
      })
    }
    scene.add(mesh)
  }

  addMerged(bins.bark, new MeshStandardMaterial({ map: barkTex, roughness: 1 }))
  addMerged(bins.needle, new MeshStandardMaterial({ map: needleTex, roughness: 1 }))
  const leafMat = (tex: ReturnType<typeof toTexture>): MeshStandardMaterial =>
    new MeshStandardMaterial({
      map: tex,
      alphaTest: 0.42,
      side: DoubleSide,
      vertexColors: true,
      roughness: 1,
    })
  addMerged(bins.leafA, leafMat(leafTexA), leafTexA)
  addMerged(bins.leafB, leafMat(leafTexB), leafTexB)
  return forestRoot
}
