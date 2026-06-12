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
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
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
@media (max-width:760px){.etool{padding:7px 10px 7px 8px;font-size:12px}.etool .em{font-size:16px}}
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
  private previewMatOk = new MeshBasicMaterial({ color: OK_TINT, transparent: true, opacity: 0.85 })
  private previewMatNo = new MeshBasicMaterial({ color: NO_TINT, transparent: true, opacity: 0.7 })
  private pendingRun: Array<{ key: number; ok: boolean }> = []
  private dirty = false
  private lastRebuild = 0

  constructor(private opts: FenceEditorOpts) {
    this.panel = new ToolPanel(
      [
        { id: 'draw', emoji: '\u{1FAB5}', label: 'Draw' },
        { id: 'gate', emoji: '\u{1F6AA}', label: 'Gateway' },
        { id: 'remove', emoji: '\u{1F528}', label: 'Remove' },
        { id: 'style', emoji: '\u{1F3A8}', label: 'Styles soon', locked: true },
      ],
      (id) => {
        this.tool = id as typeof this.tool
        this.panel.setActive(id)
      },
      () => this.close(),
    )
    const geo = new BoxGeometry(0.96, 0.5, 0.07)
    for (let i = 0; i < MAX_RUN; i++) {
      const m = new Mesh(geo, this.previewMatOk)
      m.position.y = 0.25
      m.visible = false
      m.renderOrder = 3
      opts.scene.add(m)
      this.preview.push(m)
    }
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
    return true
  }

  close(): void {
    if (!this.active) return
    this.active = false
    this.panel.hide()
    this.endDrag()
    if (this.dirty) {
      this.dirty = false
      this.opts.onChange()
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

  /** pointer ndc -> the y=0 ground plane */
  private ground(e: PointerEvent): { x: number; z: number } | null {
    this.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
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
      if (!entry) {
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
    this.dragId = null
    this.anchor = null
    this.hidePreview()
  }

  // ---- the tools -------------------------------------------------------------

  private down = (e: PointerEvent): void => {
    if (!this.active) return
    // the panel's own buttons live OUTSIDE the canvas — anything reaching
    // the canvas is tool intent
    if (this.dragId !== null) return
    e.stopImmediatePropagation()
    const g = this.ground(e)
    if (!g) return
    this.dragId = e.pointerId
    if (this.tool === 'draw') {
      this.anchor = { x: Math.round(g.x), z: Math.round(g.z) }
    } else if (this.tool === 'remove') {
      this.removeNear(g.x, g.z)
    } else if (this.tool === 'gate') {
      this.toggleGateNear(g.x, g.z)
    }
  }

  private move = (e: PointerEvent): void => {
    if (!this.active) return
    e.stopImmediatePropagation()
    if (e.pointerId !== this.dragId) return
    const g = this.ground(e)
    if (!g) return
    if (this.tool === 'draw' && this.anchor) {
      const keys = this.runEdges(this.anchor.x, this.anchor.z, Math.round(g.x), Math.round(g.z))
      this.pendingRun = keys.map((key) => {
        const { cx, cz, axis } = decodeEdge(key)
        const mx = axis === 0 ? cx + 0.5 : cx
        const mz = axis === 0 ? cz : cz + 0.5
        const fresh = !this.opts.fences.edges.has(key) && !this.opts.fences.gates.has(key)
        return { key, ok: fresh && this.opts.allowed(mx, mz) }
      })
      this.showPreview()
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
        this.dirty = true
        this.lastRebuild = 0
        this.commit()
      }
    }
    if (this.dirty) {
      this.dirty = false
      this.opts.onChange()
    }
    this.endDrag()
  }

  removeNear(x: number, z: number): boolean {
    const k = nearestEdge(this.opts.fences, x, z, 0.95)
    if (k === null) return false
    this.opts.fences.edges.delete(k)
    this.opts.fences.gates.delete(k)
    const { cx, cz, axis } = decodeEdge(k)
    this.opts.onFx(axis === 0 ? cx + 0.5 : cx, axis === 0 ? cz : cz + 0.5, 'remove')
    this.commit()
    return true
  }

  toggleGateNear(x: number, z: number): boolean {
    const k = nearestEdge(this.opts.fences, x, z, 1.2)
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
