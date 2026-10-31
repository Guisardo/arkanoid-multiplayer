// Bot Laser behavior (ticket #147, decision #137): Bots fire by holding
// primary (`primaryHeld`), read Armed from `effects.L`, and only Hard re-parks.
import { describe, expect, it } from "vitest";
import { createBot, BOT_LASER_PARAMS, type BotDifficulty } from "sim/bot";
import { createRoundSim } from "sim/roundSim";
import type { LevelData } from "content/levelFormat";
import { getLevelSync } from "content/levels";
import { BRICK_COLS, BRICK_ROWS, PADDLE_Y } from "sim/constants";
import { BRICK_EMPTY, BRICK_GOLD, coloredCell, type InputFrame, type Snapshot } from "shared/protocol";

/** Paddle centred at x 104 (w 32): its ends sit over cols 5 and 7. */
const LEFT_COL = 5;
const RIGHT_COL = 7;
const MID_COL = 6;

function emptyLevel(): LevelData {
  return {
    version: 1,
    round: 1,
    grid: Array.from({ length: BRICK_ROWS }, () => "............."),
    baseBallSpeed: 110,
    silverHitOverride: null,
    capsuleScript: [],
    scoreOverrides: {},
  };
}

interface SnapOpts {
  armed?: boolean;
  /** Grid cells to set: [row, col, value]. */
  cells?: readonly (readonly [number, number, number])[];
  /** A ball diving at the Paddle (threat) instead of one climbing away. */
  threat?: { x: number };
  paddleX?: number;
}

/** A play-phase snapshot with the ball in flight and the given bricks. */
function snap(o: SnapOpts = {}): Snapshot {
  const base = createRoundSim(emptyLevel(), { lives: 3, score: 0 }).snapshot();
  const p = base.players[0];
  if (p === undefined) throw new Error("no player");
  const bricks = new Array<number>(BRICK_COLS * BRICK_ROWS).fill(BRICK_EMPTY);
  for (const [row, col, v] of o.cells ?? []) bricks[row * BRICK_COLS + col] = v;
  const ball = o.threat
    ? { x: o.threat.x, y: 200, vx: 0, vy: 110, attachedTo: null, owner: 0 }
    : { x: 104, y: 120, vx: 0, vy: -110, attachedTo: null, owner: 0 };
  return {
    ...base,
    phase: "play",
    players: [
      {
        ...p,
        paddle: { ...p.paddle, x: o.paddleX ?? p.paddle.x },
        effects: o.armed === false ? {} : { L: 1 },
      },
    ],
    balls: [ball],
    bricks,
  };
}

function sample(difficulty: BotDifficulty, s: Snapshot, seed = 1, ticks = 1): InputFrame[] {
  const bot = createBot(0, difficulty, seed);
  const out: InputFrame[] = [];
  for (let t = 0; t < ticks; t++) out.push(bot.sampleFrame(t, s));
  return out;
}

const BRICK = coloredCell(1);

