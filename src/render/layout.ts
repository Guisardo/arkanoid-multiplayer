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

/** Ticket 100: height of the remote progress strip band above the fields. */
export const REMOTE_STRIP_HEIGHT_PX = 28;

/** Below this viewport width the strip's full rows no longer fit one line. */
const STRIP_FULL_MIN_W = 640;
/** Below this viewport height (landscape phone) the strip must stay slim. */
const STRIP_FULL_MIN_H = 480;

/**
 * Ticket 100: whether the remote progress strip shows name + score only.
 * Narrow (portrait phone) or short (landscape phone) viewports compress it;
 * evaluated on every resize so rotation flips it live.
 */
export function stripCompact(viewport: { w: number; h: number }): boolean {
  return viewport.w < STRIP_FULL_MIN_W || viewport.h < STRIP_FULL_MIN_H;
}

/** Cap devicePixelRatio at min(dpr, 2) (spec §12). */
export function capDpr(dpr: number): number {
  return Math.min(dpr, 2);
}

/**
 * Desktop: N-across equal-width columns with gutters; single centered at N=1.
 * `topInset` (ticket 100) reserves a band above every region, e.g. for the
 * remote progress strip, so fields shrink instead of being clipped.
 */
export function splitRegions(viewport: { w: number; h: number }, n: number, topInset = 0): Region[] {
  if (n <= 0) return [];
  const h = Math.max(0, viewport.h - topInset);
  if (n === 1) {
    return [{ x: 0, y: topInset, w: viewport.w, h }];
  }
  const totalGutters = (n - 1) * GUTTER_PX;
  const colW = (viewport.w - totalGutters) / n;
  const regions: Region[] = [];
  for (let i = 0; i < n; i++) {
    regions.push({
      x: i * (colW + GUTTER_PX),
      y: topInset,
      w: colW,
      h,
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
/** Plain rect with Pixi `Rectangle` field names, so it can seed a `cullArea`. */
export interface CullRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Ticket 93: the screen-px rect a field view actually draws into — the
 * letterboxed field plus the HUD strip above it. Narrower than the region on
 * purpose: Pixi's culler tests this rect, not the empty letterbox margin.
 */
export function fieldCullRect(layout: FieldLayout): CullRect {
  return {
    x: layout.field.x,
    y: layout.hud.y,
    width: layout.field.w,
    height: layout.hud.h + layout.field.h,
  };
}
