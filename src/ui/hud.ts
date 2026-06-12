/** DOM HUD: coins odometer + fountain, wheat pouch, XP bar, contextual chip,
 * proximity action buttons, customer want bubbles, naming card, level banner,
 * countdown ring, nest pip, name tag, floating toasts.
 * Purely presentational — game state is the single source of truth and the
 * displayed coin count self-heals toward it (never gated on tweens). */
import gsap from 'gsap'

const CSS = `
#hud{position:fixed;inset:0;pointer-events:none;color:#3a2d1e;
  font-family:'Trebuchet MS','Segoe UI',system-ui,sans-serif;z-index:10}
.pill{display:flex;align-items:center;gap:7px;background:rgba(255,252,240,.92);
  border-radius:999px;padding:6px 14px 6px 9px;box-shadow:0 2px 8px rgba(60,40,10,.18);
  font-weight:700;font-size:17px}
#topleft{position:absolute;top:max(10px,env(safe-area-inset-top));left:12px;
  display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.coin-ico{width:22px;height:22px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#ffe999,#f5b916 60%,#c98a08);
  box-shadow:inset 0 0 0 2px rgba(150,95,0,.35)}
.wheat-ico{font-size:18px;line-height:22px}
#xpwrap{display:flex;align-items:center;gap:8px;background:rgba(255,252,240,.92);
  border-radius:999px;padding:5px 12px 5px 6px;box-shadow:0 2px 8px rgba(60,40,10,.18)}
#daypill{display:flex;align-items:center;gap:6px;background:rgba(255,252,240,.92);
  border-radius:999px;padding:4px 12px;box-shadow:0 2px 8px rgba(60,40,10,.18);
  font-weight:800;font-size:13px;color:#7a5c1e}
#lvl{min-width:26px;height:26px;border-radius:50%;background:#7cb342;color:#fff;
  display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;
  box-shadow:inset 0 -2px 0 rgba(0,0,0,.18)}
#xpbar{width:104px;height:9px;border-radius:6px;background:#e4dcc8;overflow:hidden}
#xpfill{height:100%;width:0%;border-radius:6px;background:linear-gradient(90deg,#9ccc65,#7cb342)}
#chip{position:absolute;top:max(12px,env(safe-area-inset-top));left:50%;
  transform:translateX(-50%);background:rgba(255,252,240,.95);border-radius:999px;
  padding:8px 18px;font-weight:700;font-size:15px;box-shadow:0 3px 10px rgba(60,40,10,.22);
  opacity:0;white-space:nowrap}
#banner{position:absolute;top:18%;left:50%;transform:translate(-50%,-50%) scale(.6);
  background:linear-gradient(180deg,#ffd54f,#ffb300);color:#5d3a00;border-radius:18px;
  padding:14px 34px;font-size:26px;font-weight:800;letter-spacing:.5px;
  box-shadow:0 6px 24px rgba(120,70,0,.4);opacity:0;text-align:center}
#banner small{display:block;font-size:14px;font-weight:700;margin-top:2px}
#flash{position:absolute;inset:0;opacity:0;
  background:radial-gradient(circle at 50% 30%,rgba(255,240,180,.85),rgba(255,240,180,0) 60%)}
.coin-fly{position:absolute;width:16px;height:16px;border-radius:50%;margin:-8px 0 0 -8px;
  background:radial-gradient(circle at 35% 30%,#ffe999,#f5b916 60%,#c98a08);
  box-shadow:0 1px 3px rgba(80,50,0,.4)}
.coin-fly.golden{background:radial-gradient(circle at 35% 30%,#fffbe0,#ffd700 55%,#e09e00);
  box-shadow:0 0 8px rgba(255,215,0,.9)}
#actions{position:absolute;right:calc(14px + env(safe-area-inset-right));
  bottom:calc(158px + env(safe-area-inset-bottom));display:flex;flex-direction:column;
  gap:10px;align-items:flex-end}
.act{pointer-events:auto;display:flex;align-items:center;gap:8px;border:none;
  background:rgba(255,252,240,.96);border-radius:999px;padding:8px 15px 8px 11px;
  font-family:inherit;font-weight:800;font-size:15px;color:#3a2d1e;min-height:46px;
  box-shadow:0 5px 16px rgba(60,40,10,.3),0 3px 0 #d8cdb2;cursor:pointer;
  touch-action:manipulation}
.act:active{transform:translateY(2px);box-shadow:0 3px 10px rgba(60,40,10,.3),0 1px 0 #d8cdb2}
.act .em{font-size:21px;line-height:1}
.act .lbl{text-align:left;line-height:1.1}
.act .lbl small{display:block;font-size:11px;font-weight:700;color:#8a7a5a}
.act.locked{filter:grayscale(.85);opacity:.7}
.act.locked .lbl small{color:#b3541e}
.bubble{position:absolute;transform:translate(-50%,-100%);background:rgba(255,252,240,.96);
  border-radius:16px;padding:7px 13px;font-size:16px;font-weight:800;opacity:0;
  box-shadow:0 3px 12px rgba(60,40,10,.28);white-space:nowrap}
.bubble:after{content:'';position:absolute;left:50%;bottom:-7px;margin-left:-7px;
  border:7px solid transparent;border-top-color:rgba(255,252,240,.96);border-bottom:0}
.bubble .coin-mini{display:inline-block;width:14px;height:14px;border-radius:50%;
  vertical-align:-1px;background:radial-gradient(circle at 35% 30%,#ffe999,#f5b916 60%,#c98a08)}
.toast{position:absolute;transform:translate(-50%,-50%);font-weight:800;font-size:17px;
  color:#fff;text-shadow:0 2px 6px rgba(60,30,0,.55);white-space:nowrap;pointer-events:none}
#namecard-veil{position:absolute;inset:0;background:rgba(30,20,5,.35);pointer-events:auto;
  display:flex;align-items:center;justify-content:center;opacity:0}
#namecard{background:#fffcf0;border-radius:22px;padding:22px 26px;width:min(320px,84vw);
  box-shadow:0 12px 40px rgba(40,25,0,.45);text-align:center;transform:scale(.7)}
#namecard h2{margin:0 0 4px;font-size:22px;color:#5d3a00}
#namecard p{margin:0 0 12px;font-size:14px;color:#8a7a5a}
#namecard input{width:100%;box-sizing:border-box;border:2px solid #e0d6bb;border-radius:12px;
  padding:10px 12px;font-size:18px;font-weight:700;text-align:center;font-family:inherit;
  color:#3a2d1e;background:#fffef8;outline:none}
#namecard input:focus{border-color:#f5b916}
#namecard button{margin-top:14px;border:none;border-radius:999px;padding:11px 30px;
  font-size:17px;font-weight:800;font-family:inherit;color:#fff;background:#7cb342;
  box-shadow:0 4px 0 #5a8a2a;cursor:pointer}
#namecard button:active{transform:translateY(2px);box-shadow:0 2px 0 #5a8a2a}
#ring{position:absolute;width:54px;height:54px;margin:-27px 0 0 -27px;opacity:0}
#ring .sec{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:800;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6)}
#pip{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;opacity:0}
#nametag{position:absolute;transform:translate(-50%,-100%);background:rgba(255,252,240,.94);
  border-radius:999px;padding:3px 12px;font-size:13px;font-weight:800;opacity:0;
  box-shadow:0 2px 8px rgba(60,40,10,.25);white-space:nowrap}
#nametag .hearts{color:#e0526e;letter-spacing:-1px}
#sunveil{position:fixed;inset:0;z-index:999;pointer-events:none;opacity:0;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  background:radial-gradient(circle at 50% 62%,#fff3d2 0%,#ffe3ae 45%,#f6c87e 100%);
  transition:opacity .12s ease-out}
#sunveil.show{opacity:1}
#sunveil.bye{opacity:0;transition:opacity .38s ease-in}
#sunveil .sun{width:64px;height:64px;border-radius:50%;
  background:radial-gradient(circle at 38% 32%,#fff3b8,#ffc83d 62%,#e89b12);
  box-shadow:0 0 34px 10px rgba(255,196,80,.55);animation:sunrise 1s ease-in-out infinite alternate}
#sunveil .wm{font-weight:800;font-size:19px;letter-spacing:.14em;color:#5d3a00;
  text-transform:uppercase}
#sunveil .wm small{display:block;text-align:center;font-size:10px;letter-spacing:.3em;
  color:#8a6a35;margin-top:2px}
@keyframes sunrise{from{transform:translateY(5px)}to{transform:translateY(-4px)}}
.tickpop{animation:tickpop .18s ease-out}
@keyframes tickpop{50%{transform:scale(1.18)}}
#musicbtn{position:absolute;top:max(10px,env(safe-area-inset-top));
  right:calc(12px + env(safe-area-inset-right));width:42px;height:42px;border-radius:50%;
  border:none;background:rgba(255,252,240,.92);box-shadow:0 2px 8px rgba(60,40,10,.18);
  font-size:19px;line-height:1;pointer-events:auto;cursor:pointer;
  font-family:inherit;touch-action:manipulation}
#musicbtn:active{transform:translateY(1px)}
#fsbtn{position:absolute;top:calc(max(10px,env(safe-area-inset-top)) + 50px);
  right:calc(12px + env(safe-area-inset-right));width:42px;height:42px;border-radius:50%;
  border:none;background:rgba(255,252,240,.92);box-shadow:0 2px 8px rgba(60,40,10,.18);
  font-size:17px;line-height:1;pointer-events:auto;cursor:pointer;
  font-family:inherit;touch-action:manipulation}
#fsbtn:active{transform:translateY(1px)}
#rotatehint{position:absolute;inset:0;display:none;align-items:flex-start;
  justify-content:center;pointer-events:none;z-index:30}
#rotatehint.show{display:flex}
#rotatecard{margin-top:20vh;background:rgba(40,30,10,.8);color:#fffcf0;border-radius:18px;
  padding:16px 30px 14px;text-align:center;pointer-events:auto;position:relative;
  box-shadow:0 8px 30px rgba(20,10,0,.4);display:flex;flex-direction:column;gap:2px}
#rotatecard .ph{font-size:34px;animation:rotnudge 2.4s ease-in-out infinite}
@keyframes rotnudge{0%,25%{transform:rotate(0)}60%,85%{transform:rotate(90deg)}100%{transform:rotate(90deg)}}
#rotatecard b{font-size:17px}
#rotatecard span{font-size:13px;opacity:.85}
#rotatex{position:absolute;top:4px;right:6px;border:none;background:none;color:#fffcf0;
  font-size:15px;opacity:.7;cursor:pointer;padding:4px 6px;font-family:inherit}
/* landscape phones: everything compact so the FARM owns the screen
   (owner, twice: the verbs were eating the view — keep them modest) */
@media (max-height: 500px){
  .act{padding:5px 11px 5px 9px;font-size:13px;min-height:34px;gap:6px;
    box-shadow:0 3px 10px rgba(60,40,10,.3),0 2px 0 #d8cdb2}
  .act .em{font-size:16px}
  .act .lbl small{font-size:9.5px}
  #actions{bottom:calc(112px + env(safe-area-inset-bottom));
    right:calc(10px + env(safe-area-inset-right));gap:5px}
  .pill{font-size:13px;padding:4px 10px 4px 7px;gap:5px}
  .coin-ico{width:16px;height:16px}
  .wheat-ico{font-size:14px;line-height:16px}
  #xpwrap{padding:3px 9px 3px 4px}
  #lvl{min-width:19px;height:19px;font-size:11px}
  #xpbar{width:76px;height:7px}
  #daypill{font-size:11px;padding:3px 9px}
  #chip{font-size:12px;padding:5px 12px;top:max(6px,env(safe-area-inset-top))}
  #topleft{gap:5px;top:max(6px,env(safe-area-inset-top));left:max(10px,env(safe-area-inset-left))}
  #banner{font-size:19px;padding:10px 24px}
  #banner small{font-size:12px}
  #musicbtn{width:34px;height:34px;font-size:15px}
  #fsbtn{width:34px;height:34px;font-size:14px;top:calc(max(6px,env(safe-area-inset-top)) + 42px)}
  .bubble{font-size:13px;padding:5px 10px}
}
`

