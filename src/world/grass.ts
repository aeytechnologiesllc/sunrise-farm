import type { Scene } from 'three'

export interface GrassField {
  update(t: number): void
  /** hide the whole lawn (inside opaque interiors the farm doesn't render) */
  setVisible(on: boolean): void
  /** zero-scale every blade inside the rect — retained as a no-op for callers */
  hideIn(rect: { x0: number; z0: number; x1: number; z1: number }): void
  /** retained as a no-op for sleep/repaint flows */
  rebuild(): void
}

const SMOOTH_GRASS: GrassField = {
  update(): void {},
  setVisible(): void {},
  hideIn(): void {},
  rebuild(): void {},
}

export function buildGrass(
  _scene: Scene,
  _isClear: (x: number, z: number) => boolean,
  _options: { mobilePerf?: boolean } = {},
): GrassField {
  return SMOOTH_GRASS
}
