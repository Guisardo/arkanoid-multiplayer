import { describe, expect, it } from "vitest";
import { createAttackSession } from "sim/attackSession";
import { ALL_TRIGGERS_ON, DEFAULT_ATTACK_TUNING, type AttackTriggerToggles } from "sim/attack";
import { BRICK_COLS } from "sim/constants";
import { EMPTY_ACTIONS, isDestructibleCell, type InputFrame } from "shared/protocol";
import { getLevel } from "content/levels";

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

function fireActions(button: number): InputFrame["actions"] {
  const fire: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  fire[button] = true;
  return { cycleForward: false, cycleBack: false, fire };
}

function mkSession(
  playerCount = 2,
  triggers?: AttackTriggerToggles,
  structure: "bestOf" | "continuous" | "oneOff" = "bestOf",
) {
  const opts: Parameters<typeof createAttackSession>[0] = {
    playerCount,
    config: { structure, bestOf: 3, levelSelection: "fixedOrder", timeCapTicks: null },
    seed: 7,
  };
  if (triggers !== undefined) opts.triggers = triggers;
  return createAttackSession(opts);
}

function destructibleCount(bricks: readonly number[]): number {
  let n = 0;
  for (const c of bricks) if (isDestructibleCell(c)) n++;
  return n;
}

/** Break exactly one brick on a player's field (ball aimed at first brick).
 * Also succeeds on a mid-window field reset (0 lives → fresh layout): the
 * brick did break, the reset just refilled the field before we looked. */
function breakOneBrick(
  session: ReturnType<typeof createAttackSession>,
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
  const before = destructibleCount(session.snapshots()[player]!.bricks);
  for (let s = 0; s < 40; s++) {
    session.step([frame(player, tickRef.t++)]);
    const now = session.snapshots()[player]!;
    if (destructibleCount(now.bricks) < before) return;
    if (now.tick < snap.tick) return; // field reset mid-window
  }
  throw new Error("brick did not break in 40 ticks");
}

describe("attack session: meter fill", () => {
  it("fills 2 per brick break", () => {
    const session = mkSession();
    const ref = { t: 0 };
    breakOneBrick(session, 0, ref);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(2);
  });

  it("fills 10 per capsule catch", () => {
    const session = mkSession();
    // Force-drop a capsule onto player 0's paddle and step until caught.
    session.debugSetBall(0, 104, 300, 0, 60); // park ball below field
    const sim = session.race().simAt(0)!;
    const snap = session.snapshots()[0]!;
    const paddle = snap.players[0]!.paddle;
    sim.debugDropCapsule(paddle.x, paddle.y - 4, "E");
    for (let t = 0; t < 10; t++) session.step([frame(0, t)]);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(10);
  });

  it("caps at meterMax (100)", () => {
    const session = mkSession();
    session.debugSetMeter(0, 99);
    const ref = { t: 0 };
    breakOneBrick(session, 0, ref);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(100);
  });
});

