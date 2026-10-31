// Laser in the Shared Field engine (ticket #145, spec #140): who arms, who
// fires, who is credited, Bolt order, width sources, lifetime and the boss.
// Everything goes through the public sim seam (step + snapshot).
import { describe, expect, it } from "vitest";
import { createSharedFieldSim, type SharedFieldOptions, type SharedFieldSim } from "sim/sharedField";
import { BRICK_COLS, FIELD_H, PADDLE_W, PADDLE_Y } from "sim/constants";
import { EMPTY_ACTIONS, isArmedPlayer, type InputFrame, type Snapshot } from "shared/protocol";
import { gridLevel } from "./laserFixtures";

const ROW = 2;

/** A far-left Brick no Bolt reaches, so the round never clears on its own. */
const QUIET: Record<number, string> = { 0: "A............" };

interface FrameOpts {
  axisX?: number;
  launch?: boolean;
  held?: boolean;
}

function frame(player: number, tick: number, o: FrameOpts = {}): InputFrame {
  return {
    player,
    tick,
    axisX: o.axisX ?? 0,
    axisY: 0,
    launch: o.launch ?? false,
    primaryHeld: o.held ?? false,
    actions: EMPTY_ACTIONS,
  };
}

/** Step once with per-player frame options; returns the events of that tick. */
function stepWith(sim: SharedFieldSim, per: Record<number, FrameOpts> = {}): Snapshot["events"] {
  const t = sim.currentTick;
  const frames = Object.entries(per).map(([p, o]) => frame(Number(p), t, o));
  sim.step(frames);
  return sim.snapshot().events.filter((e) => e.tick === t);
}

function stepN(sim: SharedFieldSim, n: number, per: Record<number, FrameOpts> = {}): Snapshot["events"] {
  const out: Snapshot["events"] = [];
  for (let i = 0; i < n; i++) out.push(...stepWith(sim, per));
  return out;
}

function make(opts: Partial<SharedFieldOptions>, rows: Record<number, string> = QUIET, round = 1) {
  return createSharedFieldSim(gridLevel(rows, round), {
    placement: "A",
    ballModel: "shared",
    playerCount: 2,
    ...opts,
  });
}

function player(sim: SharedFieldSim, i: number) {
  const p = sim.snapshot().players[i];
  if (p === undefined) throw new Error(`no player ${String(i)}`);
  return p;
}

/** Launch the shared ball, then park it still and out of every Bolt's way. */
function launchAndPark(sim: SharedFieldSim): void {
  stepWith(sim, { 0: { launch: true } });
  sim.debugSetBall(4, 200, 0, 0);
}

/** Drop a capsule on Paddle `i`; it is caught on the next step. */
function catchOn(sim: SharedFieldSim, i: number, type: "E" | "C" | "L" | "R" | "B"): void {
  sim.debugDropCapsule(player(sim, i).paddle.x, PADDLE_Y, type);
  stepWith(sim);
}

function cell(sim: SharedFieldSim, row: number, col: number): number {
  return sim.snapshot().bricks[row * BRICK_COLS + col] ?? -1;
}

