// Laser in Duel (ticket #146, spec #140): the catcher's Paddle arms, Bolts go
// up through the other Paddle, and Bolt credit goes to the shooter. Everything
// here goes through the public sim seam (step + snapshot + debugDropCapsule).
import { describe, expect, it } from "vitest";
import { createRoundDuel, type DuelOptions, type DuelSim } from "sim/duel";
import type { LevelData } from "content/levelFormat";
import { BRICK_COLS, FIELD_H, PADDLE_W, PADDLE_Y } from "sim/constants";
import { EMPTY_ACTIONS, isArmedPlayer, type InputFrame, type Snapshot } from "shared/protocol";
import { gridLevel } from "./laserFixtures";

// Paddle 0 starts at x 52 (Bolts at 38/col 2, 66/col 4); Paddle 1 at x 156
// (Bolts at 142/col 8, 170/col 10). The served ball climbs col 3.
const ROW = 2;
/** A Brick far from every Bolt column, so the round never clears on its own. */
const SPARE = "............A";

interface FrameOpts {
  axisX?: number;
  launch?: boolean;
  held?: boolean;
}

type Inputs = Partial<Record<0 | 1, FrameOpts>>;

function frame(sim: DuelSim, player: number, o: FrameOpts = {}): InputFrame {
  return {
    player,
    tick: sim.currentTick,
    axisX: o.axisX ?? 0,
    axisY: 0,
    launch: o.launch ?? false,
    primaryHeld: o.held ?? false,
    actions: EMPTY_ACTIONS,
  };
}

function step(sim: DuelSim, inputs: Inputs = {}, n = 1): void {
  for (let i = 0; i < n; i++) sim.step([frame(sim, 0, inputs[0]), frame(sim, 1, inputs[1])]);
}

/** Step once and return the events pushed on that tick. */
function stepEvents(sim: DuelSim, inputs: Inputs = {}): Snapshot["events"] {
  const t = sim.currentTick;
  step(sim, inputs);
  return sim.snapshot().events.filter((e) => e.tick === t);
}

function duel(lvl: LevelData, over: Partial<DuelOptions> = {}): DuelSim {
  return createRoundDuel(lvl, { ballModel: "shared", timeCapTicks: null, ...over });
}

function player(sim: DuelSim, i: 0 | 1) {
  const p = sim.snapshot().players[i];
  if (p === undefined) throw new Error(`no player ${String(i)}`);
  return p;
}

/** Drop an L onto a Paddle; it is caught on the next step. */
function arm(sim: DuelSim, i: 0 | 1): void {
  sim.debugDropCapsule(player(sim, i).paddle.x, PADDLE_Y, "L");
  step(sim);
}

/** Player 1 slides left until flush against Paddle 0 (x 84) without pushing it. */
function slideFlush(sim: DuelSim): void {
  step(sim, { 1: { axisX: -1 } }, 28); // 156 → 86
  step(sim, { 1: { axisX: -0.8 } }); // the last 2 units
}

/** Player 0 serves, the ball is parked out of the way, then `who` arm. */
function armedInPlay(lvl: LevelData, who: (0 | 1)[], over: Partial<DuelOptions> = {}): DuelSim {
  const sim = duel(lvl, over);
  step(sim, { 0: { launch: true } });
  sim.debugSetBall(8, 200, 0, 0);
  for (const i of who) arm(sim, i);
  return sim;
}

function cell(sim: DuelSim, row: number, col: number): number {
  return sim.snapshot().bricks[row * BRICK_COLS + col] ?? -1;
}

