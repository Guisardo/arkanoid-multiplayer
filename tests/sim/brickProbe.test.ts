// Brick probe ordering (ticket 98, docs/physics-validation.md §8): the probe
// must resolve a corner hit against the *geometrically closest* brick, and
// resolve it identically on every run — never "whatever the loop hit first".
import { describe, expect, it } from "vitest";
import { probeBricks, pointBoxDistanceSq, type BrickProbeHit } from "sim/brickProbe";
import { createRoundSim } from "sim/roundSim";
import type { LevelData } from "content/levelFormat";
import { BRICK_COLS, BRICK_H, BRICK_ROWS, BRICK_TOP_OFFSET, BRICK_W } from "sim/constants";
import { EMPTY_ACTIONS, isDestructibleCell, type InputFrame } from "shared/protocol";

/** Box (center-anchored) of a grid cell, matching the sim's own lookup. */
function cellBox(index: number): { x: number; y: number; w: number; h: number } {
  const col = index % BRICK_COLS;
  const row = Math.floor(index / BRICK_COLS);
  return {
    x: col * BRICK_W + BRICK_W / 2,
    y: BRICK_TOP_OFFSET + row * BRICK_H + BRICK_H / 2,
    w: BRICK_W,
    h: BRICK_H,
  };
}

function input(tick: number): InputFrame {
  return { player: 0, tick, axisX: 0, axisY: 0, launch: false, actions: EMPTY_ACTIONS };
}

describe("pointBoxDistanceSq", () => {
  it("is 0 for a point inside the box and for one on an edge", () => {
    const box = { x: 10, y: 10, w: 4, h: 4 };
    expect(pointBoxDistanceSq(10, 10, box)).toBe(0);
    expect(pointBoxDistanceSq(12, 10, box)).toBe(0);
    expect(pointBoxDistanceSq(8, 10, box)).toBe(0);
  });

  it("measures the perpendicular gap on each axis and adds in quadrature", () => {
    const box = { x: 10, y: 10, w: 4, h: 4 };
    expect(pointBoxDistanceSq(13, 10, box)).toBeCloseTo(1, 10);
    expect(pointBoxDistanceSq(13, 13, box)).toBeCloseTo(2, 10);
    expect(pointBoxDistanceSq(0, 0, box)).toBeCloseTo(128, 10);
  });
});

describe("probeBricks ordering", () => {
  it("returns nothing when the neighbourhood is empty", () => {
    expect(probeBricks(100, 200, () => null)).toEqual([]);
  });

  it("sorts candidates closest-first, not in probe scan order", () => {
    // Ball at (100, 44): cell (row 3, col 6) contains the point (distance 0);
    // cell (row 2, col 5) is up-and-left (distance 32). The scan visits the
    // row-above sample first, so scan order would return `far` first.
    const near = 3 * BRICK_COLS + 6;
    const far = 2 * BRICK_COLS + 5;
    const present = new Set([near, far]);
    const lookup = (cx: number, cy: number): BrickProbeHit | null => {
      const col = Math.floor(cx / BRICK_W);
      const row = Math.floor((cy - BRICK_TOP_OFFSET) / BRICK_H);
      if (col < 0 || col >= BRICK_COLS || row < 0 || row >= BRICK_ROWS) return null;
      const index = row * BRICK_COLS + col;
      if (!present.has(index)) return null;
      return { index, box: cellBox(index) };
    };
    const hits = probeBricks(100, 44, lookup);
    expect(hits.map((h) => h.index)).toEqual([near, far]);
  });

  it("breaks exact distance ties on the lower cell index, so order is stable", () => {
    const a = 0;
    const b = 1;
    const lookup = (cx: number, cy: number): BrickProbeHit | null => {
      const col = Math.floor(cx / BRICK_W);
      const row = Math.floor((cy - BRICK_TOP_OFFSET) / BRICK_H);
      if (row !== 0) return null;
      const index = col;
      if (index !== a && index !== b) return null;
      return { index, box: cellBox(index) };
    };
    // Centred between the two top cells: both boxes contain the point (tie).
    const bx = BRICK_W / 2 + BRICK_W / 2;
    const by = BRICK_TOP_OFFSET + BRICK_H / 2;
    for (let run = 0; run < 5; run++) {
      expect(probeBricks(bx, by, lookup).map((h) => h.index)).toEqual([a, b]);
    }
  });

  it("deduplicates: a brick found by several probe samples is returned once", () => {
    const index = 7;
    const hits = probeBricks(7 * BRICK_W + BRICK_W / 2, BRICK_TOP_OFFSET + BRICK_H / 2, () => ({
      index,
      box: cellBox(index),
    }));
    expect(hits).toHaveLength(1);
  });
});

describe("corner hits resolve by geometry, not scan order (ticket 98)", () => {
  /**
   * Two bricks meet at the shared corner (16, 44): A = row 2 col 1 (index 27,
   * above-right), B = row 3 col 0 (index 39, below-left). The old row-major
   * probe visited A first purely because of iteration order.
   */
  const A = 2 * BRICK_COLS + 1;
  const B = 3 * BRICK_COLS + 0;

  function cornerLevel(): LevelData {
    const grid: string[] = [];
    for (let r = 0; r < BRICK_ROWS; r++) grid.push(".".repeat(BRICK_COLS));
    grid[2] = ".O............";
    grid[3] = "O.............";
    return {
      version: 1,
      round: 1,
      grid,
      baseBallSpeed: 110,
      silverHitOverride: null,
      capsuleScript: [
        { brickBreakCount: 1, capsule: "E" },
        { brickBreakCount: 2, capsule: "P" },
        { brickBreakCount: 3, capsule: "L" },
        { brickBreakCount: 4, capsule: "S" },
        { brickBreakCount: 5, capsule: "M" },
        { brickBreakCount: 6, capsule: "C" },
      ],
      scoreOverrides: {},
    };
  }

  it("breaks the brick the ball is actually touching, not the first in scan order", () => {
    const sim = createRoundSim(cornerLevel(), { lives: 99, score: 0 });
    // Inside B's box, grazing A's: B is strictly closer (distance 0 vs ~2.8).
    sim.debugSetBall(14, 46, 0, 0);
    sim.step([input(sim.currentTick)]);
    const snap = sim.snapshot();
    expect(isDestructibleCell(snap.bricks[B] ?? 0)).toBe(false);
    expect(isDestructibleCell(snap.bricks[A] ?? 0)).toBe(true);
  });

  it("the same corner hit resolves identically on every run", () => {
    const run = (): number[] => {
      const sim = createRoundSim(cornerLevel(), { lives: 99, score: 0 });
      sim.debugSetBall(14, 46, 0, 0);
      sim.step([input(sim.currentTick)]);
      return sim.snapshot().bricks;
    };
    expect(run()).toEqual(run());
  });

  it("an equidistant corner still resolves to the same brick every time", () => {
    // Dead centre of the shared corner: both boxes contain the point.
    const run = (): number[] => {
      const sim = createRoundSim(cornerLevel(), { lives: 99, score: 0 });
      sim.debugSetBall(16, 44, 0, 0);
      sim.step([input(sim.currentTick)]);
      return sim.snapshot().bricks;
    };
    const first = run();
    expect(first).toEqual(run());
    // Tie broken on the lower index, which is A here.
    expect(isDestructibleCell(first[A] ?? 0)).toBe(false);
    expect(isDestructibleCell(first[B] ?? 0)).toBe(true);
  });
});