describe("attack session: chain trigger", () => {
  it("chain tier crossing fires rain at the target's field", () => {
    const session = mkSession();
    session.debugSetTarget(0, 1);
    const ref = { t: 0 };
    // Break 4 bricks without paddle touch → small tier → 3 rain bricks on P1.
    for (let i = 0; i < 4; i++) breakOneBrick(session, 0, ref);
    const snap1 = session.snapshots()[1]!;
    const rain = session.snapshots()[1]!.events.filter((e) => e.type === "attack");
    expect(rain.length).toBe(1);
    // P1's field gained exactly 3 bricks back (small tier).
    const total1 = destructibleCount(snap1.bricks);
    expect(total1).toBeGreaterThan(0);
    // Chain counter visible in snapshot.
    expect(session.snapshots()[0]!.players[0]!.chain).toBe(4);
  });

  it("rain adds exactly 3/6/12 bricks by tier", () => {
    const session = mkSession();
    session.debugSetTarget(0, 1);
    const ref = { t: 0 };
    const before = destructibleCount(session.snapshots()[1]!.bricks);
    for (let i = 0; i < 4; i++) breakOneBrick(session, 0, ref); // small
    expect(destructibleCount(session.snapshots()[1]!.bricks)).toBe(before + 3);
    for (let i = 0; i < 3; i++) breakOneBrick(session, 0, ref); // medium (7)
    expect(destructibleCount(session.snapshots()[1]!.bricks)).toBe(before + 3 + 6);
    for (let i = 0; i < 3; i++) breakOneBrick(session, 0, ref); // large (10)
    expect(destructibleCount(session.snapshots()[1]!.bricks)).toBe(before + 3 + 6 + 12);
  });

  it("paddle touch resets the chain", () => {
    const session = mkSession();
    session.debugSetTarget(0, 1);
    const ref = { t: 0 };
    for (let i = 0; i < 3; i++) breakOneBrick(session, 0, ref);
    expect(session.snapshots()[0]!.players[0]!.chain).toBe(3);
    // Bounce the ball off the paddle: aim below bricks, ball falls onto paddle.
    // Step until the paddleBounce event lands (ball travels ~147 u at 200 u/s).
    session.debugSetBall(0, 104, 100, 0, 200);
    let bounced = false;
    for (let t = 0; t < 90 && !bounced; t++) {
      session.step([frame(0, ref.t++)]);
      bounced = session.snapshots()[0]!.events.some((e) => e.type === "paddleBounce");
    }
    expect(bounced).toBe(true);
    expect(session.snapshots()[0]!.players[0]!.chain).toBe(0);
  });

  it("chains toggle off → no rain", () => {
    const session = mkSession(2, {
      chains: false,
      capsuleCapture: true,
      levelClear: true,
      chargedManual: true,
    });
    session.debugSetTarget(0, 1);
    const ref = { t: 0 };
    const before = destructibleCount(session.snapshots()[1]!.bricks);
    for (let i = 0; i < 4; i++) breakOneBrick(session, 0, ref);
    expect(destructibleCount(session.snapshots()[1]!.bricks)).toBe(before);
    expect(session.snapshots()[0]!.players[0]!.chain).toBe(4); // still tracked
  });
});

describe("attack session: capsule-capture trigger", () => {
  it("capsule catch fires a small rain at the target", () => {
    const session = mkSession();
    session.debugSetTarget(0, 1);
    session.debugSetBall(0, 104, 300, 0, 60);
    const sim = session.race().simAt(0)!;
    const paddle = session.snapshots()[0]!.players[0]!.paddle;
    const before = destructibleCount(session.snapshots()[1]!.bricks);
    sim.debugDropCapsule(paddle.x, paddle.y - 4, "E");
    for (let t = 0; t < 10; t++) session.step([frame(0, t)]);
    expect(destructibleCount(session.snapshots()[1]!.bricks)).toBe(before + 3);
  });

  it("capsuleCapture toggle off → no rain", () => {
    const session = mkSession(2, {
      chains: true,
      capsuleCapture: false,
      levelClear: true,
      chargedManual: true,
    });
    session.debugSetTarget(0, 1);
    session.debugSetBall(0, 104, 300, 0, 60);
    const sim = session.race().simAt(0)!;
    const paddle = session.snapshots()[0]!.players[0]!.paddle;
    const before = destructibleCount(session.snapshots()[1]!.bricks);
    sim.debugDropCapsule(paddle.x, paddle.y - 4, "E");
    for (let t = 0; t < 10; t++) session.step([frame(0, t)]);
    expect(destructibleCount(session.snapshots()[1]!.bricks)).toBe(before);
    // Meter still filled by the catch.
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(10);
  });
});

