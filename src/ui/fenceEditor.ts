/** The FENCE EDITOR — the farm's first real editor mode (owner: "a proper
 * fence editor... drag a line, it highlights, you click build. Remove a
 * full line really fast or single. Reusable for buildings later").
 *
 * Shape: a generic ToolPanel (top chip row — Draw / Gateway / Remove +
 * Done, plus a LOCKED 'Styles' slot reserved for the paid/leveled skins
 * that come later) and the FenceEditor that drives it. While open, ONE
 * finger belongs to the tool (capture-phase listeners outrank the camera
 * drag and the long-press lift); Done hands the screen back.
 *
 *  - DRAW: press and drag — a straight, axis-locked run of ghost rails
 *    previews live (green = will build, amber = not allowed there);
 *    release builds every green edge at once.
 *  - GATEWAY: tap a fence piece to swap it fence<->gateway.
 *  - REMOVE: tap one piece, or HOLD AND SWEEP along a line to mow a whole
 *    run down in one gesture. Free, always.
 *
 * Rules come from game/layout.fenceEdgeAllowed (never through buildings,
 * crop soil, the pen, or the road) — the editor only paints verdicts. */
import {
  BoxGeometry,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Vector2,
} from 'three'
import { decodeEdge, encodeEdge, nearestEdge, type FenceSets } from '../game/fence'

const PANEL_CSS = `
#editor-panel{position:fixed;top:calc(58px + env(safe-area-inset-top));left:50%;
  transform:translateX(-50%);display:flex;gap:8px;z-index:30;
  font-family:'Trebuchet MS','Segoe UI',system-ui,sans-serif}
.etool{pointer-events:auto;display:flex;align-items:center;gap:6px;border:none;
  background:rgba(255,252,240,.94);border-radius:999px;padding:8px 14px 8px 10px;
  font-family:inherit;font-weight:800;font-size:14px;color:#3a2d1e;
  box-shadow:0 3px 10px rgba(60,40,10,.25)}
.etool .em{font-size:18px;line-height:1}
.etool.on{background:#7ec850;color:#fff;box-shadow:0 3px 10px rgba(40,80,10,.4)}
.etool.locked{filter:grayscale(.8);opacity:.6}
.etool.done{background:#3a2d1e;color:#fff7e0}
#editor-status{position:fixed;top:calc(106px + env(safe-area-inset-top));left:50%;
  transform:translateX(-50%);z-index:30;pointer-events:none;opacity:0;
  background:rgba(58,45,30,.88);color:#fff7e0;border-radius:999px;padding:6px 14px;
  font:800 13px 'Trebuchet MS','Segoe UI',system-ui,sans-serif;white-space:nowrap;
  transition:opacity .15s}
#style-picker{position:fixed;top:calc(106px + env(safe-area-inset-top));left:50%;
  transform:translateX(-50%);display:none;flex-wrap:nowrap;gap:6px;z-index:31;
  pointer-events:auto}
.spick{pointer-events:auto;display:flex;align-items:center;gap:5px;border:none;
  background:rgba(255,252,240,.96);border-radius:999px;padding:7px 12px 7px 9px;
  font-family:'Trebuchet MS','Segoe UI',system-ui,sans-serif;font-weight:800;
  font-size:13px;color:#3a2d1e;box-shadow:0 3px 10px rgba(60,40,10,.28);cursor:pointer}
.spick .em{font-size:16px;line-height:1}
.spick.active{background:#7ec850;color:#fff;box-shadow:0 3px 10px rgba(40,80,10,.4)}
@media (max-width:760px){.etool{padding:7px 10px 7px 8px;font-size:12px}.etool .em{font-size:16px}
  .spick{padding:6px 9px 6px 7px;font-size:12px}.spick .em{font-size:15px}}
`

export interface EditorToolDef {
  id: string
  emoji: string
  label: string
  locked?: boolean
}

/** generic top chip row — the building/coop editors reuse this later */
export class ToolPanel {
  private root: HTMLDivElement
  private chips = new Map<string, HTMLButtonElement>()