describe("Shared Field Laser: who arms, fires and is credited", () => {
  it("A: only the catcher arms, and only its owner's held input fires it", () => {
    // Paddle 0 at x 52 fires at 38 (col 2) and 66 (col 4).
    const sim = make({ placement: "A" }, { ...QUIET, [ROW]: "..A.A........" });
    launchAndPark(sim);
    catchOn(sim, 0, "L");
    expect(isArmedPlayer(player(sim, 0))).toBe(true);
    expect(isArmedPlayer(player(sim, 1))).toBe(false);
    expect(player(sim, 0).laserReady).toBe(true);
    expect(player(sim, 1).laserReady).toBeUndefined();

    expect(stepWith(sim, { 1: { held: true } }).some((e) => e.type === "laserFire")).toBe(false);
    const fired = stepWith(sim, { 0: { held: true } });
    expect(fired.filter((e) => e.type === "laserFire").map((e) => e.source)).toEqual([0]);
    expect(sim.snapshot().bolts?.map((b) => b.owner)).toEqual([0, 0]);

    const before = sim.getTeamState().score;
    const evs = stepN(sim, 60);
    expect(cell(sim, ROW, 2)).toBe(0);
    expect(cell(sim, ROW, 4)).toBe(0);
    expect(evs.filter((e) => e.type === "brickBreak").map((e) => e.source)).toEqual([0, 0]);
    // Team score, exactly as a ball break (tier 1 = 50 each).
    expect(sim.getTeamState().score).toBe(before + 100);
  });

  it("B: only the bottom Paddle catches and arms; side Paddles never do", () => {
    const sim = make({ placement: "B", playerCount: 3 });
    launchAndPark(sim);
    for (const i of [1, 2]) {
      const side = player(sim, i).paddle;
      sim.debugDropCapsule(side.x, side.y, "L");
    }
    stepN(sim, 10);
    expect(sim.snapshot().players.some((p) => isArmedPlayer(p))).toBe(false);
    expect(sim.snapshot().events.some((e) => e.type === "capsuleCatch")).toBe(false);
    catchOn(sim, 0, "L");
    expect(isArmedPlayer(player(sim, 0))).toBe(true);
    // The side players' held input does not fire the bottom Paddle; bolts go up.
    expect(stepWith(sim, { 1: { held: true }, 2: { held: true } }).some((e) => e.type === "laserFire")).toBe(false);
    stepWith(sim, { 0: { held: true } });
    const y0 = sim.snapshot().bolts?.[0]?.y ?? 0;
    stepWith(sim);
    expect(sim.snapshot().bolts?.[0]?.y).toBeLessThan(y0);
  });

  it("C: any player's input fires the shared Paddle; the shooter takes the credit", () => {
    // Shared Paddle at x 104 fires at 90 (col 5) and 118 (col 7).
    const sim = make({ placement: "C", playerCount: 3 }, { ...QUIET, [ROW]: ".....A.A....." });
    launchAndPark(sim);
    catchOn(sim, 0, "L");
    const fired = stepWith(sim, { 2: { held: true } });
    expect(fired.filter((e) => e.type === "laserFire").map((e) => e.source)).toEqual([2]);
    // The snapshot names the Paddle (player 0); the credit stays with player 2.
    expect(sim.snapshot().bolts?.map((b) => b.owner)).toEqual([0, 0]);
    const evs = stepN(sim, 60);
    expect(evs.filter((e) => e.type === "boltHit" || e.type === "brickBreak").map((e) => [e.type, e.source])).toEqual([
      ["boltHit", 2],
      ["brickBreak", 2],
      ["boltHit", 2],
      ["brickBreak", 2],
    ]);
  });

  it("C: several holders on one tick fire one volley, credited to the lowest index", () => {
    const sim = make({ placement: "C", playerCount: 3 });
    launchAndPark(sim);
    catchOn(sim, 0, "L");
    const fired = stepWith(sim, { 2: { held: true }, 1: { held: true } });
    expect(fired.filter((e) => e.type === "laserFire").map((e) => e.source)).toEqual([1]);
    expect(sim.snapshot().bolts).toHaveLength(2);
  });

  it("launch beats fire: the frame that releases the ball spends no Bolt", () => {
    const sim = make({ placement: "A" });
    catchOn(sim, 0, "L"); // caught in serve, ball still stuck
    expect(stepWith(sim, { 0: { held: true } }).some((e) => e.type === "laserFire")).toBe(false);
    const launchTick = stepWith(sim, { 0: { held: true, launch: true } });
    expect(launchTick.some((e) => e.type === "ballLaunch")).toBe(true);
    expect(launchTick.some((e) => e.type === "laserFire")).toBe(false);
    expect(stepWith(sim, { 0: { held: true } }).some((e) => e.type === "laserFire")).toBe(true);
  });
});

describe("Shared Field Laser: Bolt order and contention", () => {
  /**
   * Placement A, two Paddles pushed together at the middle: Paddle 0 (x 88)
   * fires at 74 and 102, Paddle 1 (x 120) at 106 and 134. Both inner Bolts
   * share column 6.
   */
  function huddled(rows: Record<number, string>): SharedFieldSim {
    const sim = make({ placement: "A" }, rows);
    stepN(sim, 30, { 0: { axisX: 1 }, 1: { axisX: -1 } });
    launchAndPark(sim);
    catchOn(sim, 0, "L");
    catchOn(sim, 1, "L");
    return sim;
  }

  it("orders Bolts by Paddle, then spawn order (left, right)", () => {
    const sim = huddled(QUIET);
    stepWith(sim, { 0: { held: true }, 1: { held: true } });
    expect(sim.snapshot().bolts?.map((b) => [b.owner, b.x])).toEqual([
      [0, 74],
      [0, 102],
      [1, 106],
      [1, 134],
    ]);
  });

  it("same-tick contention for one Brick goes to the lower Paddle; the other Bolt flies on", () => {
    const sim = huddled({ ...QUIET, 1: "......A......", [ROW]: "......A......" });
    stepWith(sim, { 0: { held: true }, 1: { held: true } });
    const breaks = stepN(sim, 60).filter((e) => e.type === "brickBreak");
    expect(breaks.map((e) => [e.target, e.source])).toEqual([
      [ROW * BRICK_COLS + 6, 0],
      [1 * BRICK_COLS + 6, 1],
    ]);
  });
});