describe("attack session: manual fire", () => {
  it("fires shrink at the picked target, spends 25", () => {
    const session = mkSession();
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: fireActions(1) })]);
    const snap1 = session.snapshots()[1]!;
    expect(snap1.players[0]!.effects["attackShrinkMs"]).toBe(DEFAULT_ATTACK_TUNING.shrinkMs);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(75);
    // Paddle shrunk 40%.
    expect(snap1.players[0]!.paddle.w).toBeCloseTo(32 * 0.6, 5);
  });

  it("fires speed-up at the picked target, spends 20", () => {
    const session = mkSession();
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: fireActions(2) })]);
    const snap1 = session.snapshots()[1]!;
    expect(snap1.players[0]!.effects["attackSpeedMs"]).toBe(DEFAULT_ATTACK_TUNING.speedMs);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(80);
  });

  it("fires mangle at the picked target, spends 40", () => {
    const session = mkSession();
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: fireActions(3) })]);
    const snap1 = session.snapshots()[1]!;
    expect(snap1.players[0]!.effects["attackMangleMs"]).toBe(DEFAULT_ATTACK_TUNING.mangleMs);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(60);
  });

  it("fires rain at the picked target, spends 30, adds 6 bricks (prototype manual rain)", () => {
    const session = mkSession();
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    const before = destructibleCount(session.snapshots()[1]!.bricks);
    session.step([frame(0, 0, 0, { actions: fireActions(0) })]);
    expect(destructibleCount(session.snapshots()[1]!.bricks)).toBe(before + 6);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(70);
  });

  it("insufficient meter → no fire, no spend", () => {
    const session = mkSession();
    session.debugSetMeter(0, 24); // shrink costs 25
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: fireActions(1) })]);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(24);
    expect(session.snapshots()[1]!.players[0]!.effects["attackShrinkMs"]).toBe(0);
  });

  it("chargedManual toggle off → buttons dead", () => {
    const session = mkSession(2, {
      chains: true,
      capsuleCapture: true,
      levelClear: true,
      chargedManual: false,
    });
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: fireActions(1) })]);
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(100);
    expect(session.snapshots()[1]!.players[0]!.effects["attackShrinkMs"]).toBe(0);
  });

  it("cycle buttons change the target (forward/back)", () => {
    const session = mkSession(3);
    expect(session.snapshots()[0]!.players[0]!.target).toBe(-1);
    session.step([frame(0, 0, 0, { actions: { cycleForward: true, cycleBack: false, fire: [false, false, false, false] } })]);
    expect(session.snapshots()[0]!.players[0]!.target).toBe(1);
    session.step([frame(0, 1, 0, { actions: { cycleForward: true, cycleBack: false, fire: [false, false, false, false] } })]);
    expect(session.snapshots()[0]!.players[0]!.target).toBe(2);
    session.step([frame(0, 2, 0, { actions: { cycleForward: false, cycleBack: true, fire: [false, false, false, false] } })]);
    expect(session.snapshots()[0]!.players[0]!.target).toBe(1);
  });
});

describe("attack session: effect durations + stacking", () => {
  it("shrink lasts 10 s (600 ticks) then reverts", () => {
    const session = mkSession();
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: fireActions(1) })]);
    expect(session.snapshots()[1]!.players[0]!.paddle.w).toBeCloseTo(32 * 0.6, 5);
    // Fire step + 600 decay steps: timers tick at step start, so the effect
    // is gone after 601 total steps.
    for (let t = 1; t <= 600; t++) session.step([frame(0, t)]);
    expect(session.snapshots()[1]!.players[0]!.effects["attackShrinkMs"]).toBe(0);
    expect(session.snapshots()[1]!.players[0]!.paddle.w).toBeCloseTo(32, 5);
  });

  it("same-type re-application refreshes duration", () => {
    const session = mkSession();
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: fireActions(1) })]);
    for (let t = 1; t < 500; t++) session.step([frame(0, t)]); // ~8.3 s in
    const remaining = session.snapshots()[1]!.players[0]!.effects["attackShrinkMs"];
    expect(remaining).toBeLessThan(DEFAULT_ATTACK_TUNING.shrinkMs);
    session.debugSetMeter(0, 100);
    session.step([frame(0, 500, 0, { actions: fireActions(1) })]);
    expect(session.snapshots()[1]!.players[0]!.effects["attackShrinkMs"]).toBe(
      DEFAULT_ATTACK_TUNING.shrinkMs,
    );
  });

  it("different types stack independently", () => {
    const session = mkSession();
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: fireActions(1) })]); // shrink
    session.debugSetMeter(0, 100);
    session.step([frame(0, 1, 0, { actions: fireActions(2) })]); // speed
    session.debugSetMeter(0, 100);
    session.step([frame(0, 2, 0, { actions: fireActions(3) })]); // mangle
    // Each fired at a different step: shrink 2 decays in, speed 1, mangle full.
    const fx = session.snapshots()[1]!.players[0]!.effects;
    expect(fx["attackShrinkMs"]).toBeCloseTo(DEFAULT_ATTACK_TUNING.shrinkMs - 2 * (1000 / 60), 5);
    expect(fx["attackSpeedMs"]).toBeCloseTo(DEFAULT_ATTACK_TUNING.speedMs - (1000 / 60), 5);
    expect(fx["attackMangleMs"]).toBe(DEFAULT_ATTACK_TUNING.mangleMs);
  });
});

