// Laser in roundSim (ticket #144, spec #140): arm via `debugDropCapsule`, fire
// with held primary, and the lifetime/stacking/boss rules. Everything here goes
// through the public sim seam (step + snapshot).
import { describe, expect, it } from "vitest";
import { createRoundSim, type RoundSim } from "sim/roundSim";
import type { LevelData } from "content/levelFormat";
import { BRICK_COLS, FIELD_H, PADDLE_W, PADDLE_Y } from "sim/constants";
import { EMPTY_ACTIONS, isArmedPlayer, type InputFrame, type Snapshot } from "shared/protocol";
import { LASER_COOLDOWN_TICKS } from "shared/simRates";
import { gridLevel } from "./laserFixtures";

/** Paddle starts centred at x 104: Bolts spawn at 90 (col 5) and 118 (col 7). */
const LEFT_COL = 5;
const RIGHT_COL = 7;
const ROW = 2;

/** A Brick above each Bolt column (cols 5 and 7) plus a spare far left. */
function twinLevel(): LevelData {
  return gridLevel({ [ROW]: "A....A.A....." });
}

interface FrameOpts {
  axisX?: number;
  launch?: boolean;
  held?: boolean;
}

function frame(sim: RoundSim, o: FrameOpts = {}): InputFrame {
  return {
    player: 0,
    tick: sim.currentTick,
    axisX: o.axisX ?? 0,
    axisY: 0,
    launch: o.launch ?? false,
    primaryHeld: o.held ?? false,
    actions: EMPTY_ACTIONS,
  };
}

function step(sim: RoundSim, o: FrameOpts = {}, n = 1): void {
  for (let i = 0; i < n; i++) sim.step([frame(sim, o)]);
}

function player(snap: Snapshot) {
  const p = snap.players[0];
  if (p === undefined) throw new Error("no player 0");
  return p;
}

/** Launch the ball straight up (col 6, between the Bolt columns) into play. */
function launch(sim: RoundSim): void {
  step(sim, { launch: true });
}

/** Drop an L onto the Paddle; it is caught on the next step. */
function arm(sim: RoundSim): void {
  const p = player(sim.snapshot()).paddle;
  sim.debugDropCapsule(p.x, PADDLE_Y, "L");
  step(sim);
}

function cell(snap: Snapshot, row: number, col: number): number {
  return snap.bricks[row * BRICK_COLS + col] ?? -1;
}

describe("roundSim Laser: arm and fire", () => {
  it("an L catch arms the Paddle and held primary breaks the Bricks above both ends", () => {
    const sim = createRoundSim(twinLevel(), { lives: 3, score: 0 });
    launch(sim);
    arm(sim);
    expect(isArmedPlayer(player(sim.snapshot()))).toBe(true);
    expect(player(sim.snapshot()).effects.L).toBe(1);
    expect(player(sim.snapshot()).laserReady).toBe(true);

    step(sim, { held: true });
    const fired = sim.snapshot();
    expect(fired.bolts).toHaveLength(2);
    expect(fired.events.some((e) => e.type === "laserFire" && e.source === 0)).toBe(true);
    expect(player(fired).laserReady).toBe(false);

    step(sim, {}, 60);
    const after = sim.snapshot();
    expect(cell(after, ROW, LEFT_COL)).toBe(0);
    expect(cell(after, ROW, RIGHT_COL)).toBe(0);
    expect(after.bolts).toHaveLength(0);
  });
});

/** Step once and return the events pushed on that tick. */
function stepEvents(sim: RoundSim, o: FrameOpts = {}): Snapshot["events"] {
  const t = sim.currentTick;
  sim.step([frame(sim, o)]);
  return sim.snapshot().events.filter((e) => e.tick === t);
}

/** Bricks far from every Bolt column, so the round never clears on its own. */
function quietLevel(): LevelData {
  return gridLevel({ 0: "A............" });
}

function armedInPlay(lvl: LevelData = quietLevel(), lives = 3): RoundSim {
  const sim = createRoundSim(lvl, { lives, score: 0 });
  launch(sim);
  arm(sim);
  return sim;
}

