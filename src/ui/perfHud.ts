/** On-screen performance readout for REAL-DEVICE testing.
 *
 * The iOS Simulator and a desktop browser's "mobile viewport" both render on
 * the host Mac's GPU/CPU, so their 60fps means nothing for an actual phone.
 * The only trustworthy numbers come from the handset itself — this overlay
 * surfaces them with no cable and no devtools: fps, smoothed frame time, a
 * rolling 2-second worst-frame + hitch count (the "lag when you run at the
 * field" shows up here as a hitch spike), DPR and draw stats.
 *
 * Toggle: `?fps=1` (persists across loads), a three-finger tap anywhere, or
 * `window.__farmFps()` from a desktop console. The element is
 * `pointer-events:none`, so it can never swallow a joystick or camera drag.
 */
export class PerfHud {
  private el: HTMLDivElement | null = null
  private on = false
  private persist: (on: boolean) => void
  // rolling 2-second window (matches the perfRun panel's windowed semantics)
  private winStart = 0
  private winMax = 0
  private winLong = 0
  private winVeryLong = 0
  private dispMax = 0
  private dispLong = 0
  private dispVeryLong = 0
  private lastPaint = 0

  constructor(opts: { persist?: (on: boolean) => void } = {}) {
    this.persist = opts.persist ?? (() => {})
  }

  get enabled(): boolean {
    return this.on
  }

  setEnabled(on: boolean): void {
    this.on = on
    if (on) this.mount()
    if (this.el) this.el.style.display = on ? 'block' : 'none'
  }

  /** flip visibility and tell the caller to persist the choice */
  toggle(): void {
    this.setEnabled(!this.on)
    this.persist(this.on)
  }

  private mount(): void {
    if (this.el) return
    const el = document.createElement('div')
    // top-left, clear of the notch; translucent so the farm reads behind it
    el.style.cssText =
      'position:fixed;z-index:40;pointer-events:none;white-space:pre;' +
      'left:calc(8px + env(safe-area-inset-left));top:calc(8px + env(safe-area-inset-top));' +
      'padding:5px 8px;border-radius:8px;background:rgba(16,18,12,.62);' +
      'color:#eafbcf;font:700 11px/1.34 ui-monospace,SFMono-Regular,Menlo,monospace;' +
      'text-shadow:0 1px 2px rgba(0,0,0,.5);min-width:120px'
    el.textContent = 'fps —'
    document.body.appendChild(el)
    this.el = el
  }

  /** call once per rendered frame, AFTER render so the draw stats are current.
   * `now` is the rAF timestamp (ms), `dtMs` the raw frame delta. */
  sample(
    now: number,
    dtMs: number,
    info: { fps: number; avgMs: number; dpr: number; calls: number; tris: number },
  ): void {
    if (!this.on) return
    if (this.winStart === 0) this.winStart = now
    // ignore tab-resume mega-frames so one background gap can't show as a hitch
    if (dtMs > 0 && dtMs < 1000) {
      if (dtMs > this.winMax) this.winMax = dtMs
      if (dtMs > 33.4) this.winLong += 1
      if (dtMs > 50) this.winVeryLong += 1
    }
    if (now - this.winStart >= 2000) {
      this.dispMax = this.winMax
      this.dispLong = this.winLong
      this.dispVeryLong = this.winVeryLong
      this.winMax = 0
      this.winLong = 0
      this.winVeryLong = 0
      this.winStart = now
    }
    // repaint the DOM ~5x/sec, not every frame — textContent forces layout
    if (now - this.lastPaint < 200 || !this.el) return
    this.lastPaint = now
    const fps = Math.round(info.fps)
    this.el.style.color = fps >= 55 ? '#bff58a' : fps >= 40 ? '#ffd36b' : '#ff8f6b'
    this.el.textContent =
      `${fps} fps  ${info.avgMs.toFixed(1)}ms\n` +
      `2s worst ${this.dispMax.toFixed(0)}ms\n` +
      `hitch ${this.dispLong} (>33)  ${this.dispVeryLong} (>50)\n` +
      `dpr ${info.dpr.toFixed(2)}  draw ${info.calls}  tri ${(info.tris / 1000).toFixed(1)}k`
  }
}
