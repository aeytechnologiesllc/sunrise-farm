/** Left-thumb virtual joystick (DOM) + WASD/arrows, merged into one vector.
 * Wedge-proof: the stick releases on pointerup, pointercancel,
 * lostpointercapture, window blur AND tab-hidden — a dropped pointer can
 * never leave the farmer running into a fence forever. */

const CSS = `
#joy{position:fixed;left:calc(18px + env(safe-area-inset-left));
  bottom:calc(20px + env(safe-area-inset-bottom));width:124px;height:124px;
  border-radius:50%;background:rgba(40,30,10,.16);
  box-shadow:inset 0 0 0 2px rgba(255,252,240,.5);z-index:20;touch-action:none}
#joyknob{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;
  border-radius:50%;background:rgba(255,252,240,.92);
  box-shadow:0 3px 10px rgba(40,25,0,.35), inset 0 -4px 0 rgba(160,130,70,.35);
  transition:transform .08s ease-out}
@media (hover:hover) and (pointer:fine){ #joy{opacity:.55} }
`

const RADIUS = 44

export class Joystick {
  /** unit-ish vector: x = screen-right, y = screen-up (forward). |v| <= 1 */
  readonly value = { x: 0, y: 0 }
  /** true the moment any movement input is active (idle-timer reset) */
  get active(): boolean {
    return this.value.x !== 0 || this.value.y !== 0
  }

  private base: HTMLDivElement
  private knob: HTMLDivElement
  private pointerId: number | null = null
  private stick = { x: 0, y: 0 }
  private keys = new Set<string>()

  constructor() {
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    this.base = document.createElement('div')
    this.base.id = 'joy'
    this.knob = document.createElement('div')
    this.knob.id = 'joyknob'
    this.base.appendChild(this.knob)
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
