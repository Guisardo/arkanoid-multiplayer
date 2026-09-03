// Field region layout math (spec §12): fixed logical 208 × 256 field,
// letterboxed inside its region, fractional scale, dpr capped at min(dpr, 2).
// Pure math — unit-testable without Pixi.
import { FIELD_H, FIELD_W } from "shared/gridConstants";

export const HUD_STRIP_UNITS = 20; // logical units above the field, inside region

export interface Region {
  /** Top-left in screen px. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FieldLayout {
  region: Region;
  /** Screen-px rect of the letterboxed play field. */
  field: { x: number; y: number; w: number; h: number };
  /** HUD strip rect above the field, inside the region. */
  hud: { x: number; y: number; w: number; h: number };
  /** Scale: screen px per logical unit (fractional allowed). */
  scale: number;
}

export const GUTTER_PX = 8;

/** Cap devicePixelRatio at min(dpr, 2) (spec §12). */
export function capDpr(dpr: number): number {
  return Math.min(dpr, 2);
}

/** Desktop: N-across equal-width columns with gutters; single centered at N=1. */
export function splitRegions(viewport: { w: number; h: number }, n: number): Region[] {
  if (n <= 0) return [];
  if (n === 1) {
    return [{ x: 0, y: 0, w: viewport.w, h: viewport.h }];
  }
  const totalGutters = (n - 1) * GUTTER_PX;
  const colW = (viewport.w - totalGutters) / n;
  const regions: Region[] = [];
  for (let i = 0; i < n; i++) {
    regions.push({
      x: i * (colW + GUTTER_PX),
      y: 0,
      w: colW,
      h: viewport.h,
    });
  }
  return regions;
}

/**
 * Letterbox a 208×256 field (+ HUD strip above) inside a region.
 * Fractional scale allowed; field centered horizontally, HUD above field.
 */
export function layoutField(region: Region): FieldLayout {
  const totalH = FIELD_H + HUD_STRIP_UNITS;
  const scale = Math.min(region.w / FIELD_W, region.h / totalH);
  const fieldW = FIELD_W * scale;
  const fieldH = FIELD_H * scale;
  const fieldX = region.x + (region.w - fieldW) / 2;
  const fieldY = region.y + (region.h - fieldH) / 2;
  return {
    region,
    field: { x: fieldX, y: fieldY, w: fieldW, h: fieldH },
    hud: {
      x: fieldX,
      y: fieldY - HUD_STRIP_UNITS * scale,
      w: fieldW,
      h: HUD_STRIP_UNITS * scale,
    },
    scale,
  };
}
