export const meta = {
  name: 'camera-bughunt',
  description: 'Focused adversarial sweep of the Sunrise Farm camera (FollowCamera + cameraMath + main wiring) for shake, pops, occlusion, ride, room, NaN, and timing bugs',
  phases: [
    { title: 'Hunt', detail: '8 camera concerns in parallel' },
    { title: 'Verify', detail: 'refute-by-default' },
    { title: 'Triage', detail: 'ranked real findings' },
  ],
}

const REPO = '/Users/shahzaib/game3'

const CTX = `
Sunrise Farm = cosy 3D farm game (three.js + TS, mobile PWA, iPhone landscape). The camera is a third-person follow rig. KEY FILES: src/world/FollowCamera.ts (the rig: orbit, damp, look-ahead, occlusion whiskers, ride framing, cinematics, room confiner), src/world/cameraMath.ts (pure: nearSafeRadius, occlusionWant, clampToBox), and the wiring in src/main.ts (grep — it's ~3500 lines: cam.follow is in engine.onFrame ~line 3560; player.update in engine.onUpdate ~2755; room transitions; mount/dismount; resize).
RECENT CONTEXT (do not re-report as new): cam.follow runs at RENDER rate; the player moves on the FIXED 60Hz step. The look-ahead velocity was just LOW-PASSED (camVelSmooth in main.ts) to fix a running-shake from fixed-step-quantized displacement — verify THAT fix is correct + complete, but it's known. Also recently fixed: whisker per-side cache, rideLift/rideLiftS/rideK smoothing + clearWhiskers on mount/dismount, the editorActive guard. Known invariants: occlusionWant keeps the lens >= near-margin in FRONT of any hit; cinematics (cineTarget set) bypass gameplay occlusion/look-ahead/confiner; a 0x0 viewport (hidden tab) must never produce a NaN aspect/ray.
Hunt for REAL camera defects a player would SEE or FEEL: shake/jitter, pops/snaps, clipping through walls, the farmer vanishing behind geometry, the lens stuck/lagging, oscillation, a transition that flings or freezes the camera, NaN. Ground every claim in the actual code.
`

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: { findings: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['title', 'where', 'severity', 'symptom', 'cause', 'fix', 'confidence'],
    properties: {
      title: { type: 'string' }, where: { type: 'string' },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      symptom: { type: 'string', description: 'what the player sees/feels' },
      cause: { type: 'string' }, fix: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  } } },
}
const VERDICT = {
  type: 'object', additionalProperties: false, required: ['isReal', 'severity', 'reasoning'],
  properties: { isReal: { type: 'boolean' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, reasoning: { type: 'string' } },
}

const DIMS = [
  { key: 'timing-stutter', focus: 'TIMING / STUTTER beyond the known look-ahead fix. Does anything else in the per-frame follow read fixed-step-quantized state and stutter (the smoothDist damp, the anchor lerp using frame dt while player.pos steps at 60Hz, the fov ease, kTight/kCollapse smoothing)? Is dt ever 0 or huge (tab refocus, first frame) and does that spike a damp/lerp? Is the look-ahead low-pass (camVelSmooth) reset at EVERY discontinuous player.pos jump, or only room transitions (warp/sleep/cutscene)?' },
  { key: 'occlusion-whisker', focus: 'OCCLUSION + WHISKERS. The pull-in/ease-out hysteresis (snap-in instant, ease after 0.35s clear beat) — can it pump or stick near a building edge while the player moves along a wall? The per-side whisker cache — stale across a sudden distance change? occlusionWant invariant (lens always >= margin in front of a hit) — any input (negative blocked, NaN margin, blocked<margin) that breaks it and pushes the lens THROUGH a wall? The ride-horse is NOT an occluder — can the camera still clip a real building while riding?' },
  { key: 'ride-mode', focus: 'RIDE FRAMING. rideLift/rideLiftS/rideK — boot value (rideLiftS starts 0)? Any pop on mount/dismount despite the smoothing? Does dismount fully restore dist AND rideLift AND let rideLiftS ease back? The kAspect ride branch (0.82) + the pitch floor (0.66) easing — discontinuity? clearWhiskers on mount/dismount + the +2.2u dist bump — interaction with occlusion. Does the camVelSmooth low-pass make the ride look-ahead lag oddly at canter speed?' },
  { key: 'room-transition', focus: 'ROOM / DOOR TRANSITIONS. snapTo + setConfine + the aimBox + near/far + camVelSmooth reset — is the order correct so the first post-teleport frame never films from the old room or flings? The confiner clamps the POSITION last — can it strand the lens in a corner or fight the occlusion clamp? Entering/leaving an opaque room: near 0.15/far 64 swap + the projection update — any one-frame artifact? The occlClamp reset on transition?' },
  { key: 'auto-follow', focus: 'AUTO-FOLLOW (hands-off yaw catch-up after 1.4s). The deadbands (aligned never micro-hunts; dead-backward ~180 holds) + the urgency bands (90-160 ramps the cap) — any input where the correction sign flip-flops per frame = shimmer, or where a held diagonal-back stick becomes a perpetual whip-pan? Does it fight the manual orbit or the ride yaw? Does walking straight at the lens (180) actually hold, or jitter at the taper edges (2.75/3.05 rad)?' },
  { key: 'nan-viewport', focus: 'NaN / VIEWPORT. A 0x0 or 1x1 viewport (hidden tab, iOS rotation, boot) — every aspect/ray/projection guarded? resize() refuses w/h<=1 — but does the constructor + the per-frame margin calc + screenPos + occlusion ray all stay finite if aspect is briefly bad? Any division by a near-zero (dt, dist, asked, smoothDist) that yields NaN/Infinity and poisons the matrix?' },
  { key: 'cinematics', focus: 'CINEMATICS. cineFollow/cineCut/focusOn/release/moveFocus + the focusW channel (0..1). Can a ceremony release() fight a running cinematic for focusW and leave attention half-handed-back? Are gsap tweens on focusW/focusPoint killed before re-tweening (stutter from stacked tweens)? On cineFollow(null) handback — is pitch/dist/occlClamp legally restored so gameplay resumes clean? A cinematic interrupted by another (construction during a deed) — does it strand?' },
  { key: 'lookahead-fix', focus: 'THE NEW LOOK-AHEAD LOW-PASS (camVelSmooth in main.ts onFrame). Is the smoothing math right (the kVel = 1-exp(-12*dt) lerp)? Does it preserve the displacement-not-intent property (player pushing into a wall = zero displacement = look-ahead decays, never shoves the ray through the wall)? Is it reset on ALL teleports (only room transition resets it — is that enough; what about the dev warp / any sleep reposition)? Could the ~85ms lag cause the look-ahead to over/undershoot at a sharp direction change?' },
]

phase('Hunt')
log(`camera sweep — ${DIMS.length} concerns`)

const reviewed = await pipeline(
  DIMS,
  (d) => agent(
    `${CTX}\nCONCERN "${d.key}": ${d.focus}\nReport ONLY real, specific camera defects with exact where (file:line) + the player-visible symptom + the cause + a minimal fix. Be skeptical; do not re-report the known recent fixes as new. Empty findings is a valid honest result.`,
    { label: `hunt:${d.key}`, phase: 'Hunt', schema: SCHEMA, model: 'sonnet' },
  ),
  (rev, dim) => {
    const fs = (rev && rev.findings) || []
    if (!fs.length) return []
    return parallel(fs.map((f) => () =>
      agent(
        `${CTX}\nAdversarially VERIFY this camera claim at ${REPO}; read the actual code. Default isReal=FALSE unless the code genuinely produces a defect a player would see/feel. Many "issues" are already guarded elsewhere (NaN guards, hysteresis, the cineTarget bypass) — grep before agreeing. Do not accept re-reports of the known recent fixes.\nCLAIM (${dim.key}): ${f.title}\n@ ${f.where}\nSYMPTOM: ${f.symptom}\nCAUSE: ${f.cause}\nFIX: ${f.fix}`,
        { label: `verify:${dim.key}`, phase: 'Verify', schema: VERDICT, model: 'sonnet' },
      ).then((v) => ({ ...f, verdict: v }))))
  },
)

phase('Triage')
const confirmed = reviewed.flat().filter(Boolean).filter((f) => f.verdict && f.verdict.isReal)
  .map((f) => ({ title: f.title, where: f.where, severity: f.verdict.severity, symptom: f.symptom, cause: f.cause, fix: f.fix, why: f.verdict.reasoning }))
  .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]))

log(`${confirmed.length} real camera findings`)
return { realCount: confirmed.length, clean: confirmed.length === 0, findings: confirmed }
