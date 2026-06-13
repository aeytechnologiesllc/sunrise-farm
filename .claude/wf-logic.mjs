export const meta = {
  name: 'long-season-logic-audit',
  description: 'Game-LOGIC coherence audit — missing logic, dead-ends, half-wired systems, contradictions, things that do not make sense. Plus player-journey walkthroughs.',
  phases: [
    { title: 'Audit', detail: '8 logic dimensions + 3 player journeys' },
    { title: 'Verify', detail: 'each finding adversarially checked' },
    { title: 'Synthesize', detail: 'triaged coherence report' },
  ],
}

const REPO = '/Users/shahzaib/game3'

const CONTEXT = `
This is "Sunrise Farm" — a cozy 3D farm game (three.js + TS, mobile PWA). Core loop: plant/harvest crops, tend animals (sheep/goats/hens/horse), sell to customers, fulfil contracts, level up, buy land deeds + buildings + a town (Millbrook), upgrade everything, ride Hazel the horse, decorate. The owner's law: the player must ALWAYS have something to save for; nothing should feel pointless, contradictory, or dead-end.
You are auditing for LOGIC COHERENCE, not code style. The thing you hunt: does the game MAKE SENSE? Half-wired features, dead resources, unreachable content, gates that can never be met, rewards that do not match effort, a sign/label that says one thing while the code does another, a mode you can enter but not exit, a system added but never connected to the rest, numbers that contradict each other, a player who can get stuck. Read the actual code/data to ground every claim (src/game/* is the logic+data; src/main.ts ~3500 lines wires it — grep, never read whole).
`

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: { findings: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['title', 'where', 'severity', 'kind', 'description', 'suggestion', 'confidence'],
    properties: {
      title: { type: 'string' },
      where: { type: 'string', description: 'file:line or system/area' },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      kind: { type: 'string', description: 'dead-wiring | economy | softlock | ui-vs-logic | state-machine | offline-time | reward-effort | integration | confusing | other' },
      description: { type: 'string' },
      suggestion: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  } } },
}
const VERDICT = {
  type: 'object', additionalProperties: false, required: ['isReal', 'severity', 'reasoning'],
  properties: { isReal: { type: 'boolean' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, reasoning: { type: 'string' } },
}

const DIMS = [
  { key: 'dead-wiring', files: 'src/game/Game.ts, src/main.ts, src/game/state.ts',
    focus: 'HALF-WIRED / ORPHAN LOGIC. Events emitted but never handled (or handled but never emitted). State fields written but never read, or read but never written. Functions/methods defined but never called. Dev hooks or signs or actions that point at nothing. A system that is built but not actually hooked into the game loop. setMounted/decorChanged/cafeSold/contractDone/festivalDone/townBuilt/fenceStyleBought — is each fully round-tripped (emit -> handler -> visible effect)?' },
  { key: 'economy-graph', files: 'src/game/economy.ts, src/game/town.ts, src/game/contracts.ts, src/game/upgrades.ts, src/game/expansion.ts, src/game/decor.ts, src/game/produce.ts, src/game/Game.ts',
    focus: 'ECONOMY COHERENCE. Trace every SINK (things you spend coins/wheat/eggs on) and every FAUCET (income). Is any GOOD a dead resource (produced but nothing consumes it, or required but nothing produces it)? Any gate that can NEVER be met (e.g. needs N wheat but wheat caps below N)? Any cost that does not scale so it is trivial late or impossible early? Does the café eat eggs you also need elsewhere, starving another system? Is wheat both currency and feed and bakery+cafe input — can those compete and soft-lock? Does the festival square 1.5x and station 4th slot actually pay out?' },
  { key: 'progression-softlock', files: 'src/game/goals.ts, src/game/expansion.ts, src/game/projects.ts, src/game/town.ts, src/game/upgrades.ts, src/main.ts',
    focus: 'PROGRESSION + SOFT-LOCKS. Can a player reach a state with NO path forward? Trace the gate graph (level / coins / wheat / deliveries / prerequisite-owned). Any contradiction or impossible ordering (B needs A but A needs B; a deliveries gate when deliveries require something behind that gate)? Can the goal compass point at something the player cannot actually act on? Is the stable->Old-Pasture bridge fully resolved now? Can you spend yourself into a corner (buy something that strands you)?' },
  { key: 'ui-vs-logic', files: 'src/main.ts, src/game/town.ts, src/game/contracts.ts, src/game/economy.ts, src/game/decor.ts, src/game/upgrades.ts',
    focus: 'WHAT IT SAYS vs WHAT IT DOES. Every player-facing number/label vs the code behind it. A sign/action sub-label that states a cost/reward/time that differs from what the code actually charges/pays/takes. The café banner says "3 eggs into +Nc" — does N match CAFE_EGGS*CAFE_RATE? Deliver action "feed 1 wheat -> 26-42c" — accurate? Decor/upgrade/town prices shown == prices charged? Crop grow-time labels == actual timers? Any stale text from before a value changed.' },
  { key: 'state-machine', files: 'src/main.ts, src/world/Player.ts, src/world/riding.ts, src/ui/fenceEditor.ts',
    focus: 'MODE STATE MACHINE. The exclusive modes: riding, carrying a building, placing decor, fence-editing, inside a room, sleeping, construction, cutscene, modal-open. Enumerate how each is entered/exited. Can any TWO be true at once illegally? Any mode you can enter but get stuck in (no exit affordance)? Does an interrupting event (sleep at dusk, a delivery returning, a level-up cutscene) leave a mode half-active? Can the player lose control of input?' },
  { key: 'offline-time', files: 'src/game/state.ts, src/game/Game.ts, src/game/produce.ts, src/game/town.ts, src/game/contracts.ts',
    focus: 'OFFLINE / TIME / DAY-CLOCK. The offline catch-up path (catchUp / deserialize): does it advance ALL the new systems sensibly (contracts/festival re-roll, café+bakery daily orders, town) or do some silently not advance, or double-advance? The once-per-day latches (lastBakeryDay/lastCafeDay/lastBusDay/lastTrainDay) — can any double-fire across a reload or never fire? Day vs week rollover for festival. dayPhase boundary windows (bus/recess/train) — gaps or overlaps that misbehave at exactly the edge?' },
  { key: 'reward-effort', files: 'src/game/economy.ts, src/game/contracts.ts, src/game/produce.ts, src/game/town.ts, src/game/upgrades.ts, src/game/Game.ts',
    focus: 'REWARD vs EFFORT / DOMINANT STRATEGY. Is any activity strictly dominant (so the player only ever does one thing)? Any reward so small it is pointless, or so large it trivializes the game? Does petting/feeding/heart-building actually pay off or is it busywork? Do upgrades you buy actually change the numbers (market premium, pasture bonus, wool works 1.5x, greenhouse beds)? Is there content that exists but grants nothing meaningful?' },
  { key: 'integration', files: 'src/main.ts, src/game/Game.ts, src/world/riding.ts, src/game/decor.ts, src/game/contracts.ts, src/game/town.ts',
    focus: 'NEW-SYSTEM INTEGRATION. Do the newest systems actually CONNECT to the rest? Riding: does it correctly gate-check carry/rooms/delivery/fence/sleep and dismount on all of them? Decor: placement respects world bounds + building footprints + the reach guard + the cap? Contracts: does noteProduce fire from EVERY production site (harvest, egg, coop, shear, milk) so every good can fill an order? Café/station/square: do their effects actually reach the systems they claim (egg order, 4th slot, festival 1.5x)? Town acts reveal + construction at the right lot?' },
]

const JOURNEYS = [
  { key: 'journey-new', stage: 'a brand-new player on day 1-3 (level 1-5, a few coins, the starter stand + chicken)',
    look: 'What is confusing, missing, or illogical in the FIRST session? Is the next step always clear? Does anything appear that the player cannot understand or act on yet? Is the FTUE coherent?' },
  { key: 'journey-mid', stage: 'a mid-game player (level ~12-18, owns the coop/stable/greenhouse, first town acts, a horse)',
    look: 'Does the mid-game flow make sense? Are the new boards/shops/riding discoverable and clearly purposeful? Any system that appears with no explanation, or a goal that points somewhere confusing? Does the money have clear places to go?' },
  { key: 'journey-end', stage: 'an endgame player (level 30+, owns nearly everything, all of Millbrook, max upgrades, lots of decor)',
    look: 'Does the endgame still make sense and give a reason to keep playing? Is the "always something to buy" promise actually true here? Does anything feel pointless, repetitive-without-reward, or like a dead-end? What does the goal compass say and is it satisfying?' },
]

phase('Audit')
log(`Logic audit: ${DIMS.length} coherence dimensions + ${JOURNEYS.length} player journeys`)

const dimResults = pipeline(
  DIMS,
  (d) => agent(
    `${CONTEXT}\n\nDIMENSION "${d.key}" in ${REPO}. Files to ground in:\n${d.files}\n\nHUNT FOR:\n${d.focus}\n\nReport ONLY real, specific coherence problems with concrete where + why + a suggested fix. This is the SECOND audit pass — earlier code sweeps already covered determinism, leaks, save-migration, camera. You are hunting LOGIC/SENSE gaps those missed. Empty findings is a valid honest result — do NOT invent issues.`,
    { label: `audit:${d.key}`, phase: 'Audit', schema: SCHEMA, model: 'sonnet' },
  ),
  (rev, dim) => {
    const fs = (rev && rev.findings) || []
    if (!fs.length) return []
    return parallel(fs.map((f) => () =>
      agent(
        `${CONTEXT}\n\nAdversarially VERIFY this LOGIC claim in ${REPO}. Read the actual code/data to confirm or refute. Default isReal=FALSE unless the code genuinely shows the incoherence. Be especially skeptical of "missing" claims — the handler/consumer/producer may exist elsewhere; grep for it before agreeing.\n\nCLAIM (${dim.key}, ${f.kind}): ${f.title}\nWHERE: ${f.where}\n${f.description}\nSuggested: ${f.suggestion}`,
        { label: `verify:${dim.key}`, phase: 'Verify', schema: VERDICT, model: 'sonnet' },
      ).then((v) => ({ ...f, verdict: v }))))
  },
)

const journeyResults = parallel(JOURNEYS.map((j) => () =>
  agent(
    `${CONTEXT}\n\nPLAYER-JOURNEY audit. Imagine you ARE ${j.stage}, playing Sunrise Farm at ${REPO}. Read the data + wiring (src/game/economy.ts, expansion.ts, projects.ts, town.ts, upgrades.ts, contracts.ts, goals.ts, decor.ts, and grep src/main.ts for how things surface) to reason CONCRETELY about this player's actual experience.\n\nLOOK FOR:\n${j.look}\n\nReport real logic/coherence/clarity gaps THIS player would hit — things that do not make sense, dead-ends, missing guidance, or rewards that do not land. Ground each in the actual numbers/code. Empty is valid.`,
    { label: `journey:${j.key}`, phase: 'Audit', schema: SCHEMA, model: 'sonnet' },
  ).then((rev) => ({ journey: j.key, findings: (rev && rev.findings) || [] }))))

const [dims, journeys] = await Promise.all([dimResults, journeyResults])

const confirmed = dims.flat().filter(Boolean).filter((f) => f.verdict && f.verdict.isReal)
  .map((f) => ({ ...f, source: 'dimension' }))
const journeyFindings = journeys.filter(Boolean).flatMap((j) => j.findings.map((f) => ({ ...f, source: `journey:${j.journey}` })))

const all = [...confirmed, ...journeyFindings]
  .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]))

phase('Synthesize')
log(`${confirmed.length} verified dimension findings + ${journeyFindings.length} player-journey notes`)

return {
  verifiedDimensionFindings: confirmed.length,
  journeyNotes: journeyFindings.length,
  findings: all.map((f) => ({
    title: f.title, where: f.where, severity: f.severity, kind: f.kind,
    description: f.description, suggestion: f.suggestion, source: f.source,
    verifier: f.verdict ? f.verdict.reasoning : '(player-journey — unverified observation)',
  })),
}
