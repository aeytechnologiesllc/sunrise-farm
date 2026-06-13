export const meta = {
  name: 'long-season-bughunt',
  description: 'Adversarial multi-agent bug hunt over the Long Season arc (riding, decor, fence styles, contracts, upgrades, camera) — find, verify, triage',
  phases: [
    { title: 'Review', detail: 'five dimensions reviewed in parallel' },
    { title: 'Verify', detail: 'each finding adversarially checked' },
    { title: 'Synthesize', detail: 'triaged, deduped report' },
  ],
}

const REPO = '/Users/shahzaib/game3'

const NONNEG = `
PROJECT NON-NEGOTIABLES (flag any violation):
- Determinism: ONLY mulberry32 (src/game/rng.ts) for randomness in game logic; NEVER the built-in non-seeded JS RNG (the Math random API) or any wall-clock/date API (the Date constructor or its now() method) in src/game or simulation paths (UI-only performance.now is OK). Sub-streams seed per (saveSeed, day) etc.
- Save-compat: every new GameState field MUST have a ??= backfill in deserialize (state.ts) AND a value in initialState; save version v stays 1; old saves must load without crashing. SAVE_KEY 'sunrise-farm-v1'.
- Perf: textured merged meshes, 1 draw per material (mergeGeometries); geometry DISPOSED on rebuild (no leaks); NO per-frame heap allocations in hot loops (camera follow, player update, riding update, decor ghost); NO new outdoor PointLights (emissive only); heavy proximity/UI scans live in the 20Hz uiTick tier in main.ts.
- mergeGeometries requires every geometry in a bucket to share the SAME attributes (a stray color/uv mismatch throws and drops the whole bucket).
- Art: no untextured blob characters/trees.
`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'line', 'severity', 'category', 'description', 'proposedFix', 'confidence'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          category: { type: 'string' },
          description: { type: 'string' },
          proposedFix: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['isReal', 'severity', 'reasoning'],
  properties: {
    isReal: { type: 'boolean' },
    severity: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string' },
  },
}

const DIMENSIONS = [
  {
    key: 'determinism-save',
    files: 'src/game/state.ts, src/game/Game.ts, src/game/contracts.ts, src/game/decor.ts, src/game/upgrades.ts, src/game/fence.ts, src/game/town.ts, src/game/goals.ts, src/game/henhouse.ts',
    focus: 'DETERMINISM and SAVE-COMPAT. Verify every new GameState field (decor, fenceStyle, fenceStyles, upgrades, contracts, festival, festivalRibbons, town, hazel) has BOTH a deserialize ??= backfill AND an initialState value. Check no non-seeded RNG or wall-clock/date calls in game logic. Check contract/festival day/week rollover never double-pays or loses progress. Check buyFenceStyle/placeDecor/buyUpgrade deduct coins exactly once and guard affordability+level. Check old saves (missing the new fields) deserialize without throwing.',
  },
  {
    key: 'perf-leaks',
    files: 'src/world/decorSet.ts, src/world/scenery.ts, src/world/riding.ts, src/world/grass.ts, src/world/FollowCamera.ts, src/main.ts',
    focus: 'PERFORMANCE, DRAW-CALLS, MEMORY LEAKS. In decorSet.refresh and the fence rebuild: are previous geometries disposed before replacing? Any mergeGeometries bucket that could mix mismatched attributes (color/uv) and throw? Per-frame heap allocations in the riding update, decor ghost positioning, or camera follow? Any new outdoor PointLight? Does the ride-horse get disposed/hidden properly on dismount? Draw-call budgets respected?',
  },
  {
    key: 'correctness',
    files: 'src/game/Game.ts, src/game/contracts.ts, src/game/decor.ts, src/game/upgrades.ts, src/game/goals.ts, src/main.ts',
    focus: 'LOGIC CORRECTNESS and EDGE CASES. canPlaceDecor reach/full/occupied vs DECOR_MAX. Riding mount/dismount gates and the canRideHazel condition. placeDecor stamping the day for sapling growth. Contract progress accumulation (noteProduce) and once-only completion. Upgrade gating + effects (greenhouseBeds, market premium, pasture bonus). goals.nextGoal — can it return null when content remains (the compass going dark)? Fence style switching when a style is not owned.',
  },
  {
    key: 'input-ui',
    files: 'src/main.ts, src/ui/fenceEditor.ts, src/ui/hud.ts',
    focus: 'INPUT, UI, INTERACTION on a mobile touch PWA. Action-list mutual exclusivity (riding vs placingDecor vs carry.carrying vs fenceEditor) — can two modes overlap and strand the player? The fence Style picker show/hide lifecycle (does it leak open after close?). The catalog card panel (modalOpen) interactions. The decor placer ghost lifecycle — disposed on cancel/commit/sleep? Pointer capture conflicts between camera, fence editor, and the new panels. Any action that can fire while a modal is open.',
  },
  {
    key: 'camera-jitter',
    files: 'src/world/FollowCamera.ts, src/world/Player.ts, src/main.ts',
    focus: 'CAMERA and VISUAL JITTER. The new rideLift + ride pitch (0.66) + ride aspect (0.82) — any discontinuity/pop when mounting/dismounting? The ride-horse is NOT in OCCLUDERS — can the camera clip through her or pull weirdly? setMounted raises the model only (pos stays ground) — verify proximity/camera anchors are truly unaffected. Whisker cache correctness. Any NaN path (zero viewport) reintroduced. Does dismount fully restore dist/rideLift?',
  },
]

