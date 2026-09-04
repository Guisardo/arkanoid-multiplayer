import { describe, expect, it } from "vitest";
import { createAssistSession, countDestructible } from "sim/assistSession";
import { BRICK_COLS } from "sim/constants";
import { EMPTY_ACTIONS, isDestructibleCell, type InputFrame } from "shared/protocol";

function frame(
  player: number,
  tick: number,
  axisX = 0,
  over: Partial<Pick<InputFrame, "launch" | "actions">> = {},
): InputFrame {
  return {
    player,
    tick,
    axisX,
    axisY: 0,
    launch: over.launch ?? false,
    actions: over.actions ?? EMPTY_ACTIONS,
  };
}

function assistActions(button: number): InputFrame["actions"] {
  const fire: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  fire[button] = true;
  return { cycleForward: false, cycleBack: false, fire };
}

function mkSession(playerCount = 2, startRound = 1, endRound = 3) {
  return createAssistSession({ playerCount, startRound, endRound, seed: 7 });
}

/** Break exactly one brick on a player's field (ball aimed at first brick). */
function breakOneBrick(
  session: ReturnType<typeof createAssistSession>,
  player: number,
  tickRef: { t: number },
): void {
  const snap = session.snapshots()[player]!;
  let target = -1;
  for (let i = 0; i < snap.bricks.length; i++) {
    if (isDestructibleCell(snap.bricks[i] ?? 0)) {
      target = i;
      break;
    }
  }
  if (target < 0) throw new Error("no destructible brick to aim at");
  const col = target % BRICK_COLS;
  const row = Math.floor(target / BRICK_COLS);
  session.debugSetBall(player, col * 16 + 8 + 2, 20 + (row + 1) * 8 + 6, 0, -200);
  const before = countDestructible(session.snapshots()[player]!.bricks);
  for (let s = 0; s < 40; s++) {
    session.step([frame(player, tickRef.t++)]);
    const now = session.snapshots()[player]!;
    if (countDestructible(now.bricks) < before) return;
  }
  throw new Error("brick did not break in 40 ticks");
}

/** Clear a player's current level (aim at bricks until roundClear). */
function clearLevel(
  session: ReturnType<typeof createAssistSession>,
  player: number,
): void {
  let guard = 0;
  while (guard < 3000) {
    const snap = session.snapshots()[player]!;
    if (snap.phase === "roundClear") return;
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
      if (session.snapshots()[player]!.phase === "roundClear") return;
      if (session.state().phase !== "playing") return;
    }
  }
  throw new Error("level did not clear in 3000 ticks");
}

describe("assist session: structure", () => {
  it("creates N parallel fields with shared score", () => {
    const session = mkSession(3);
    expect(session.playerCount).toBe(3);
    const snaps = session.snapshots();
    expect(snaps).toHaveLength(3);
    expect(snaps[0]!.bricks).toEqual(snaps[1]!.bricks);
    expect(snaps.map((s) => s.players[0]!.name)).toEqual(["Player 1", "Player 2", "Player 3"]);
    // Shared score: every strip shows the same (team) value.
    expect(snaps[0]!.players[0]!.score).toBe(snaps[1]!.players[0]!.score);
  });

  it("per-player input drives only that player's field", () => {
    const session = mkSession(2);
    const x0 = session.snapshots()[0]!.players[0]!.paddle.x;
    session.step([frame(0, 0, 1)]);
    const s0 = session.snapshots()[0]!.players[0]!.paddle.x;
    const s1 = session.snapshots()[1]!.players[0]!.paddle.x;
    expect(s0).toBeGreaterThan(x0);
    expect(s1).toBeCloseTo(x0, 5);
  });
});

describe("assist session: meter fill", () => {
  it("fills 2 per brick break", () => {
    const session = mkSession();
    const ref = { t: 0 };
    breakOneBrick(session, 0, ref);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(2);
  });

  it("caps at meterMax (100)", () => {
    const session = mkSession();
    session.debugSetMeter(0, 99);
    const ref = { t: 0 };
    breakOneBrick(session, 0, ref);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(100);
  });

  it("downed players earn no meter income", () => {
    const session = mkSession();
    session.debugSetDowned(0);
    const ref = { t: 0 };
    // Park ball below field; no income possible while frozen anyway —
    // verify via a live teammate contrast: P1 breaks, P0 stays 0.
    breakOneBrick(session, 1, ref);
    expect(session.snapshots()[1]!.players[0]!.meter).toBe(2);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(0);
  });
});