describe("Shared Field Laser: paddle slot and width sources", () => {
  it("E and R stack; L evicts E but keeps R; E evicts L", () => {
    const sim = make({ placement: "C", playerCount: 2 });
    launchAndPark(sim);
    catchOn(sim, 0, "E");
    catchOn(sim, 0, "R");
    expect(player(sim, 0).paddle.w).toBeCloseTo(PADDLE_W * 1.5 * 0.65, 5);
    catchOn(sim, 0, "L");
    expect(isArmedPlayer(player(sim, 0))).toBe(true);
    expect(player(sim, 0).paddle.w).toBeCloseTo(PADDLE_W * 0.65, 5);
    catchOn(sim, 0, "E");
    expect(isArmedPlayer(player(sim, 0))).toBe(false);
    expect(player(sim, 0).paddle.w).toBeCloseTo(PADDLE_W * 1.5 * 0.65, 5);
    catchOn(sim, 0, "L");
    catchOn(sim, 0, "C");
    expect(isArmedPlayer(player(sim, 0))).toBe(false);
    expect(player(sim, 0).paddle.w).toBeCloseTo(PADDLE_W * 0.65, 5);
  });

  it("a widening swap at the wall clamps the Paddle inside the field", () => {
    const sim = make({ placement: "C", playerCount: 2 });
    stepN(sim, 120, { 0: { axisX: 1 } });
    launchAndPark(sim);
    catchOn(sim, 0, "L");
    catchOn(sim, 0, "E");
    const p = player(sim, 0).paddle;
    expect(p.x + p.w / 2).toBeLessThanOrEqual(208 + 1e-9);
    expect(p.w).toBeCloseTo(PADDLE_W * 1.5, 5);
  });

  it("a second L refreshes the cooldown and still pays the catch bonus", () => {
    const sim = make({ placement: "A" });
    launchAndPark(sim);
    catchOn(sim, 0, "L");
    stepWith(sim, { 0: { held: true } });
    expect(player(sim, 0).laserReady).toBe(false);
    const before = sim.getTeamState().score;
    catchOn(sim, 0, "L");
    expect(player(sim, 0).laserReady).toBe(true);
    expect(sim.getTeamState().score).toBe(before + 100);
  });

  it("R stacks: Bolts spawn at the live, narrower ends", () => {
    const sim = make({ placement: "C", playerCount: 2 });
    launchAndPark(sim);
    catchOn(sim, 0, "L");
    catchOn(sim, 0, "R");
    stepWith(sim, { 1: { held: true } });
    const reach = (PADDLE_W * 0.65) / 2 - 2;
    const x = player(sim, 0).paddle.x;
    expect(sim.snapshot().bolts?.map((b) => b.x)).toEqual([x - reach, x + reach]);
  });
});

