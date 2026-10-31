// Laser Bolt module (ticket #142, spec #140): spawn geometry, tip sweep,
// brick kinds, per-Paddle cap, cooldown and the boss counter, all through the
// module's public API with plain-array hooks standing in for a sim.
import { describe, expect, it } from "vitest";
import { Bolts, makeBoltState, resetBoltState, type BoltHooks } from "sim/bolts";
import { BRICK_COLS, BRICK_ROWS, PADDLE_H, PADDLE_W, PADDLE_Y } from "sim/constants";
import { BRICK_EMPTY, BRICK_GOLD } from "shared/protocol";
import type { Box } from "sim/collision";

interface Recorder {
  bricks: number[];
  brickHits: { index: number; shooter: number }[];
  goldHits: { index: number; shooter: number }[];
  bossHits: number[];
  boss: Box | null;
}

/** Hooks over a plain brick grid; normal bricks break, silver decrements. */
function makeHooks(): { hooks: BoltHooks; rec: Recorder } {
  const rec: Recorder = {
    bricks: new Array<number>(BRICK_COLS * BRICK_ROWS).fill(BRICK_EMPTY),
    brickHits: [],
    goldHits: [],
    bossHits: [],
    boss: null,
  };
  const hooks: BoltHooks = {
    cellAt: (index) => rec.bricks[index] ?? BRICK_EMPTY,
    hitBrick: (index, shooter) => {
      rec.brickHits.push({ index, shooter });
      const v = rec.bricks[index] ?? BRICK_EMPTY;
      rec.bricks[index] = v > 9 && v < 13 ? v - 1 : BRICK_EMPTY;
    },
    goldHit: (index, shooter) => {
      rec.goldHits.push({ index, shooter });
    },
    bossBox: () => rec.boss,
    hitBoss: (shooter) => {
      rec.bossHits.push(shooter);
    },
  };
  return { hooks, rec };
}

/** Cell index of grid (col, row). */
const cell = (col: number, row: number): number => row * BRICK_COLS + col;

/** Fire one shot from a default Paddle centred at x. */
function fire(bolts: Bolts, paddle: number, x: number, w = PADDLE_W, owner = paddle): boolean {
  return bolts.tryFire(paddle, owner, x, PADDLE_Y, w, PADDLE_H);
}

describe("Bolts: spawn geometry", () => {
  it("a shot spawns 2 Bolts at the Paddle ends, tip at the Paddle top", () => {
    const { hooks } = makeHooks();
    const bolts = new Bolts(1, hooks);
    expect(fire(bolts, 0, 100)).toBe(true);
    // x = 100 ± (32/2 - 2) = 86 / 114; y = 242 - 6/2 = 239.
    expect(bolts.toSnapshot()).toEqual([
      { x: 86, y: 239, owner: 0 },
      { x: 114, y: 239, owner: 0 },
    ]);
  });

  it("follows the live Paddle width (narrowed and widened)", () => {
    const { hooks } = makeHooks();
    const bolts = new Bolts(2, hooks);
    fire(bolts, 0, 100, 20.8); // Reduce: 32 × 0.65
    fire(bolts, 1, 100, 48); // Expand: 32 × 1.5
    const xs = bolts.toSnapshot().map((b) => b.x);
    expect(xs[0]).toBeCloseTo(91.6);
    expect(xs[1]).toBeCloseTo(108.4);
    expect(xs.slice(2)).toEqual([78, 122]);
  });
});

