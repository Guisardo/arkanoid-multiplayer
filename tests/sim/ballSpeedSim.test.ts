// Sim-level coverage for the arcade ball-speed mechanics added by tickets 96
// (ceiling / back-wall speed-up) and 97 (multiball spawn boost), across every
// engine that owns balls: solo `roundSim`, `duel` and `sharedField`.
import { describe, expect, it } from "vitest";
import { createRoundSim, type RoundSim } from "sim/roundSim";
import { createRoundDuel } from "sim/duel";
import { createSharedFieldSim } from "sim/sharedField";
import type { LevelData } from "content/levelFormat";
import { BALL_R, BRICK_COLS, BRICK_ROWS, PADDLE_Y } from "sim/constants";
import { CEILING_SPEEDUP } from "sim/ballSpeed";
import { EMPTY_ACTIONS, type InputFrame } from "shared/protocol";

const BASE_SPEED = 110;
/** Clear vertical lane on the right of the wall: no bricks, no paddle reach. */
const LANE_X = 200;

function input(player: number, tick: number, axisX = 0): InputFrame {
  return { player, tick, axisX, axisY: 0, launch: false, actions: EMPTY_ACTIONS };
}

function launch(player: number, tick: number): InputFrame {
  return { ...input(player, tick), launch: true };
}

/**
 * A round with 48 destructibles — comfortably above the 15-brick threshold, so
 * the brick-count speed tiers stay inert and every speed assertion in this
 * file is about the arcade mechanics alone. Bricks stop one column short of the
 * right wall, leaving a clear vertical lane for ceiling rallies.
 */
function laneLevel(): LevelData {
  const grid: string[] = [];
  for (let r = 0; r < BRICK_ROWS; r++) {
    grid.push(r < 4 ? "OOOOOOOOOOOO." : ".".repeat(BRICK_COLS));
  }
  return {
    version: 1,
    round: 1,
    grid,
    baseBallSpeed: BASE_SPEED,
    silverHitOverride: null,
    capsuleScript: [
      { brickBreakCount: 1, capsule: "E" },
      { brickBreakCount: 2, capsule: "P" },
      { brickBreakCount: 3, capsule: "L" },
      { brickBreakCount: 4, capsule: "S" },
      { brickBreakCount: 5, capsule: "M" },
      { brickBreakCount: 6, capsule: "C" },
    ],
    scoreOverrides: {},
  };
}

function soloSim() {
  return createRoundSim(laneLevel(), { lives: 99, score: 0 });
}

/**
 * Speeds observed at each ceiling contact. The ball is re-seeded just below the
 * top wall moving up on every tick, so each step is exactly one contact: it
 * clips the wall, reflects, and is lifted back to the same spot. That isolates
 * the mechanic from the rally that would otherwise end the life.
 */
function collectCeilingSpeeds(seed: (i: number) => void, want: number): number[] {
  const speeds: number[] = [];
  for (let i = 0; i < want * 4 && speeds.length < want; i++) {
    seed(i);
    const b = currentBall();
    if (b === undefined) break;
    // A ceiling contact is the only way to end a step at the wall moving down.
    if (b.vy > 0 && b.y <= BALL_R + 1e-9) speeds.push(Math.hypot(b.vx, b.vy));
  }
  return speeds;
}

/** The first ball of whichever sim is currently being driven. */
let activeBall: () => { x: number; y: number; vx: number; vy: number } | undefined = () => undefined;

function currentBall(): { x: number; y: number; vx: number; vy: number } | undefined {
  return activeBall();
}

/**
 * Drop the ball just above the paddle, let it fall onto it, and return the
 * speed it left with — i.e. what `speedFor` plus the arcade bonuses resolved to.
 */
function paddleBounceSpeed(sim: RoundSim): number {
  sim.debugSetBall(104, PADDLE_Y - 10, 0, BASE_SPEED);
  for (let i = 0; i < 60; i++) {
    sim.step([input(0, i)]);
    const b = sim.snapshot().balls[0];
    if (b !== undefined && b.vy < 0) return Math.hypot(b.vx, b.vy);
  }
  throw new Error("ball never reached the paddle");
}

