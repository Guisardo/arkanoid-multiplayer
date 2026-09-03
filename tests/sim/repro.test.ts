import { describe, expect, it } from "vitest";
import { createAttackSession } from "sim/attackSession";
import { isDestructibleCell, EMPTY_ACTIONS } from "shared/protocol";
import { BRICK_COLS } from "sim/constants";

function destructibleCount(bricks: readonly number[]): number {
  let n = 0;
  for (const c of bricks) if (isDestructibleCell(c)) n++;
  return n;
}

describe("debug repro", () => {
  it("aim ball at first brick", () => {
    const session = createAttackSession({
      playerCount: 2,
      config: { structure: "bestOf", bestOf: 3, levelSelection: "fixedOrder", timeCapTicks: null },
      seed: 7,
    });
    const snap = session.snapshots()[0]!;
    let target = -1;
    for (let i = 0; i < snap.bricks.length; i++) {
      if (isDestructibleCell(snap.bricks[i] ?? 0)) { target = i; break; }
    }
    console.log("target idx", target, "col", target % BRICK_COLS, "row", Math.floor(target / BRICK_COLS));
    const col = target % BRICK_COLS;
    const row = Math.floor(target / BRICK_COLS);
    session.debugSetBall(0, col * 16 + 8 + 2, 20 + (row + 1) * 8 + 6, 0, -200);
    const before = destructibleCount(session.snapshots()[0]!.bricks);
    for (let s = 0; s < 40; s++) {
      session.step([{ player: 0, tick: s, axisX: 0, axisY: 0, launch: false, actions: EMPTY_ACTIONS }]);
      const now = destructibleCount(session.snapshots()[0]!.bricks);
      if (now < before) { console.log("broke at step", s); break; }
      if (s === 39) {
        console.log("NOT BROKEN. ball:", JSON.stringify(session.snapshots()[0]!.balls[0]));
        console.log("phase:", session.snapshots()[0]!.phase);
      }
    }
    // second sequential break
    const snap2 = session.snapshots()[0]!;
    let target2 = -1;
    for (let i = 0; i < snap2.bricks.length; i++) {
      if (isDestructibleCell(snap2.bricks[i] ?? 0)) { target2 = i; break; }
    }
    console.log("2nd target idx", target2, "col", target2 % BRICK_COLS, "row", Math.floor(target2 / BRICK_COLS));
    const col2 = target2 % BRICK_COLS;
    const row2 = Math.floor(target2 / BRICK_COLS);
    session.debugSetBall(0, col2 * 16 + 8 + 2, 20 + (row2 + 1) * 8 + 6, 0, -200);
    const before2 = destructibleCount(session.snapshots()[0]!.bricks);
    for (let s = 0; s < 40; s++) {
      session.step([{ player: 0, tick: 100 + s, axisX: 0, axisY: 0, launch: false, actions: EMPTY_ACTIONS }]);
      const now = destructibleCount(session.snapshots()[0]!.bricks);
      if (now < before2) { console.log("2nd broke at step", s); break; }
      if (s === 39) {
        console.log("2nd NOT BROKEN. ball:", JSON.stringify(session.snapshots()[0]!.balls[0]));
        console.log("phase:", session.snapshots()[0]!.phase, "lives:", session.snapshots()[0]!.players[0]?.lives);
      }
    }
    expect(true).toBe(true);
  });
});