/** big one-tap context button shown above the right thumb */
export interface ActionDef {
  id: string
  emoji: string
  label: string
  sub?: string
  locked?: boolean
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  id: string,
  parent: HTMLElement,
  cls = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (id) e.id = id
  if (cls) e.className = cls
  parent.appendChild(e)
  return e
}

function ringSvg(size: number, stroke: string, bg: string, width: number): {
  svg: SVGSVGElement
  arc: SVGCircleElement
} {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 40 40')
  svg.style.cssText = `width:${size}px;height:${size}px;display:block`
  const mk = (color: string, w: number): SVGCircleElement => {
    const c = document.createElementNS(ns, 'circle')
    c.setAttribute('cx', '20')
    c.setAttribute('cy', '20')
    c.setAttribute('r', '16')
    c.setAttribute('fill', 'none')
    c.setAttribute('stroke', color)
    c.setAttribute('stroke-width', String(w))
    c.setAttribute('stroke-linecap', 'round')
    svg.appendChild(c)
    return c
  }
  mk(bg, width)
  const arc = mk(stroke, width)
  arc.setAttribute('stroke-dasharray', '100.5')
  arc.setAttribute('transform', 'rotate(-90 20 20)')
  arc.setAttribute('pathLength', '100')
  return { svg, arc }
}

