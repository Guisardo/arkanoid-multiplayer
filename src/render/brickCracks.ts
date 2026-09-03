// Brick hit-state crack overlays (spec §13): procedural tint+crack for
// silver multi-hit bricks. Pure geometry math — unit-testable headless.
// Brick-local coordinates: 16 × 8 units, origin top-left.
import { cellSilverHits, SILVER_MAX_HITS } from "shared/protocol";
import type { BrickSet } from "content/skinTypes";

export interface CrackSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Damage taken = max hits − hits remaining (0..3). */
export function brickDamage(cell: number): number {
  const hits = cellSilverHits(cell);
  if (hits === null) return 0;
  return SILVER_MAX_HITS - hits;
}

/**
 * Crack segments for a silver brick cell, scaled by damage. Deterministic:
 * same cell + style → same segments. One segment per hit taken (max 3).
 */
export function crackSegments(cell: number, style: BrickSet["crackStyle"]): readonly CrackSegment[] {
  const damage = brickDamage(cell);
  if (damage <= 0) return [];
  // Per-style segment pools (brick-local 16×8 coords), index = damage-1.
  const pools: Partial<Record<BrickSet["crackStyle"], readonly CrackSegment[]>> = {
    hairline: [
      { x1: 2, y1: 1, x2: 6, y2: 4 },
      { x1: 6, y1: 4, x2: 10, y2: 2 },
      { x1: 10, y1: 2, x2: 14, y2: 6 },
    ],
    shatter: [
      { x1: 8, y1: 0, x2: 8, y2: 8 },
      { x1: 0, y1: 4, x2: 16, y2: 4 },
      { x1: 3, y1: 1, x2: 13, y2: 7 },
    ],
    chip: [
      { x1: 0, y1: 0, x2: 3, y2: 2 },
      { x1: 13, y1: 6, x2: 16, y2: 8 },
      { x1: 6, y1: 0, x2: 9, y2: 2 },
    ],
  };
  const pool = pools[style];
  if (!pool) return [];
  const segs: CrackSegment[] = [];
  for (let i = 0; i < damage && i < pool.length; i++) {
    const s = pool[i];
    if (s) segs.push({ ...s });
  }
  return segs;
}
