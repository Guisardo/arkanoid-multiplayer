// Brick probe ordering (ticket 98, docs/physics-validation.md §8).
//
// Every sim probes the neighbourhood around the ball, but iterated it in
// row-major scan order — so the *top-left* cell always won a corner hit, no
// matter which brick the ball actually touched first. That made corner
// resolution depend on iteration order rather than geometry, and it differed
// subtly per sim because each engine re-typed the loop.
//
// This module is the single probe-and-order policy: take the ball's own grid
// cell plus its eight neighbours, then hand back the non-empty bricks sorted
// by how close each one is to the ball, with the cell index as the tie-break so
// the result never depends on `Array.prototype.sort` stability or on probe
// order.
//
// Sampling whole *cells* rather than half-cell offsets is what keeps the probe
// tunnel-safe. A ball cannot skip a brick unless it travels more than one cell
// per tick, so the guarantee is "speed × TICK_DT < BRICK_H" — which holds even
// at the arcade speed ceiling (round 33 base 174 × both brick-count tiers ×
// three ceiling tiers × the multiball boost ≈ 282 u/s ≈ 4.7 u/tick). The old
// half-cell sampling only held below 4 u/tick, which the ceiling tiers and the
// multiball boost (tickets 96/97) push past. Wider probing cannot invent a
// collision: every candidate still has to pass the circle-vs-box overlap test.
import { BRICK_H, BRICK_TOP_OFFSET, BRICK_W } from "./constants";
import type { Box } from "./collision";

export interface BrickProbeHit {
  index: number;
  box: Box;
}

/** The sim's own cell lookup: given a point, the brick occupying that cell. */
export type BrickProbeLookup = (cx: number, cy: number) => BrickProbeHit | null;

/** Squared distance from a point to a box (0 when the point is inside). */
export function pointBoxDistanceSq(px: number, py: number, box: Box): number {
  const dx = Math.max(0, Math.abs(px - box.x) - box.w / 2);
  const dy = Math.max(0, Math.abs(py - box.y) - box.h / 2);
  return dx * dx + dy * dy;
}

/** Centre of the grid cell containing a point (may be off-grid). */
function cellCentre(col: number, row: number): { x: number; y: number } {
  return {
    x: col * BRICK_W + BRICK_W / 2,
    y: BRICK_TOP_OFFSET + row * BRICK_H + BRICK_H / 2,
  };
}

/**
 * Non-empty bricks in the ball's cell and its eight neighbours, closest first.
 * Ties break on the lower cell index (row-major), so two bricks that are
 * exactly equidistant resolve identically on every engine and every run.
 *
 * Cost is 9 lookups plus a sort of at most 9 numbers — the neighbourhood is a
 * fixed 3×3 by construction, so this is no more work than the inline loops it
 * replaced.
 */
export function probeBricks(bx: number, by: number, brickAt: BrickProbeLookup): BrickProbeHit[] {
  const col0 = Math.floor(bx / BRICK_W);
  const row0 = Math.floor((by - BRICK_TOP_OFFSET) / BRICK_H);
  const found = new Map<number, BrickProbeHit>();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = cellCentre(col0 + dx, row0 + dy);
      const hit = brickAt(c.x, c.y);
      if (hit === null) continue;
      found.set(hit.index, hit);
    }
  }
  const hits = [...found.values()];
  hits.sort((a, b) => {
    const da = pointBoxDistanceSq(bx, by, a.box);
    const db = pointBoxDistanceSq(bx, by, b.box);
    if (da !== db) return da - db;
    return a.index - b.index;
  });
  return hits;
}