  constructor(tools: EditorToolDef[], onPick: (id: string) => void, onDone: () => void) {
    if (!document.getElementById('editor-css')) {
      const style = document.createElement('style')
      style.id = 'editor-css'
      style.textContent = PANEL_CSS
      document.head.appendChild(style)
    }
    this.root = document.createElement('div')
    this.root.id = 'editor-panel'
    for (const t of tools) {
      const b = document.createElement('button')
      b.className = 'etool' + (t.locked ? ' locked' : '')
      b.innerHTML = `<span class="em">${t.emoji}</span>${t.label}`
      if (!t.locked) b.addEventListener('pointerdown', () => onPick(t.id))
      this.root.appendChild(b)
      this.chips.set(t.id, b)
    }
    const done = document.createElement('button')
    done.className = 'etool done'
    done.innerHTML = `<span class="em">\u{2713}</span>Done`
    done.addEventListener('pointerdown', () => onDone())
    this.root.appendChild(done)
    this.root.style.display = 'none'
    document.body.appendChild(this.root)
  }

  setActive(id: string): void {
    for (const [tid, b] of this.chips) b.classList.toggle('on', tid === id)
  }

  show(): void {
    this.root.style.display = 'flex'
  }

  hide(): void {
    this.root.style.display = 'none'
  }
}

const OK_TINT = 0x7ec850
const NO_TINT = 0xe0a33f
/** preview pool size — the longest run a single drag can lay down */
const MAX_RUN = 48

export interface FenceEditorOpts {
  dom: HTMLElement
  camera: PerspectiveCamera
  scene: Scene
  fences: FenceSets
  /** is an edge midpoint legal fence ground right now? */
  allowed: (mx: number, mz: number) => boolean
  /** commit: persist + rebuild the fence mesh */
  onChange: () => void
  /** a little pop where something got removed/placed (sfx + sparkle) */
  onFx: (x: number, z: number, kind: 'build' | 'remove' | 'gate') => void
  canOpen: () => boolean
  /** entering/leaving edit mode (main pulls the camera back for overview) */
  onOpen?: () => void
  onClose?: () => void
  /** returns the style ids the player currently owns (always includes 'classic') */
  ownedStyles?: () => string[]
  /** returns the currently-active style id */
  activeStyle?: () => string
  /** owner persists the choice + rebuilds the fence mesh */
  onStyle?: (id: string) => void
}

export class FenceEditor {
  active = false

  private tool: 'draw' | 'gate' | 'remove' = 'draw'
  private panel: ToolPanel
  private ray = new Raycaster()
  private ndc = new Vector2()
  private dragId: number | null = null
  private anchor: { x: number; z: number } | null = null
  private preview: Mesh[] = []
  private previewMatOk = new MeshBasicMaterial({ color: OK_TINT, transparent: true, opacity: 0.9 })
  private previewMatNo = new MeshBasicMaterial({ color: NO_TINT, transparent: true, opacity: 0.75 })
  private pendingRun: Array<{ key: number; ok: boolean; exists: boolean }> = []
  private dirty = false
  private stylePicker: HTMLDivElement
  private lastRebuild = 0
  /** the 1u ground grid, visible only while editing — you can't draw on
   * lines you can't see (the phone playtest's first complaint) */
  private grid: Mesh
  /** one-line live verdict under the chips: "+5 posts", "already fenced" */
  private status: HTMLDivElement
  private statusHideAt = 0

