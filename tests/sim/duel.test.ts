import { describe, expect, it } from "vitest";
import { createRoundDuel, assertDuelRound, DUEL_MAX_ROUND, type DuelOptions } from "sim/duel";
import { getLevel } from "content/levels";
import { FIELD_W, PADDLE_Y } from "sim/constants";
import { EMPTY_ACTIONS, isDestructibleCell, type InputFrame } from "shared/protocol";

function frame(player: number, tick: number, axisX = 0, launch = false): InputFrame {
  return { player, tick, axisX, axisY: 0, launch, actions: EMPTY_ACTIONS };
}

function duel(over: Partial<DuelOptions> = {}, round = 1) {
  return createRoundDuel(getLevel(round), {
    ballModel: "shared",
    timeCapTicks: null,
    ...over,
  });
}

describe("Duel round constraint (spec §4)", () => {
  it("rounds 1–32 OK; round 33 throws", () => {
    expect(DUEL_MAX_ROUND).toBe(32);
    expect(() => { assertDuelRound(32); }).not.toThrow();
    expect(() => { assertDuelRound(33); }).toThrow();
  });
});

describe("paddle separation (spec §5)", () => {
  it("paddles are solid: moving into each other blocks, never overlap", () => {
    const s = duel();
    // Player 0 pushes right toward player 1 (short push — no wall contact).
    for (let i = 0; i < 60; i++) s.step([frame(0, i, 1)]);
    const [p0, p1] = s.snapshot().players.map((p) => p.paddle);
    expect(p0!.x + p0!.w / 2).toBeLessThanOrEqual(p1!.x - p1!.w / 2 + 1e-6);
    expect(p0!.x).toBeGreaterThan(FIELD_W / 4); // moved from start
  });

  it("wall-constrained separation: leftover shift pushes the other, ends flush", () => {
    const s = duel();
    // Player 0 pushes right hard: p0 flush against p1, then p1 pushed to
    // the right wall, both end flush.
    for (let i = 0; i < 600; i++) s.step([frame(0, i, 1)]);
    const [p0, p1] = s.snapshot().players.map((p) => p.paddle);
    // p1 at right wall; p0 flush against p1.
    expect(p1!.x).toBeCloseTo(FIELD_W - p1!.w / 2, 1);
    expect(p0!.x + p0!.w / 2).toBeCloseTo(p1!.x - p1!.w / 2, 1);
  });

  it("leftover shift works both directions (right pushes left to left wall)", () => {
    const s = duel();
    for (let i = 0; i < 600; i++) s.step([frame(1, i, -1)]);
    const [p0, p1] = s.snapshot().players.map((p) => p.paddle);
    expect(p0!.x).toBeCloseTo(p0!.w / 2, 1); // left wall
    expect(p1!.x - p1!.w / 2).toBeCloseTo(p0!.x + p0!.w / 2, 1); // flush
  });
});

describe("ball models (spec §6.3)", () => {
  it("shared: any paddle touch steals ownership", () => {
    const s = duel({ ballModel: "shared" });
    s.step([frame(0, 0, 0, true)]); // player 0 serves
    // Ball falls toward player 1's side; player 1 touches it.
    s.debugSetBall(156, PADDLE_Y - 20, 0, 110);
    for (let i = 0; i < 10; i++) s.step([frame(0, 100 + i), frame(1, 100 + i)]);
    const b = s.snapshot().balls[0]!;
    expect(b.owner).toBe(1); // stolen
  });

  it("owned: deflect-only, no ownership transfer", () => {
    const s = duel({ ballModel: "owned" });
    s.step([frame(0, 0, 0, true)]);
    s.debugSetBall(156, PADDLE_Y - 20, 0, 110);
    for (let i = 0; i < 10; i++) s.step([frame(0, 100 + i), frame(1, 100 + i)]);
    const b = s.snapshot().balls[0]!;
    expect(b.owner).toBe(0); // unchanged
  });
});

