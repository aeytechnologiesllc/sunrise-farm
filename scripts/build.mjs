// Build wrapper. Stamps a unique build id into the bundle (VITE_APP_VERSION)
// AND writes dist/version.json with the SAME id. The running app fetches
// version.json with cache:'no-store' on boot (see the freshness check in
// src/main.ts) and hard-reloads past a cached index.html when a newer build is
// live — so an installed PWA / iOS home-screen app reliably updates even though
// there is no service worker. The content-hashed JS busts itself; this only
// covers the one file that can go stale (index.html).
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const build = String(Date.now())
const run = (cmd, env) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } })

run('tsc --noEmit')
run('vite build', { VITE_APP_VERSION: build })
mkdirSync('dist', { recursive: true })
writeFileSync('dist/version.json', `${JSON.stringify({ build })}\n`)
console.log(`[build] stamped version ${build} -> dist/version.json`)
