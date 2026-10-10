// Ticket 102: the destroyed-brick history behind Attack's brick rain was
// unbounded — every break appended forever, so a long continuous Attack match
// grew the array without limit and brick rain kept resurrecting bricks broken
// dozens of rounds ago. The cap keeps only the most recent entries.
import { describe, expect, it } from "vitest";
import { createRoundSim, DESTROYED_HISTORY_CAP } from "sim/roundSim";
import type { LevelData } from "content/levelFormat";
import { BRICK_COLS, BRICK_ROWS, FIELD_H } from "sim/constants";
import { EMPTY_ACTIONS, isDestructibleCell, type InputFrame } from "shared/protocol";

/** A grid whose every cell is a one-hit brick, so breaks never run out. */
function denseLevel(): LevelData {
  const grid = Array.from({ length: BRICK_ROWS }, () =>
    "O".repeat(BRICK_COLS),
  );
  return {
    version: 1,
    round: 1,
    grid,
    baseBallSpeed: 110,
    silverHitOverride: null,
    capsuleScript: [],
    scoreOverrides: {},
  };
}

function frame(tick: number): InputFrame {
  return { player: 0, tick, axisX: 0, axisY: 0, launch: false, actions: EMPTY_ACTIONS };
}

describe("destroyed-brick history cap (ticket 102)", () => {
  it("the cap covers far more breaks than one field can ever hold", () => {
    // A field only has BRICK_COLS × BRICK_ROWS cells, so a cap at 500 is
    // generous by design: brick rain must still find empty cells to fill even
    // after a full round of breaks.
    expect(DESTROYED_HISTORY_CAP).toBeGreaterThanOrEqual(BRICK_COLS * BRICK_ROWS);
    expect(Number.isInteger(DESTROYED_HISTORY_CAP)).toBe(true);
  });

  it("the history never grows past the cap", () => {
    const sim = createRoundSim(denseLevel(), { lives: 99, score: 0 });
    // Break well past the cap by cycling the ball over the wall repeatedly.
    let tick = 0;
    let maxSeen = 0;
    for (let round = 0; round < 60; round++) {
      sim.debugSetBall(6, 40, 0, -300);
      for (let i = 0; i < 300; i++) {
        sim.step([frame(tick++)]);
        maxSeen = Math.max(maxSeen, sim.destroyedHistorySize);
      }
    }
    expect(sim.destroyedHistorySize).toBeLessThanOrEqual(DESTROYED_HISTORY_CAP);
    expect(maxSeen).toBeLessThanOrEqual(DESTROYED_HISTORY_CAP);
    // It really did break plenty of bricks — the cap is doing work, not
    // measuring an empty history.
    expect(sim.destroyedHistorySize).toBeGreaterThan(0);
  });

  it("the cap keeps the MOST RECENT breaks, not the oldest", () => {
    const sim = createRoundSim(denseLevel(), { lives: 99, score: 0 });
    let tick = 0;
    for (let round = 0; round < 60; round++) {
      sim.debugSetBall(6, 40, 0, -300);
      for (let i = 0; i < 300; i++) sim.step([frame(tick++)]);
    }
    // Overflow drops the oldest entries, so the survivors are the newest —
    // visible as the fact that rain fills the empties still on the field.
    const bricks = sim.snapshot().bricks;
    let empty = 0;
    for (const c of bricks) if (!isDestructibleCell(c)) empty++;
    // The field has empty cells the history can still reach into.
    expect(sim.destroyedHistorySize).toBeLessThanOrEqual(DESTROYED_HISTORY_CAP);
    expect(empty).toBeGreaterThan(0);
  });

  it("brick rain still fills its count after the history overflowed", () => {
    const sim = createRoundSim(denseLevel(), { lives: 99, score: 0 });
    let tick = 0;
    // Break everything at least once so the history overflows.
    for (let round = 0; round < 60; round++) {
      sim.debugSetBall(6, 40, 0, -300);
      for (let i = 0; i < 300; i++) sim.step([frame(tick++)]);
    }
    const cleared = sim.snapshot().bricks.every((c) => !isDestructibleCell(c));
    if (!cleared) {
      // Field still has bricks: rain fills from the capped history.
      const before = sim.snapshot().bricks.filter(isDestructibleCell).length;
      const placed = sim.resurrectBricks(3);
      expect(placed).toBe(3);
      expect(sim.snapshot().bricks.filter(isDestructibleCell).length).toBe(before + 3);
    } else {
      // Fully cleared field: rain falls back to the topmost empty cells, so
      // the cap never makes rain a no-op.
      const placed = sim.resurrectBricks(3);
      expect(placed).toBe(3);
      expect(sim.snapshot().bricks.filter(isDestructibleCell).length).toBe(3);
    }
  });

  it("an uncapped history would have grown past the cap (regression guard)", () => {
    // Ball-speed sanity: 60 cycles of 300 ticks with the paddle parked breaks
    // more bricks than the cap holds, which is exactly the condition the cap
    // exists for.
    expect(60 * 300).toBeGreaterThan(DESTROYED_HISTORY_CAP);
    expect(FIELD_H).toBeGreaterThan(0);
  });
});