describe("Bolts: motion and tip sweep", () => {
  it("a Bolt fired this tick holds still, then climbs 4 units per tick", () => {
    const { hooks } = makeHooks();
    const bolts = new Bolts(1, hooks);
    fire(bolts, 0, 100);
    bolts.step();
    expect(bolts.toSnapshot()[0]?.y).toBe(239);
    bolts.step();
    expect(bolts.toSnapshot()[0]?.y).toBe(235);
  });

  it("is removed once its tip passes the top wall (y < 0), not at y = 0", () => {
    const { hooks } = makeHooks();
    const bolts = new Bolts(1, hooks);
    fire(bolts, 0, 100);
    bolts.step(); // fresh
    // 239 → 3 after 59 moves; 239 - 60×4 = -1 on the 60th.
    for (let i = 0; i < 59; i++) bolts.step();
    expect(bolts.toSnapshot()[0]?.y).toBe(3);
    expect(bolts.count).toBe(2);
    bolts.step();
    expect(bolts.count).toBe(0);
  });

  it("sweeps every cell between the previous and new tip, so it never tunnels", () => {
    const { hooks, rec } = makeHooks();
    const bolts = new Bolts(1, hooks);
    // Left Bolt at x = 86 → column 5. Row 17 spans y 156..164.
    rec.bricks[cell(5, 17)] = 1;
    fire(bolts, 0, 100);
    bolts.step();
    // Step the tip to just below the row (y 165), then one step enters it.
    for (let i = 0; i < 18; i++) bolts.step(); // 239 - 72 = 167
    expect(rec.brickHits).toEqual([]);
    bolts.step(); // 163: entered row 17
    expect(rec.brickHits).toEqual([{ index: cell(5, 17), shooter: 0 }]);
    expect(bolts.count).toBe(1);
  });

  it("hits the first non-empty cell in its column, bottom-up", () => {
    const { hooks, rec } = makeHooks();
    const bolts = new Bolts(1, hooks);
    rec.bricks[cell(5, 3)] = 2;
    rec.bricks[cell(5, 10)] = 2;
    rec.bricks[cell(6, 12)] = 2; // a neighbour column, never touched
    fire(bolts, 0, 100);
    for (let i = 0; i < 70; i++) bolts.step();
    expect(rec.brickHits).toEqual([{ index: cell(5, 10), shooter: 0 }]);
  });
});

describe("Bolts: Brick kinds", () => {
  it("a normal Brick breaks and the Bolt is consumed (1 Bolt, 1 Brick)", () => {
    const { hooks, rec } = makeHooks();
    const bolts = new Bolts(1, hooks);
    rec.bricks[cell(5, 10)] = 3;
    rec.bricks[cell(5, 9)] = 3;
    fire(bolts, 0, 100);
    for (let i = 0; i < 70; i++) bolts.step();
    expect(rec.brickHits).toEqual([{ index: cell(5, 10), shooter: 0 }]);
    expect(rec.bricks[cell(5, 9)]).toBe(3);
  });

  it("silver takes one hit per Bolt", () => {
    const { hooks, rec } = makeHooks();
    const bolts = new Bolts(1, hooks);
    rec.bricks[cell(5, 10)] = 11; // silver, 3 hits left
    fire(bolts, 0, 100);
    for (let i = 0; i < 70; i++) bolts.step();
    expect(rec.brickHits).toHaveLength(1);
    expect(rec.bricks[cell(5, 10)]).toBe(10);
  });

  it("gold consumes the Bolt with no damage and reports the clank", () => {
    const { hooks, rec } = makeHooks();
    const bolts = new Bolts(1, hooks);
    rec.bricks[cell(5, 10)] = BRICK_GOLD;
    rec.bricks[cell(5, 4)] = 1;
    fire(bolts, 0, 100);
    for (let i = 0; i < 40; i++) bolts.step();
    expect(rec.goldHits).toEqual([{ index: cell(5, 10), shooter: 0 }]);
    expect(rec.bricks[cell(5, 10)]).toBe(BRICK_GOLD);
    expect(bolts.countFor(0)).toBe(1); // the right Bolt still flies
    for (let i = 0; i < 30; i++) bolts.step();
    expect(rec.brickHits).toEqual([]); // the spent Bolt never reached row 4
  });

  it("a Bolt reaching a cell emptied earlier the same tick keeps flying", () => {
    const { hooks, rec } = makeHooks();
    // Two Paddles stacked on one column: paddle 0's left Bolt resolves first
    // (Paddle index ascending) and breaks the Brick; paddle 1's flies on.
    const bolts = new Bolts(2, hooks);
    rec.bricks[cell(5, 17)] = 1;
    rec.bricks[cell(5, 2)] = 1;
    fire(bolts, 0, 100);
    fire(bolts, 1, 100);
    bolts.step();
    for (let i = 0; i < 19; i++) bolts.step();
    expect(rec.brickHits).toEqual([{ index: cell(5, 17), shooter: 0 }]);
    expect(bolts.countFor(1)).toBe(2);
    for (let i = 0; i < 40; i++) bolts.step();
    expect(rec.brickHits).toEqual([
      { index: cell(5, 17), shooter: 0 },
      { index: cell(5, 2), shooter: 1 },
    ]);
  });

  it("credits the shooter, not the Paddle (shared Paddle)", () => {
    const { hooks, rec } = makeHooks();
    const bolts = new Bolts(1, hooks);
    rec.bricks[cell(5, 10)] = 1;
    bolts.tryFire(0, 2, 100, PADDLE_Y, PADDLE_W, PADDLE_H);
    for (let i = 0; i < 70; i++) bolts.step();
    expect(rec.brickHits).toEqual([{ index: cell(5, 10), shooter: 2 }]);
    expect(bolts.toSnapshot().every((b) => b.owner === 2)).toBe(true);
  });
});

