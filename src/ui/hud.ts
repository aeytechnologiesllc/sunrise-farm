/** DOM HUD: coins odometer + fountain, wheat pouch, XP bar, contextual chip,
 * seed picker, naming card, level banner, countdown ring, nest pip, name tag.
 * Purely presentational — game state is the single source of truth and the
 * displayed coin count self-heals toward it (never gated on tweens). */
import gsap from 'gsap'
import type { CropKind } from '../game/economy'

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
#picker{position:absolute;pointer-events:auto}
#picker .seed{position:absolute;width:74px;height:74px;margin:-37px 0 0 -37px;border-radius:50%;
  background:rgba(255,252,240,.97);border:none;box-shadow:0 4px 14px rgba(60,40,10,.3);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;
  font-family:inherit;font-weight:800;font-size:13px;color:#3a2d1e;cursor:pointer}
#picker .seed .em{font-size:24px;line-height:1.1}
#picker .seed .tm{font-size:10px;font-weight:700;color:#8a7a5a}
#picker .seed.locked{filter:grayscale(.9);opacity:.72}
#picker .seed.locked .tm{color:#b3541e}
#pickerveil{position:absolute;inset:0;pointer-events:auto}
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
.tickpop{animation:tickpop .18s ease-out}
@keyframes tickpop{50%{transform:scale(1.18)}}
`

export interface SeedOption {
  kind: CropKind
  label: string
  emoji: string
  time: string
  locked: boolean
  lockText: string
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
  private chip: HTMLDivElement
  private chipText = ''
  private banner: HTMLDivElement
  private flash: HTMLDivElement
  private picker: HTMLDivElement | null = null
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

    this.chip = el('div', 'chip', this.root)
    this.banner = el('div', 'banner', this.root)
    this.flash = el('div', 'flash', this.root)

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

  // ---- seed picker ------------------------------------------------------

  showSeedPicker(at: { x: number; y: number }, options: SeedOption[], pick: (kind: CropKind) => void): void {
    this.hideSeedPicker()
    const veil = document.createElement('div')
    veil.id = 'pickerveil'
    veil.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      this.hideSeedPicker()
    })
    const wrap = document.createElement('div')
    wrap.id = 'picker'
    veil.appendChild(wrap)
    this.root.appendChild(veil)
    this.picker = veil
    const cx = Math.min(Math.max(at.x, 96), innerWidth - 96)
    const cy = Math.min(Math.max(at.y, 140), innerHeight - 100)
    const radius = 78
    const start = -Math.PI / 2 - ((options.length - 1) * 0.45) / 2
    options.forEach((opt, i) => {
      const b = document.createElement('button')
      b.className = opt.locked ? 'seed locked' : 'seed'
      const a = start + i * 0.9
      b.style.left = `${cx + Math.cos(a) * radius}px`
      b.style.top = `${cy + Math.sin(a) * radius}px`
      b.innerHTML = `<span class="em">${opt.emoji}</span>${opt.label}<span class="tm">${
        opt.locked ? opt.lockText : opt.time
      }</span>`
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation()
        if (opt.locked) {
          gsap.fromTo(b, { x: -4 }, { x: 0, duration: 0.3, ease: 'elastic.out(1.2,0.3)' })
          return
        }
        this.hideSeedPicker()
        pick(opt.kind)
      })
      wrap.appendChild(b)
      gsap.from(b, { scale: 0.3, opacity: 0, duration: 0.3, delay: i * 0.05, ease: 'back.out(2.5)' })
    })
  }

  hideSeedPicker(): void {
    this.picker?.remove()
    this.picker = null
  }

  get pickerOpen(): boolean {
    return this.picker !== null
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

  setRing(visible: boolean, x = 0, y = 0, frac = 0, secLeft = 0): void {
    this.ring.style.opacity = visible ? '1' : '0'
    if (!visible) return
    this.ring.style.left = `${x}px`
    this.ring.style.top = `${y}px`
    this.ringArc.setAttribute('stroke-dashoffset', String(100 - frac * 100))
    this.ringSec.textContent = secLeft >= 60 ? `${Math.ceil(secLeft / 60)}m` : `${Math.ceil(secLeft)}`
  }

  setPip(visible: boolean, x = 0, y = 0, frac = 0, ready = false): void {
    this.pip.style.opacity = visible ? '1' : '0'
    if (!visible) return
    this.pip.style.left = `${x}px`
    this.pip.style.top = `${y}px`
    this.pipArc.setAttribute('stroke-dashoffset', String(100 - frac * 100))
    this.pipArc.setAttribute('stroke', ready ? '#ffd700' : '#fff3b0')
  }

  setNameTag(visible: boolean, x = 0, y = 0, name = '', hearts = 0): void {
    this.nametag.style.opacity = visible ? '1' : '0'
    if (!visible) return
    this.nametag.style.left = `${x}px`
    this.nametag.style.top = `${y}px`
    const h = hearts > 0 ? ` <span class="hearts">${'♥'.repeat(Math.min(hearts, 8))}${hearts > 8 ? `x${hearts}` : ''}</span>` : ''
    this.nametag.innerHTML = `${name}${h}`
  }
}