describe("Shared Field Laser: lifetime", () => {
  it("shared ball: the team's last ball lost disarms every Paddle and drops the Bolts", () => {
    const sim = make({ placement: "A" });
    launchAndPark(sim);
    catchOn(sim, 0, "L");
    catchOn(sim, 1, "L");
    stepWith(sim, { 0: { held: true }, 1: { held: true } });
    expect(sim.snapshot().bolts).toHaveLength(4);
    sim.debugSetBall(104, FIELD_H + 20, 0, 60);
    stepWith(sim);
    expect(sim.snapshot().phase).toBe("serve");
    expect(sim.snapshot().players.some((p) => isArmedPlayer(p))).toBe(false);
    expect(sim.snapshot().bolts).toHaveLength(0);
  });

  it("perPlayer: a player whose ball fell keeps the Laser while a teammate's ball lives", () => {
    const sim = make({ placement: "A", ballModel: "perPlayer" });
    stepWith(sim, { 0: { launch: true }, 1: { launch: true } });
    catchOn(sim, 0, "L");
    // balls[0] is player 0's ball: drop it out of the field.
    sim.debugSetBall(52, FIELD_H + 20, 0, 60);
    stepWith(sim);
    expect(sim.snapshot().balls).toHaveLength(1);
    expect(isArmedPlayer(player(sim, 0))).toBe(true);
    expect(stepWith(sim, { 0: { held: true } }).some((e) => e.type === "laserFire")).toBe(true);
    // Now the team's last ball goes.
    sim.debugSetBall(156, FIELD_H + 20, 0, 60);
    stepWith(sim);
    expect(isArmedPlayer(player(sim, 0))).toBe(false);
    expect(sim.snapshot().bolts).toHaveLength(0);
  });

  it("round clear disarms and drops the Bolts", () => {
    // Paddle 0's left Bolt clears the round; the right one is still flying.
    const sim = make({ placement: "A" }, { [ROW]: "..A.........." });
    launchAndPark(sim);
    catchOn(sim, 0, "L");
    stepWith(sim, { 0: { held: true } });
    stepN(sim, 60);
    expect(sim.snapshot().phase).toBe("roundClear");
    expect(isArmedPlayer(player(sim, 0))).toBe(false);
    expect(sim.snapshot().bolts).toHaveLength(0);
  });

  it("B clears the round and the Bolts", () => {
    const sim = make({ placement: "A" });
    launchAndPark(sim);
    catchOn(sim, 0, "L");
    stepWith(sim, { 0: { held: true } });
    catchOn(sim, 1, "B");
    expect(sim.snapshot().phase).toBe("roundClear");
    expect(sim.snapshot().bolts).toHaveLength(0);
  });

  it("gold spends the Bolt with no damage", () => {
    const sim = make({ placement: "A" }, { ...QUIET, [ROW]: "..G.........." });
    launchAndPark(sim);
    catchOn(sim, 0, "L");
    stepWith(sim, { 0: { held: true } });
    const evs = stepN(sim, 60);
    expect(cell(sim, ROW, 2)).toBe(13);
    expect(evs.filter((e) => e.type === "boltGoldHit").map((e) => e.source)).toEqual([0]);
  });
});

describe("Shared Field Laser: boss", () => {
  it("the boss counter is team-wide: 2 Bolts from each Paddle cost 1 HP", () => {
    // Huddled A Paddles: only the inner Bolts (102 and 106) meet the boss box
    // (x 80–128), so each volley pair lands 1 Bolt per Paddle.
    const sim = make({ placement: "A" }, {}, 33);
    stepN(sim, 30, { 0: { axisX: 1 }, 1: { axisX: -1 } });
    launchAndPark(sim);
    catchOn(sim, 0, "L");
    catchOn(sim, 1, "L");
    const hp0 = sim.snapshot().boss?.hp ?? -1;
    // Held for 2 volleys per Paddle (ticks 0 and 21), then let them land.
    const evs = [
      ...stepN(sim, 25, { 0: { held: true }, 1: { held: true } }),
      ...stepN(sim, 70),
    ];
    expect(evs.filter((e) => e.type === "laserFire")).toHaveLength(4);
    expect(sim.snapshot().bolts).toHaveLength(0);
    expect(sim.snapshot().boss?.hp).toBe(hp0 - 1);
    expect(evs.filter((e) => e.type === "bossHit")).toHaveLength(1);
  });
});

describe("Shared Field Laser: determinism", () => {
  it("identical held-fire inputs produce identical snapshots", () => {
    function run(): Snapshot[] {
      const sim = make(
        { placement: "C", playerCount: 3 },
        { 0: "AAAAAAAAAAAAA", 1: "SSSSGSSSSSSSS", 3: "BBBBBBBBBBBBB" },
      );
      const out: Snapshot[] = [];
      for (let t = 0; t < 600; t++) {
        if (t === 10) sim.debugDropCapsule(player(sim, 0).paddle.x, PADDLE_Y, "L");
        const axisX = Math.sin(t / 25) > 0 ? 1 : -1;
        stepWith(sim, {
          0: { axisX, launch: t === 5, held: t % 50 < 30 },
          1: { held: t % 70 > 40 },
          2: { axisX: -axisX / 2 },
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
