# Sunrise Farm — definition of "good" (the loop's rubric)

This is the bar an automated improvement pass measures against. A pass is **done**
when every objective gate below is green and only taste calls remain. "Best game
ever" is not a stopping condition; **"no known defects + coherent + polished to the
bar + backlog empty"** is, and it's reachable.

## Hard gates (must always be green — a pass FAILS if it breaks one)
- `npx tsc --noEmit` clean, `npx vitest run` all green, `npx vite build` succeeds.
- No console errors on boot or during a normal play loop (preview check, when available).
- Determinism: only `mulberry32` (src/game/rng.ts) for sim randomness — never the
  built-in JS RNG or any wall-clock/date call in `src/game` or the sim path.
- Save-compat: every GameState field has a `??=` backfill in deserialize AND a value
  in initialState; `v` stays 1; an old save loads without throwing; serialize round-trips.
- The owner's live save is stashed and restored byte-exact around any preview QA.

## Quality bars (the pass drives these toward green, escalates if blocked)
- **No softlocks / dead-ends.** Every system has an exit; the goal compass is never dark;
  no content is unreachable or unfillable; the economy always has a next thing to buy.
- **No dead wiring.** Events have effects; state that's written is read; signs/actions
  point somewhere; what the UI SAYS matches what the code DOES (labels, costs, payouts).
- **Perf.** Textured merged meshes, 1 draw/material; geometry disposed on rebuild; no
  per-frame heap allocation in hot loops; no new outdoor PointLights; targets a smooth
  frame on a mid iPhone. The adaptive DPR governor stays intact.
- **Coherence.** Numbers don't contradict; gates are monotonic and reachable; rewards
  match effort; nothing feels pointless.
- **Art law.** Textured hand-built meshes only — never untextured blob characters/trees.

## Taste — ESCALATE, never auto-decide
The loop does NOT make these calls; it surfaces them as a question or a `spawn_task` chip:
fun/feel, difficulty/pacing *intent*, visual style + colour, camera feel, what content
to add next, anything that changes the game's identity. The owner plays on a phone; only
he can judge feel.

## Process law (every pass)
- Adversarially VERIFY every finding (refute-by-default) before fixing — no invented work.
- Cheap Sonnet/Haiku subagents do the crunch; the top model designs + reviews + judges.
- Loop-until-dry: stop when N consecutive passes surface nothing real. Log what was
  dropped; never silently truncate.
- Unattended (cron) passes commit to a branch and leave a summary — they NEVER push to
  `main` (main auto-deploys to the live PWA; humans gate that).

## "Are we done?" signal
Track findings-per-pass. The curve already bends down (8 → fewer → ~0). When two passes
in a row find nothing real and the backlog holds only taste items, the objective work is
complete — report that plainly and wait for the owner's taste input.