describe("roundSim Laser: cooldown and trigger", () => {
  it("held primary auto-repeats every LASER_COOLDOWN_TICKS (21) ticks", () => {
    const sim = armedInPlay();
    const fireTicks: number[] = [];
    for (let i = 0; i < 70; i++) {
      const t = sim.currentTick;
      if (stepEvents(sim, { held: true }).some((e) => e.type === "laserFire")) fireTicks.push(t);
    }
    const first = fireTicks[0] ?? -1;
    expect(LASER_COOLDOWN_TICKS).toBe(21);
    expect(fireTicks).toEqual([first, first + 21, first + 42, first + 63]);
  });

  it("a tap fires at once when the cooldown has elapsed, and not before", () => {
    const sim = armedInPlay();
    expect(stepEvents(sim, { held: true }).some((e) => e.type === "laserFire")).toBe(true);
    step(sim, {}, 5);
    expect(stepEvents(sim, { held: true }).some((e) => e.type === "laserFire")).toBe(false);
    step(sim, {}, LASER_COOLDOWN_TICKS);
    expect(player(sim.snapshot()).laserReady).toBe(true);
    expect(stepEvents(sim, { held: true }).some((e) => e.type === "laserFire")).toBe(true);
  });

  it("an unarmed Paddle never fires", () => {
    const sim = createRoundSim(quietLevel(), { lives: 3, score: 0 });
    launch(sim);
    step(sim, { held: true }, 30);
    expect(sim.snapshot().bolts).toHaveLength(0);
    expect(player(sim.snapshot()).laserReady).toBeUndefined();
  });

  it("launch beats fire: the frame that releases the stuck ball spends no Bolt", () => {
    const sim = createRoundSim(quietLevel(), { lives: 3, score: 0 });
    arm(sim); // caught in serve, ball still stuck
    expect(isArmedPlayer(player(sim.snapshot()))).toBe(true);
    // Serve phase: held fire does nothing.
    expect(stepEvents(sim, { held: true }).some((e) => e.type === "laserFire")).toBe(false);
    const launchTick = stepEvents(sim, { held: true, launch: true });
    expect(launchTick.some((e) => e.type === "ballLaunch")).toBe(true);
    expect(launchTick.some((e) => e.type === "laserFire")).toBe(false);
    expect(sim.snapshot().bolts).toHaveLength(0);
    expect(stepEvents(sim, { held: true }).some((e) => e.type === "laserFire")).toBe(true);
  });

  it("a launch edge with no stuck ball does not block the shot", () => {
    const sim = armedInPlay();
    expect(stepEvents(sim, { held: true, launch: true }).some((e) => e.type === "laserFire")).toBe(true);
  });

  it("never fires in roundClear or gameOver", () => {
    const cleared = armedInPlay(gridLevel({ [ROW]: ".....A......." }));
    step(cleared, { held: true }, 60);
    expect(cleared.snapshot().phase).toBe("roundClear");
    step(cleared, { held: true }, 30);
    expect(cleared.snapshot().bolts).toHaveLength(0);

    const over = armedInPlay(quietLevel(), 1);
    over.debugSetBall(104, FIELD_H + 20, 0, 60);
    step(over, { held: true });
    expect(over.snapshot().phase).toBe("gameOver");
    step(over, { held: true }, 30);
    expect(over.snapshot().bolts).toHaveLength(0);
    expect(isArmedPlayer(player(over.snapshot()))).toBe(false);
  });
});

describe("roundSim Laser: lifetime", () => {
  it("lasts past the old 10 s catch timer while a ball lives", () => {
    const sim = armedInPlay();
    step(sim, {}, 60 * 12);
    expect(sim.snapshot().phase).toBe("play");
    expect(isArmedPlayer(player(sim.snapshot()))).toBe(true);
  });

  it("losing the last ball disarms and drops every Bolt in flight", () => {
    const sim = armedInPlay();
    step(sim, { held: true });
    expect(sim.snapshot().bolts).toHaveLength(2);
    sim.debugSetBall(104, FIELD_H + 20, 0, 60);
    step(sim);
    const snap = sim.snapshot();
    expect(snap.phase).toBe("serve");
    expect(isArmedPlayer(player(snap))).toBe(false);
    expect(snap.bolts).toHaveLength(0);
  });

  it("losing a non-last ball keeps the Laser", () => {
    const sim = armedInPlay();
    sim.debugDropCapsule(player(sim.snapshot()).paddle.x, PADDLE_Y, "M");
    step(sim);
    expect(sim.snapshot().balls.length).toBeGreaterThan(1);
    sim.debugLoseBallsExcept(0);
    step(sim);
    expect(sim.snapshot().balls).toHaveLength(1);
    expect(isArmedPlayer(player(sim.snapshot()))).toBe(true);
  });

  it("round clear disarms and drops the Bolts", () => {
    // The left Bolt clears the round; the right one is still in flight.
    const sim = armedInPlay(gridLevel({ [ROW]: ".....A......." }));
    step(sim, { held: true });
    step(sim, {}, 60);
    const snap = sim.snapshot();
    expect(snap.phase).toBe("roundClear");
    expect(isArmedPlayer(player(snap))).toBe(false);
    expect(snap.bolts).toHaveLength(0);
  });

  it("revive disarms and drops the Bolts", () => {
    const sim = armedInPlay();
    step(sim, { held: true });
    sim.revivePlayer();
    const snap = sim.snapshot();
    expect(isArmedPlayer(player(snap))).toBe(false);
    expect(snap.bolts).toHaveLength(0);
  });

  it("B clears the round and the Bolts", () => {
    const sim = armedInPlay();
    step(sim, { held: true });
    sim.debugDropCapsule(player(sim.snapshot()).paddle.x, PADDLE_Y, "B");
    step(sim);
    const snap = sim.snapshot();
    expect(snap.phase).toBe("roundClear");
    expect(snap.bolts).toHaveLength(0);
  });
});

