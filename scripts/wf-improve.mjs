// The reusable "improve" engine for Sunrise Farm. Finds + adversarially verifies
// what's below the QUALITY.md bar, reads BACKLOG.md, returns a TRIAGED action list.
// It does NOT edit code — the caller (me, sequentially, with tests gating, or the
// nightly cron on a branch) applies the verified fixes. Run via:
//   Workflow({ scriptPath: 'scripts/wf-improve.mjs', args: { scope: 'bugs+polish' } })
export const meta = {
  name: 'improve',
  description: 'Sunrise Farm self-improvement pass: audit vs QUALITY.md + BACKLOG.md, adversarially verify, return a triaged action list (no auto-edits)',
  phases: [
    { title: 'Audit', detail: 'dimensions + backlog, in parallel' },
    { title: 'Verify', detail: 'refute-by-default' },
    { title: 'Triage', detail: 'ranked actions + done-signal' },
  ],
}

const REPO = '/Users/shahzaib/game3'
const scope = (args && args.scope) || 'bugs+polish' // 'bugs' | 'bugs+polish' | 'bugs+polish+features'

const LAW = `
Sunrise Farm = a cosy 3D farm game (three.js + TS, mobile PWA). The bar lives in docs/QUALITY.md; the work list in docs/BACKLOG.md (READ BOTH). Hard law: mulberry32 only for sim randomness (never the built-in JS RNG or a wall-clock/date call in src/game); every GameState field backfilled in deserialize; merged textured meshes (1 draw/material) disposed on rebuild; no per-frame heap alloc in hot loops; no untextured blobs; no softlocks; the goal compass is never dark; what the UI says must match what the code does. TASTE (fun/feel/colour/camera/what-to-add) is NEVER decided here — it is escalated. src/main.ts is ~3500 lines: grep, never read whole.
`

const FIND = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: { findings: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['title', 'where', 'severity', 'kind', 'description', 'fix', 'autofixable', 'confidence'],
    properties: {
      title: { type: 'string' }, where: { type: 'string' },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      kind: { type: 'string', description: 'bug | coherence | softlock | ui-vs-logic | perf | determinism | save | polish | balance | taste | feature' },
      description: { type: 'string' }, fix: { type: 'string' },
      autofixable: { type: 'boolean', description: 'true = mechanical + safe to apply without owner taste input' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  } } },
}
const VERDICT = {
  type: 'object', additionalProperties: false, required: ['isReal', 'severity', 'autofixable', 'reasoning'],
  properties: { isReal: { type: 'boolean' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, autofixable: { type: 'boolean' }, reasoning: { type: 'string' } },
}

const DIMS = [
  { key: 'correctness-save', focus: 'logic bugs, save/migration round-trip, determinism-law breaks, edge cases in Game.ts/state.ts/contracts.ts/economy.ts.' },
  { key: 'coherence-softlock', focus: 'dead wiring (events/state/fns set-but-unread), unreachable/unfillable content, softlocks, the goal compass going dark, gate-graph contradictions.' },
  { key: 'ui-vs-logic', focus: 'every player-facing number/label vs the code behind it (costs, payouts, times, multipliers); stale text.' },
  { key: 'perf-leaks', focus: 'geometry disposal on rebuild, mergeGeometries attribute mismatches, per-frame allocations in hot loops, draw budgets, new outdoor lights.' },
  { key: 'polish-balance', focus: scope === 'bugs' ? 'SKIP — bugs-only pass, return empty findings.' : 'economy monotonicity + reachability, reward-vs-effort, dominant strategies, small UX/polish gaps. Flag anything that changes FEEL as kind:taste (escalate, do not auto-fix).' },
]

phase('Audit')
log(`improve pass — scope: ${scope}`)

const reviewed = await pipeline(
  DIMS,
  (d) => agent(
    `${LAW}\nAudit dimension "${d.key}" at ${REPO}. FOCUS: ${d.focus}\nReport ONLY real, specific findings with exact where + a concrete fix. Mark autofixable=true only if the fix is mechanical and needs no owner taste input. Empty is a valid honest result — do not invent work.`,
    { label: `audit:${d.key}`, phase: 'Audit', schema: FIND, model: 'sonnet' },
  ),
  (rev, dim) => {
    const fs = (rev && rev.findings) || []
    if (!fs.length) return []
    return parallel(fs.map((f) => () =>
      agent(
        `${LAW}\nAdversarially VERIFY this claim at ${REPO}; read the actual code. Default isReal=FALSE unless the code genuinely confirms it. Re-judge autofixable: anything touching game FEEL/balance intent/visual taste is NOT autofixable (escalate).\nCLAIM (${dim.key}/${f.kind}): ${f.title}\n@ ${f.where}\n${f.description}\nFix: ${f.fix}`,
        { label: `verify:${dim.key}`, phase: 'Verify', schema: VERDICT, model: 'sonnet' },
      ).then((v) => ({ ...f, verdict: v }))))
  },
)

const backlog = await agent(
  `${LAW}\nRead docs/BACKLOG.md. Given the allowed scope "${scope}", pick the single highest-value item the loop should advance THIS pass (skip [feature]/[taste] unless scope allows + owner-approved). Return it as one finding (kind, where=the area, fix=the concrete next step, autofixable per its tag).`,
  { label: 'backlog:top', phase: 'Audit', schema: FIND, model: 'sonnet' },
)

phase('Triage')
const confirmed = reviewed.flat().filter(Boolean).filter((f) => f.verdict && f.verdict.isReal)
  .map((f) => ({ title: f.title, where: f.where, severity: f.verdict.severity, kind: f.kind, description: f.description, fix: f.fix, autofixable: f.verdict.autofixable, why: f.verdict.reasoning }))
  .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]))

const autofix = confirmed.filter((f) => f.autofixable)
const escalate = confirmed.filter((f) => !f.autofixable)
log(`${confirmed.length} real (${autofix.length} auto-fixable, ${escalate.length} taste/escalate)`)

return {
  scope,
  realCount: confirmed.length,
  doneSignal: confirmed.length === 0,
  autofixable: autofix,
  escalateToOwner: escalate,
  backlogNext: (backlog && backlog.findings) || [],
}
