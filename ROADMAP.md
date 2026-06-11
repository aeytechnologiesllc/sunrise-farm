# Sunrise Farm — Full Story Roadmap (designed 2026-06-11)

Eight shippable phases from today's build to the complete vision: living sky and
weather, turning seasons, a horse-delivery story you can watch, and Millbrook —
the town your farm builds. Synthesized from a code audit of this repo, cozy-sim
design research (Stardew/ACNH/Harvest Moon retention literature), and three.js
mobile weather-tech research; three competing roadmaps were drafted and judged
(winner: retention-first, merged with the engineering-first sequencing and the
story-first "one cast" rule).

**Iron laws for every phase** (from the audit and the house rules):
- Deterministic: weather/seasons roll from a dedicated `weatherSeed` stream
  keyed by day — NEVER the shared `state.rng` (gameplay-roll order hazard,
  Game.ts syncRng). No setTimeout, no raw Math.random, engine clock only.
- Save-compatible: every new field gets a `??=` backfill in deserialize.
- Mobile 60fps: particles are ONE draw call (InstancedMesh/Points, GPU-animated
  via uTime like the grass wind shader); phone budgets in scope notes.
- No-blob art: snow/weather/town are shader tints and textured kit assets,
  never flat-colored primitives.
- Cozy no-punishment: weather and seasons are GIFTS (rain waters crops free,
  seasons add — they never destroy). No crop death, ever. Festivals run
  alongside play, never pause it.
- Cinematic guards: weather composes BEFORE the night blend in DayCycle.apply
  (sleep cutscene always wins); rain/snow volumes hidden while
  sleepActive/interiorShot; weather windows end by dayPhase ~0.85 (dusk park).

---

## Phase 1 — Hazel's Story: a delivery you can finally see [M]
Pure legibility pass, zero economy changes (75s run / 200s cooldown / 26-42c).
- Button states the trip ("Send Hazel — 75s") per the plant-button convention.
- Departure ceremony: crate-load beat at the stable, "−1 wheat" float, Hazel
  name tag (extend the chicken-only tag), order names cargo + buyer +
  destination ("6 wheat → Rosie's order, Millbrook") from the seeded stream.
- A textured town gate/signpost at the road's east end; sendRun waypoints
  extended so she despawns BEYOND it (today she vanishes in plain sight at
  (21,11), 2u past the player bound).
- While away: delivery chip with ring countdown reading produce.deliveryT (the
  logic truth — never Grazers visual state).
- Return: synced gallop + itemized receipt banner naming who bought what.
- Bug fixes from audit: coin fountain fires from mirrored screen pos when the
  stable is behind the camera; deliveryDone toast lacks a sleepActive guard;
  reload mid-run teleports her back with no return gallop; offline completion
  pays a silent flat 34c — surface it in a "while you were away" note (keep the
  flat pay — determinism rule for offline).

## Phase 2 — Forecast core & overcast skies (thin weather slice) [M]
The deterministic spine; zero particles.
- New pure `src/game/weather.ts`: per-day forecast = f(weatherSeed, day) via
  mulberry32(hash); kinds clear|breezy|overcast; vitest coverage; weatherSeed
  backfill `??= (s.rng ^ 0x9e3779b9)>>>0`.
- DayCycle `setOvercast(k)` cloned from the setNight(k) post-multiply pattern,
  composed BEFORE the night block. God rays die by lerping sunDisk color toward
  fog/bg (never toggle the EffectPass — shader recompile hitch).
- Weather owns fog near/far (DayCycle keeps fog.color); near-fog floor ≥35 for
  phone-landscape readability.
- Drive the existing 6 drift clouds greyer/lower via their one shared material.
- Dawn banner announces the day's mood + hints at tomorrow.

## Phase 3 — Rain as a gift: particles, sound, the free morning [M]
- ONE InstancedMesh of stretched quads (~600-900 phone / 1500-2500 desktop),
  fall animated in the vertex shader, camera-following ~18u box, depthWrite
  off; pooled instanced splash rings at fixed ground height.
- Looping filtered-noise rain audio inside Sfx with setRain(k) gain (rides the
  iOS silent-switch session unlock).
