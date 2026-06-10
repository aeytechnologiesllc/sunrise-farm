/** Virtual joysticks (DOM) — one class, two sides.
 * LEFT drives the farmer (merged with WASD/arrows); RIGHT orbits the camera.
 * Wedge-proof: a stick releases on pointerup, pointercancel,
 * lostpointercapture, window blur AND tab-hidden — a dropped pointer can
 * never leave the farmer running into a fence (or the camera spinning)
 * forever. Landscape-first: both sticks hug the bottom corners inside the
 * safe area, sized for thumbs at 812x375. */

const CSS = `
.joy{position:fixed;width:124px;height:124px;
  bottom:calc(20px + env(safe-area-inset-bottom));
  border-radius:50%;background:rgba(40,30,10,.16);
  box-shadow:inset 0 0 0 2px rgba(255,252,240,.5);z-index:20;touch-action:none}
.joy.left{left:calc(18px + env(safe-area-inset-left))}
.joy.right{right:calc(18px + env(safe-area-inset-right))}
.joyknob{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;
  border-radius:50%;background:rgba(255,252,240,.92);
  box-shadow:0 3px 10px rgba(40,25,0,.35), inset 0 -4px 0 rgba(160,130,70,.35);
  transition:transform .08s ease-out}
.joy.right .joyknob{background:rgba(255,246,214,.88);
  box-shadow:0 3px 10px rgba(40,25,0,.3), inset 0 -4px 0 rgba(150,120,60,.3)}
.joy .joyglyph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:15px;color:rgba(60,45,15,.5);pointer-events:none}
@media (hover:hover) and (pointer:fine){ .joy{opacity:.55} }
`
let cssInstalled = false

const RADIUS = 44

export interface JoystickOpts {
  side: 'left' | 'right'
  /** merge WASD/arrow keys into the vector (left stick only) */
  keyboard?: boolean
  /** small glyph hinting what the stick does (e.g. camera icon) */
  glyph?: string
}

export class Joystick {
  /** unit-ish vector: x = screen-right, y = screen-up. |v| <= 1 */
  readonly value = { x: 0, y: 0 }
  /** true the moment any input is active (idle-timer reset) */
  get active(): boolean {
    return this.value.x !== 0 || this.value.y !== 0
  }
  /** raw stick deflection 0..1 (keyboard included) — run threshold checks */
  get magnitude(): number {
    return Math.min(1, Math.hypot(this.value.x, this.value.y))
  }

  private base: HTMLDivElement
  private knob: HTMLDivElement
  private pointerId: number | null = null
  private stick = { x: 0, y: 0 }
  private keys = new Set<string>()

  constructor(opts: JoystickOpts) {
    if (!cssInstalled) {
      cssInstalled = true
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
    }
    this.base = document.createElement('div')
    this.base.className = `joy ${opts.side}`
    this.knob = document.createElement('div')
    this.knob.className = 'joyknob'
    this.base.appendChild(this.knob)
    if (opts.glyph) {
      const g = document.createElement('div')
      g.className = 'joyglyph'
      g.textContent = opts.glyph
      this.knob.appendChild(g)
    }
    document.body.appendChild(this.base)

    this.base.addEventListener('pointerdown', this.down)
    this.base.addEventListener('pointermove', this.move)
    this.base.addEventListener('pointerup', this.release)
    this.base.addEventListener('pointercancel', this.release)
    this.base.addEventListener('lostpointercapture', this.release)
    addEventListener('blur', this.releaseAll)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.releaseAll()
    })
    if (opts.keyboard) {
      addEventListener('keydown', (e) => {
        if (KEYMAP[e.code]) {
          this.keys.add(KEYMAP[e.code])
          this.recompute()
        }
      })
      addEventListener('keyup', (e) => {
        if (KEYMAP[e.code]) {
          this.keys.delete(KEYMAP[e.code])
          this.recompute()
        }
      })
    }
  }

  private down = (e: PointerEvent): void => {
    if (this.pointerId !== null) return
    this.pointerId = e.pointerId
    this.base.setPointerCapture(e.pointerId)
    this.track(e)
  }

  private move = (e: PointerEvent): void => {
    if (e.pointerId === this.pointerId) this.track(e)
  }

  private release = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return
    this.pointerId = null
    this.stick.x = this.stick.y = 0
    this.recompute()
  }

  private releaseAll = (): void => {
    this.pointerId = null
    this.stick.x = this.stick.y = 0
    this.keys.clear()
    this.recompute()
  }

  private track(e: PointerEvent): void {
    const r = this.base.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    const len = Math.hypot(dx, dy)
    const k = len > RADIUS ? RADIUS / len : 1
    this.stick.x = (dx * k) / RADIUS
    this.stick.y = (-dy * k) / RADIUS
    this.recompute()
  }

  private recompute(): void {
    let x = this.stick.x
    let y = this.stick.y
    if (this.keys.has('l')) x -= 1
    if (this.keys.has('r')) x += 1
    if (this.keys.has('u')) y += 1
    if (this.keys.has('d')) y -= 1
    const len = Math.hypot(x, y)
    if (len > 1) {
      x /= len
      y /= len
    }
    this.value.x = x
    this.value.y = y
    this.knob.style.transform = `translate(${this.stick.x * RADIUS}px,${-this.stick.y * RADIUS}px)`
  }
}

const KEYMAP: Record<string, 'u' | 'd' | 'l' | 'r'> = {
  KeyW: 'u',
  KeyS: 'd',
  KeyA: 'l',
  KeyD: 'r',
  ArrowUp: 'u',
  ArrowDown: 'd',
  ArrowLeft: 'l',
  ArrowRight: 'r',
}