describe("assist session: spends", () => {
  it("brick clear removes 8 lowest bricks from the target's field", () => {
    const session = mkSession();
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    const before = countDestructible(session.snapshots()[1]!.bricks);
    session.step([frame(0, 0, 0, { actions: assistActions(1) })]); // clear button
    const after = countDestructible(session.snapshots()[1]!.bricks);
    expect(before - after).toBe(8);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(70); // 100 - 30
    const events = session.snapshots()[1]!.events.filter((e) => e.type === "assist");
    expect(events.length).toBe(1);
  });

  it("brick clear removes fewer when fewer remain", () => {
    const session = mkSession();
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    // Break bricks until ≤ 5 remain, then clear.
    const ref = { t: 0 };
    let remaining = countDestructible(session.snapshots()[1]!.bricks);
    while (remaining > 5) {
      breakOneBrick(session, 1, ref);
      remaining = countDestructible(session.snapshots()[1]!.bricks);
    }
    session.step([frame(0, ref.t++, 0, { actions: assistActions(1) })]);
    const after = countDestructible(session.snapshots()[1]!.bricks);
    expect(after).toBe(0);
  });

  it("power-up gift sends the last captured capsule to the teammate's field", () => {
    const session = mkSession();
    // P0 catches an E capsule: park ball, drop capsule on paddle.
    session.debugSetBall(0, 104, 300, 0, 60);
    const sim = session.simAt(0)!;
    const paddle = session.snapshots()[0]!.players[0]!.paddle;
    sim.debugDropCapsule(paddle.x, paddle.y - 4, "E");
    for (let t = 0; t < 10; t++) session.step([frame(0, t)]);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(10); // caught
    // Now gift it to P1.
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    const before = session.snapshots()[1]!.capsules.length;
    session.step([frame(0, 10, 0, { actions: assistActions(0) })]); // gift button
    expect(session.snapshots()[1]!.capsules.length).toBe(before + 1);
    expect(session.snapshots()[1]!.capsules.at(-1)!.type).toBe("E");
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(80); // 100 - 20
  });

  it("gift with nothing captured does nothing (no spend)", () => {
    const session = mkSession();
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    const before = session.snapshots()[1]!.capsules.length;
    session.step([frame(0, 0, 0, { actions: assistActions(0) })]);
    expect(session.snapshots()[1]!.capsules.length).toBe(before);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(100); // unspent
  });

  it("life gift revives a downed teammate: 1 life, ball attached", () => {
    const session = mkSession();
    session.debugSetDowned(1);
    expect(session.snapshots()[1]!.players[0]!.state).toBe("downed");
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: assistActions(2) })]); // life button
    const snap1 = session.snapshots()[1]!;
    expect(snap1.players[0]!.state).toBe("playing");
    expect(snap1.players[0]!.lives).toBe(1);
    expect(snap1.phase).toBe("serve");
    expect(snap1.balls[0]!.attachedTo).toBe(0); // attached, owner launches
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(60); // 100 - 40
  });

  it("life gift creates the life — giver's lives untouched", () => {
    const session = mkSession();
    session.debugSetDowned(1);
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    const giverLives = session.snapshots()[0]!.players[0]!.lives;
    session.step([frame(0, 0, 0, { actions: assistActions(2) })]);
    expect(session.snapshots()[0]!.players[0]!.lives).toBe(giverLives);
    expect(session.snapshots()[1]!.players[0]!.lives).toBe(1);
  });

  it("self life gift impossible", () => {
    const session = mkSession();
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 0); // self
    session.step([frame(0, 0, 0, { actions: assistActions(2) })]);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(100); // unspent
    expect(session.snapshots()[0]!.players[0]!.lives).toBe(5); // unchanged
  });

  it("life gift on a live teammate does nothing (revive-only)", () => {
    const session = mkSession();
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: assistActions(2) })]);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(100); // unspent
    expect(session.snapshots()[1]!.players[0]!.lives).toBe(5); // unchanged
  });

  it("downed players keep spend rights (gift/clear)", () => {
    const session = mkSession();
    session.debugSetDowned(0);
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    const before = countDestructible(session.snapshots()[1]!.bricks);
    session.step([frame(0, 0, 0, { actions: assistActions(1) })]); // clear while downed
    const after = countDestructible(session.snapshots()[1]!.bricks);
    expect(before - after).toBe(8);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(70);
  });

  it("insufficient meter: button does nothing", () => {
    const session = mkSession();
    session.debugSetMeter(0, 19); // below gift cost 20
    session.debugSetTarget(0, 1);
    const before = countDestructible(session.snapshots()[1]!.bricks);
    session.step([frame(0, 0, 0, { actions: assistActions(1) })]);
    expect(countDestructible(session.snapshots()[1]!.bricks)).toBe(before);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(19);
  });
});

