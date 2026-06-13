/** Background music: real CC0/public-domain folk tracks (see
 * public/audio/CREDITS.md), looped as an alternating playlist.
 *
 * Plays through HTMLAudioElements — NOT WebAudio — on purpose:
 * - iOS routes media elements through the "playback" audio session, so music
 *   plays even with the ringer SILENT switch on (WebAudio gets hard-muted).
 * - Autoplay policies: on the first user gesture every element is primed
 *   (play() inside the gesture call stack, losers paused immediately), which
 *   blesses them for all later programmatic play() calls at track changes.
 * - Mute uses el.muted (settable everywhere, including old iOS); fades use
 *   el.volume where the platform allows it and degrade to clean hard cuts
 *   where it doesn't.
 * Sits quietly under the SFX (~0.25), ducks during fanfares, and the HUD
 * corner button mutes it (persisted). Purely presentational. */

// BASE-relative so a subpath host (GitHub Pages /<repo>/) still finds them
const TRACKS = [
  `${import.meta.env.BASE_URL}audio/music/still-pickin.mp3`,
  `${import.meta.env.BASE_URL}audio/music/happy-whistling-ukulele.mp3`,
]
const VOLUME = 0.25
/** crossfade length between tracks, seconds */
const XFADE = 2.5
/** volume approach rate per second (fade-ins/outs) */
const FADE_RATE = 0.9
const MUTE_KEY = 'sunrise-farm.musicMuted'

export class Music {
  private els: HTMLAudioElement[]
  private want: number[]
  private have: number[]
  private primed = false
  private current = -1
  private muted: boolean
  private lastTick = 0
  private duckK = 1
  private duckRecoverAt = 0

  constructor() {
    this.muted = localStorage.getItem(MUTE_KEY) === '1'
    this.els = TRACKS.map((url) => {
      const a = new Audio(url)
      a.preload = 'none'
      a.loop = false
      a.muted = this.muted
      ;(a as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
      try {
        a.volume = 0
      } catch {
        /* platforms with fixed volume: fades become hard cuts */
      }
      return a
    })
    this.want = TRACKS.map(() => 0)
    this.have = TRACKS.map(() => 0)
  }

  get isMuted(): boolean {
    return this.muted
  }

  /** call inside the FIRST user gesture: primes every element for later
   * programmatic playback, then lets track 0 keep playing. If the browser
   * still refuses (gesture didn't carry activation), we un-prime so the very
   * next tap retries — music can never get permanently stuck off. */
  unlock(_ctx?: AudioContext): void {
    if (this.primed) return
    this.primed = true
    this.current = 0
    this.want = this.els.map((_, i) => (i === 0 ? 1 : 0))
    this.els.forEach((a, i) => {
      const p = a.play()
      if (p)
        p.then(() => {
          if (i !== this.current) {
            a.pause()
            a.currentTime = 0
          }
        }).catch(() => {
          if (i === this.current) {
            this.primed = false
            this.current = -1
          }
        })
    })
  }

  /** seconds until the next steady-state poll (media-element property reads
   * cross into WebKit's media engine — they are NOT cheap field reads) */
  private restUntil = 0

  /** per-frame: drive crossfades + the playlist hand-off on wall time */
  tick(): void {
    if (!this.primed || this.current < 0) return
    const now = performance.now() / 1000
    const dt = this.lastTick === 0 ? 0.016 : Math.min(0.1, now - this.lastTick)
    this.lastTick = now

    // steady state (no fade easing, no duck recovering) polls at 4Hz —
    // the crossfade window is 2s+, a 250ms-late hand-off is inaudible
    let busy = this.duckK < 1
    for (let i = 0; i < this.els.length && !busy; i++) busy = this.have[i] !== this.want[i]
    if (!busy) {
      if (now < this.restUntil) return
      this.restUntil = now + 0.25
    }

    // duck recovery
    if (this.duckK < 1 && now >= this.duckRecoverAt) {
      this.duckK = Math.min(1, this.duckK + dt / 1.8)
    }

    // hand off to the next track as this one approaches its tail
    const cur = this.els[this.current]
    const dur = cur.duration
    if (Number.isFinite(dur) && dur > 0 && (cur.ended || dur - cur.currentTime <= XFADE)) {
      const next = (this.current + 1) % this.els.length
      if (next !== this.current) {
        const n = this.els[next]
        n.currentTime = 0
        void n.play().catch(() => {})
        this.want[this.current] = 0
        this.want[next] = 1
        this.current = next
      } else if (cur.ended) {
        // single-track fallback: just loop it
        cur.currentTime = 0
        void cur.play().catch(() => {})
      }
    }

    // ease element volumes toward their targets (fade in/out + duck)
    for (let i = 0; i < this.els.length; i++) {
      const target = this.want[i]
      const h = this.have[i]
      const step = FADE_RATE * dt
      const v = h + Math.max(-step, Math.min(step, target - h))
      this.have[i] = v
      try {
        this.els[i].volume = Math.max(0, Math.min(1, v * VOLUME * this.duckK))
      } catch {
        /* fixed-volume platform: rely on muted + hard cuts */
      }
      // fully faded out: stop pulling the stream
      if (target === 0 && v <= 0.001 && !this.els[i].paused && i !== this.current) this.els[i].pause()
    }
  }

  /** dip slightly under big fanfares, then swell back */
  duck(): void {
    this.duckK = 0.35
    this.duckRecoverAt = performance.now() / 1000 + 1.4
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
    for (const a of this.els) a.muted = muted
  }

  /** dev/diagnostic peek (also handy in remote debugging) */
  get debug(): {
    primed: boolean
    current: number
    times: number[]
    paused: boolean[]
    ready: number[]
    network: number[]
    errors: Array<number | null>
    volumes: number[]
    muted: boolean[]
  } {
    return {
      primed: this.primed,
      current: this.current,
      times: this.els.map((a) => a.currentTime),
      paused: this.els.map((a) => a.paused),
      ready: this.els.map((a) => a.readyState),
      network: this.els.map((a) => a.networkState),
      errors: this.els.map((a) => a.error?.code ?? null),
      volumes: this.els.map((a) => a.volume),
      muted: this.els.map((a) => a.muted),
    }
  }
}