- Cozy law: rain auto-waters all outdoor crops → "Rain day — morning off!"
  banner. Rain exclusives so players HOPE for rain: post-rain mushroom forage,
  dog puddle-play, a rain-only umbrella visitor (lands fully in Phase 4).
- Forecast notice-board prop at the farmhouse; weather line on the star-gaze
  day-tally card. Optional distant thunder: ambient/fog color spike 2-3 frames,
  scheduled from the day-keyed stream, gated off during sleep.

## Phase 4 — The Regulars: named neighbors with standing orders [M]
- Persistent seeded roster of 4-6 named neighbors (Rosie, Martha, Tom…):
  identity, favorite goods, standing orders, per-neighbor streaks → bigger
  orders + warmer greetings. Pure logic + vitest.
- ONE CAST rule: Hazel's delivery buyers ARE the stand regulars. Rosie
  foreshadows her bakery. Weather small-talk reads Phase 2/3 state.
- Textured Quaternius characters (already in public/models), name tags, the
  notice board becomes the planning hub (forecast + today's standing orders).

## Phase 5 — The Turning Year: season engine & world retint [L]
One-time material surgery, done exactly once.
- season = pure f(day), ~10 in-game days each; season-weighted forecast tables;
  seasonOffset ??= 0.
- Shared uSeasonTint + uSnowK uniforms injected via onBeforeCompile into grass
  (existing color_fragment hook), ground (existing uDetail hook — buildGround
  must return handles; tint the 700×700 horizon skirt in lockstep), trees
  (first injection; buildForest must return handles). Coordinate the stragglers:
  baked flowers, field soil, painted ground canvas — or seams show.
- Per-season sun keyframes/palettes in DayCycle (low pale winter sun, golden
  summer). Seasons gate ADDITIONS only: seasonal seeds in the shop, neighbors
  switch orders. Last-call warning before season turn; nothing ever dies
  (uSnowK ships dormant at 0 for Phase 6).

## Phase 6 — Winter Wonder: snow without the trough [M]
- Flakes: ONE Points system (soft-dot sprite, ~400 phone / 900 desktop),
  NightSky master-fade lifecycle, inherits rain's camera box + cutscene gates.
- Accumulation: animate uSnowK — mix toward white by dot(worldNormal, up)
  across already-instrumented materials. Zero new geometry.
- Winter is the ANIMAL and TOWN season (no Stardew shutdown): wool peaks,
  eggs/milk continue, Hazel delivers through snow, greenhouse farms on.
- Pure-joy toys: buildable snowman, paw prints, frost breath. Update FTUE
  guidance for winter starts (Game.suggestion must not strand new players).

## Phase 7 — Rosie's Bakery: the first building of Millbrook [M]
- New ladder rung funded with coins + produce delivered by Hazel (contract
  orders extend produce.ts, reusing the whole Phase 1 delivery pipeline).
- Textured bakery facade past the town gate (outside player bound maxX=19 — no
  nav work; inside dome r240). Construction cutscene + scaffold rising over
  days + premium skippable ribbon-cutting with the named cast.
- Once open: Rosie's standing order upgrades to a daily bakery contract —
  wheat in, better pay, light upkeep (everything earns).

## Phase 8 — Millbrook Rising: town tiers, chains & festival nights [L]
- `src/game/town.ts`: tiers driven by cumulative delivered produce — butcher,
  school, supermarket, tailor — each a construction arc + opening beat + richer
  delivery destination. Facades fill the east-road skyline (merged statics).
- Production chains: wool/sheepskin → coats at the tailor (the premium winter
  order, crowning Phase 6), then milk → cheese.
- A bus on a seeded schedule brings one-off visitors via the existing offstage
  entry. Town ledger screen (every shop, lifetime sold, next unlock).
- One festival per season alongside normal play; flagship mid-winter night
  market at the gate (lantern stalls, the named cast attending).

---

**Sequencing rationale**: Phase 1 fixes the owner's explicit complaint first and
is felt in the first minute. Phase 2 lands the one composition point all sky
work rides on before any particles exist. Rain (3) before regulars (4) so the
cast can react to weather from their first line. The season retint (5) is the
expensive surgery — done once, then winter (6) is pure payoff. The bakery (7)
proves the town pipeline end-to-end before scaling it (8).