describe("ceiling speed-up through the sim (ticket 96)", () => {
  /**
 * One ceiling contact per tick, at the top of the clear right-hand lane. The
 * re-seed keeps the ball's *current* speed (pointing up) so successive tiers
 * compound exactly as they would in a real rally.
 */
  function soloLane() {
    const sim = soloSim();
    activeBall = () => sim.snapshot().balls[0];
    return (i: number): void => {
      const b = sim.snapshot().balls[0];
      const live = b === undefined ? 0 : Math.hypot(b.vx, b.vy);
      // Attached balls have no velocity yet; seed those at base speed.
      sim.debugSetBall(LANE_X, BALL_R + 0.5, 0, -(live > 0 ? live : BASE_SPEED));
      sim.step([input(0, i)]);
    };
  }

  it("every ceiling contact is counted, and speed only moves at a tier boundary", () => {
    const n = CEILING_SPEEDUP.hitsPerTier;
    const speeds = collectCeilingSpeeds(soloLane(), n);
    expect(speeds).toHaveLength(n);
    for (let i = 0; i < n - 1; i++) expect(speeds[i]).toBeCloseTo(BASE_SPEED, 6);
    expect(speeds[n - 1]).toBeCloseTo(BASE_SPEED * CEILING_SPEEDUP.tierFactor, 6);
  });

  it("keeps climbing one tier per threshold, then stops at the cap", () => {
    const speeds = collectCeilingSpeeds(
      soloLane(),
      CEILING_SPEEDUP.hitsPerTier * (CEILING_SPEEDUP.maxTiers + 1),
    );
    expect(speeds.length).toBeGreaterThanOrEqual(CEILING_SPEEDUP.hitsPerTier * CEILING_SPEEDUP.maxTiers);
    for (let tier = 1; tier <= CEILING_SPEEDUP.maxTiers; tier++) {
      const at = CEILING_SPEEDUP.hitsPerTier * tier - 1;
      expect(speeds[at], `tier ${String(tier)}`).toBeCloseTo(
        BASE_SPEED * CEILING_SPEEDUP.tierFactor ** tier,
        6,
      );
    }
    expect(speeds[speeds.length - 1]).toBeCloseTo(
      BASE_SPEED * CEILING_SPEEDUP.tierFactor ** CEILING_SPEEDUP.maxTiers,
      6,
    );
  });

  it("the earned tier shows up in the next paddle bounce, not just mid-flight", () => {
    const sim = soloSim();
    activeBall = () => sim.snapshot().balls[0];
    for (let i = 0; i < CEILING_SPEEDUP.hitsPerTier; i++) {
      sim.debugSetBall(LANE_X, BALL_R + 0.5, 0, -BASE_SPEED);
      sim.step([input(0, i)]);
    }
    expect(paddleBounceSpeed(sim)).toBeCloseTo(BASE_SPEED * CEILING_SPEEDUP.tierFactor, 6);
  });

  it("a re-served ball starts a fresh life at base speed", () => {
    const sim = soloSim();
    activeBall = () => sim.snapshot().balls[0];
    for (let i = 0; i < CEILING_SPEEDUP.hitsPerTier + 2; i++) {
      sim.debugSetBall(LANE_X, BALL_R + 0.5, 0, -BASE_SPEED);
      sim.step([input(0, i)]);
    }
    // Drop the ball → re-serve attached, no inherited tier.
    sim.debugSetBall(104, 300, 0, 60);
    for (let i = 0; i < 3; i++) sim.step([input(0, sim.currentTick)]);
    expect(sim.snapshot().balls[0]?.attachedTo).toBe(0);
    sim.step([launch(0, sim.currentTick)]);
    const launched = sim.snapshot().balls[0]!;
    expect(Math.hypot(launched.vx, launched.vy)).toBeCloseTo(BASE_SPEED, 6);
  });

  it("duel counts ceiling contacts too", () => {
    const sim = createRoundDuel(laneLevel(), { ballModel: "owned", timeCapTicks: null });
    activeBall = () => sim.snapshot().balls[0];
    const speeds = collectCeilingSpeeds((i) => {
      sim.debugSetBall(LANE_X, BALL_R + 0.5, 0, -BASE_SPEED);
      sim.step([input(0, i), input(1, i)]);
    }, CEILING_SPEEDUP.hitsPerTier);
    expect(speeds).toHaveLength(CEILING_SPEEDUP.hitsPerTier);
    expect(speeds[CEILING_SPEEDUP.hitsPerTier - 1]).toBeCloseTo(
      BASE_SPEED * CEILING_SPEEDUP.tierFactor,
      6,
    );
  });

  it("shared field counts ceiling contacts too (placement A keeps the top wall)", () => {
    const sim = createSharedFieldSim(laneLevel(), {
      placement: "A",
      ballModel: "shared",
      playerCount: 2,
    });
    activeBall = () => sim.snapshot().balls[0];
    const speeds = collectCeilingSpeeds((i) => {
      sim.debugSetBall(LANE_X, BALL_R + 0.5, 0, -BASE_SPEED);
      sim.step([input(0, i), input(1, i)]);
    }, CEILING_SPEEDUP.hitsPerTier);
    expect(speeds).toHaveLength(CEILING_SPEEDUP.hitsPerTier);
    expect(speeds[CEILING_SPEEDUP.hitsPerTier - 1]).toBeCloseTo(
      BASE_SPEED * CEILING_SPEEDUP.tierFactor,
      6,
    );
  });

  it("placement B with a top paddle has no ceiling to count", () => {
    const sim = createSharedFieldSim(laneLevel(), {
      placement: "B",
      ballModel: "shared",
      playerCount: 4,
    });
    activeBall = () => sim.snapshot().balls[0];
    const speeds = collectCeilingSpeeds((i) => {
      sim.debugSetBall(LANE_X, BALL_R + 0.5, 0, -BASE_SPEED);
      sim.step([input(0, i), input(1, i), input(2, i), input(3, i)]);
    }, 4);
    expect(speeds).toEqual([]);
  });
});
