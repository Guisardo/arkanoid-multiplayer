import { describe, expect, it } from "vitest";
import { createSharedFieldSim, placementBEdges, SPEED_SCALE_PER_EXTRA_PLAYER } from "sim/sharedField";
import { getLevel } from "content/levels";
import { FIELD_W, PADDLE_Y, BRICK_COLS } from "sim/constants";
import { EMPTY_ACTIONS, isDestructibleCell, type InputFrame } from "shared/protocol";

function frame(player: number, tick: number, axisX = 0, axisY = 0, launch = false): InputFrame {
  return { player, tick, axisX, axisY, launch, actions: EMPTY_ACTIONS };
}

function sim(over: Partial<Parameters<typeof createSharedFieldSim>[1]> = {}) {
  return createSharedFieldSim(getLevel(1), {
    placement: "A",
    ballModel: "shared",
    playerCount: 2,
    ...over,
  });
}

describe("placement B edge assignment (spec §6.4)", () => {
  it("2P bottom+right; 3P +left; 4P +top", () => {
    expect(placementBEdges(2)).toEqual(["bottom", "right"]);
    expect(placementBEdges(3)).toEqual(["bottom", "right", "left"]);
    expect(placementBEdges(4)).toEqual(["bottom", "right", "left", "top"]);
  });
});

describe("shared pool (spec §6.4)", () => {
  it("pool = 3 × player count for 2/3/4P", () => {
    expect(sim({ playerCount: 2 }).getTeamState().lives).toBe(6);
    expect(sim({ playerCount: 3 }).getTeamState().lives).toBe(9);
    expect(sim({ playerCount: 4 }).getTeamState().lives).toBe(12);
  });

  it("life lost when ball count hits zero; multiball is a buffer", () => {
    const s = sim({ playerCount: 2 });
    // launch, then lose the ball → life lost
    s.step([frame(0, 0, 0, 0, true)]);
    s.debugSetBall(104, 300, 0, 60);
    for (let i = 0; i < 12; i++) s.step([frame(0, i)]);
    expect(s.getTeamState().lives).toBe(5);

    // multiball buffer: split to 3, lose ALL 3 → exactly ONE life lost
    s.step([frame(0, 100, 0, 0, true)]);
    const p0x = s.snapshot().players[0]!.paddle.x;
    s.debugDropCapsule(p0x, PADDLE_Y - 4, "M");
    for (let i = 0; i < 3; i++) s.step([frame(0, 110 + i)]);
    expect(s.snapshot().balls.length).toBe(3);
    const livesBefore = s.getTeamState().lives;
    // Balls fall out one by one (paddles parked at slice extremes) — no life
    // lost while any ball remains.
    let guard = 0;
    while (s.snapshot().balls.length > 1 && guard < 600) {
      s.step([frame(0, 200 + guard, -1), frame(1, 200 + guard, 1)]);
      guard++;
      expect(s.getTeamState().lives).toBe(livesBefore); // buffer holds
    }
    expect(s.snapshot().balls.length).toBe(1);
    // Force the last ball out → exactly ONE life lost for the whole set.
    s.debugSetBall(104, 300, 0, 60);
    for (let i = 0; i < 12; i++) s.step([frame(0, 900 + i)]);
    expect(s.getTeamState().lives).toBe(livesBefore - 1); // ONE life, not three
    expect(s.snapshot().phase).toBe("serve");
  });
});

describe("placement A (bottom edge, slices)", () => {
  it("each paddle confined to its slice", () => {
    const s = sim({ playerCount: 2, placement: "A" });
    for (let i = 0; i < 200; i++) s.step([frame(0, i, -1), frame(1, i, 1)]);
    const p0 = s.snapshot().players[0]!.paddle;
    const p1 = s.snapshot().players[1]!.paddle;
    // slice 0: [0, 104] → minX = 16 (paddle half-width)
    expect(p0.x).toBeCloseTo(16, 1);
    // slice 1: [104, 208] → maxX = 192
    expect(p1.x).toBeCloseTo(FIELD_W - 16, 1);
    expect(p0.x).toBeLessThanOrEqual(FIELD_W / 2);
    expect(p1.x).toBeGreaterThanOrEqual(FIELD_W / 2);
  });
});

