import { describe, expect, it } from "vitest";
import { createMultiFieldSession, resolveTimeout } from "sim/multiField";
import { BRICK_COLS } from "sim/constants";
import { EMPTY_ACTIONS, isDestructibleCell, type InputFrame } from "shared/protocol";

function frame(player: number, tick: number, axisX = 0, launch = false): InputFrame {
  return { player, tick, axisX, axisY: 0, launch, actions: EMPTY_ACTIONS };
}

/** Clear exactly one round on a player's field, stopping at the round clear. */
function clearOneRound(
  session: ReturnType<typeof createMultiFieldSession>,
  player: number,
): void {
  let guard = 0;
  while (guard < 3000) {
    const before = session.state().roundPoints[player] ?? 0;
    const snap = session.snapshots()[player]!;
    let target = -1;
    for (let i = 0; i < snap.bricks.length; i++) {
      if (isDestructibleCell(snap.bricks[i] ?? 0)) {
        target = i;
        break;
      }
    }
    if (target < 0) return;
    const col = target % BRICK_COLS;
    const row = Math.floor(target / BRICK_COLS);
    session.debugSetBall(player, col * 16 + 8 + 2, 20 + (row + 1) * 8 + 6, 0, -200);
    for (let s = 0; s < 20; s++) {
      session.step([frame(player, guard * 20 + s)]);
      guard++;
      if ((session.state().roundPoints[player] ?? 0) > before) return;
      if (session.state().phase === "matchOver") return;
    }
  }
}

describe("resolveTimeout (spec §6.3)", () => {
  it("round-based → most bricks that round", () => {
    const r = resolveTimeout("bestOf", [0, 0], [10, 12]);
    expect(r.winner).toBe(1);
    expect(r.draw).toBe(false);
  });
  it("continuous → furthest along (levels cleared, then bricks)", () => {
    const r = resolveTimeout("continuous", [2, 1], [5, 40]);
    expect(r.winner).toBe(0);
    const r2 = resolveTimeout("continuous", [1, 1], [5, 40]);
    expect(r2.winner).toBe(1);
  });
  it("one-off → most bricks", () => {
    const r = resolveTimeout("oneOff", [0, 0], [3, 9]);
    expect(r.winner).toBe(1);
  });
  it("exact tie → draw", () => {
    const r = resolveTimeout("bestOf", [0, 0], [7, 7]);
    expect(r.draw).toBe(true);
    expect(r.winner).toBe(-1);
  });
});