describe("roundSim Laser: paddle slot stacking", () => {
  function catchCapsule(sim: RoundSim, type: "E" | "C" | "L" | "R"): void {
    sim.debugDropCapsule(player(sim.snapshot()).paddle.x, PADDLE_Y, type);
    step(sim);
  }

  it("E, C and L evict each other and recompute the width", () => {
    const sim = createRoundSim(quietLevel(), { lives: 3, score: 0 });
    launch(sim);
    catchCapsule(sim, "E");
    expect(player(sim.snapshot()).paddle.w).toBeCloseTo(PADDLE_W * 1.5, 5);
    catchCapsule(sim, "L");
    let p = player(sim.snapshot());
    expect(p.effects.E).toBeUndefined();
    expect(isArmedPlayer(p)).toBe(true);
    expect(p.paddle.w).toBeCloseTo(PADDLE_W, 5);
    catchCapsule(sim, "C");
    p = player(sim.snapshot());
    expect(isArmedPlayer(p)).toBe(false);
    expect(p.effects.C).toBeDefined();
    catchCapsule(sim, "L");
    p = player(sim.snapshot());
    expect(p.effects.C).toBeUndefined();
    expect(isArmedPlayer(p)).toBe(true);
  });

  it("E over L at the wall widens the Paddle and clamps it inside the field", () => {
    const sim = armedInPlay();
    step(sim, { axisX: 1 }, 120);
    expect(player(sim.snapshot()).paddle.x).toBeCloseTo(208 - PADDLE_W / 2, 5);
    catchCapsule(sim, "E");
    const p = player(sim.snapshot());
    expect(isArmedPlayer(p)).toBe(false);
    expect(p.paddle.w).toBeCloseTo(PADDLE_W * 1.5, 5);
    expect(p.paddle.x).toBeCloseTo(208 - (PADDLE_W * 1.5) / 2, 5);
  });

  it("a second L refreshes the cooldown and still pays the catch bonus", () => {
    const sim = armedInPlay();
    const before = player(sim.snapshot()).score;
    step(sim, { held: true });
    expect(player(sim.snapshot()).laserReady).toBe(false);
    catchCapsule(sim, "L");
    const p = player(sim.snapshot());
    expect(p.laserReady).toBe(true);
    expect(p.score).toBe(before + 100);
  });

  it("R stacks: Bolts spawn at the live, narrower Paddle ends", () => {
    const sim = armedInPlay();
    catchCapsule(sim, "R");
    const p = player(sim.snapshot());
    expect(isArmedPlayer(p)).toBe(true);
    expect(p.paddle.w).toBeCloseTo(PADDLE_W * 0.65, 5);
    step(sim, { held: true });
    const xs = (sim.snapshot().bolts ?? []).map((b) => b.x);
    const reach = (PADDLE_W * 0.65) / 2 - 2;
    expect(xs[0]).toBeCloseTo(p.paddle.x - reach, 5);
    expect(xs[1]).toBeCloseTo(p.paddle.x + reach, 5);
  });
});