  constructor(private opts: FenceEditorOpts) {
    this.panel = new ToolPanel(
      [
        { id: 'draw',   emoji: '\u{1FAB5}', label: 'Draw' },
        { id: 'gate',   emoji: '\u{1F6AA}', label: 'Gateway' },
        { id: 'remove', emoji: '\u{1F528}', label: 'Remove' },
        { id: 'style',  emoji: '\u{1F3A8}', label: 'Style' },
      ],
      (id) => {
        if (id === 'style') {
          this.handleStylePick()
          return
        }
        this.stylePicker.style.display = 'none'
        this.tool = id as typeof this.tool
        this.panel.setActive(id)
      },
      () => this.close(),
    )
    const geo = new BoxGeometry(0.96, 0.6, 0.09)
    for (let i = 0; i < MAX_RUN; i++) {
      const m = new Mesh(geo, this.previewMatOk)
      m.position.y = 0.3
      m.visible = false
      m.renderOrder = 3
      opts.scene.add(m)
      this.preview.push(m)
    }
    // the editing grid: a faint 1u lattice over the whole farm so the lines
    // you draw along are VISIBLE (one draw, hidden unless editing)
    const gc = document.createElement('canvas')
    gc.width = gc.height = 64
    const g2 = gc.getContext('2d')!
    g2.clearRect(0, 0, 64, 64)
    g2.strokeStyle = 'rgba(255,250,230,0.85)'
    g2.lineWidth = 2.5
    g2.strokeRect(0, 0, 64, 64)
    const gridTex = new CanvasTexture(gc)
    gridTex.colorSpace = SRGBColorSpace
    gridTex.wrapS = gridTex.wrapT = RepeatWrapping
    gridTex.repeat.set(48, 40)
    const gridGeo = new PlaneGeometry(48, 40)
    gridGeo.rotateX(-Math.PI / 2)
    // grid lines land ON integer coordinates: span 48x40 centered at
    // (1.5, 2.5) puts edges at ...-1,0,1... in both axes
    gridGeo.translate(1.5, 0.03, 2.5)
    this.grid = new Mesh(gridGeo, new MeshBasicMaterial({ map: gridTex, transparent: true, opacity: 0.16, depthWrite: false }))
    this.grid.renderOrder = 2
    this.grid.visible = false
    opts.scene.add(this.grid)
    this.status = document.createElement('div')
    this.status.id = 'editor-status'
    document.body.appendChild(this.status)
    this.stylePicker = document.createElement('div')
    this.stylePicker.id = 'style-picker'
    document.body.appendChild(this.stylePicker)
    // capture phase: while the editor is open, the first finger is a TOOL —
    // the camera drag and the long-press lift never see it
    opts.dom.addEventListener('pointerdown', this.down, { capture: true })
    opts.dom.addEventListener('pointermove', this.move, { capture: true })
    addEventListener('pointerup', this.up, { capture: true })
    addEventListener('pointercancel', this.up, { capture: true })
  }

  open(): boolean {
    if (this.active || !this.opts.canOpen()) return false
    this.active = true
    this.panel.setActive(this.tool)
    this.panel.show()
    this.grid.visible = true
    this.say('drag along a line to fence it')
    this.opts.onOpen?.()
    return true
  }

  close(): void {
    if (!this.active) return
    this.active = false
    this.panel.hide()
    this.grid.visible = false
    this.stylePicker.style.display = 'none'
    this.status.style.opacity = '0'
    this.endDrag()
    if (this.dirty) {
      this.dirty = false
      this.opts.onChange()
    }
    this.opts.onClose?.()
  }

  /** the live verdict chip (auto-fades; update() retires it) */
  private say(text: string, holdMs = 2600): void {
    this.status.textContent = text
    this.status.style.opacity = '1'
    this.statusHideAt = performance.now() + holdMs
  }

  /** per-frame housekeeping while open (status fade) */
  update(): void {
    if (this.statusHideAt && performance.now() > this.statusHideAt) {
      this.statusHideAt = 0
      this.status.style.opacity = '0'
    }
  }

  /** the fence-skin chips, by id (matches FenceStyle in scenery.ts) */
  private static readonly STYLE_META: Record<string, { emoji: string; label: string }> = {
    classic: { emoji: '\u{1FAB5}', label: 'Cream' },
    picket: { emoji: '\u{1F90D}', label: 'Picket' },
    cedar: { emoji: '\u{1F7EB}', label: 'Cedar' },
    stone: { emoji: '\u{1FAA8}', label: 'Stone' },
  }

  /** the Style chip toggles a little row of owned skins; tapping one repaints
   * the whole fence in that style. Locked skins live in the shop catalog, so
   * here we only ever show what the player already owns (always >= classic). */
  private handleStylePick(): void {
    const open = this.stylePicker.style.display === 'flex'
    if (open) {
      this.stylePicker.style.display = 'none'
      this.panel.setActive(this.tool)
      return
    }
    this.renderStylePicker()
    this.stylePicker.style.display = 'flex'
    this.panel.setActive('style')
  }

  private renderStylePicker(): void {
    const owned = this.opts.ownedStyles?.() ?? ['classic']
    const active = this.opts.activeStyle?.() ?? 'classic'
    this.stylePicker.replaceChildren()
    for (const id of owned) {
      const meta = FenceEditor.STYLE_META[id] ?? { emoji: '\u{1F3A8}', label: id }
      const b = document.createElement('button')
      b.className = 'spick' + (id === active ? ' active' : '')
      b.innerHTML = `<span class="em">${meta.emoji}</span>${meta.label}`
      b.onclick = (e) => {
        e.stopPropagation()
        this.opts.onStyle?.(id)
        this.say(`fences repainted: ${meta.label.toLowerCase()}`)
        this.renderStylePicker()
      }
      this.stylePicker.appendChild(b)
    }
  }