export class Hud {
  readonly root: HTMLDivElement
  private coinValue = 0
  private coinText: HTMLSpanElement
  private coinPill: HTMLDivElement
  private wheatText: HTMLSpanElement
  private wheatPill: HTMLDivElement
  private lvlBadge: HTMLDivElement
  private xpFill: HTMLDivElement
  private dayPill: HTMLDivElement
  private chip: HTMLDivElement
  private chipText = ''
  private banner: HTMLDivElement
  private flash: HTMLDivElement
  private actionsBox: HTMLDivElement
  private actionsKey = ''
  private onAction: ((id: string) => void) | null = null
  private bubbles: HTMLDivElement[] = []
  private nameVeil: HTMLDivElement | null = null
  private ring: HTMLDivElement
  private ringArc: SVGCircleElement
  private ringSec: HTMLDivElement
  private pip: HTMLDivElement
  private pipArc: SVGCircleElement
  private nametag: HTMLDivElement
  private flights = 0

  constructor() {
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    this.root = document.createElement('div')
    this.root.id = 'hud'
    document.body.appendChild(this.root)

    const tl = el('div', 'topleft', this.root)
    this.coinPill = el('div', 'coinpill', tl, 'pill')
    el('div', '', this.coinPill, 'coin-ico')
    this.coinText = el('span', '', this.coinPill)
    this.coinText.textContent = '0'
    this.wheatPill = el('div', 'wheatpill', tl, 'pill')
    const wi = el('span', '', this.wheatPill, 'wheat-ico')
    wi.textContent = '\u{1F33E}'
    this.wheatText = el('span', '', this.wheatPill)
    this.wheatText.textContent = '0'
    const xw = el('div', 'xpwrap', tl)
    this.lvlBadge = el('div', 'lvl', xw)
    this.lvlBadge.textContent = '1'
    const bar = el('div', 'xpbar', xw)
    this.xpFill = el('div', 'xpfill', bar)
    this.dayPill = el('div', 'daypill', tl)
    this.dayPill.textContent = 'Day 1 \u{2600}\u{FE0F}'

    this.chip = el('div', 'chip', this.root)
    this.banner = el('div', 'banner', this.root)
    this.flash = el('div', 'flash', this.root)
    this.actionsBox = el('div', 'actions', this.root)
    // three bubbles: the Farm Shop raises the queue to 3 browsers
    for (let i = 0; i < 3; i++) {
      const b = el('div', '', this.root, 'bubble')
      this.bubbles.push(b)
    }

    this.ring = el('div', 'ring', this.root)
    const r1 = ringSvg(54, '#ffd54f', 'rgba(40,30,10,.45)', 5)
    this.ring.appendChild(r1.svg)
    this.ringArc = r1.arc
    this.ringSec = el('div', '', this.ring, 'sec')

    this.pip = el('div', 'pip', this.root)
    const r2 = ringSvg(34, '#fff3b0', 'rgba(40,30,10,.45)', 6)
    this.pip.appendChild(r2.svg)
    this.pipArc = r2.arc

    this.nametag = el('div', 'nametag', this.root)

    // landscape-first: soft rotate hint on portrait touch screens.
    // Dismissible, pointer-events only on the card — play is never blocked.
    const hint = el('div', 'rotatehint', this.root)
    hint.innerHTML =
      '<div id="rotatecard"><div class="ph">\u{1F4F1}</div><b>Rotate your device</b>' +
      '<span>the farm is loveliest in landscape</span>' +
      '<button id="rotatex" aria-label="Dismiss">✕</button></div>'
    const portrait = matchMedia('(orientation: portrait)')
    const coarse = matchMedia('(pointer: coarse)')
    const refreshHint = (): void => {
      const show =
        portrait.matches && coarse.matches && sessionStorage.getItem('sunrise-farm.rotateDismissed') !== '1'
      hint.classList.toggle('show', show)
    }
    portrait.addEventListener('change', refreshHint)
    hint.querySelector('#rotatex')!.addEventListener('click', () => {
      sessionStorage.setItem('sunrise-farm.rotateDismissed', '1')
      refreshHint()
    })
    refreshHint()
  }

