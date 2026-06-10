/** GLB loading + cloning. Kenney survival/food kits resolve an external
 * Textures/colormap.png relative to the GLB URL — keep pack folders intact. */
import { Group, Mesh, MeshStandardMaterial, SkinnedMesh, type AnimationClip, type Object3D } from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

const NATURE = '/models/kenney/nature-kit'
const FOOD = '/models/kenney/food-kit'
const SURVIVAL = '/models/kenney/survival-kit'
const QUAT = '/models/quaternius'

// NOTE: the hen is procedurally sculpted in Chicken.ts — both chicken GLBs in
// public/models read as blobs at gameplay distance (Hen.glb = gray box stack,
// Chicken.glb = a literal "Chicken_Blob" head mesh with no body silhouette).
// Customers are the SAME adult Quaternius family as the farmer (identical
// CharacterArmature rig + clip set) — the chibi Kenney minis are retired.
export const MODEL_URLS = {
  dog: `${QUAT}/ultimate-animated-animals/ShibaInu.glb`,
  sheep: `${QUAT}/animals-extra/Sheep.glb`,
  horse: `${QUAT}/ultimate-animated-animals/Horse.glb`,
  cow: `${QUAT}/ultimate-animated-animals/Cow.glb`,
  // no CC0 animated goat exists anywhere (verified 2026-06-10) — the goats
  // are smaller, darker-tinted sheep from the same rig family
  goat: `${QUAT}/animals-extra/Sheep.glb`,
  farmer: `${QUAT}/characters/Farmer.glb`,
  customerA: `${QUAT}/characters/Worker.glb`,
  customerB: `${QUAT}/characters/Adventurer.glb`,
  customerC: `${QUAT}/characters/Casual.glb`,
  signpost: `${SURVIVAL}/signpost.glb`,
  chest: `${SURVIVAL}/chest.glb`,
  egg: `${FOOD}/egg.glb`,
  cornItem: `${FOOD}/corn.glb`,
  pumpkinItem: `${FOOD}/pumpkin.glb`,
  wheatA: `${NATURE}/crops_wheatStageA.glb`,
  wheatB: `${NATURE}/crops_wheatStageB.glb`,
  cornA: `${NATURE}/crops_cornStageA.glb`,
  cornB: `${NATURE}/crops_cornStageB.glb`,
  cornC: `${NATURE}/crops_cornStageC.glb`,
  cornD: `${NATURE}/crops_cornStageD.glb`,
  dirt: `${NATURE}/crops_dirtSingle.glb`,
  fence: `${NATURE}/fence_simple.glb`,
  fenceCorner: `${NATURE}/fence_corner.glb`,
  fenceGate: `${NATURE}/fence_gate.glb`,
  pathStone: `${NATURE}/path_stone.glb`,
  treeA: `${NATURE}/tree_default.glb`,
  treeB: `${NATURE}/tree_oak.glb`,
  treeC: `${NATURE}/tree_fat.glb`,
  pine: `${NATURE}/tree_pineRoundA.glb`,
  bush: `${NATURE}/plant_bushDetailed.glb`,
  flowerR: `${NATURE}/flower_redA.glb`,
  flowerY: `${NATURE}/flower_yellowB.glb`,
  flowerP: `${NATURE}/flower_purpleA.glb`,
  rock: `${NATURE}/rock_smallB.glb`,
  rockTall: `${NATURE}/rock_smallE.glb`,
  stump: `${NATURE}/stump_round.glb`,
  grassTuft: `${NATURE}/grass_leafs.glb`,
  grassLarge: `${NATURE}/grass_large.glb`,
  mushroom: `${NATURE}/mushroom_redGroup.glb`,
  bushLarge: `${NATURE}/plant_bushLarge.glb`,
  flowerR2: `${NATURE}/flower_redC.glb`,
  flowerY2: `${NATURE}/flower_yellowC.glb`,
  barrel: `${SURVIVAL}/barrel.glb`,
  box: `${SURVIVAL}/box.glb`,
  boxLarge: `${SURVIVAL}/box-large.glb`,
} as const

export type ModelKey = keyof typeof MODEL_URLS

export class Assets {
  private gltfs = new Map<ModelKey, GLTF>()

  async loadAll(onProgress?: (done: number, total: number) => void): Promise<void> {
    const loader = new GLTFLoader()
    const entries = Object.entries(MODEL_URLS) as Array<[ModelKey, string]>
    let done = 0
    await Promise.all(
      entries.map(async ([key, url]) => {
        const gltf = await loader.loadAsync(url)
        this.gltfs.set(key, gltf)
        done += 1
        onProgress?.(done, entries.length)
      }),
    )
  }

  clips(key: ModelKey): AnimationClip[] {
    return this.gltfs.get(key)?.animations ?? []
  }

  /** Static clone with shadows. `uniqueMaterials` when emissive will be animated. */
  spawn(key: ModelKey, uniqueMaterials = false): Group {
    const src = this.gltfs.get(key)
    if (!src) throw new Error(`asset not loaded: ${key}`)
    const obj = src.scene.clone(true)
    prepare(obj, uniqueMaterials)
    const g = new Group()
    g.add(obj)
    return g
  }

  /** SkeletonUtils clone for skinned/animated rigs. */
  spawnSkinned(key: ModelKey): Group {
    const src = this.gltfs.get(key)
    if (!src) throw new Error(`asset not loaded: ${key}`)
    const obj = cloneSkinned(src.scene)
    prepare(obj, true)
    const g = new Group()
    g.add(obj)
    return g
  }
}

function prepare(obj: Object3D, uniqueMaterials: boolean): void {
  obj.traverse((o) => {
    if (o instanceof Mesh) {
      o.castShadow = true
      o.receiveShadow = true
      // skinned rigs whose vertices live in tiny bind space (e.g. Quaternius
      // characters: ~0.02u verts + 100x armature) get culled by their raw
      // geometry bounds — never cull animated meshes
      if (o instanceof SkinnedMesh) o.frustumCulled = false
      if (uniqueMaterials) {
        o.material = Array.isArray(o.material)
          ? o.material.map((m) => m.clone())
          : o.material.clone()
      }
    }
  })
}

/** Pulse emissive gold on every standard material under `obj` (0..1). */
export function setEmissive(obj: Object3D, intensity: number): void {
  obj.traverse((o) => {
    if (o instanceof Mesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (m instanceof MeshStandardMaterial) {
          m.emissive.setRGB(1, 0.82, 0.35)
          m.emissiveIntensity = intensity
        }
      }
    }
  })
}

/** Per-animal seeded tint/size variety. */
export function tint(obj: Object3D, hueShift: number, lightness: number): void {
  obj.traverse((o) => {
    if (o instanceof Mesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (m instanceof MeshStandardMaterial) {
          m.color.offsetHSL(hueShift, 0, lightness)
        }
      }
    }
  })
}
