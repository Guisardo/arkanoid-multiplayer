// Field background painter (spec §13): procedural starfield + darkening
// overlay pass. Pure math for speckle positions — unit-testable headless.
// Background must stay low-contrast so bricks/ball stay readable (gate).
import type { Graphics } from "pixi.js";
import type { FieldBackground } from "content/skinTypes";
import { FIELD_H, FIELD_W } from "shared/gridConstants";

/** Deterministic star positions for a density (seeded LCG — stable across frames). */
export function starPositions(density: number, count = 24): Array<{ x: number; y: number }> {
  if (density <= 0) return [];
  const stars: Array<{ x: number; y: number }> = [];
  // LCG: x(n+1) = (a·x(n) + c) mod m — deterministic, no RNG at render time.
  // Math.imul keeps the multiply inside int32 (no float precision drift).
  let state = 0x2f6e2b1;
  const next = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const n = Math.round(count * density);
  for (let i = 0; i < n; i++) {
    stars.push({ x: next() * FIELD_W, y: next() * FIELD_H });
  }
  return stars;
}

/** Paint a field background into a Graphics: base fill + speckles + darkening overlay. */
export function paintFieldBackground(gfx: Graphics, bg: FieldBackground): void {
  gfx.rect(0, 0, FIELD_W, FIELD_H).fill(bg.color);
  if (bg.starDensity > 0) {
    for (const s of starPositions(bg.starDensity)) {
      gfx.rect(s.x, s.y, 1, 1).fill(0x8888a8);
    }
  }
  if (bg.darkenAlpha > 0) {
    gfx.rect(0, 0, FIELD_W, FIELD_H).fill({ color: 0x000000, alpha: bg.darkenAlpha });
  }
}