  /** wall-clock throttle is fine here: mesh rebuilds are presentation */
  private commit(): void {
    this.dirty = true
    const now = performance.now()
    if (now - this.lastRebuild > 220) {
      this.lastRebuild = now
      this.dirty = false
      this.opts.onChange()
    }
  }

  /** pointer ndc -> the y=0 ground plane. Measures the CANVAS, not the
   * window: they're usually the same, but a zero/stale window measurement
   * (iOS rotation, hidden boot) must return null, never NaN coordinates. */
  private ground(e: PointerEvent): { x: number; z: number } | null {
    const r = (this.opts.dom as HTMLElement).getBoundingClientRect()
    if (!(r.width > 1) || !(r.height > 1)) return null
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(this.ndc, this.opts.camera)
    const o = this.ray.ray.origin
    const d = this.ray.ray.direction
    if (Math.abs(d.y) < 1e-6) return null
    const t = -o.y / d.y
    if (t <= 0) return null
    return { x: o.x + d.x * t, z: o.z + d.z * t }
  }

  /** the straight, axis-locked run between two grid vertices */
  private runEdges(ax: number, az: number, bx: number, bz: number): number[] {
    const out: number[] = []
    if (Math.abs(bx - ax) >= Math.abs(bz - az)) {
      const z = az
      for (let x = Math.min(ax, bx); x < Math.max(ax, bx) && out.length < MAX_RUN; x++) out.push(encodeEdge(x, z, 0))
    } else {
      const x = ax
      for (let z = Math.min(az, bz); z < Math.max(az, bz) && out.length < MAX_RUN; z++) out.push(encodeEdge(x, z, 1))
    }
    return out
  }

  private showPreview(): void {
    for (let i = 0; i < this.preview.length; i++) {
      const m = this.preview[i]
      const entry = this.pendingRun[i]
      // existing fence shows NO ghost (it's already there — amber over it
      // read as "rejected" and made whole drags feel broken)
      if (!entry || entry.exists) {
        m.visible = false
        continue
      }
      const { cx, cz, axis } = decodeEdge(entry.key)
      m.position.x = axis === 0 ? cx + 0.5 : cx
      m.position.z = axis === 0 ? cz : cz + 0.5
      m.rotation.y = axis === 1 ? Math.PI / 2 : 0
      m.material = entry.ok ? this.previewMatOk : this.previewMatNo
      m.visible = true
    }
  }

  private hidePreview(): void {
    for (const m of this.preview) m.visible = false
    this.pendingRun = []
  }

  private endDrag(): void {
    if (this.dragId !== null) {
      try {
        ;(this.opts.dom as Element).releasePointerCapture(this.dragId)
      } catch {
        /* already released */
      }
    }
    this.dragId = null
    this.anchor = null
    this.hidePreview()
    // a "+N posts" live verdict must not outlive its drag
    if (this.statusHideAt > performance.now() + 5000) this.statusHideAt = performance.now() + 1600
  }

  // ---- the tools -------------------------------------------------------------

  private down = (e: PointerEvent): void => {
    if (!this.active) return
    // the panel's own buttons live OUTSIDE the canvas — anything reaching the
    // canvas is tool intent. Swallow it BEFORE the dragId early-out so a
    // second finger mid-draw can't leak through to start a camera pinch or a
    // building lift on the layer beneath us.
    e.stopImmediatePropagation()
    e.preventDefault()
    if (this.dragId !== null) return
    const g = this.ground(e)
    if (!g) return
    this.dragId = e.pointerId
    // CAPTURE the pointer: the HUD (joystick, buttons, chips) sits in
    // sibling layers OVER the canvas — without capture, the instant a
    // thumb-drag crossed any of them the canvas stopped receiving moves
    // and the drag silently died. THIS was "the fence editor doesn't
    // work at all" on the phone.
    try {
      ;(this.opts.dom as Element).setPointerCapture(e.pointerId)
    } catch {
      /* synthetic/dev pointers can't be captured — fine */
    }
    if (this.tool === 'draw') {
      this.anchor = { x: Math.round(g.x), z: Math.round(g.z) }
    } else if (this.tool === 'remove') {
      if (!this.removeNear(g.x, g.z)) this.say('no fence here — sweep along one')
    } else if (this.tool === 'gate') {
      if (!this.toggleGateNear(g.x, g.z)) this.say('tap a fence piece to make it a gateway')
    }
  }