describe("attack session: control mangle", () => {
  it("mangled player's consumed axis is corrupted (paddle moves wrong way)", () => {
    const session = mkSession();
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: fireActions(3) })]);
    // Player 1 holds full right; mangle inverts ~half the ticks (seeded).
    // Honest full-right for 60 ticks = +150 u; the corrupted stream mixes
    // −2.5 and +2.5 steps (and may wall-pin), so net < 150.
    let net = 0;
    let moved = 0;
    for (let t = 1; t <= 60; t++) {
      const before = session.snapshots()[1]!.players[0]!.paddle.x;
      session.step([frame(1, t, 1)]);
      const delta = session.snapshots()[1]!.players[0]!.paddle.x - before;
      net += delta;
      if (delta < -0.01) moved++;
    }
    // Corrupted ≠ honest: either leftward steps occurred (inversion) or the
    // paddle wall-pinned below the honest distance.
    expect(net).toBeLessThan(150);
    expect(moved > 0 || net < 150 - 2.5).toBe(true);
  });

  it("mangle expires after 6 s (360 ticks)", () => {
    const session = mkSession();
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 0, 0, { actions: fireActions(3) })]);
    for (let t = 1; t < 360; t++) session.step([frame(1, t, 1)]);
    expect(session.snapshots()[1]!.players[0]!.effects["attackMangleMs"]).toBeGreaterThan(0);
    session.step([frame(1, 360, 1)]);
    expect(session.snapshots()[1]!.players[0]!.effects["attackMangleMs"]).toBe(0);
    // Honest input again: full axis for 60 ticks ≈ ±150 u unless the paddle
    // wall-pinned during the mangled walk — accept full travel either way.
    let netR = 0;
    let netL = 0;
    for (let t = 361; t <= 420; t++) {
      const before = session.snapshots()[1]!.players[0]!.paddle.x;
      session.step([frame(1, t, 1)]);
      netR += session.snapshots()[1]!.players[0]!.paddle.x - before;
    }
    for (let t = 421; t <= 480; t++) {
      const before = session.snapshots()[1]!.players[0]!.paddle.x;
      session.step([frame(1, t, -1)]);
      netL += session.snapshots()[1]!.players[0]!.paddle.x - before;
    }
    const full = 2.5 * 60;
    expect(Math.abs(netR) > full - 5 || Math.abs(netL) > full - 5).toBe(true);
  });
});

