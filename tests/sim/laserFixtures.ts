// Shared fixture for the Laser sim tests (roundSim, sharedField, duel): a
// hand-drawn grid with no capsule script, so only `debugDropCapsule` drops.
import type { LevelData } from "content/levelFormat";
import { BRICK_ROWS } from "sim/constants";

/** A level from sparse grid rows (row index → 13-char row; the rest empty). */
export function gridLevel(rows: Record<number, string>, round = 1): LevelData {
  const grid: string[] = [];
  for (let r = 0; r < BRICK_ROWS; r++) grid.push(rows[r] ?? ".............");
  return {
    version: 1,
    round,
    grid,
    baseBallSpeed: 110,
    silverHitOverride: null,
    capsuleScript: [],
    scoreOverrides: {},
  };
}