  private move = (e: PointerEvent): void => {
    if (!this.active) return
    e.stopImmediatePropagation()
    if (e.pointerId !== this.dragId) return
    e.preventDefault()
    const g = this.ground(e)
    if (!g) return
    if (this.tool === 'draw' && this.anchor) {
      const keys = this.runEdges(this.anchor.x, this.anchor.z, Math.round(g.x), Math.round(g.z))
      this.pendingRun = keys.map((key) => {
        const { cx, cz, axis } = decodeEdge(key)
        const mx = axis === 0 ? cx + 0.5 : cx
        const mz = axis === 0 ? cz : cz + 0.5
        const exists = this.opts.fences.edges.has(key) || this.opts.fences.gates.has(key)
        return { key, ok: !exists && this.opts.allowed(mx, mz), exists }
      })
      this.showPreview()
      // live verdict while the finger is still down — the editor TALKS
      const fresh = this.pendingRun.filter((p) => p.ok).length
      if (fresh > 0) this.say(`+${fresh} post${fresh === 1 ? '' : 's'}`, 9999)
      else if (this.pendingRun.length > 0 && this.pendingRun.every((p) => p.exists)) this.say('already fenced here', 9999)
      else if (this.pendingRun.length > 0) this.say("can't fence here", 9999)
    } else if (this.tool === 'remove') {
      // hold-and-sweep: mow a whole run down in one gesture
      this.removeNear(g.x, g.z)
    }
  }

  private up = (e: PointerEvent): void => {
    if (!this.active || e.pointerId !== this.dragId) return
    e.stopImmediatePropagation()
    if (this.tool === 'draw' && this.anchor) {
      let built = 0
      for (const { key, ok } of this.pendingRun) {
        if (!ok) continue
        this.opts.fences.edges.add(key)
        built++
      }
      if (built > 0) {
        const last = this.pendingRun.find((p) => p.ok)
        if (last) {
          const { cx, cz, axis } = decodeEdge(last.key)
          this.opts.onFx(axis === 0 ? cx + 0.5 : cx, axis === 0 ? cz : cz + 0.5, 'build')
        }
        this.say(`${built} post${built === 1 ? '' : 's'} built`)
        this.dirty = true
        this.lastRebuild = 0
        this.commit()
      } else if (this.pendingRun.length > 0) {
        this.say(this.pendingRun.every((p) => p.exists) ? 'already fenced here' : "can't fence here")
      }
    }
    if (this.dirty) {
      this.dirty = false
      this.opts.onChange()
    }
    this.endDrag()
  }

  removeNear(x: number, z: number): boolean {
    // a thumb is not a cursor: generous pick radius
    const k = nearestEdge(this.opts.fences, x, z, 1.3)
    if (k === null) return false
    this.opts.fences.edges.delete(k)
    this.opts.fences.gates.delete(k)
    const { cx, cz, axis } = decodeEdge(k)
    this.opts.onFx(axis === 0 ? cx + 0.5 : cx, axis === 0 ? cz : cz + 0.5, 'remove')
    this.commit()
    return true
  }

  toggleGateNear(x: number, z: number): boolean {
    const k = nearestEdge(this.opts.fences, x, z, 1.5)
    if (k === null) return false
    if (this.opts.fences.gates.has(k)) {
      this.opts.fences.gates.delete(k)
      this.opts.fences.edges.add(k)
    } else {
      this.opts.fences.edges.delete(k)
      this.opts.fences.gates.add(k)
    }
    const { cx, cz, axis } = decodeEdge(k)
    this.opts.onFx(axis === 0 ? cx + 0.5 : cx, axis === 0 ? cz : cz + 0.5, 'gate')
    this.dirty = true
    this.lastRebuild = 0
    this.commit()
    return true
  }

  /** E2E drives the same internals the fingers do */
  drawRun(ax: number, az: number, bx: number, bz: number): number {
    let built = 0
    for (const key of this.runEdges(ax, az, bx, bz)) {
      const { cx, cz, axis } = decodeEdge(key)
      const mx = axis === 0 ? cx + 0.5 : cx
      const mz = axis === 0 ? cz : cz + 0.5
      if (this.opts.fences.edges.has(key) || this.opts.fences.gates.has(key)) continue
      if (!this.opts.allowed(mx, mz)) continue
      this.opts.fences.edges.add(key)
      built++
    }
    if (built > 0) {
      this.dirty = false
      this.opts.onChange()
    }
    return built
  }
}
