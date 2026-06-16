# Sunrise Farm launch notes

## Ship to itch.io

1. Run `npm run package:itch`.
2. Upload `sunrise-farm-itch.zip` to a new itch.io project.
3. Set the project kind to `HTML`.
4. Enable mobile/browser play, then test the embedded frame on a phone-sized viewport.

The zip contains the built `dist/` contents at the root, which is what itch expects for an HTML game.

## Current Itch draft fields

- **Title:** Sunrise Farm
- **Short description:** A cozy 3D browser farm: plant crops, care for animals, ride Hazel, drive the tractor, and grow Millbrook.
- **Classification:** Games
- **Kind of project:** HTML
- **Release status:** Prototype or in development
- **Pricing:** No payments / free for soft launch
- **Genre:** Simulation
- **Tags:** `3d`, `farming`, `cozy`, `simulation`, `browser`, `mobile`, `pwa`, `low-poly`, `casual`, `singleplayer`
- **Embed:** 640 × 360, fullscreen button enabled, scrollbars disabled if offered
- **Mobile:** enable mobile-friendly/browser play
- **Upload:** `sunrise-farm-itch.zip`, mark as playable in browser

## Current Itch media

- **Cover image:** `media/itch/cover-630x500.png`
- **Embed BG / Run Game poster:** `media/itch/embed-clean-keyart-640x360.png`
- **Desktop screenshot:** `media/itch/screenshot-desktop-farm.png`
- **Mobile first-session screenshot:** `media/itch/screenshot-mobile-fresh.png`
- **Tractor screenshot:** `media/itch/screenshot-tractor.png`
- **Horse screenshot:** `media/itch/screenshot-horse.png`

## Draft page copy

Free browser play — plant crops, ride Hazel, drive the tractor.

Start with a small homestead, grow wheat, help customers at the roadside stand, unlock animals, and expand into a bigger working farm.

### Controls

- **Mobile:** drag the joystick, tap action buttons.
- **Desktop:** WASD / arrow keys to move, Space to activate, F for fences.

Early soft-launch build — feedback on mobile controls, performance, and pacing is welcome.

## Crash and analytics tracking

The game now sends launch/FTUE/progression/crash events through a tiny vendor-neutral bridge:

- Set `VITE_SUNRISE_TELEMETRY_URL=https://YOUR_SUPABASE_REF.supabase.co/functions/v1/game-telemetry-ingest` before `npm run build`, or
- Append `?telemetry=https://your-endpoint.example/events` to the game URL.
- Optionally set `VITE_SUNRISE_TELEMETRY_KEY=your-public-ingest-key` before `npm run build`, or append `?telemetry_key=...` / `?ingest_key=...` to the game URL.

Events are JSON strings sent as `text/plain;charset=UTF-8` with credentialless `fetch(..., mode: 'no-cors')`, so simple webhook/worker endpoints can receive them without preflight drama. The ingest key is a public anti-spoofing signal, not a secret auth guarantee, and is only included in HTTP telemetry payloads. If no endpoint is configured, the tracker stays safe/no-op except for iframe `postMessage` events.

Tracked events:

- `boot`
- `ready`
- `first_move`
- `first_crop_planted`
- `first_harvest`
- `chicken_arrived`
- `chicken_named`
- `project_built`
- `land_deed_bought`
- `level_up`
- `performance_sample`
- `webgl_context_lost`
- `error`
- `unhandled_rejection`

## Zulura admin iframe bridge

Embed the game in Zulura with an iframe and listen for `postMessage` packets where `event.data.source === 'sunrise-farm'`.

The game also survives third-party iframe storage restrictions: if `localStorage` or `sessionStorage` is blocked, it falls back to in-memory storage instead of crashing.

Parent → game commands:

- `{ source: 'zulura-admin', type: 'sunrise:getSnapshot' }`
- `{ source: 'zulura-admin', type: 'sunrise:ping' }`
- `{ source: 'zulura-admin', type: 'sunrise:resetSave' }`
- `{ source: 'zulura-admin', type: 'sunrise:setTelemetryEndpoint', endpoint: 'https://...' }`

Game → parent messages:

- `{ source: 'sunrise-farm', type: 'ready', sessionId, sentAt }`
- `{ source: 'sunrise-farm', type: 'event', event, payload, sessionId, sentAt }`
- `{ source: 'sunrise-farm', type: 'snapshot', snapshot, sessionId, sentAt }`
- `{ source: 'sunrise-farm', type: 'pong', sessionId, sentAt }`

Use `docs/zulura/SunriseFarmAdminTab.tsx` as the drop-in admin tab starter.