describe("bot Laser: fire policy per difficulty", () => {
  it("laser params: Easy blind, Normal aimed, Hard aimed + gold-aware + re-park", () => {
    expect(BOT_LASER_PARAMS.easy).toEqual({ aim: "blind", blindFireChance: 0.03, reparkWhenArmed: false });
    expect(BOT_LASER_PARAMS.normal).toEqual({ aim: "brickAbove", blindFireChance: 0, reparkWhenArmed: false });
    expect(BOT_LASER_PARAMS.hard).toEqual({ aim: "skipGold", blindFireChance: 0, reparkWhenArmed: true });
  });

  it("no Bot holds primary while unarmed", () => {
    const s = snap({ armed: false, cells: [[2, LEFT_COL, BRICK]] });
    for (const d of ["easy", "normal", "hard"] as const) {
      expect(sample(d, s, 3, 500).some((f) => f.primaryHeld)).toBe(false);
    }
  });

  it("Easy fires blind at about 0.03 per tick, bricks or not", () => {
    const frames = sample("easy", snap(), 11, 4000);
    const rate = frames.filter((f) => f.primaryHeld).length / frames.length;
    expect(rate).toBeGreaterThan(0.02);
    expect(rate).toBeLessThan(0.04);
  });

  it("Normal fires only with a destructible Brick above a Paddle end", () => {
    expect(sample("normal", snap({ cells: [[2, LEFT_COL, BRICK]] }))[0]?.primaryHeld).toBe(true);
    expect(sample("normal", snap({ cells: [[9, RIGHT_COL, BRICK]] }))[0]?.primaryHeld).toBe(true);
    // A Brick between the ends is not a shot.
    expect(sample("normal", snap({ cells: [[2, MID_COL, BRICK]] }))[0]?.primaryHeld).toBe(false);
    expect(sample("normal", snap())[0]?.primaryHeld).toBe(false);
  });

  it("Normal still fires at a Brick hidden behind gold; Hard skips that shot", () => {
    const goldBlocked = snap({
      cells: [
        [2, LEFT_COL, BRICK],
        [5, LEFT_COL, BRICK_GOLD],
        [5, RIGHT_COL, BRICK_GOLD],
      ],
    });
    expect(sample("normal", goldBlocked)[0]?.primaryHeld).toBe(true);
    expect(sample("hard", goldBlocked)[0]?.primaryHeld).toBe(false);
  });

  it("Hard fires when either end has a clear line to a destructible Brick", () => {
    const oneClear = snap({
      cells: [
        [5, LEFT_COL, BRICK_GOLD],
        [3, RIGHT_COL, BRICK],
      ],
    });
    expect(sample("hard", oneClear)[0]?.primaryHeld).toBe(true);
  });
});

describe("bot Laser: movement", () => {
  /** A single destructible column far left (col 1, centre x 24). */
  const farLeft = { cells: [[2, 1, BRICK]] as const };

  it("only Hard re-parks when Armed and idle, lining a Paddle end up under the column", () => {
    const s = snap(farLeft);
    const hard = sample("hard", s)[0];
    expect(hard?.axisX).toBe(-1);
    // Normal and Easy keep their idle behavior: centred Paddle stays put.
    expect(sample("normal", s)[0]?.axisX).toBe(0);
    expect(sample("easy", s)[0]?.axisX).toBe(0);
  });

  it("Hard parks with an end Bolt column on the target, then holds still", () => {
    // Col 1 centre is x 24: the left end (x - 14) sits on it at paddle x 38,
    // nearer than the wall-clamped right-end spot.
    const parked = snap({ ...farLeft, paddleX: 38 });
    expect(sample("hard", parked)[0]?.axisX).toBe(0);
  });

  it("unarmed Hard keeps its old idle park under the lowest Brick column", () => {
    const s = snap({ armed: false, cells: [[2, 1, BRICK]] });
    expect(sample("hard", s)[0]?.axisX).toBe(-1);
    const centred = snap({ armed: false, cells: [[2, 1, BRICK]], paddleX: 24 });
    expect(sample("hard", centred)[0]?.axisX).toBe(0);
  });

  it("ball defense wins: an Armed Bot tracks the threat exactly as an unarmed one", () => {
    for (const d of ["easy", "normal", "hard"] as const) {
      const armed = snap({ ...farLeft, threat: { x: 180 } });
      const unarmed = snap({ ...farLeft, threat: { x: 180 }, armed: false });
      const a = sample(d, armed, 5)[0];
      const u = sample(d, unarmed, 5)[0];
      expect(a?.axisX).toBe(1);
      expect(a?.axisX).toBe(u?.axisX);
    }
  });
});

describe("bot Laser: determinism", () => {
  it("same seed gives the same input stream through an Armed round", () => {
    function run(difficulty: BotDifficulty): InputFrame[] {
      const sim = createRoundSim(getLevelSync(1), { lives: 99, score: 0 });
      const bot = createBot(0, difficulty, 42);
      const out: InputFrame[] = [];
      for (let t = 0; t < 900; t++) {
        const s = sim.snapshot();
        const p = s.players[0];
        if (t === 200 && p) sim.debugDropCapsule(p.paddle.x, PADDLE_Y, "L");
        const f = bot.sampleFrame(t, s);
        out.push(f);
        sim.step([f]);
      }
      return out;
    }
    for (const d of ["easy", "normal", "hard"] as const) {
      const a = run(d);
      expect(a.some((f) => f.primaryHeld)).toBe(true);
      expect(run(d)).toEqual(a);
    }
  });
});