describe("multi-field session (ticket 34)", () => {
  it("creates N parallel identical fields", () => {
    const session = createMultiFieldSession({
      playerCount: 3,
      config: { structure: "bestOf", bestOf: 3, levelSelection: "fixedOrder", timeCapTicks: null },
    });
    expect(session.playerCount).toBe(3);
    const snaps = session.snapshots();
    expect(snaps).toHaveLength(3);
    expect(snaps[0]!.bricks).toEqual(snaps[1]!.bricks);
    expect(snaps[1]!.bricks).toEqual(snaps[2]!.bricks);
    expect(snaps.map((s) => s.players[0]!.name)).toEqual(["Player 1", "Player 2", "Player 3"]);
  });

  it("per-player input drives only that player's field", () => {
    const session = createMultiFieldSession({
      playerCount: 2,
      config: { structure: "bestOf", bestOf: 3, levelSelection: "fixedOrder", timeCapTicks: null },
    });
    const x0 = session.snapshots()[0]!.players[0]!.paddle.x;
    session.step([frame(0, 0, 1)]);
    const s0 = session.snapshots()[0]!.players[0]!.paddle.x;
    const s1 = session.snapshots()[1]!.players[0]!.paddle.x;
    expect(s0).toBeGreaterThan(x0);
    expect(s1).toBeCloseTo(x0, 5);
  });

  it("first clear wins the round; one-off ends the match", () => {
    const session = createMultiFieldSession({
      playerCount: 2,
      config: { structure: "oneOff", bestOf: 1, levelSelection: "fixedOrder", timeCapTicks: null },
    });
    clearOneRound(session, 1); // player 1 clears first
    const st = session.state();
    expect(st.matchWinner).toBe(1);
    expect(st.phase).toBe("matchOver");
  });

  it("best-of-N: match ends at majority", () => {
    const session = createMultiFieldSession({
      playerCount: 2,
      config: { structure: "bestOf", bestOf: 3, levelSelection: "fixedOrder", timeCapTicks: null },
    });
    clearOneRound(session, 0);
    expect(session.state().roundPoints[0]).toBe(1);
    expect(session.state().phase).toBe("playing");
    clearOneRound(session, 0);
    expect(session.state().roundPoints[0]).toBe(2);
    expect(session.state().matchWinner).toBe(0);
    expect(session.state().phase).toBe("matchOver");
  });

  it("timeout: most bricks wins; exact tie → draw, no round point, next level", () => {
    const session = createMultiFieldSession({
      playerCount: 2,
      config: { structure: "oneOff", bestOf: 1, levelSelection: "fixedOrder", timeCapTicks: 30 },
    });
    // Player 0 breaks exactly one brick, player 1 none.
    const snap0 = session.snapshots()[0]!;
    let target = -1;
    for (let i = 0; i < snap0.bricks.length; i++) {
      if (isDestructibleCell(snap0.bricks[i] ?? 0)) {
        target = i;
        break;
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    const col = target % BRICK_COLS;
    const row = Math.floor(target / BRICK_COLS);
    session.debugSetBall(0, col * 16 + 8 + 2, 20 + (row + 1) * 8 + 6, 0, -200);
    for (let t = 0; t < 30; t++) session.step([frame(0, t), frame(1, t)]);
    const st = session.state();
    expect(st.matchWinner).toBe(0); // 1 brick vs 0
    expect(st.phase).toBe("matchOver");
  });

  it("timeout draw: equal bricks → no winner, round advances", () => {
    const session = createMultiFieldSession({
      playerCount: 2,
      config: { structure: "bestOf", bestOf: 3, levelSelection: "fixedOrder", timeCapTicks: 30 },
    });
    for (let t = 0; t < 35; t++) session.step([frame(0, t), frame(1, t)]);
    const st = session.state();
    expect(st.matchWinner).toBeNull();
    expect(st.roundPoints).toEqual([0, 0]);
    expect(st.phase).toBe("playing");
  });

  it("0 lives → level resets with fresh layout and restored lives", () => {
    const session = createMultiFieldSession({
      playerCount: 2,
      config: { structure: "bestOf", bestOf: 3, levelSelection: "fixedOrder", timeCapTicks: null },
    });
    // Drop player 0's ball 5 times → 0 lives → gameOver → resetField.
    for (let loss = 0; loss < 5; loss++) {
      session.debugSetBall(0, 104, 300, 0, 60);
      for (let s = 0; s < 12; s++) session.step([frame(0, loss * 12 + s)]);
    }
    const snap = session.snapshots()[0]!;
    expect(snap.players[0]!.lives).toBe(5); // restored
    expect(snap.phase).toBe("serve"); // fresh layout, re-serving
  });

  it("random level selection is deterministic per seed", () => {
    const mk = (): number =>
      createMultiFieldSession({
        playerCount: 2,
        config: { structure: "bestOf", bestOf: 3, levelSelection: "random", timeCapTicks: null },
        seed: 42,
      }).state().round;
    expect(mk()).toBe(mk());
  });

  it("hostPick uses the configured round", () => {
    const session = createMultiFieldSession({
      playerCount: 2,
      config: { structure: "bestOf", bestOf: 3, levelSelection: "hostPick", timeCapTicks: null, hostPickRound: 5 },
    });
    expect(session.state().round).toBe(5);
  });

  it("determinism: identical input sequences → identical snapshots", () => {
    const run = () => {
      const session = createMultiFieldSession({
        playerCount: 2,
        config: { structure: "bestOf", bestOf: 3, levelSelection: "fixedOrder", timeCapTicks: null },
        seed: 7,
      });
      for (let t = 0; t < 120; t++) {
        session.step([frame(0, t, t % 2 === 0 ? 1 : -1), frame(1, t, t % 3 === 0 ? -1 : 1)]);
      }
      return session.snapshots();
    };
    expect(run()).toEqual(run());
  });
});