describe("Bolts: per-Paddle cap and cooldown", () => {
  it("fires at most once per 21 ticks (350 ms rounded up)", () => {
    const { hooks } = makeHooks();
    const bolts = new Bolts(1, hooks);
    expect(fire(bolts, 0, 100)).toBe(true);
    let fired = 0;
    let firstAgain = -1;
    for (let t = 1; t <= 21; t++) {
      bolts.step();
      if (fire(bolts, 0, 100)) {
        fired++;
        if (firstAgain < 0) firstAgain = t;
      }
    }
    expect(fired).toBe(1);
    expect(firstAgain).toBe(21);
  });

  it("caps each Paddle at 8 Bolts; an over-cap shot is dropped and keeps the cooldown ready", () => {
    const { hooks } = makeHooks();
    const bolts = new Bolts(2, hooks);
    // A Bolt lives 61 ticks, so the 21-tick cooldown alone keeps 3 shots in
    // flight; repeat Laser catches (resetCooldown) are what reach the cap.
    for (let s = 0; s < 4; s++) {
      bolts.resetCooldown(0);
      expect(fire(bolts, 0, 100)).toBe(true);
      bolts.step();
    }
    expect(bolts.countFor(0)).toBe(8);
    bolts.resetCooldown(0);
    expect(fire(bolts, 0, 100)).toBe(false);
    expect(bolts.countFor(0)).toBe(8);
    expect(bolts.cooldown(0)).toBe(0); // not consumed
    // The cap is per Paddle: the other Paddle still fires.
    expect(fire(bolts, 1, 50)).toBe(true);
    // Once the oldest pair leaves the field, the very next tick may fire.
    while (bolts.countFor(0) === 8) bolts.step();
    expect(bolts.countFor(0)).toBe(6);
    expect(fire(bolts, 0, 100)).toBe(true);
  });

  it("resetCooldown readies a Paddle at once (Laser catch)", () => {
    const { hooks } = makeHooks();
    const bolts = new Bolts(1, hooks);
    fire(bolts, 0, 100);
    expect(bolts.cooldown(0)).toBe(21);
    bolts.resetCooldown(0);
    expect(fire(bolts, 0, 100)).toBe(true);
  });

  it("clear and clearPaddle return Bolts to the pool and ready the Paddle", () => {
    const { hooks } = makeHooks();
    const bolts = new Bolts(2, hooks);
    const warm = bolts.pooled;
    fire(bolts, 0, 100);
    fire(bolts, 1, 50);
    expect(bolts.pooled).toBe(warm - 4);
    bolts.clearPaddle(1);
    expect(bolts.countFor(1)).toBe(0);
    expect(bolts.countFor(0)).toBe(2);
    expect(bolts.cooldown(1)).toBe(0);
    bolts.clear();
    expect(bolts.count).toBe(0);
    expect(bolts.cooldown(0)).toBe(0);
    expect(bolts.pooled).toBe(warm);
  });

  it("rejects an out-of-range Paddle with context", () => {
    const { hooks } = makeHooks();
    const bolts = new Bolts(2, hooks);
    expect(() => fire(bolts, 2, 100)).toThrow(/Bolts\.tryFire: paddle out of range \(paddle=2, paddleCount=2\)/);
    expect(() => new Bolts(0, hooks)).toThrow(/Bolts\.constructor: paddleCount/);
    expect(() => new Bolts(5, hooks)).toThrow(/paddleCount=5/);
  });
});