describe("Duel Laser: arm and fire", () => {
  it("only the catcher arms; held primary fires from its Paddle ends", () => {
    const sim = armedInPlay(gridLevel({ 0: SPARE, [ROW]: "..A.A........" }), [0]);
    expect(isArmedPlayer(player(sim, 0))).toBe(true);
    expect(player(sim, 0).effects.L).toBe(1);
    expect(player(sim, 0).laserReady).toBe(true);
    expect(isArmedPlayer(player(sim, 1))).toBe(false);
    expect(player(sim, 1).laserReady).toBeUndefined();

    const evs = stepEvents(sim, { 0: { held: true }, 1: { held: true } });
    expect(evs.filter((e) => e.type === "laserFire").map((e) => e.source)).toEqual([0]);
    const bolts = sim.snapshot().bolts ?? [];
    expect(bolts.map((b) => b.owner)).toEqual([0, 0]);
    expect(bolts.map((b) => b.x)).toEqual([52 - (PADDLE_W / 2 - 2), 52 + (PADDLE_W / 2 - 2)]);
    expect(player(sim, 0).laserReady).toBe(false);

    step(sim, {}, 60);
    expect(cell(sim, ROW, 2)).toBe(0);
    expect(cell(sim, ROW, 4)).toBe(0);
    expect(sim.snapshot().bolts).toHaveLength(0);
  });

  it("credits the shooter, not the ball owner", () => {
    // Player 0 served (owns the ball); player 1 shoots.
    const sim = armedInPlay(gridLevel({ 0: SPARE, [ROW]: "........A.A.." }), [1]);
    expect(sim.snapshot().balls[0]?.owner).toBe(0);
    const before = sim.snapshot().players.map((p) => p.score);
    step(sim, { 1: { held: true } });
    const seen: Snapshot["events"] = [];
    for (let i = 0; i < 60; i++) seen.push(...stepEvents(sim));
    const after = sim.snapshot().players.map((p) => p.score);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe((before[1] ?? 0) + 50 + 50);
    const breaks = seen.filter((e) => e.type === "brickBreak");
    expect(breaks.map((e) => e.source)).toEqual([1, 1]);
    // boltHit immediately precedes each Brick result.
    for (const b of breaks) {
      const i = seen.indexOf(b);
      expect(seen[i - 1]?.type).toBe("boltHit");
      expect(seen[i - 1]?.target).toBe(b.target);
    }
  });

  it("Bolts pass through the other Paddle when the Paddles are flush", () => {
    const sim = armedInPlay(gridLevel({ 0: SPARE, [ROW]: "....A.A......" }), [1]);
    slideFlush(sim);
    expect(player(sim, 0).paddle.x).toBeCloseTo(52, 3);
    expect(player(sim, 1).paddle.x).toBeCloseTo(84, 3);
    step(sim, { 1: { held: true } });
    step(sim, {}, 60);
    // Left Bolt at 70 (col 4) climbs right past Paddle 0's edge.
    expect(cell(sim, ROW, 4)).toBe(0);
    expect(cell(sim, ROW, 6)).toBe(0);
  });

  it("same-tick contention for one Brick goes to Paddle 0", () => {
    // Flush at 52/84: Paddle 0's right Bolt (66) and Paddle 1's left (70) share col 4.
    const sim = armedInPlay(gridLevel({ 0: SPARE, [ROW]: "....A........" }), [0, 1]);
    slideFlush(sim);
    step(sim, { 0: { held: true }, 1: { held: true } });
    const seen: Snapshot["events"] = [];
    for (let i = 0; i < 60; i++) seen.push(...stepEvents(sim));
    const target = ROW * BRICK_COLS + 4;
    const onTarget = seen.filter((e) => e.target === target);
    expect(onTarget.map((e) => [e.type, e.source])).toEqual([
      ["boltHit", 0],
      ["brickBreak", 0],
    ]);
  });

  it("launch beats fire, and serve never fires", () => {
    const sim = duel(gridLevel({ 0: SPARE }));
    arm(sim, 0); // caught in serve, ball still stuck to Paddle 0
    expect(isArmedPlayer(player(sim, 0))).toBe(true);
    expect(stepEvents(sim, { 0: { held: true } }).some((e) => e.type === "laserFire")).toBe(false);
    const launchTick = stepEvents(sim, { 0: { held: true, launch: true } });
    expect(launchTick.some((e) => e.type === "ballLaunch")).toBe(true);
    expect(launchTick.some((e) => e.type === "laserFire")).toBe(false);
    expect(stepEvents(sim, { 0: { held: true } }).some((e) => e.type === "laserFire")).toBe(true);
  });
});

