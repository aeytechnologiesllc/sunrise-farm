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
- Emergency rollback: user reported the `500aa23` mobile perf commit made the game unplayably laggy. Reverted it immediately; subagent flagged grass chunk sizing and shadow cadence as the most suspect areas for any smaller future retry.