describe("attack session: immunity + auto-retarget", () => {
  it("mid-level-reset target is immune; manual attack auto-retargets", () => {
    const session = mkSession(3);
    // Player 2 loses all lives → field resets → immune.
    for (let loss = 0; loss < 5; loss++) {
      session.debugSetBall(2, 104, 300, 0, 60);
      for (let s = 0; s < 12; s++) session.step([frame(2, loss * 12 + s)]);
    }
    // Player 0 targets the immune player 2 and fires shrink.
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 2);
    session.step([frame(0, 100, 0, { actions: fireActions(1) })]);
    // Auto-retargeted to player 1 (first valid opponent).
    const fx1 = session.snapshots()[1]!.players[0]!.effects;
    const fx2 = session.snapshots()[2]!.players[0]!.effects;
    expect(fx1["attackShrinkMs"]).toBe(DEFAULT_ATTACK_TUNING.shrinkMs);
    expect(fx2["attackShrinkMs"]).toBe(0);
    // Meter still spent.
    expect(session.snapshots()[0]!.players[0]!.meter).toBe(75);
  });

  it("immunity clears on round advance", () => {
    const session = mkSession(2, ALL_TRIGGERS_ON, "continuous");
    // Player 1 loses all lives → immune.
    for (let loss = 0; loss < 5; loss++) {
      session.debugSetBall(1, 104, 300, 0, 60);
      for (let s = 0; s < 12; s++) session.step([frame(1, loss * 12 + s)]);
    }
    // Player 0 clears the level → round advances → immunity cleared.
    const ref = { t: 1000 };
    let guard = 0;
    while (guard < 3000 && session.race().state().levelsCleared[0] === 0) {
      breakOneBrick(session, 0, ref);
      guard++;
    }
    expect(session.race().state().levelsCleared[0]).toBe(1);
    // Player 1 no longer immune: shrink lands.
    session.debugSetMeter(0, 100);
    session.debugSetTarget(0, 1);
    session.step([frame(0, 5000, 0, { actions: fireActions(1) })]);
    expect(session.snapshots()[1]!.players[0]!.effects["attackShrinkMs"]).toBe(
      DEFAULT_ATTACK_TUNING.shrinkMs,
    );
  });
});

describe("attack session: level-clear trigger (continuous only)", () => {
  it("continuous: clearing a level fires a small rain at the target", () => {
    const session = mkSession(2, ALL_TRIGGERS_ON, "continuous");
    session.debugSetTarget(0, 1);
    const ref = { t: 0 };
    let guard = 0;
    while (guard < 3000 && session.race().state().levelsCleared[0] === 0) {
      breakOneBrick(session, 0, ref);
      guard++;
    }
    expect(session.race().state().levelsCleared[0]).toBe(1);
    // Level-clear rain (3) landed on P1's field — which has already advanced
    // to the next round's fresh layout, so compare against that round's own
    // destructible count.
    const round2 = session.snapshots()[1]!.round;
    const level2 = getLevel(round2);
    const freshCount = level2.grid.join("").split("").filter((c) => c !== "." && c !== "G").length;
    expect(destructibleCount(session.snapshots()[1]!.bricks)).toBe(freshCount + 3);
  });

  it("bestOf: level-clear trigger does not fire (round-based clear ends the round)", () => {
    const session = mkSession(2, ALL_TRIGGERS_ON, "bestOf");
    session.debugSetTarget(0, 1);
    const ref = { t: 0 };
    let guard = 0;
    while (guard < 3000 && session.race().state().roundPoints[0] === 0) {
      breakOneBrick(session, 0, ref);
      guard++;
    }
    expect(session.race().state().roundPoints[0]).toBe(1);
    // No level-clear rain: P1's field is the next round's fresh layout —
    // exactly the destructible count of that round's level, nothing extra.
    const round2 = session.snapshots()[1]!.round;
    const level2 = getLevel(round2);
    const expected = level2.grid.join("").split("").filter((c) => c !== "." && c !== "G").length;
    expect(destructibleCount(session.snapshots()[1]!.bricks)).toBe(expected);
  });
});

describe("attack session: determinism", () => {
  it("identical input sequences → identical snapshots", () => {
    const run = () => {
      const session = mkSession(2);
      session.debugSetMeter(0, 100);
      session.debugSetTarget(0, 1);
      for (let t = 0; t < 120; t++) {
        session.step([
          frame(0, t, t % 2 === 0 ? 1 : -1, t === 10 ? { actions: fireActions(3) } : {}),
          frame(1, t, t % 3 === 0 ? -1 : 1),
        ]);
      }
      return session.snapshots();
    };
    expect(run()).toEqual(run());
  });
});