describe("Bolts: boss counter", () => {
  // Doh box: 48×32 centred at (100, 44) → spans x 76..124, y 28..60.
  const BOSS: Box = { x: 100, y: 44, w: 48, h: 32 };

  it("a Bolt hitting the boss box is consumed; every 4th Bolt costs 1 HP", () => {
    const { hooks, rec } = makeHooks();
    rec.boss = BOSS;
    const bolts = new Bolts(1, hooks);
    fire(bolts, 0, 100); // both Bolts (x 86, 114) inside the box columns
    for (let i = 0; i < 60; i++) bolts.step();
    expect(bolts.count).toBe(0);
    expect(rec.bossHits).toEqual([]);
    expect(bolts.bossHits).toBe(2);
    bolts.resetCooldown(0);
    fire(bolts, 0, 100);
    for (let i = 0; i < 60; i++) bolts.step();
    expect(rec.bossHits).toEqual([0]); // only the HP-losing 4th Bolt reports
    expect(bolts.bossHits).toBe(0);
  });

  it("Bolts beside the boss box fly past it", () => {
    const { hooks, rec } = makeHooks();
    rec.boss = BOSS;
    const bolts = new Bolts(1, hooks);
    fire(bolts, 0, 30); // x 16 / 44: left of 76 - 1
    for (let i = 0; i < 70; i++) bolts.step();
    expect(bolts.bossHits).toBe(0);
    expect(bolts.count).toBe(0); // left through the top wall
  });

  it("a Brick in front of the boss takes the Bolt first", () => {
    const { hooks, rec } = makeHooks();
    rec.boss = BOSS;
    rec.bricks[cell(5, 6)] = BRICK_GOLD; // y 68..76, below the boss face
    const bolts = new Bolts(1, hooks);
    fire(bolts, 0, 100);
    for (let i = 0; i < 70; i++) bolts.step();
    expect(rec.goldHits).toEqual([{ index: cell(5, 6), shooter: 0 }]);
    expect(bolts.bossHits).toBe(1); // only the right Bolt reached Doh
  });

  it("resetBossHits restarts the counter (round start)", () => {
    const { hooks, rec } = makeHooks();
    rec.boss = BOSS;
    const bolts = new Bolts(1, hooks);
    fire(bolts, 0, 100);
    for (let i = 0; i < 60; i++) bolts.step();
    bolts.resetBossHits();
    expect(bolts.bossHits).toBe(0);
    bolts.resetCooldown(0);
    fire(bolts, 0, 100);
    for (let i = 0; i < 60; i++) bolts.step();
    expect(rec.bossHits).toEqual([]);
  });
});

describe("Bolts: pooling (ADR 0006)", () => {
  it("prewarm scales with Paddle count, 8 per Paddle up to 32", () => {
    const { hooks } = makeHooks();
    expect(new Bolts(1, hooks).pooled).toBe(8);
    expect(new Bolts(3, hooks).pooled).toBe(24);
    expect(new Bolts(4, hooks).pooled).toBe(32);
  });

  it("4 Paddles at the cap never allocate past the prewarm", () => {
    const { hooks } = makeHooks();
    const bolts = new Bolts(4, hooks);
    for (let tick = 0; tick < 600; tick++) {
      for (let p = 0; p < 4; p++) {
        bolts.resetCooldown(p);
        fire(bolts, p, 20 + p * 50);
      }
      bolts.step();
      expect(bolts.pooled + bolts.count).toBe(32);
    }
    expect(bolts.count).toBe(32);
  });

  it("resetBoltState clears every field", () => {
    const b = makeBoltState();
    const fresh = makeBoltState();
    Object.assign(b, { x: 5, y: 6, paddle: 3, owner: 2, fresh: true });
    resetBoltState(b);
    expect(b).toEqual(fresh);
    expect(Object.keys(b).sort()).toEqual(["fresh", "owner", "paddle", "x", "y"]);
  });
});
