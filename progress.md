Original prompt: Get Sunrise Farm going right now for soft launch: prioritize Itch/PWA, add crash/analytics tracking, and explore Zulura admin embedding.

Progress:
- Current branch starts clean at codex/mobile-story-perf-fixes.
- Goal is launch plumbing that is safe without external credentials: configurable telemetry endpoint, parent-window postMessage bridge for Zulura/admin iframe, Itch packaging docs/script.

TODO:
- Add telemetry bridge/client.
- Add launch docs and package script.
- Run tests/build/live mobile smoke.
- If a Zulura admin repo is identified, wire iframe tab or document exact integration.
- Added vendor-neutral telemetry module, iframe postMessage bridge, Itch packaging script, launch docs, and drop-in Zulura admin tab sample.
- Zulu-Royal local repo exists but is dirty/out-of-sync, so do not edit it in this pass without explicit confirmation or a clean worktree.
- Fixed iframe/private-mode storage crash by routing local/session storage through safe wrappers with memory fallback.
- Verified iframe postMessage bridge and local telemetry endpoint on a 390x844 mobile viewport; boot/ready/snapshot messages worked.
- Ran npm test, npm run package:itch, and the develop-web-game Playwright client; screenshots inspected.
- New prompt: User reports mobile lag while running or when sun is in view. Investigating render/post-processing/shadow/camera bottlenecks and testing live on mobile viewport.
- Fixed mobile running/sun-view lag by disabling mobile post stack, lowering coarse DPR cap, using cheaper mobile shadows, slowing shadow refresh while running/dusk, trimming mobile grass/forest/particles, and simplifying coarse grass wind.
- Verified on real Android emulator `Medium_Phone_API_35` in Chrome via adb/CDP: idle, running, dusk sun view, and dusk running all held ~16.6-17.6ms averages after the final pass; final dusk-running p95 was 16.8ms with only 2 frames over 17ms.