describe("scoring (spec §6.3)", () => {
  it("ball drop pays the opponent +500", () => {
    const s = duel();
    s.step([frame(0, 0, 0, true)]); // player 0 serves (owner 0)
    s.debugSetBall(104, 300, 0, 60); // falls out on player 0's watch
    for (let i = 0; i < 12; i++) s.step([frame(0, i)]);
    const snap = s.snapshot();
    expect(snap.players[1]!.score).toBe(500);
    expect(snap.players[0]!.score).toBe(0);
    expect(snap.phase).toBe("serve");
    expect(snap.balls[0]!.attachedTo).toBe(0); // dropper re-serves
  });

  it("brick points attributed to ball owner", () => {
    const s = duel();
    s.step([frame(0, 0, 0, true)]); // owner 0
    const snap = s.snapshot();
    let target = -1;
    for (let i = 0; i < snap.bricks.length; i++) {
      if (isDestructibleCell(snap.bricks[i] ?? 0)) {
        target = i;
        break;
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    const col = target % 13;
    const row = Math.floor(target / 13);
    s.debugSetBall(col * 16 + 8 + 2, 20 + (row + 1) * 8 + 6, 0, -200);
    for (let i = 0; i < 20; i++) s.step([frame(0, 100 + i)]);
    const after = s.snapshot();
    expect(after.players[0]!.score).toBeGreaterThan(0);
    expect(after.players[1]!.score).toBe(0);
  });

  it("field clear ends the round; winner = most points", () => {
    const s = duel();
    // Player 1 gets a drop bonus first (player 0 drops).
    s.step([frame(0, 0, 0, true)]);
    s.debugSetBall(104, 300, 0, 60);
    for (let i = 0; i < 12; i++) s.step([frame(0, i)]);
    expect(s.snapshot().players[1]!.score).toBe(500);
    // Player 0 clears the field via debug placements (owner 0 bricks).
    let guard = 0;
    while (guard < 3000 && s.getMatchResult() === null) {
      const snap = s.snapshot();
      let target = -1;
      for (let i = 0; i < snap.bricks.length; i++) {
        if (isDestructibleCell(snap.bricks[i] ?? 0)) {
          target = i;
          break;
        }
      }
      if (target < 0) break;
      const col = target % 13;
      const row = Math.floor(target / 13);
      s.debugSetBall(col * 16 + 8 + 2, 20 + (row + 1) * 8 + 6, 0, -200);
      for (let st = 0; st < 20; st++) {
        s.step([frame(0, guard * 20 + st)]);
        guard++;
        if (s.getMatchResult() !== null) break;
      }
    }
    const result = s.getMatchResult();
    expect(result).not.toBeNull();
    // Player 0 broke all bricks (3300+ points) vs player 1's 500 drop bonus.
    expect(result!.winner).toBe(0);
    expect(result!.scores[0]).toBeGreaterThan(result!.scores[1]);
  });

  it("timeout: most points wins; exact tie → draw", () => {
    const s = duel({ timeCapTicks: 50 });
    for (let t = 0; t < 55; t++) s.step([frame(0, t), frame(1, t)]);
    const result = s.getMatchResult();
    expect(result).not.toBeNull();
    expect(result!.winner).toBe(-1); // 0-0 tie → draw
    expect(result!.scores).toEqual([0, 0]);
  });

  it("timeout with score difference: leader wins", () => {
    const s = duel({ timeCapTicks: 50 });
    s.step([frame(0, 0, 0, true)]);
    s.debugSetBall(104, 300, 0, 60);
    for (let i = 0; i < 12; i++) s.step([frame(0, i)]); // player 1 +500
    for (let t = 0; t < 55; t++) s.step([frame(0, 100 + t), frame(1, 100 + t)]);
    const result = s.getMatchResult();
    expect(result!.winner).toBe(1);
  });

  it("timeCapTicks null = infinite (no timeout at large tick)", () => {
    const s = duel({ timeCapTicks: null });
    for (let t = 0; t < 5000; t++) s.step([frame(0, t), frame(1, t)]);
    expect(s.getMatchResult()).toBeNull();
  });
});

describe("capsules in duel", () => {
  it("catch affects only the catching player's paddle", () => {
    const s = duel();
    const p0x = s.snapshot().players[0]!.paddle.x;
    s.debugDropCapsule(p0x, PADDLE_Y - 4, "E");
    s.step([frame(0, 0)]);
    expect(s.snapshot().players[0]!.paddle.w).toBeGreaterThan(32);
    expect(s.snapshot().players[1]!.paddle.w).toBe(32);
  });

  it("multiball: per-ball last-toucher; only last ball re-attaches on drop", () => {
    const s = duel();
    s.step([frame(0, 0, 0, true)]); // owner 0
    const p0x = s.snapshot().players[0]!.paddle.x;
    s.debugDropCapsule(p0x, PADDLE_Y - 4, "M");
    for (let i = 0; i < 3; i++) s.step([frame(0, 10 + i)]);
    expect(s.snapshot().balls.length).toBe(3);
    // All 3 fall out: each pays opponent +500 (owner 0), last re-attaches.
    let guard = 0;
    while (s.snapshot().phase !== "serve" && guard < 600) {
      s.step([frame(0, 100 + guard, -1), frame(1, 100 + guard, 1)]);
      guard++;
    }
    expect(s.snapshot().phase).toBe("serve");
    expect(s.snapshot().balls).toHaveLength(1);
    expect(s.snapshot().balls[0]!.attachedTo).toBe(0);
    expect(s.snapshot().players[1]!.score).toBe(1500); // 3 drops × 500
  });
});

describe("determinism", () => {
  it("identical input sequences → identical snapshots", () => {
    const run = () => {
      const s = duel();
      for (let t = 0; t < 200; t++) {
        s.step([
          frame(0, t, Math.sin(t / 8) > 0 ? 1 : -1),
          frame(1, t, Math.cos(t / 8) > 0 ? 1 : -1, t === 30),
        ]);
      }
      return s.snapshot();
    };
    expect(run()).toEqual(run());
  });
});
