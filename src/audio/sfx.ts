/** All audio is synthesized via WebAudio — no sample files. The context is
 * created on first user gesture; every play call no-ops until then. */

/** ~0.05s of silence as a WAV data URI — see the session trick in unlock() */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRlIAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YS4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private session: HTMLAudioElement | null = null

  /** shared context so music rides the same unlock gesture */
  get context(): AudioContext | null {
    return this.ctx
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const ctx = new AudioContext()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.45
    this.master.connect(ctx.destination)
    // iOS hard-mutes ALL WebAudio while the ringer switch is on silent —
    // unless a media element is playing, which flips the app's audio session
    // to 'playback'. A looping silent <audio> keeps that session alive so
    // pops/coins/barks stay audible on silent phones (same reason the music
    // moved to HTMLAudio).
    const s = new Audio(SILENT_WAV)
    s.loop = true
    ;(s as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
    void s.play().catch(() => {})
    this.session = s
    void this.session // held alive for the page's lifetime
  }

  private tone(
    freq: number,
    opts: {
      type?: OscillatorType
      at?: number
      dur?: number
      gain?: number
      glideTo?: number
    } = {},
  ): void {
    if (!this.ctx || !this.master) return
    const { type = 'sine', at = 0, dur = 0.25, gain = 0.5, glideTo } = opts
    const t0 = this.ctx.currentTime + at
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur)
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur)
    osc.connect(g).connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  private noise(opts: { at?: number; dur?: number; gain?: number; freq?: number; q?: number }): void {
    if (!this.ctx || !this.master) return
    const { at = 0, dur = 0.12, gain = 0.3, freq = 1200, q = 1.2 } = opts
    const t0 = this.ctx.currentTime + at
    const len = Math.ceil(this.ctx.sampleRate * dur)
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = freq
    bp.Q.value = q
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t0)
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur)
    src.connect(bp).connect(g).connect(this.master)
    src.start(t0)
  }

  /** crop ready — two soft bell notes (kept gentle: it plays unprompted) */
  chime(): void {
    this.tone(659, { dur: 0.5, gain: 0.14 })
    this.tone(988, { at: 0.09, dur: 0.6, gain: 0.1 })
  }

  /** harvest squash-pop */
  pop(): void {
    this.tone(420, { type: 'triangle', dur: 0.12, gain: 0.4, glideTo: 130 })
    this.noise({ dur: 0.07, gain: 0.18, freq: 2400, q: 0.8 })
  }

  /** planting thup */
  plant(): void {
    this.tone(220, { type: 'sine', dur: 0.1, gain: 0.3, glideTo: 110 })
    this.noise({ dur: 0.05, gain: 0.1, freq: 700, q: 1 })
  }

  /** one per coin sprite landing; slight detune keeps a shower lively */
  tink(): void {
    const f = 1860 + Math.random() * 240
    this.tone(f, { type: 'triangle', dur: 0.09, gain: 0.16 })
    this.tone(f * 1.5, { type: 'sine', dur: 0.07, gain: 0.07 })
  }

  cluck(): void {
    this.noise({ dur: 0.06, gain: 0.3, freq: 1050, q: 4 })
    this.tone(740, { type: 'square', dur: 0.05, gain: 0.06, glideTo: 480 })
    this.noise({ at: 0.09, dur: 0.05, gain: 0.2, freq: 880, q: 4 })
    this.tone(620, { at: 0.09, type: 'square', dur: 0.05, gain: 0.05, glideTo: 420 })
  }

  /** golden event — unique rising arpeggio */
  golden(): void {
    const notes = [523, 659, 784, 1047, 1319]
    notes.forEach((f, i) =>
      this.tone(f, { at: i * 0.07, type: 'triangle', dur: 0.4, gain: 0.2 }),
    )
    this.noise({ at: 0.05, dur: 0.5, gain: 0.05, freq: 6000, q: 0.6 })
  }

  /** level-up fanfare */
  fanfare(): void {
    const seq: Array<[number, number]> = [
      [523, 0],
      [659, 0.11],
      [784, 0.22],
      [1047, 0.36],
    ]
    for (const [f, at] of seq) {
      this.tone(f, { at, type: 'sawtooth', dur: 0.3, gain: 0.12 })
      this.tone(f * 0.5, { at, type: 'triangle', dur: 0.32, gain: 0.1 })
    }
    this.tone(784, { at: 0.5, type: 'sawtooth', dur: 0.55, gain: 0.1 })
    this.tone(1047, { at: 0.5, type: 'sawtooth', dur: 0.55, gain: 0.12 })
  }

  /** pet — warm short swell */
  heart(): void {
    this.tone(392, { type: 'sine', dur: 0.3, gain: 0.2 })
    this.tone(494, { at: 0.06, type: 'sine', dur: 0.34, gain: 0.16 })
    this.tone(587, { at: 0.12, type: 'sine', dur: 0.4, gain: 0.13 })
  }

  /** crate creak + thump for the arrival ceremony */
  crate(): void {
    this.tone(160, { type: 'sawtooth', dur: 0.3, gain: 0.08, glideTo: 320 })
    this.noise({ at: 0.25, dur: 0.1, gain: 0.2, freq: 400, q: 1 })
  }

  /** soft friendly "ruff" — the dog checking in, never alarming */
  bark(): void {
    this.tone(310, { type: 'square', dur: 0.07, gain: 0.1, glideTo: 170 })
    this.noise({ dur: 0.09, gain: 0.22, freq: 520, q: 1.6 })
    this.tone(240, { at: 0.02, type: 'triangle', dur: 0.1, gain: 0.18, glideTo: 120 })
  }

  /** storefront ding — a customer wave reached the stand (single, soft) */
  bell(): void {
    this.tone(1318, { type: 'triangle', dur: 0.4, gain: 0.11 })
    this.tone(1975, { dur: 0.5, gain: 0.05 })
  }

  /** sale! — bright little till jingle (offer hand-over) */
  kaching(): void {
    this.noise({ dur: 0.06, gain: 0.18, freq: 3200, q: 1.4 })
    this.tone(1047, { at: 0.02, type: 'triangle', dur: 0.16, gain: 0.2 })
    this.tone(1568, { at: 0.1, type: 'triangle', dur: 0.3, gain: 0.18 })
    this.tone(2093, { at: 0.18, type: 'sine', dur: 0.35, gain: 0.12 })
  }

  /** old tractor putt-putt-putt */
  tractor(): void {
    for (let i = 0; i < 7; i++) {
      this.tone(82 + (i % 2) * 14, { at: i * 0.13, type: 'square', dur: 0.09, gain: 0.12, glideTo: 60 })
      this.noise({ at: i * 0.13, dur: 0.07, gain: 0.1, freq: 320, q: 1 })
    }
  }

  /** gentle sheep baa — barely above the breeze */
  baa(): void {
    const f = 280 + Math.random() * 60
    this.tone(f, { type: 'sawtooth', dur: 0.32, gain: 0.04, glideTo: f * 0.82 })
    this.tone(f * 1.01, { at: 0.03, type: 'sawtooth', dur: 0.3, gain: 0.028, glideTo: f * 0.8 })
    this.noise({ dur: 0.25, gain: 0.02, freq: 900, q: 0.8 })
  }

  /** whistle — calling the dog for a fetch round */
  whistle(): void {
    this.tone(1180, { type: 'sine', dur: 0.18, gain: 0.16, glideTo: 1560 })
    this.tone(1560, { at: 0.2, type: 'sine', dur: 0.24, gain: 0.16, glideTo: 1100 })
  }
}