  /** music on/off button in the top-right HUD corner */
  mountMusicToggle(muted: boolean, onToggle: (muted: boolean) => void): void {
    const b = document.createElement('button')
    b.id = 'musicbtn'
    let m = muted
    const paint = (): void => {
      b.textContent = m ? '\u{1F507}' : '\u{1F3B5}'
      b.title = m ? 'Music: off' : 'Music: on'
      b.setAttribute('aria-label', b.title)
    }
    paint()
    b.addEventListener('click', () => {
      m = !m
      paint()
      onToggle(m)
    })
    this.root.appendChild(b)
  }

  /** fullscreen toggle — only where the API exists (iPhone Safari has none;
   * there, Add-to-Home-Screen is the fullscreen path via the manifest) */
  mountFullscreenToggle(): void {
    const el = document.documentElement
    if (typeof el.requestFullscreen !== 'function') return
    const b = document.createElement('button')
    b.id = 'fsbtn'
    const paint = (): void => {
      b.textContent = document.fullscreenElement ? '✖' : '⛶'
      b.title = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'
      b.setAttribute('aria-label', b.title)
    }
    paint()
    document.addEventListener('fullscreenchange', paint)
    b.addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen()
      else void el.requestFullscreen()
    })
    this.root.appendChild(b)
  }

  // ---- coins ------------------------------------------------------------

  /** instant set (boot / dev driver) */
  setCoins(n: number): void {
    this.coinValue = n
    this.coinText.textContent = String(n)
  }

  get displayedCoins(): number {
    return this.coinValue
  }

  /** screen center of the coin pill — fallback fountain origin when the
   * paying world point is behind the camera (mirrored projections lied) */
  coinPillPos(): { x: number; y: number } {
    const r = this.coinPill.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }

  get coinsInFlight(): boolean {
    return this.flights > 0
  }

  private tickCoins(share: number): void {
    this.coinValue += share
    this.coinText.textContent = String(this.coinValue)
    this.coinPill.classList.remove('tickpop')
    void this.coinPill.offsetWidth
    this.coinPill.classList.add('tickpop')
  }

  /** 8-15 sprites bezier from `from` into the counter; each arrival ticks the
   * odometer by its exact share (shares sum to the grant). */
  coinFountain(from: { x: number; y: number }, shares: number[], golden: boolean, onTink: () => void): void {
    const rect = this.coinPill.getBoundingClientRect()
    const to = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    shares.forEach((share, i) => {
      const c = document.createElement('div')
      c.className = golden ? 'coin-fly golden' : 'coin-fly'
      this.root.appendChild(c)
      const burst = {
        x: from.x + (Math.random() - 0.5) * 110,
        y: from.y - 40 - Math.random() * 70,
      }
      const ctrl = { x: (burst.x + to.x) / 2 + (Math.random() - 0.5) * 120, y: burst.y - 90 }
      const p = { t: 0 }
      const place = (x: number, y: number): void => {
        c.style.left = `${x}px`
        c.style.top = `${y}px`
      }
      place(from.x, from.y)
      this.flights += 1
      const tl = gsap.timeline({
        onComplete: () => {
          this.flights -= 1
          c.remove()
          this.tickCoins(share)
          onTink()
        },
      })
      tl.to(p, {
        t: 1,
        duration: 0.34,
        delay: i * 0.045,
        ease: 'power2.out',
        onUpdate: () => {
          place(from.x + (burst.x - from.x) * p.t, from.y + (burst.y - from.y) * p.t)
        },
      })
      const q = { t: 0 }
      tl.to(q, {
        t: 1,
        duration: 0.5,
        ease: 'power1.in',
        onUpdate: () => {
          const u = q.t
          const x = (1 - u) * (1 - u) * burst.x + 2 * (1 - u) * u * ctrl.x + u * u * to.x
          const y = (1 - u) * (1 - u) * burst.y + 2 * (1 - u) * u * ctrl.y + u * u * to.y
          place(x, y)
        },
      })
    })
  }

  // ---- meters -----------------------------------------------------------

  setWheat(n: number): void {
    this.wheatText.textContent = String(n)
    this.wheatPill.classList.remove('tickpop')
    void this.wheatPill.offsetWidth
    this.wheatPill.classList.add('tickpop')
  }

  setXp(xp: number, need: number, level: number): void {
    this.lvlBadge.textContent = String(level)
    gsap.to(this.xpFill, { width: `${Math.min(100, (xp / need) * 100)}%`, duration: 0.4, ease: 'power2.out' })
  }

  /** the journey marker: which day of farm life this is, with a phase mood */
  setDay(day: number, label: 'dawn' | 'morning' | 'noon' | 'golden' | 'dusk'): void {
    const icon =
      label === 'dawn' ? '\u{1F305}' : label === 'golden' ? '\u{1F33B}' : label === 'dusk' ? '\u{1F319}' : '\u{2600}\u{FE0F}'
    const text = `Day ${day} ${icon}`
    if (this.dayPill.textContent !== text) this.dayPill.textContent = text
  }

  // ---- chip -------------------------------------------------------------

  showChip(text: string | null): void {
    const t = text ?? ''
    if (t === this.chipText) return
    this.chipText = t
    if (!t) {
      gsap.to(this.chip, { opacity: 0, y: -8, duration: 0.25, ease: 'power2.in' })
      return
    }
    this.chip.textContent = t
    gsap.fromTo(this.chip, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.35, ease: 'back.out(2)' })
  }

  // ---- ceremonies -------------------------------------------------------

  showBanner(title: string, sub: string): void {
    this.banner.innerHTML = ''
    this.banner.append(title)
    if (sub) {
      const s = document.createElement('small')
      s.textContent = sub
      this.banner.appendChild(s)
    }
    gsap
      .timeline()
      .to(this.banner, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(1.8)' })
      .to(this.banner, { opacity: 0, scale: 0.8, duration: 0.4, ease: 'power2.in' }, '+=2.1')
    gsap.timeline().to(this.flash, { opacity: 1, duration: 0.18 }).to(this.flash, { opacity: 0, duration: 0.9 })
  }

  /** yank a live banner off screen — cinematics call this when the letterbox
   * drops so a just-fired event toast never floats over the scene */
  dismissBanner(): void {
    gsap.killTweensOf(this.banner)
    gsap.to(this.banner, { opacity: 0, scale: 0.8, duration: 0.25, ease: 'power2.in' })
  }

  // ---- proximity action buttons (above the right thumb) ------------------

  /** declarative: call every tick with what's actionable HERE; the DOM only
   * rebuilds when the set changes. Empty array hides the stack. */
  setActions(actions: ActionDef[], onAction: (id: string) => void): void {
    this.onAction = onAction
    const key = actions.map((a) => `${a.id}:${a.label}:${a.locked ? 1 : 0}:${a.sub ?? ''}`).join('|')
    if (key === this.actionsKey) return
    this.actionsKey = key
    this.actionsBox.innerHTML = ''
    actions.forEach((a, i) => {
      const b = document.createElement('button')
      b.className = a.locked ? 'act locked' : 'act'
      b.innerHTML = `<span class="em">${a.emoji}</span><span class="lbl">${a.label}${
        a.sub ? `<small>${a.sub}</small>` : ''
      }</span>`
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation()
        if (a.locked) {
          gsap.fromTo(b, { x: -5 }, { x: 0, duration: 0.32, ease: 'elastic.out(1.2,0.3)' })
          return
        }
        this.onAction?.(a.id)
      })
      this.actionsBox.appendChild(b)
      gsap.from(b, { scale: 0.5, opacity: 0, duration: 0.28, delay: i * 0.05, ease: 'back.out(2.4)' })
    })
  }

  // ---- the sunrise veil: a branded split-second over rotation rebuilds ----
  // (owner: better a beautiful blink than a felt hitch). Pure presentation:
  // plain timers are fine here, nothing deterministic depends on it.
  private sunveil: HTMLDivElement | null = null
  private veilShownAt = 0
  private veilCap: ReturnType<typeof setTimeout> | null = null

  get rotateVeilUp(): boolean {
    return this.sunveil !== null
  }

  showRotateVeil(): void {
    if (this.sunveil) return
    const v = document.createElement('div')
    v.id = 'sunveil'
    v.innerHTML = `<div class="sun"></div><div class="wm">Sunrise Farm<small>turning the field</small></div>`
    document.body.appendChild(v)
    // force a style flush so the opacity transition has a FROM state —
    // rAF would do it too, but rAF doesn't tick in a backgrounded tab
    void v.offsetWidth
    v.classList.add('show')
    this.sunveil = v
    this.veilShownAt = performance.now()
    // belt-and-braces: the veil may NEVER strand, whatever resize does
    this.veilCap = setTimeout(() => this.hideRotateVeil(), 1400)
  }

  hideRotateVeil(): void {
    const v = this.sunveil
    if (!v) return
    this.sunveil = null
    if (this.veilCap) clearTimeout(this.veilCap)
    this.veilCap = null
    // hold at least a beat — a 60ms flash reads as a glitch, not a brand
    const wait = Math.max(0, 350 - (performance.now() - this.veilShownAt))
    setTimeout(() => {
      v.classList.add('bye')
      setTimeout(() => v.remove(), 420)
    }, wait)
  }

  // ---- customer want bubbles (projected) ----------------------------------

  /** set opacity only when it changes — a same-value style write still
   * costs a style pass on mobile Safari, and these run every frame */
  private fadeTo(el: HTMLElement | SVGElement, on: boolean): boolean {
    const want = on ? '1' : '0'
    if ((el as HTMLElement).dataset.op !== want) {
      ;(el as HTMLElement).dataset.op = want
      ;(el as HTMLElement).style.opacity = want
    }
    return on
  }

  /** compositor-only positioning: translate3d never triggers layout, while
   * left/top did — these widgets reposition EVERY frame from world space */
  private moveTo(el: HTMLElement, x: number, y: number): void {
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  setBubble(slot: number, visible: boolean, x = 0, y = 0, html = ''): void {
    const b = this.bubbles[slot]
    if (!b) return
    if (!this.fadeTo(b, visible)) return
    // bubbles keep left/top: their CSS anchor AND the gsap scale pop both
    // own the transform channel — fighting it costs more than layout does
    b.style.left = `${x}px`
    b.style.top = `${y}px`
    if (b.dataset.html !== html) {
      b.dataset.html = html
      b.innerHTML = html
      gsap.from(b, { scale: 0.5, duration: 0.35, ease: 'back.out(2.2)' })
    }
  }

  /** tiny rising toast ("+3 tip ♥", "+1 🌾") at a screen point */
  floatText(at: { x: number; y: number }, text: string): void {
    const t = document.createElement('div')
    t.className = 'toast'
    t.textContent = text
    t.style.left = `${at.x}px`
    t.style.top = `${at.y}px`
    this.root.appendChild(t)
    gsap.to(t, { y: -56, duration: 1.1, ease: 'power1.out' })
    gsap.to(t, { opacity: 0, duration: 0.4, delay: 0.7, onComplete: () => t.remove() })
    gsap.from(t, { scale: 0.5, duration: 0.25, ease: 'back.out(2.5)' })
  }

  // ---- naming card ------------------------------------------------------

  showNameCard(suggested: string, done: (name: string) => void): void {
    const veil = document.createElement('div')
    veil.id = 'namecard-veil'
    const card = document.createElement('div')
    card.id = 'namecard'
    card.innerHTML = `<h2>A new friend!</h2><p>She needs a name — pick one or keep ours.</p>`
    const input = document.createElement('input')
    input.value = suggested
    input.maxLength = 16
    input.setAttribute('aria-label', 'Chicken name')
    const btn = document.createElement('button')
    btn.textContent = 'Welcome her home'
    card.append(input, btn)
    veil.appendChild(card)
    this.root.appendChild(veil)
    this.nameVeil = veil
    gsap.to(veil, { opacity: 1, duration: 0.3 })
    gsap.to(card, { scale: 1, duration: 0.45, ease: 'back.out(1.7)' })
    btn.addEventListener('click', () => {
      const name = input.value.trim() || suggested
      gsap.to(veil, {
        opacity: 0,
        duration: 0.25,
        onComplete: () => {
          this.nameVeil?.remove()
          this.nameVeil = null
        },
      })
      done(name)
    })
  }

  get modalOpen(): boolean {
    return this.nameVeil !== null
  }

  // ---- projected widgets (positioned every frame from world space) -------

  private ringLastText = ''
  private ringLastDash = ''
  private pipLastDash = ''
  private pipLastStroke = ''
  private tagLastKey = ''

  setRing(visible: boolean, x = 0, y = 0, frac = 0, secLeft = 0): void {
    if (!this.fadeTo(this.ring, visible)) return
    this.moveTo(this.ring, x, y)
    const dash = String(Math.round(100 - frac * 100))
    if (dash !== this.ringLastDash) {
      this.ringLastDash = dash
      this.ringArc.setAttribute('stroke-dashoffset', dash)
    }
    const txt = secLeft >= 60 ? `${Math.ceil(secLeft / 60)}m` : `${Math.ceil(secLeft)}`
    if (txt !== this.ringLastText) {
      this.ringLastText = txt
      this.ringSec.textContent = txt
    }
  }

  setPip(visible: boolean, x = 0, y = 0, frac = 0, ready = false): void {
    if (!this.fadeTo(this.pip, visible)) return
    this.moveTo(this.pip, x, y)
    const dash = String(Math.round(100 - frac * 100))
    if (dash !== this.pipLastDash) {
      this.pipLastDash = dash
      this.pipArc.setAttribute('stroke-dashoffset', dash)
    }
    const stroke = ready ? '#ffd700' : '#fff3b0'
    if (stroke !== this.pipLastStroke) {
      this.pipLastStroke = stroke
      this.pipArc.setAttribute('stroke', stroke)
    }
  }

  setNameTag(visible: boolean, x = 0, y = 0, name = '', hearts = 0): void {
    if (!this.fadeTo(this.nametag, visible)) return
    // compose the CSS anchor into the same transform (no gsap touches this)
    this.nametag.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`
    // rebuild the HTML only when the CONTENT changes — this used to parse
    // fresh markup every frame the tag was on screen (most of normal play)
    const key = `${name}|${hearts}`
    if (key !== this.tagLastKey) {
      this.tagLastKey = key
      const h = hearts > 0 ? ` <span class="hearts">${'♥'.repeat(Math.min(hearts, 8))}${hearts > 8 ? `x${hearts}` : ''}</span>` : ''
      this.nametag.innerHTML = `${name}${h}`
    }
  }
}
