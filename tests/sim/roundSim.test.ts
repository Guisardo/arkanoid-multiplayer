import { describe, expect, it } from "vitest";
import { createRoundSim, type RoundSim } from "sim/roundSim";
import type { LevelData } from "content/levelFormat";
import { FIELD_W, PADDLE_Y, TICK_DT, BRICK_COLS, BRICK_ROWS } from "sim/constants";
import { EMPTY_ACTIONS, type InputFrame } from "shared/protocol";

function testLevel(): LevelData {
  const grid: string[] = [];
  for (let r = 0; r < BRICK_ROWS; r++) {
    // Single brick at row 2, col 0 (y 36–44).
    grid.push(r === 2 ? "O............" : ".............");
  }
  return {
    version: 1,
    round: 1,
    grid,
    baseBallSpeed: 110,
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

function input(player: number, tick: number, axisX: number, launch = false): InputFrame {
  return { player, tick, axisX, axisY: 0, launch, actions: EMPTY_ACTIONS };
}

/** Deterministic movement script: returns frames holding axis, then launch. */
function* serveAndWander(sim: RoundSim): Generator<InputFrame> {
  // attach phase: wait a few ticks, then launch
  for (let i = 0; i < 5; i++) yield input(0, sim.currentTick, 0);
  yield input(0, sim.currentTick, 0, true);
}

describe("RoundSim (tracer round)", () => {
  it("creates a serve-phase snapshot with the ball attached", () => {
    const sim = createRoundSim(testLevel(), { lives: 3, score: 0 });
    const snap = sim.snapshot();
    expect(snap.phase).toBe("serve");
    expect(snap.round).toBe(1);
    expect(snap.players[0]?.lives).toBe(3);
    expect(snap.balls).toHaveLength(1);
    expect(snap.balls[0]?.attachedTo).toBe(0);
  });

  it("paddle moves at Vmax * |axis| per tick (binary ±1 → 150 u/s)", () => {
    const sim = createRoundSim(testLevel(), { lives: 3, score: 0 });
    const x0 = sim.snapshot().players[0]!.paddle.x;
    sim.step([input(0, sim.currentTick, 1)]);
    const x1 = sim.snapshot().players[0]!.paddle.x;
    expect(x1 - x0).toBeCloseTo(150 * TICK_DT, 5);
  });

  it("paddle clamps to field walls", () => {
    const sim = createRoundSim(testLevel(), { lives: 3, score: 0 });
    for (let i = 0; i < 100; i++) sim.step([input(0, sim.currentTick, -1)]);
    const p = sim.snapshot().players[0]!.paddle;
    expect(p.x).toBeCloseTo(p.w / 2, 5);
    for (let i = 0; i < 200; i++) sim.step([input(0, sim.currentTick, 1)]);
    const q = sim.snapshot().players[0]!.paddle;
    expect(q.x).toBeCloseTo(FIELD_W - q.w / 2, 5);
  });

  it("launch consumes the edge event and enters play", () => {
    const sim = createRoundSim(testLevel(), { lives: 3, score: 0 });
    for (const f of serveAndWander(sim)) sim.step([f]);
    const snap = sim.snapshot();
    expect(snap.phase).toBe("play");
    expect(snap.balls[0]?.attachedTo).toBeNull();
    expect(snap.balls[0]!.vy).toBeLessThan(0);
  });

  it("ball loss decrements lives and re-serves; 0 lives ends round as gameOver", () => {
    const sim = createRoundSim(testLevel(), { lives: 3, score: 0 });
    // Force losses by stepping with the ball placed below the field.
    for (let life = 3; life >= 1; life--) {
      sim.debugSetBall(104, 300, 0, 60); // below field, moving away
      for (let i = 0; i < 10; i++) sim.step([input(0, sim.currentTick, 0)]);
      const snap = sim.snapshot();
      if (life > 1) {
        expect(snap.players[0]!.lives).toBe(life - 1);
        expect(snap.phase).toBe("serve");
      } else {
        expect(snap.players[0]!.lives).toBe(0);
        expect(snap.phase).toBe("gameOver");
      }
    }
  });

  it("identical input sequences produce identical outcomes (determinism)", () => {
    function run(): ReturnType<RoundSim["snapshot"]> {
      const sim = createRoundSim(testLevel(), { lives: 3, score: 0 });
      const frames: InputFrame[] = [];
      // scripted 600-tick play: wiggle + launch + wiggle
      for (let t = 0; t < 600; t++) {
        const axis = Math.sin(t / 20) > 0 ? 1 : -1;
        const f = input(0, t, axis, t === 30);
        frames.push(f);
        sim.step([f]);
      }
      return sim.snapshot();
    }
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });

  it("clearing the last brick ends the round as roundClear", () => {
    const sim = createRoundSim(testLevel(), { lives: 3, score: 0 });
    // Single-brick level: smash it — ball above the brick, moving down.
    sim.debugSetBall(8, 30, 0, 110);
    for (let i = 0; i < 60; i++) sim.step([input(0, sim.currentTick, 0)]);
    const snap = sim.snapshot();
    expect(snap.phase).toBe("roundClear");
    expect(snap.bricks.every((c) => c === 0)).toBe(true);
  });

  it("snapshot bricks array has grid dimensions", () => {
    const sim = createRoundSim(testLevel(), { lives: 3, score: 0 });
    const snap = sim.snapshot();
    expect(snap.bricks).toHaveLength(BRICK_COLS * BRICK_ROWS);
    expect(snap.bricks.filter((c) => c !== 0)).toHaveLength(1);
  });

  it("paddle stays at PADDLE_Y", () => {
    const sim = createRoundSim(testLevel(), { lives: 3, score: 0 });
    sim.step([input(0, sim.currentTick, 1)]);
    expect(sim.snapshot().players[0]!.paddle.y).toBeCloseTo(PADDLE_Y, 5);
  });
});