describe("assist session: downed state", () => {
  it("0 lives → downed: field frozen, spectates", () => {
    const session = mkSession();
    // Drop P0's ball 5 times → 0 lives → downed.
    for (let loss = 0; loss < 5; loss++) {
      session.debugSetBall(0, 104, 300, 0, 60);
      for (let s = 0; s < 12; s++) session.step([frame(0, loss * 12 + s)]);
    }
    const snap = session.snapshots()[0]!;
    expect(snap.players[0]!.state).toBe("downed");
    expect(snap.players[0]!.lives).toBe(0);
    // Frozen: stepping does not change the field.
    const tickBefore = snap.tick;
    session.step([frame(0, 999)]);
    expect(session.snapshots()[0]!.tick).toBe(tickBefore);
  });

  it("team loses when all players downed simultaneously", () => {
    const session = mkSession(2);
    session.debugSetDowned(0);
    session.debugSetDowned(1);
    session.step([frame(0, 0)]);
    expect(session.state().phase).toBe("lost");
  });

  it("one downed player does not lose the match", () => {
    const session = mkSession(2);
    session.debugSetDowned(0);
    session.step([frame(1, 0)]);
    expect(session.state().phase).toBe("playing");
  });
});

describe("assist session: team progression", () => {
  it("team advances when every live field clears; range end → win", () => {
    const session = mkSession(2, 1, 2); // rounds 1..2
    clearLevel(session, 0);
    clearLevel(session, 1);
    expect(session.state().round).toBe(2);
    expect(session.state().phase).toBe("playing");
    clearLevel(session, 0);
    clearLevel(session, 1);
    expect(session.state().phase).toBe("won");
  });

  it("early clearer spectates with full gift rights incl. life gift", () => {
    const session = mkSession(2, 1, 2);
    clearLevel(session, 0); // P0 clears first, waits for P1
    expect(session.snapshots()[0]!.phase).toBe("roundClear");
    // P0 (early clearer) can still life-gift a downed teammate.
    session.debugSetDowned(1);
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: assistActions(2) })]);
    expect(session.snapshots()[1]!.players[0]!.state).toBe("playing");
    expect(session.snapshots()[1]!.players[0]!.lives).toBe(1);
  });

  it("downed player revived mid-round rejoins the same level", () => {
    const session = mkSession(2, 1, 2);
    session.debugSetDowned(1);
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: assistActions(2) })]);
    // P1 revived on round 1's layout (same as P0's field).
    expect(session.snapshots()[1]!.round).toBe(session.snapshots()[0]!.round);
    expect(session.snapshots()[1]!.bricks).toEqual(session.snapshots()[0]!.bricks);
  });

  it("shared score sums across live fields", () => {
    const session = mkSession(2);
    const ref = { t: 0 };
    breakOneBrick(session, 0, ref);
    breakOneBrick(session, 1, ref);
    const s0 = session.snapshots()[0]!.players[0]!.score;
    const s1 = session.snapshots()[1]!.players[0]!.score;
    expect(s0).toBe(s1);
    expect(s0).toBeGreaterThan(0);
  });
});

describe("assist session: targeting", () => {
  it("cycle target walks teammates", () => {
    const session = mkSession(3);
    expect(session.snapshots()[0]!.players[0]!.target).toBe(-1);
    session.step([frame(0, 0, 0, { actions: { cycleForward: true, cycleBack: false, fire: [false, false, false, false] } })]);
    expect(session.snapshots()[0]!.players[0]!.target).toBe(1);
    session.step([frame(0, 1, 0, { actions: { cycleForward: true, cycleBack: false, fire: [false, false, false, false] } })]);
    expect(session.snapshots()[0]!.players[0]!.target).toBe(2);
    session.step([frame(0, 2, 0, { actions: { cycleForward: true, cycleBack: false, fire: [false, false, false, false] } })]);
    expect(session.snapshots()[0]!.players[0]!.target).toBe(1); // wraps
  });

  it("cycle back walks in reverse", () => {
    const session = mkSession(3);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: { cycleForward: false, cycleBack: true, fire: [false, false, false, false] } })]);
    expect(session.snapshots()[0]!.players[0]!.target).toBe(2);
  });
});
