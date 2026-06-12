/**
 * Fixed-step frame driver. Simulation runs at 60Hz regardless of display
 * rate; rendering and tweens get raw dt. advance() is public so tests and
 * the dev driver can step deterministically with RAF paused.
 */
type TickFn = (dt: number) => void

export class Engine {
  readonly fixedStep = 1 / 60
  /** shared shader/game clock, seconds */
  readonly uTime = { value: 0 }
  fps = 60

  private updates: TickFn[] = []
  private frames: TickFn[] = []
  private accumulator = 0
  private last = 0
  private raf = 0

  constructor(private render: (dt: number) => void) {}

  onUpdate(fn: TickFn): void {
    this.updates.push(fn)
  }

  onFrame(fn: TickFn): void {
    this.frames.push(fn)
  }

  start(): void {
    this.last = performance.now()
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      const dt = Math.min((now - this.last) / 1000, 0.1)
      this.last = now
      this.advance(dt)
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
  }

  advance(dt: number): void {
    // the fps EMA lives HERE, not in start(): main drives its own rAF loop
    // straight into advance(), so a start()-only EMA reads a frozen 60
    // forever (the perf readout was fiction until 2026-06-12)
    if (dt > 1e-4) this.fps += (1 / dt - this.fps) * 0.05
    this.uTime.value += dt
    // catch-up cap: 4 fixed steps, not 15 — after a hitch the sim must not
    // pile MORE work onto the very frame that is already struggling (the
    // recovery-resistant feedback loop the perf audit flagged). Dropped
    // wall time is fine: crops/timers re-sync via catchUp on resume.
    this.accumulator = Math.min(this.accumulator + dt, 4 * this.fixedStep)
    while (this.accumulator >= this.fixedStep) {
      this.accumulator -= this.fixedStep
      for (const fn of this.updates) fn(this.fixedStep)
    }
    for (const fn of this.frames) fn(dt)
    this.render(dt)
  }
}