phase('Review')
log(`Reviewing ${DIMENSIONS.length} dimensions across the Long Season arc (~4200 lines)`)

const results = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(
      `You are a meticulous senior engineer reviewing a three.js + TypeScript cozy farm game (mobile PWA) at ${REPO}. Read ONLY excerpts you need (grep first; src/main.ts is ~3400 lines — never read it whole).\n\nReview these files for the dimension "${d.key}":\n${d.files}\n\nFOCUS:\n${d.focus}\n${NONNEG}\n\nReport ONLY real, specific, actionable findings with exact file:line. Prefer fewer high-confidence findings over speculation. For each: a precise description of the bug/risk and a concrete minimal fix. If you find nothing real, return an empty findings array — do NOT invent issues.`,
      { label: `review:${d.key}`, phase: 'Review', schema: SCHEMA, model: 'sonnet' },
    ),
  (review, dim) => {
    const finds = (review && review.findings) || []
    if (finds.length === 0) return []
    return parallel(
      finds.map((fnd) => () =>
        agent(
          `Adversarially VERIFY this claimed issue in the repo at ${REPO}. Read the actual code at ${fnd.file} around line ${fnd.line} (and related files) and decide if it is REAL.\n\nCLAIM (${dim.key}): ${fnd.title}\nFILE: ${fnd.file}:${fnd.line}\nSEVERITY(claimed): ${fnd.severity}\nDESCRIPTION: ${fnd.description}\nPROPOSED FIX: ${fnd.proposedFix}\n\nDefault to isReal=false unless the code genuinely confirms the bug. Consider: does the guard/backfill/disposal the reviewer missed actually exist elsewhere? Is the hot-loop allocation actually hot? Does the determinism concern actually run in game logic? Give your honest verdict and corrected severity.`,
          { label: `verify:${fnd.file}:${fnd.line}`, phase: 'Verify', schema: VERDICT, model: 'sonnet' },
        ).then((v) => ({ ...fnd, verdict: v })),
      ),
    )
  },
)

const confirmed = results
  .flat()
  .filter(Boolean)
  .filter((f) => f.verdict && f.verdict.isReal)
  .sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 }
    return rank[a.verdict.severity] - rank[b.verdict.severity]
  })

phase('Synthesize')
log(`${confirmed.length} findings confirmed real after adversarial verification`)

return {
  confirmedCount: confirmed.length,
  findings: confirmed.map((f) => ({
    title: f.title,
    file: f.file,
    line: f.line,
    severity: f.verdict.severity,
    category: f.category,
    description: f.description,
    proposedFix: f.proposedFix,
    verifierReasoning: f.verdict.reasoning,
  })),
}
