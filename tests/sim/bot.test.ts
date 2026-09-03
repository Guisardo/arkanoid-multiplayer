import { describe, expect, it } from "vitest";
import { createBot, BOT_PARAMS } from "sim/bot";
import { assignBotSkins } from "sim/botSkins";
import { createRoundSim } from "sim/roundSim";
import { getLevel } from "content/levels";
import { createDelayQueue } from "net/delayQueue";
import type { InputFrame, Snapshot } from "shared/protocol";

/** Drive a sim with the bot until phase change or tick cap. */
function playRound(difficulty: "easy" | "normal" | "hard", seed: number, maxTicks: number) {
  const level = getLevel(1);
  const sim = createRoundSim(level, { lives: 99, score: 0 });
  const bot = createBot(0, difficulty, seed);
  let tick = 0;
  let losses = 0;
  let lastLives = 99;
  while (sim.snapshot().phase !== "roundClear" && sim.snapshot().phase !== "gameOver" && tick < maxTicks) {
    const frame = bot.sampleFrame(tick, sim.snapshot());
    sim.step([frame]);
    const lives = sim.snapshot().players[0]!.lives;
    if (lives < lastLives) {
      losses += lastLives - lives;
      lastLives = lives;
    }
    tick++;
  }
  return { ticks: tick, phase: sim.snapshot().phase, losses };
}

describe("bot parameter sets (spec §7)", () => {
  it("all six knobs present per difficulty with exact values", () => {
    expect(BOT_PARAMS.easy).toEqual({
      aimNoise: 24,
      engagementY: 0.65,
      launchMin: 60,
      launchMax: 240,
      meterThreshold: 80,
      fireChance: 0.002,
      smartTargeting: false,
    });
    expect(BOT_PARAMS.normal).toEqual({
      aimNoise: 8,
      engagementY: 0.4,
      launchMin: 67,
      launchMax: 127,
      meterThreshold: 30,
      fireChance: 0.008,
      smartTargeting: false,
    });
    expect(BOT_PARAMS.hard).toEqual({
      aimNoise: 2,
      engagementY: 0.25,
      launchMin: 40,
      launchMax: 120,
      meterThreshold: 20,
      fireChance: 0.015,
      smartTargeting: true,
    });
  });
});

describe("bot plays a full round", () => {
  it("clears round 1 on each difficulty", () => {
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      const r = playRound(difficulty, 42, 120_000);
      expect(r.phase, `${difficulty} phase`).toBe("roundClear");
    }
  });

  it("engagement thresholds differ visibly: hard reacts high, easy reacts low", () => {
    const level = getLevel(1);
    // Ball descending at a given height, far from the paddle: does the bot move?
    const reacts = (difficulty: "easy" | "normal" | "hard", ballY: number): boolean => {
      const sim = createRoundSim(level, { lives: 99, score: 0 });
      const bot = createBot(0, difficulty, 11);
      // park the ball mid-descent at ballY, moving down
      sim.debugSetBall(20, ballY, 30, 110);
      const frame = bot.sampleFrame(0, sim.snapshot());
      return frame.axisX !== 0;
    };
    // FIELD_H = 256: hard line 0.25×256 = 64, normal 0.40×256 = 102.4, easy 0.65×256 = 166.4
    expect(reacts("hard", 70)).toBe(true);
    expect(reacts("normal", 70)).toBe(false);
    expect(reacts("normal", 110)).toBe(true);
    expect(reacts("easy", 110)).toBe(false);
    expect(reacts("easy", 170)).toBe(true);
  });

  it("launch timing lands inside each difficulty's range", () => {
    const level = getLevel(1);
    for (const [difficulty, min, max] of [
      ["easy", 60, 240],
      ["normal", 67, 127],
      ["hard", 40, 120],
    ] as const) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const sim = createRoundSim(level, { lives: 99, score: 0 });
        const bot = createBot(0, difficulty, seed);
        let launchedAt = -1;
        for (let tick = 0; tick < 300 && launchedAt < 0; tick++) {
          const frame = bot.sampleFrame(tick, sim.snapshot());
          if (frame.launch) launchedAt = tick;
          sim.step([frame]);
        }
        expect(launchedAt, `${difficulty} seed ${String(seed)}`).toBeGreaterThanOrEqual(min);
        expect(launchedAt, `${difficulty} seed ${String(seed)}`).toBeLessThan(max);
      }
    }
  });

  it("deterministic: same seed + same state sequence → identical frames", () => {
    const level = getLevel(1);
    const run = (): InputFrame[] => {
      const sim = createRoundSim(level, { lives: 99, score: 0 });
      const bot = createBot(0, "normal", 7);
      const frames: InputFrame[] = [];
      for (let tick = 0; tick < 2000; tick++) {
        const snap = sim.snapshot();
        const frame = bot.sampleFrame(tick, snap);
        frames.push(frame);
        sim.step([frame]);
        if (sim.snapshot().phase === "roundClear") break;
      }
      return frames;
    };
    const a = run();
    const b = run();
    expect(a.length).toBeGreaterThan(100);
    expect(a).toEqual(b);
  });

  it("bot frames enter the same delay queue as a human local player (D=0)", () => {
    const level = getLevel(1);
    const sim = createRoundSim(level, { lives: 99, score: 0 });
    const bot = createBot(0, "normal", 3);
    const q = createDelayQueue({ delay: 0 });
    for (let tick = 0; tick < 10; tick++) {
      const frame = bot.sampleFrame(tick, sim.snapshot());
      q.push(frame);
      sim.step([frame]);
    }
    const due = q.due(10);
    expect(due).toHaveLength(10);
    expect(due.map((f) => f.tick)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("bot frame shape", () => {
  it("produces the identical InputFrame shape as a keyboard adapter (parity)", () => {
    const level = getLevel(1);
    const sim = createRoundSim(level, { lives: 99, score: 0 });
    const bot = createBot(0, "normal", 5);
    const frame = bot.sampleFrame(0, sim.snapshot());
    const keys = Object.keys(frame).sort();
    expect(keys).toEqual(["actions", "axisX", "axisY", "launch", "player", "tick"]);
    expect(frame.player).toBe(0);
    expect(frame.tick).toBe(0);
    expect(Math.abs(frame.axisX)).toBeLessThanOrEqual(1);
  });

  it("launches the attached ball within the timing range", () => {
    const level = getLevel(1);
    const sim = createRoundSim(level, { lives: 99, score: 0 });
    const bot = createBot(0, "hard", 9);
    let launchedAt = -1;
    for (let tick = 0; tick < 500 && launchedAt < 0; tick++) {
      const frame = bot.sampleFrame(tick, sim.snapshot());
      if (frame.launch) launchedAt = tick;
      sim.step([frame]);
    }
    expect(launchedAt).toBeGreaterThanOrEqual(0);
    expect(launchedAt).toBeLessThanOrEqual(120);
  });
});

describe("bot skins", () => {
  it("distinct, never colliding with humans, deterministic", () => {
    const a = assignBotSkins([0, 3], 2, 8);
    const b = assignBotSkins([0, 3], 2, 8);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(2);
    for (const s of a) expect(s).not.toBe(0);
    for (const s of a) expect(s).not.toBe(3);
  });
  it("handles more bots than remaining skins by raising", () => {
    expect(() => assignBotSkins([0, 1, 2], 4, 3)).toThrow();
  });
});

// Silence unused warnings for helper types
export type __Probe = Snapshot;