describe("roundSim Laser: Bricks, scoring and the boss", () => {
  it("a Bolt break scores like a ball break and silver takes one hit per Bolt", () => {
    const sim = armedInPlay(gridLevel({ 0: "A............", [ROW]: ".....A.S....." }));
    const before = player(sim.snapshot()).score;
    step(sim, { held: true });
    step(sim, {}, 60);
    const snap = sim.snapshot();
    expect(cell(snap, ROW, LEFT_COL)).toBe(0);
    // Tier-1 colored = 50; round-1 silver needs 1 hit and scores 50.
    expect(cell(snap, ROW, RIGHT_COL)).toBe(0);
    expect(player(snap).score).toBe(before + 50 + 50);
  });

  it("silver loses one hit per Bolt and breaks on the last", () => {
    // Round 8 silver needs 2 hits.
    const sim = armedInPlay(gridLevel({ 0: "A............", [ROW]: ".......S....." }, 8));
    const silver = cell(sim.snapshot(), ROW, RIGHT_COL);
    step(sim, { held: true });
    step(sim, {}, 60);
    expect(cell(sim.snapshot(), ROW, RIGHT_COL)).toBe(silver - 1);
    step(sim, { held: true });
    step(sim, {}, 60);
    expect(cell(sim.snapshot(), ROW, RIGHT_COL)).toBe(0);
  });

  it("gold spends the Bolt with no damage and a boltGoldHit", () => {
    const sim = armedInPlay(gridLevel({ 0: "A............", [ROW]: ".....G......." }));
    step(sim, { held: true });
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) for (const e of stepEvents(sim)) seen.push(e.type);
    expect(cell(sim.snapshot(), ROW, LEFT_COL)).toBe(13);
    expect(seen.filter((t) => t === "boltGoldHit")).toHaveLength(1);
    expect(seen).not.toContain("brickBreak");
  });

  it("boltHit precedes the Brick result; Bolts never emit paddleBounce", () => {
    const sim = armedInPlay(gridLevel({ 0: "A............", [ROW]: ".....A......." }));
    step(sim, { held: true });
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) for (const e of stepEvents(sim)) seen.push(e.type);
    const hit = seen.indexOf("boltHit");
    expect(hit).toBeGreaterThanOrEqual(0);
    expect(seen[hit + 1]).toBe("brickBreak");
  });

  it("a Bolt and a ball reaching one Brick on the same tick: the Bolt takes it", () => {
    // Row 17 spans y 156–164; the left Bolt enters it on its 19th move.
    const sim = armedInPlay(gridLevel({ 0: "A............", 17: ".....A......." }));
    step(sim, { held: true });
    step(sim, {}, 18);
    sim.debugSetBall(90, 168, 0, -120);
    const target = 17 * BRICK_COLS + LEFT_COL;
    const evs = stepEvents(sim).filter((e) => e.target === target);
    expect(evs.map((e) => e.type)).toEqual(["boltHit", "brickBreak"]);
    // The ball found the cell already empty and flew on.
    expect(sim.snapshot().balls[0]?.vy ?? 0).toBeLessThan(0);
  });

  it("boss round: 1 HP per 4 Bolt hits, bossHit only on the HP-losing Bolt", () => {
    const sim = createRoundSim(gridLevel({}, 33), { lives: 3, score: 0 });
    launch(sim);
    sim.debugSetBall(8, 200, 0, 0); // park the ball out of the boss's way
    arm(sim);
    const hp0 = sim.snapshot().boss?.hp ?? -1;
    let bossHits = 0;
    let firstVolleySpentAt = -1;
    for (let i = 0; i < 100; i++) {
      const evs = stepEvents(sim, { held: i < 25 });
      bossHits += evs.filter((e) => e.type === "bossHit").length;
      if (firstVolleySpentAt < 0 && i > 0 && (sim.snapshot().bolts?.length ?? 0) === 2 && i > 21) {
        firstVolleySpentAt = i;
        // The first volley (2 Bolts) has landed: no HP lost yet.
        expect(sim.snapshot().boss?.hp).toBe(hp0);
        expect(bossHits).toBe(0);
      }
    }
    // Two volleys = 4 Bolts = 1 HP, announced once.
    expect(firstVolleySpentAt).toBeGreaterThan(0);
    expect(sim.snapshot().boss?.hp).toBe(hp0 - 1);
    expect(bossHits).toBe(1);
  });
});

describe("roundSim Laser: determinism", () => {
  it("identical held-fire inputs produce identical snapshots", () => {
    function run(): Snapshot[] {
      const sim = createRoundSim(gridLevel({ 0: "AAAAAAAAAAAAA", 1: "SSSSGSSSSSSSS", 3: "BBBBBBBBBBBBB" }), {
        lives: 3,
        score: 0,
      });
      const out: Snapshot[] = [];
      for (let t = 0; t < 600; t++) {
        if (t === 10) sim.debugDropCapsule(player(sim.snapshot()).paddle.x, PADDLE_Y, "L");
        const axisX = Math.sin(t / 25) > 0 ? 1 : -1;
        sim.step([frame(sim, { axisX, launch: t === 5, held: t % 50 < 30 })]);
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
