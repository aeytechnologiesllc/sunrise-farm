export const meta = {
  name: 'long-season-bughunt-deep',
  description: 'DEEP second-pass bug hunt over the FULL Long Season arc incl Phase 3 + the first round of fixes — 10 dimensions, adversarial verify, completeness critic',
  phases: [
    { title: 'Find', detail: '10 dimensions reviewed in parallel' },
    { title: 'Verify', detail: 'each finding adversarially refuted-by-default' },
    { title: 'Critic', detail: 'completeness pass — what was missed' },
  ],
}

const REPO = '/Users/shahzaib/game3'

const NONNEG = `
PROJECT LAW (flag any violation):
- Determinism: ONLY mulberry32 (src/game/rng.ts) for randomness in game/sim logic; NEVER the built-in non-seeded JS RNG (the Math random API) or any wall-clock/date API (the Date constructor or its now method) in src/game or simulation paths. UI-only performance.now is fine.
- Save-compat: every GameState field needs a ??= backfill in deserialize AND a value in initialState; v stays 1; old saves must load without throwing; serialize->deserialize must round-trip. SAVE_KEY 'sunrise-farm-v1'.
- Perf: merged meshes, 1 draw/material; geometry DISPOSED on every rebuild; NO per-frame heap allocation in hot loops (camera follow, player/riding update, decor ghost, proximity scan); NO new outdoor PointLights (emissive only).
- mergeGeometries THROWS and drops the whole bucket if geometries have mismatched attributes (a colorize'd vertex-color geo in a plain-material bucket is the classic trap).
`

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: { findings: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['title', 'file', 'line', 'severity', 'category', 'description', 'proposedFix', 'confidence'],
    properties: {
      title: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      category: { type: 'string' }, description: { type: 'string' },
      proposedFix: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  } } },
}
const VERDICT = {
  type: 'object', additionalProperties: false, required: ['isReal', 'severity', 'reasoning'],
  properties: { isReal: { type: 'boolean' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, reasoning: { type: 'string' } },
}

const DIMS = [
  { key: 'save-migration', files: 'src/game/state.ts, src/game/contracts.ts, src/game/Game.ts',
    focus: 'SAVE/MIGRATION. serialize->deserialize->serialize idempotence. Every new field (decor, fenceStyle, fenceStyles, contracts.goods, festival.order, town.lastCafeDay, town.lastTrainDay, upgrades, festivalRibbons) backfilled AND in initialState. An OLD save (missing all of these) must deserialize without throwing AND without NaN/undefined leaking into runtime. The FROZEN contracts.goods/festival.order: does an old save with empty goods correctly re-roll on first tick rather than show an empty board forever? Does the stranded-layout rescue still work?' },
  { key: 'determinism', files: 'src/game/contracts.ts, src/game/decor.ts, src/game/town.ts, src/game/goals.ts, src/world/decorSet.ts, src/world/townSet.ts',
    focus: 'DETERMINISM. Any built-in RNG or wall-clock/date call in game/sim logic. Seed derivation for daily contracts, weekly festival, decor petal hues, town stage rng — stable per (seed, day/week)? Two runs of the same save same day must produce identical boards.' },
  { key: 'perf-leaks', files: 'src/world/decorSet.ts, src/world/scenery.ts, src/world/townSet.ts, src/world/riding.ts, src/world/FollowCamera.ts, src/main.ts',
    focus: 'PERF/LEAKS/DRAW-CALLS. Geometry disposal on every rebuild (decor refresh, fence rebuild incl the stone gate-overlay child, town reveal). mergeGeometries attribute-mismatch risk in the 3 NEW town stages + the train. Per-frame allocations in riding update / decor ghost / camera. New outdoor PointLights. The train/bus gsap tweens — leaked or re-killable? Draw-call budget of the 3 new town acts.' },
  { key: 'town-acts', files: 'src/game/town.ts, src/game/Game.ts, src/game/contracts.ts, src/main.ts, src/world/townSet.ts',
    focus: 'TOWN ACTS 5-7. Café daily egg order (cafeOrderReady mirrors bakery, deducts 3 eggs once/day, can it go negative or double-fire?). Festival square 1.5x (rollFestival reads built.square). Station 4th slot (contractSlots). The train twice-daily latch (lastTrainDay) vs the bus latch — do they collide or double-save? Each act lot in town.ts must equal the townSet P_ render position (cafe/square/station). Construction reveal for the new acts. Act gating chain works->cafe->square->station.' },
  { key: 'contract-freeze', files: 'src/game/Game.ts, src/game/contracts.ts, src/game/state.ts',
    focus: 'THE CONTRACT FREEZE FIX (new). ensureContractsFresh stores rolled goods. Edge cases: slot count changes mid-day (station built) — does it re-roll and is that correct? Week rollover for festival. An in-progress contract when the day turns — progress reset cleanly? Can a contract pay out TWICE? Does the festival "done" check use the frozen order? If cottages built mid-week, does the festival roll correctly? Does building the square mid-week update the frozen payout (and is that desired or a bug)?' },
  { key: 'riding-sm', files: 'src/main.ts, src/world/Player.ts, src/world/riding.ts',
    focus: 'RIDING STATE MACHINE. mountHazel/dismountHazel gates. Mutual exclusivity: can you mount while carrying a building / placing decor / in the fence editor / inside a room / mid-delivery / during construction / during a cutscene? Can any of those start WHILE riding? Does sleep/room-enter/construction force a clean dismount? setMounted raises the model only — any path where pos.y leaks up and breaks proximity? Is riding truly never saved (no leak into the save)?' },
  { key: 'decor-catalog', files: 'src/game/decor.ts, src/world/decorSet.ts, src/main.ts',
    focus: 'DECOR + CATALOG + PLACEMENT. canPlaceDecor reach/full(DECOR_MAX)/occupied. The ghost lifecycle: disposed on cancel/commit/sleep AND on any interrupting transition (room enter, construction, delivery)? Can you open the catalog and strand a ghost? Catalog affordability/level gates match Game.placeDecor guards. Buying a fence style you already own. Sapling day-stamp + growth. Placing at exactly DECOR_MAX.' },
  { key: 'camera', files: 'src/world/FollowCamera.ts, src/main.ts',
    focus: 'CAMERA. The ride smoothing (rideLiftS/rideK) — correct at boot (rideLiftS starts 0)? Any NaN if aspect/viewport is 0? The ride horse is NOT an occluder — can the camera still clip a real building while riding? clearWhiskers on mount/dismount + teleport. Does dismount fully restore dist AND rideLift AND rideLiftS eases back? kTight/kCollapse interaction with rideLift. The editorActive guard still holds.' },
  { key: 'ui-action-machine', files: 'src/main.ts, src/ui/hud.ts, src/ui/fenceEditor.ts',
    focus: 'UI/ACTION STATE MACHINE on a touch PWA. The action-list assembly: enumerate the top-level branches (riding / placingDecor / carry.carrying / fenceEditor.active / normal) — can two be true at once and strand the player with the wrong buttons? Any action handler that fires while a modal (hud.modalOpen) is open? The catalog/order card panel + the fence style picker show/hide lifecycles. near.catalog/near.ride/near.town gating. Can the player get soft-locked (no way back to normal)?' },
  { key: 'goals-economy', files: 'src/game/goals.ts, src/game/upgrades.ts, src/game/expansion.ts, src/game/town.ts, src/game/decor.ts, src/game/fence.ts',
    focus: 'GOALS + ECONOMY BALANCE. goals.nextGoal: truly never null for delivered>=1? Priority order sane (affordable-now beats blocked)? Pills <=40 chars. Economy sanity: are upgrade/town/decor/fence costs + level gates monotonic and reachable (no gate a player can never afford given income)? Any off-by-one in level/coins/wheat/delivered comparisons (>= vs >).' },
]

phase('Find')
log(`Deep sweep: ${DIMS.length} dimensions over the full arc at HEAD`)

const reviewed = await pipeline(
  DIMS,
  (d) => agent(
    `Senior engineer, second-pass DEEP review of a three.js + TS cozy farm game (mobile PWA) at ${REPO}. An earlier sweep already fixed 8 bugs — you are hunting what it MISSED, especially in the newest code (Phase 3 town acts 5-7, the café/train/station, the contract-freeze fix, the camera ride-smoothing). Grep first; src/main.ts is ~3500 lines — never read whole.\n\nDIMENSION "${d.key}". Files:\n${d.files}\n\nFOCUS:\n${d.focus}\n${NONNEG}\n\nReport ONLY real, specific findings with exact file:line + a concrete minimal fix. Be skeptical and thorough but do NOT invent issues — empty findings is a valid, honest result.`,
    { label: `find:${d.key}`, phase: 'Find', schema: SCHEMA, model: 'sonnet' },
  ),
  (review, dim) => {
    const finds = (review && review.findings) || []
    if (!finds.length) return []
    return parallel(finds.map((f) => () =>
      agent(
        `Adversarially VERIFY this claim in ${REPO}. Read ${f.file} near line ${f.line} + related code. Default to isReal=FALSE unless the code genuinely confirms a real bug a player or the GPU would actually hit. The earlier sweep already fixed: stone-fence gate leak, contract re-roll orphan, decorSet source-geo leak, ride camera pop, fence picker. If this duplicates an already-fixed issue, isReal=false.\n\nCLAIM (${dim.key}): ${f.title}\n${f.file}:${f.line} [${f.severity}]\n${f.description}\nProposed fix: ${f.proposedFix}`,
        { label: `verify:${f.file.split('/').pop()}:${f.line}`, phase: 'Verify', schema: VERDICT, model: 'sonnet' },
      ).then((v) => ({ ...f, verdict: v }))))
  },
)

const confirmed = reviewed.flat().filter(Boolean).filter((f) => f.verdict && f.verdict.isReal)
  .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.verdict.severity] - { high: 0, medium: 1, low: 2 }[b.verdict.severity]))

phase('Critic')
const critic = await agent(
  `Completeness critic for a bug hunt of a three.js farm game at ${REPO}. The sweep examined these dimensions: ${DIMS.map((d) => d.key).join(', ')}. It confirmed ${confirmed.length} real findings: ${confirmed.map((f) => `${f.title} (${f.file.split('/').pop()}:${f.line})`).join('; ') || '(none)'}.\n\nWhat did this sweep likely MISS? Name specific files, code paths, or CLASSES of bug (e.g. an integration seam between two systems, a save-migration edge, a perf path) that warrant a look but weren't covered. Be concrete and concise — this becomes the next round's targets.`,
  { label: 'completeness-critic', phase: 'Critic', model: 'sonnet' },
)

return {
  confirmedCount: confirmed.length,
  findings: confirmed.map((f) => ({ title: f.title, file: f.file, line: f.line, severity: f.verdict.severity, category: f.category, description: f.description, proposedFix: f.proposedFix, verifier: f.verdict.reasoning })),
  completenessCritic: critic,
}
