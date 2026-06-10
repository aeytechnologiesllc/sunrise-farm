# SUNRISE FARM — COMPLETE PLAN to "the best version"
Owner's bar: a polished commercial farm game a non-technical player instantly understands and enjoys. Every phase ends the same way: build → independent verify agent → screenshot review at the owner's reference camera angle → deploy to https://game3-roan.vercel.app → owner playtest. No phase is "done" until it survives the owner's screenshot test.

## PHASE 1 — CHARACTERS & SCALE (the trust pass) ← NOW
The owner's screenshot diagnosis, in full:
1. **Scale hierarchy** (broken today: dog ≈ human, hen ≈ human): farmer = 1.6u reference; customers = farmer ±10%; dog = 0.45u at the shoulder (knee height); hen = 0.28u (shin height); chick babies smaller still. One SCALE table in code; every spawn asserts against it (unit test).
2. **One human model family**: customers move off the chibi Kenney minis onto the same adult-proportioned family as the farmer — seeded variety per customer (outfit tint, skin tone, hat/no-hat, hair). No chibi anywhere.
3. **Farmer readability**: brighten materials, warm fill so he never reads as a dark silhouette against grass; straw hat clearly visible at gameplay distance.
4. **Animation polish, everyone**: crossfaded idle/walk(/run) with no foot-slide or T-pose flashes; chicken = strut + peck + wing-flutter (absorb in-flight partial work in src/world/Chicken.ts); dog = trot/sit/look-back (no hopping); customers = walk, browse idle, happy-hop on serve, re-timed to correct scale.
5. **Acceptance**: a screenshot at the owner's exact angle (stand + field + dog + hen in frame) shows an obvious person/dog/bird size ladder and zero blob-reads; both joysticks; 60fps; tests green.

## PHASE 2 — MISSIONS (clarity pass)
- Mission card top-left: title + steps with progress pips ("FIRST HARVEST — Plant wheat 3/3 → Gather it → Sell at the stand"), always answering "what do I do now" at any pause-screenshot.
- Scripted early chain: First Harvest → Meet the Hen (naming) → First Egg → First Customer → Second Field → The Cow Arrives. Each ends in the full ceremony (banner, fanfare, fountain, visible world change) and hands off the next goal on-screen.
- Dog guide targets the current mission step; completion ticks audibly; mission state saved.

## PHASE 3 — SOUND IDENTITY (unique to this game)
- Replace generic bleeps with ONE cohesive palette: warm pentatonic wood/bell family — harvest pluck, coin tick, serve chime, level fanfare all share the same key and timbre so the game sounds like *itself*.
- Per-animal voices (hen cluck set, dog bark/whine, cow moo later) pitch-varied per individual; ambient layer (songbirds, breeze, distant windmill creak) that follows time-of-day; music ducks under ceremonies and sits deeper in the mix.

## PHASE 4 — CONTENT LADDER (the farm grows)
- Cow paddock (level 4): feed corn → milk → premium customers; baby-to-adult growth moments.
- Crops 3 & 4 (carrot, pumpkin) with the verified timer ladder; second field + land expansion tiles that physically peel back overgrowth.
- Collection journal: golden finds + rare breeds (1-in-50 snowdrop calf, 1-in-200 golden chicken) with jingle + confetti + journal entry; barn upgrade visuals.

## PHASE 5 — RETENTION & ACCOUNTS
- Comeback celebration pan (everything that ripened while away), daily mailbox gift, day/night tint cycle.
- Sign-up (owner-requested, deferred until here): lightweight account + cloud save sync; guest play always allowed first — never gate the first session.

## PHASE 6 — LAUNCH POLISH
- Real-device perf pass (mid-range Android target), PWA manifest + icon + install prompt, polished loading screen, share-worthy screenshot moments, final QA sweep (full FTUE replay + save migration), production deploy + owner sign-off.

## STANDING RULES (every phase)
Research-verified dopamine directives in docs/design.md stay binding (timer ladder, golden layer, no punishment ever, naming/petting, juice discipline). game1/game2 untouched. Fixed-step logic only; __farm/__step dev driver maintained; typecheck + vitest green before any deploy.
