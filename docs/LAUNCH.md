# Sunrise Farm launch notes

## Ship to itch.io

1. Run `npm run package:itch`.
2. Upload `sunrise-farm-itch.zip` to a new itch.io project.
3. Set the project kind to `HTML`.
4. Enable mobile/browser play, then test the embedded frame on a phone-sized viewport.

The zip contains the built `dist/` contents at the root, which is what itch expects for an HTML game.

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