describe("placement B (multiple edges)", () => {
  it("side paddles move vertically (axisY)", () => {
    const s = sim({ playerCount: 2, placement: "B" });
    const y0 = s.snapshot().players[1]!.paddle.y;
    for (let i = 0; i < 60; i++) s.step([frame(1, i, 0, 1)]);
    const y1 = s.snapshot().players[1]!.paddle.y;
    expect(y1).toBeGreaterThan(y0);
  });

  it("top paddle bounces the ball down", () => {
    const s = sim({ playerCount: 4, placement: "B" });
    s.debugSetBall(104, 30, 0, -110);
    for (let i = 0; i < 30; i++) s.step([frame(0, i)]);
    const b = s.snapshot().balls[0]!;
    expect(b.vy).toBeGreaterThan(0);
  });

  it("ball hits bricks from any direction (from below)", () => {
    const s = sim({ playerCount: 2, placement: "B" });
    const snap = s.snapshot();
    let target = -1;
    for (let i = 0; i < snap.bricks.length; i++) {
      if (isDestructibleCell(snap.bricks[i] ?? 0)) {
        target = i;
        break;
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    const col = target % BRICK_COLS;
    const row = Math.floor(target / BRICK_COLS);
    const before = snap.bricks.filter((c) => isDestructibleCell(c)).length;
    s.debugSetBall(col * 16 + 8 + 2, 20 + (row + 1) * 8 + 6, 0, -200);
    for (let i = 0; i < 20; i++) s.step([frame(0, i)]);
    const after = s.snapshot().bricks.filter((c) => isDestructibleCell(c)).length;
    expect(after).toBeLessThan(before);
  });

  it("non-paddle edges are walls; bottom always open", () => {
    const s = sim({ playerCount: 2, placement: "B" });
    s.debugSetBall(2, 100, -110, 0);
    for (let i = 0; i < 10; i++) s.step([frame(0, i)]);
    const b = s.snapshot().balls[0]!;
    expect(b.vx).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThanOrEqual(3);
  });
});

describe("placement C (shared paddle)", () => {
  it("summed inputs clamp to ±1", () => {
    const s = sim({ playerCount: 3, placement: "C" });
    const x0 = s.snapshot().players[0]!.paddle.x;
    s.step([frame(0, 0, 1), frame(1, 0, 1), frame(2, 0, -1)]); // net +1
    const x1 = s.snapshot().players[0]!.paddle.x;
    expect(x1 - x0).toBeCloseTo(2.5, 1);
    const x2before = s.snapshot().players[0]!.paddle.x;
    s.step([frame(0, 1, 1), frame(1, 1, -1)]); // net 0
    expect(s.snapshot().players[0]!.paddle.x).toBeCloseTo(x2before, 5);
  });

  it("any player launches the shared serve", () => {
    const s = sim({ playerCount: 2, placement: "C" });
    s.step([frame(1, 0, 0, 0, true)]);
    expect(s.snapshot().phase).toBe("play");
    expect(s.snapshot().balls[0]!.attachedTo).toBeNull();
  });
});

describe("ball models", () => {
  it("perPlayer: each player has a ball; lost ball respawns, others keep state", () => {
    const s = sim({ playerCount: 2, ballModel: "perPlayer" });
    expect(s.snapshot().balls).toHaveLength(2);
    // launch both
    s.step([frame(0, 0, 0, 0, true), frame(1, 0, 0, 0, true)]);
    s.debugSetBall(104, 300, 0, 60); // ball 0 below field
    let guard = 0;
    while (s.snapshot().balls.length > 1 && guard < 200) {
      s.step([frame(0, guard), frame(1, guard)]);
      guard++;
    }
    // ball 0 lost; ball 1 still in flight → no life lost, one ball remains
    expect(s.snapshot().balls.length).toBe(1);
    expect(s.getTeamState().lives).toBe(6);
  });

  it("multiball splits the capturing player's ball only (perPlayer)", () => {
    const s = sim({ playerCount: 2, ballModel: "perPlayer", placement: "A" });
    s.step([frame(0, 0, 0, 0, true), frame(1, 0, 0, 0, true)]);
    expect(s.snapshot().balls.filter((b) => b.attachedTo === null)).toHaveLength(2);
    const p0x = s.snapshot().players[0]!.paddle.x;
    s.debugDropCapsule(p0x, PADDLE_Y - 4, "M");
    for (let i = 0; i < 3; i++) s.step([frame(0, 10 + i), frame(1, 10 + i)]);
    expect(s.snapshot().balls).toHaveLength(4); // 0's split to 3 + 1's one
  });

  it("capsules affect the capturer's paddle only (placement A)", () => {
    const s = sim({ playerCount: 2, placement: "A" });
    const p0x = s.snapshot().players[0]!.paddle.x;
    s.debugDropCapsule(p0x, PADDLE_Y - 4, "E");
    s.step([frame(0, 0)]);
    expect(s.snapshot().players[0]!.paddle.w).toBeGreaterThan(32);
    expect(s.snapshot().players[1]!.paddle.w).toBe(32);
  });
});

describe("speed scaling (spec §6.4)", () => {
  it("A/B: +6.5% per player beyond 2; C exempt", () => {
    const bounceSpeed = (s: ReturnType<typeof sim>): number => {
      // drop the ball onto the bottom paddle's actual position
      const px = s.snapshot().players.find((p) => p.paddle.edge === "bottom")!.paddle.x;
      s.debugSetBall(px, PADDLE_Y - 10, 0, 110);
      for (let i = 0; i < 10; i++) s.step([frame(0, i)]);
      const b = s.snapshot().balls[0]!;
      return Math.hypot(b.vx, b.vy);
    };
    const base = 110;
    expect(bounceSpeed(sim({ playerCount: 2 }))).toBeCloseTo(base, 0);
    expect(bounceSpeed(sim({ playerCount: 3 }))).toBeCloseTo(base * SPEED_SCALE_PER_EXTRA_PLAYER, 0);
    expect(bounceSpeed(sim({ playerCount: 4 }))).toBeCloseTo(base * SPEED_SCALE_PER_EXTRA_PLAYER ** 2, 0);
    expect(bounceSpeed(sim({ playerCount: 4, placement: "C" }))).toBeCloseTo(base, 0);
  });
});

describe("pause (coop semantics)", () => {
  it("any player's pause request pauses all; any resumes", () => {
    const s = sim({ playerCount: 3 });
    s.requestPause(2);
    expect(s.isPaused()).toBe(true);
    const tickBefore = s.currentTick;
    s.step([frame(0, 0)]);
    expect(s.currentTick).toBe(tickBefore);
    s.requestResume(1);
    expect(s.isPaused()).toBe(false);
    s.step([frame(0, 1)]);
    expect(s.currentTick).toBe(tickBefore + 1);
  });
});

describe("determinism", () => {
  it("identical inputs → identical snapshots", () => {
    const run = () => {
      const s = sim({ playerCount: 2 });
      for (let t = 0; t < 100; t++) {
        s.step([frame(0, t, Math.sin(t / 10) > 0 ? 1 : -1), frame(1, t, Math.cos(t / 10) > 0 ? 1 : -1)]);
      }
      return s.snapshot();
    };
    expect(run()).toEqual(run());
  });
});
