/** Background music: real CC0/public-domain folk tracks (see
 * public/audio/CREDITS.md), looped as an alternating playlist with gentle
 * gapless crossfades scheduled on the WebAudio clock. Sits quietly under the
 * SFX (~0.25 vs 0.45 master), starts only after the first user gesture,
 * ducks during fanfares, and a HUD corner button mutes it (persisted).
 * Purely presentational — never touches game logic or the fixed-step sim. */

const TRACKS = ['/audio/music/still-pickin.mp3', '/audio/music/happy-whistling-ukulele.mp3']
const VOLUME = 0.25
/** crossfade length between tracks, seconds */
const XFADE = 2.5
const MUTE_KEY = 'sunrise-farm.musicMuted'

export class Music {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private duckG: GainNode | null = null
  private buffers: (AudioBuffer | null)[] = TRACKS.map(() => null)
  private loading = false
  private nextIdx = 0
  private nextStart = 0
  private muted: boolean

  constructor() {
    this.muted = localStorage.getItem(MUTE_KEY) === '1'
  }

  get isMuted(): boolean {
    return this.muted
  }

  /** call on first user gesture with the (already unlocked) shared context */
  unlock(ctx: AudioContext): void {
    if (this.ctx) return
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.gain.value = this.muted ? 0 : VOLUME
    this.duckG = ctx.createGain()
    this.duckG.connect(this.out)
    this.out.connect(ctx.destination)
    void this.load()
  }

  private async load(): Promise<void> {
    if (this.loading || !this.ctx) return
    this.loading = true
    await Promise.all(
      TRACKS.map(async (url, i) => {
        try {
          const res = await fetch(url)
          if (!res.ok) return
          const raw = await res.arrayBuffer()
          this.buffers[i] = await this.ctx!.decodeAudioData(raw)
        } catch {
          /* missing/undecodable track: playlist just skips it */
        }
      }),
    )
  }

  /** per-frame: keep the playlist scheduled ahead on the audio clock */
  tick(): void {
    if (!this.ctx || !this.duckG) return
    const ready = this.buffers.filter((b): b is AudioBuffer => b !== null)
    if (ready.length === 0) return
    if (this.ctx.currentTime + 6 < this.nextStart) return
    const buf = nextBuffer(this.buffers, this.nextIdx)
    if (!buf) return
    this.nextIdx = (this.buffers.indexOf(buf.buffer) + 1) % this.buffers.length
    const t0 = Math.max(this.nextStart, this.ctx.currentTime + 0.05)
    const first = this.nextStart === 0
    const src = this.ctx.createBufferSource()
    src.buffer = buf.buffer
    const g = this.ctx.createGain()
    const fadeIn = first ? 1.2 : XFADE
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(1, t0 + fadeIn)
    const dur = buf.buffer.duration
    g.gain.setValueAtTime(1, t0 + dur - XFADE)
    g.gain.linearRampToValueAtTime(0, t0 + dur)
    src.connect(g).connect(this.duckG)
    src.start(t0)
    src.stop(t0 + dur + 0.1)
    // the next track begins exactly where this one's fade-out starts
    this.nextStart = t0 + dur - XFADE
  }

  /** dip slightly under big fanfares, then swell back */
  duck(): void {
    if (!this.ctx || !this.duckG) return
    const t = this.ctx.currentTime
    const gain = this.duckG.gain
    gain.cancelScheduledValues(t)
    gain.setValueAtTime(gain.value, t)
    gain.linearRampToValueAtTime(0.35, t + 0.18)
    gain.setValueAtTime(0.35, t + 1.4)
    gain.linearRampToValueAtTime(1, t + 3.2)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
    if (!this.ctx || !this.out) return
    const t = this.ctx.currentTime
    this.out.gain.cancelScheduledValues(t)
    this.out.gain.setValueAtTime(this.out.gain.value, t)
    this.out.gain.linearRampToValueAtTime(muted ? 0 : VOLUME, t + 0.3)
  }
}

function nextBuffer(buffers: (AudioBuffer | null)[], startIdx: number): { buffer: AudioBuffer } | null {
  for (let k = 0; k < buffers.length; k++) {
    const b = buffers[(startIdx + k) % buffers.length]
    if (b) return { buffer: b }
  }
  return null
}