describe("Duel Laser: lifetime", () => {
  it("a ball drop (the re-serve) disarms both Paddles and drops every Bolt", () => {
    const sim = armedInPlay(gridLevel({ 0: SPARE }), [0, 1]);
    step(sim, { 0: { held: true }, 1: { held: true } });
    expect(sim.snapshot().bolts).toHaveLength(4);
    sim.debugSetBall(52, FIELD_H + 20, 0, 60);
    step(sim);
    const snap = sim.snapshot();
    expect(snap.phase).toBe("serve");
    expect(snap.players.map(isArmedPlayer)).toEqual([false, false]);
    expect(snap.bolts).toHaveLength(0);
  });

  it("losing a non-last multiball ball is no re-serve: the Laser stays", () => {
    const sim = armedInPlay(gridLevel({ 0: SPARE }), [0]);
    sim.debugDropCapsule(player(sim, 0).paddle.x, PADDLE_Y, "M");
    step(sim);
    const balls = sim.snapshot().balls.length;
    expect(balls).toBeGreaterThan(1);
    sim.debugSetBall(104, FIELD_H + 20, 0, 60);
    step(sim);
    const snap = sim.snapshot();
    expect(snap.balls).toHaveLength(balls - 1);
    expect(snap.phase).toBe("play");
    expect(isArmedPlayer(player(sim, 0))).toBe(true);
  });

  it("round end by timeout disarms both Paddles and drops the Bolts", () => {
    const sim = armedInPlay(gridLevel({ 0: SPARE }), [0, 1], { timeCapTicks: 10 });
    step(sim, { 0: { held: true }, 1: { held: true } }, 10);
    const snap = sim.snapshot();
    expect(snap.phase).toBe("roundClear");
    expect(snap.players.map(isArmedPlayer)).toEqual([false, false]);
    expect(snap.bolts).toHaveLength(0);
  });

  it("a Bolt clearing the last Brick ends the round for both Paddles", () => {
    const sim = armedInPlay(gridLevel({ [ROW]: "..A.........." }), [0, 1]);
    step(sim, { 0: { held: true }, 1: { held: true } });
    step(sim, {}, 60);
    const snap = sim.snapshot();
    expect(snap.phase).toBe("roundClear");
    expect(sim.getMatchResult()?.winner).toBe(0);
    expect(snap.players.map(isArmedPlayer)).toEqual([false, false]);
    expect(snap.bolts).toHaveLength(0);
  });
});

describe("Duel Laser: paddle slot", () => {
  function catchCapsule(sim: DuelSim, i: 0 | 1, type: "E" | "C" | "L" | "R"): void {
    sim.debugDropCapsule(player(sim, i).paddle.x, PADDLE_Y, type);
    step(sim);
  }

  it("E, C and L evict each other; R stacks with L", () => {
    const sim = armedInPlay(gridLevel({ 0: SPARE }), []);
    catchCapsule(sim, 0, "E");
    expect(player(sim, 0).paddle.w).toBeCloseTo(PADDLE_W * 1.5, 5);
    catchCapsule(sim, 0, "L");
    expect(isArmedPlayer(player(sim, 0))).toBe(true);
    expect(player(sim, 0).paddle.w).toBeCloseTo(PADDLE_W, 5);
    catchCapsule(sim, 0, "R");
    expect(isArmedPlayer(player(sim, 0))).toBe(true);
    expect(player(sim, 0).paddle.w).toBeCloseTo(PADDLE_W * 0.65, 5);
    catchCapsule(sim, 0, "C");
    expect(isArmedPlayer(player(sim, 0))).toBe(false);
    catchCapsule(sim, 0, "E");
    expect(player(sim, 0).paddle.w).toBeCloseTo(PADDLE_W * 1.5 * 0.65, 5);
  });

  it("a second L refreshes the cooldown and still pays the catch bonus", () => {
    const sim = armedInPlay(gridLevel({ 0: SPARE }), [0]);
    step(sim, { 0: { held: true } });
    expect(player(sim, 0).laserReady).toBe(false);
    const before = player(sim, 0).score;
    catchCapsule(sim, 0, "L");
    expect(player(sim, 0).laserReady).toBe(true);
    expect(player(sim, 0).score).toBe(before + 100);
  });
});

describe("Duel Laser: determinism", () => {
  it("identical held-fire inputs produce identical snapshots", () => {
    function run(): Snapshot[] {
      const sim = duel(gridLevel({ 0: "AAAAAAAAAAAAA", 1: "SSSSGSSSSSSSS", 3: "BBBBBBBBBBBBB" }));
      const out: Snapshot[] = [];
      for (let t = 0; t < 600; t++) {
        if (t === 10) sim.debugDropCapsule(player(sim, 0).paddle.x, PADDLE_Y, "L");
        if (t === 12) sim.debugDropCapsule(player(sim, 1).paddle.x, PADDLE_Y, "L");
        step(sim, {
          0: { axisX: Math.sin(t / 25) > 0 ? 1 : -1, launch: t === 5, held: t % 50 < 30 },
          1: { axisX: Math.cos(t / 30) > 0 ? 1 : -1, held: t % 40 < 10 },
        });
        if (t % 60 === 0) out.push(sim.snapshot());
      }
      out.push(sim.snapshot());
      return out;
    }
    const a = run();
    expect(a.some((s) => (s.bolts?.length ?? 0) > 0)).toBe(true);
    expect(a).toEqual(run());
  });
});
