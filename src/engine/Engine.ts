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
      this.fps += (1 / Math.max(dt, 1e-4) - this.fps) * 0.05
      this.advance(dt)
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
  }

  advance(dt: number): void {
    this.uTime.value += dt
    this.accumulator = Math.min(this.accumulator + dt, 0.25)
    while (this.accumulator >= this.fixedStep) {
      this.accumulator -= this.fixedStep
      for (const fn of this.updates) fn(this.fixedStep)
    }
    for (const fn of this.frames) fn(dt)
    this.render(dt)
  }
}
