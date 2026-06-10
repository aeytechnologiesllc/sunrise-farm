# 3D Model Manifest — game3 farm assets

All assets CC0 1.0 (no attribution required). Downloaded 2026-06-10. Every GLB below was
machine-verified: GLB header + declared length checked, JSON chunk parsed, and all external
URI references confirmed to exist on disk (642 GLBs, 0 failures).

> IMPORTANT (proven in sibling project): the Kenney `survival-kit`, `food-kit`, and
> `mini-characters` GLBs reference an EXTERNAL `Textures/colormap.png` relative to the GLB.
> Keep each pack folder intact — do not move a .glb out of its folder without also shipping
> its `Textures/` sibling. `nature-kit` and all Quaternius GLBs are fully self-contained
> (embedded buffers/textures).

---

## quaternius/ultimate-animated-animals/
- Source: Quaternius — "Ultimate Animated Animals" pack, https://quaternius.com/packs/ultimateanimatedanimals.html (official Google Drive distribution, glTF folder; embedded-base64 .gltf repacked losslessly to binary .glb locally)
- License: CC0 (see `License.txt` in folder, from the pack itself)
- Skinned + animated. No external textures (vertex-color materials).

| File | Animation clips |
|---|---|
| `Cow.glb` | Attack_Headbutt, Attack_Kick, Death, Eating, Gallop, Gallop_Jump, Idle, Idle_2, Idle_Headlow, Idle_HitReact1, Idle_HitReact2, Jump_toIdle, Walk |
| `Horse.glb` | same clip set as Cow |
| `Donkey.glb` | same clip set as Cow |
| `ShibaInu.glb` (dog) | Attack, Death, Eating, Gallop, Gallop_Jump, Idle, Idle_2, Idle_2_HeadLow, Idle_HitReact1, Idle_HitReact2, Jump_ToIdle, Walk |

Pack also offers (not downloaded): Alpaca, Bull, Deer, Fox, Horse_White, Husky, Stag, Wolf —
same Drive folder if needed later.

## quaternius/animated-chickens/
- Source: models authored by Quaternius, mirrored via Poly Pizza CDN (static.poly.pizza) —
  quaternius.com's own animal packs contain no chicken; Poly Pizza hosts Quaternius's full
  CC0 catalog. Model pages: https://poly.pizza/m/ineV9pU5VL (Chicken),
  https://poly.pizza/m/Z3RCoCYss4 (Hen), https://poly.pizza/m/LH96IMq0rE (Chick)
- License: CC0 1.0 (stated on each model page)
- Skinned + animated. Self-contained GLBs (Hen/Chick embed a PNG texture).

| File | Animation clips |
|---|---|
| `Chicken.glb` (toon-style) | CharacterArmature\|Bite_Front, Dance, Death, HitRecieve, Idle, Jump, No, Walk, Yes |
| `Hen.glb` (farm-style, textured) | AnimalArmature…\|Attack, Death, Idle, Idle_Peck, Run |
| `Chick.glb` (baby, textured) | AnimalArmature…\|Attack, Death, Idle, Idle_Peck, Run |

Note: clip names carry armature prefixes (e.g. `CharacterArmature|Walk`,
`AnimalArmature|AnimalArmature|AnimalArmature|Idle_Peck`) — match by suffix in code.
`Hen.glb`/`Chick.glb` have no Walk clip; use `Run` at reduced timeScale. `Idle_Peck` = eating.

## kenney/nature-kit/
- Source: Kenney — "Nature Kit", https://kenney.nl/assets/nature-kit (kenney_nature-kit.zip, Models/GLTF format)
- License: CC0 (see `License.txt` in folder)
- 329 static GLBs, fully self-contained (no external textures). No animations.
- Farm highlights: `fence_simple/_simpleLow/_simpleHigh/_corner/_bend/_gate/_planks…` (12 fence pieces),
  `crops_cornStageA–D`, `crops_wheatStageA–B`, `crops_leafsStageA–B`, `crops_bambooStageA–B`,
  `crops_dirtRow*/dirtDoubleRow*/dirtSingle` (tillable plot pieces), `plant_bush*`, `plant_flat*`,
  trees, cliffs, paths, rocks, mushrooms, bridges.

## kenney/survival-kit/
- Source: Kenney — "Survival Kit", https://kenney.nl/assets/survival-kit (kenney_survival-kit.zip, Models/GLB format)
- License: CC0 (see `License.txt` in folder)
- 80 static GLBs + `chest.glb` animated (clips: open, close, open-close).
- REQUIRES sibling `Textures/colormap.png` (kept in folder).
- Farm highlights: `fence.glb`, `fence-doorway.glb`, `fence-fortified.glb`, `tool-hoe.glb`,
  `tool-axe/shovel/pickaxe/hammer(-upgraded).glb`, `bucket.glb`, `barrel.glb`, `box*.glb`,
  `grass*/patch-grass*.glb`, `resource-wood/stone/planks.glb`, `tent*`, `workbench*`.

## kenney/food-kit/
- Source: Kenney — "Food Kit", https://kenney.nl/assets/food-kit (kenney_food-kit.zip, Models/GLB format)
- License: CC0 (see `License.txt` in folder)
- 200 static GLBs. REQUIRES sibling `Textures/colormap.png` (kept in folder).
- Farm produce: `carrot.glb`, `corn.glb`, `pumpkin.glb`, `pumpkin-basic.glb`, `tomato.glb`,
  `eggplant.glb`, `egg.glb`, `apple.glb`, `cabbage.glb` etc. — good as harvest/inventory items.

## kenney/mini-characters/
- Source: Kenney — "Mini Characters", https://kenney.nl/assets/mini-characters (kenney_mini-characters.zip, Models/GLB format)
- License: CC0 (see `License.txt` in folder)
- 26 GLBs; 12 are fully rigged + animated characters (`character-female-a…f.glb`,
  `character-male-a…f.glb`) — usable as the farmer/NPCs. REQUIRES sibling `Textures/colormap.png`.
- Shared clip set per character (32 clips): static, idle, walk, sprint, jump, fall, crouch, sit,
  drive, die, pick-up, emote-yes, emote-no, holding-right/left/both(+-shoot),
  attack-melee-right/left, attack-kick-right/left, interact-right/left, wheelchair-* (7 clips).

---

## Loading notes (three.js)
- All files load with `GLTFLoader` as-is; clips are in `gltf.animations`.
- For Kenney packs with external textures, load via the pack folder URL so the relative
  `Textures/colormap.png` resolves, e.g. `loader.load('/models/kenney/survival-kit/fence.glb')`.
- Quaternius UAA models are ~1.7–2.2 MB each (embedded animation data); consider
  `gltf-transform optimize` (draco/meshopt) later if bundle size matters.
