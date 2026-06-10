# SUNRISE FARM (working title) — game3 design
**Status:** v1, research-backed. Built from 14 adversarially-verified findings (research run `wf_c3ba8b38-595`; 6 folklore claims rejected — fabricated quotes/misattributed sources — and excluded from this doc).
**One sentence:** a warm, toy-like 3D farm that starts as one field and one chicken and visibly grows into a homestead — engineered so every minute contains something ripening, something to collect, and something new to place in the world. game1 is frozen; this is a fresh codebase.

## PILLARS
1. **Anticipation is the product** — growth is always watchable (staged, animated, shimmer-before-ready); never a blank timer. (Schultz/Glimcher reward-prediction: dopamine rides the approach, not the receipt.)
2. **Surprise on top, never instead** — base rewards are 100% reliable; a golden layer (~8% golden crops at 4x, golden eggs, rare giant crops) adds delight without ever gating progress on chance. (Fiorillo/Tobler/Schultz: uncertainty amplifies; ethical = additive-only variance.)
3. **Growth you can walk on** — every unlock places a visible 3D thing (plot, coop, cow, fence, path). The farm IS the progress bar.
4. **Never punish absence** — no wither, no death, no decay (Hay Day-verified). Returning opens on abundance: camera pans across everything that got ready while you were gone. Time pressure only ever as BONUS windows (visitor pays 2x for 3h), never loss.
5. **Animals are individuals** — baby-schema proportions (head ~30% of body, big eyes — verified NAcc/cuteness literature), arrive as babies and grow up, mandatory naming ceremony, respond to their name, daily one-tap petting raises hearts (hearts NEVER decrease; verified Stardew math, punishment half dropped), per-animal seeded variation + rare breed variants (1-in-50 / 1-in-200, hatch-only, jingle + confetti).
6. **Juice with discipline** — coin fountains that bezier into an odometer-ticking counter (sum always exact); poke-response on every entity (~150ms back-out scale); no linear tweens anywhere; slow-mo beats (timeScale 0.2 for ~100ms) reserved for RARE events only.
7. **No forced tutorial** — Hay Day-verified: a farm dog points at the next thing when you idle ~5s; 5-6 contextual action chips total; input and camera never lock.

## THE FIRST TEN MINUTES (timer ladder, verified pattern)
0:00 open straight into the farm (no signup, no menu) → dog leads to the field → plant wheat (90-second crop, watchable stages) → first harvest ~2:00 with coin fountain → replant + meet the chicken (naming ceremony) → feed her → egg in ~3 min → collect + sell at the roadside stand → first unlock (second field plot, placed visibly) → by 10:00 the player has run 4-5 full loops and owns: 2 plots, 1 named chicken, corn unlocked, and sees the locked cow paddock with its price. Nothing in session 1 waits longer than ~5 minutes; eggs stretch to 15-20 min and milk to ~1h only after the loop is learned.

## CORE LOOP (nested)
plant → watch → harvest → (feed animals | sell) → coins+XP → unlock visible expansion → bigger plant/watch/harvest. Crops feed animals; animals make products; products sell higher; stations (later: bakery) multiply value. Every layer's output visibly feeds the next.

## ECONOMY v1
- Crops: wheat (90s, 2c), corn (4min, 5c, lvl 2), carrot (10min, 12c, lvl 3), pumpkin (45min, 40c, lvl 5).
- Chicken: feed 1 wheat → egg in 15-20min (3min during FTUE) → 8c. Cow (lvl 4, 120c): feed 2 corn → milk ~1h → 20c.
- Golden: 8% golden crop = 4x sale, unique chime + glint; petted-today animals +10% golden-product chance per heart level (cap 50%).
- XP: every action; level-ups gate unlocks and trigger the big ceremony (banner + light + new item placement).
- Plots: 4 → buy more with coins; land expansion tiles peel back overgrowth (visible spatial growth).

## ART & TECH
- Stack: Vite + TS + three 0.184 + gsap + postprocessing (engine scaffold committed; fixed-step `Engine.advance()` for deterministic tests).
- Models: CC0 GLBs — Quaternius animated animals (cow/chicken with real idle/walk/eat clips), Kenney farm/nature/character packs in `public/models/` (keep each pack's `Textures/colormap.png`; pattern proven in game2). Toy-like, rounded, saturated; warm sun + soft shadows; ACES; subtle bloom for golden moments only.
- Camera: gentle 35° orbit-pan (one-finger drag pan, pinch zoom, clamped); tap = act.
- Saves: localStorage with sim-time catch-up on boot (offline growth uses real elapsed time, capped); signup/cloud deferred by owner.
- Dev driver: `window.__farm` = state/give/step/wipe (+ `__step(s)` fixed-step sim — hidden preview tabs throttle rAF; never gate logic on gsap completion; gsap re-rooted on engine clock).
- Anti-dark-pattern hard rules: no decay/loss mechanics, no purchase-gated randomness, no guilt notifications. Joyful compulsion only.

## MILESTONES
M1 world+camera+input+HUD shell → M2 crops+harvest juice+economy+save → M3 chicken (naming/petting/variation/egg loop) → M4 unlock ladder+dog guide+FTUE chips+cow → M5 audio+polish+deploy. Each ends with a screenshot review and a playtest pass.
