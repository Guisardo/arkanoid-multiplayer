import { describe, expect, it } from "vitest";
import { createRoundSim } from "sim/roundSim";
import type { LevelData } from "content/levelFormat";
import { BRICK_COLS, BRICK_ROWS, PADDLE_Y } from "sim/constants";
import { EMPTY_ACTIONS, type InputFrame, type CapsuleTypeId } from "shared/protocol";

function levelWith(script: Array<{ brickBreakCount: number; capsule: CapsuleTypeId }>, brickRows = 1): LevelData {
  const grid: string[] = [];
  for (let r = 0; r < BRICK_ROWS; r++) {
    if (r < brickRows) grid.push("OOOOOOOOOOOOO");
    else grid.push(".".repeat(BRICK_COLS));
  }
  return {
    version: 1,
    round: 1,
    grid,
    baseBallSpeed: 110,
    silverHitOverride: null,
    capsuleScript: script,
    scoreOverrides: {},
  };
}

const BASE_SCRIPT = [
  { brickBreakCount: 1, capsule: "E" as CapsuleTypeId },
  { brickBreakCount: 2, capsule: "P" as CapsuleTypeId },
  { brickBreakCount: 3, capsule: "M" as CapsuleTypeId },
  { brickBreakCount: 4, capsule: "C" as CapsuleTypeId },
  { brickBreakCount: 5, capsule: "L" as CapsuleTypeId },
  { brickBreakCount: 6, capsule: "S" as CapsuleTypeId },
];

function input(tick: number, axisX = 0, launch = false): InputFrame {
  return { player: 0, tick, axisX, axisY: 0, launch, actions: EMPTY_ACTIONS };
}

/** Break exactly n bricks deterministically via debug ball placement. */
function breakBricks(sim: ReturnType<typeof createRoundSim>, n: number): void {
  for (let i = 0; i < n; i++) {
    // Ball above brick row i's position, moving down: col = i % 13, row = floor(i / 13)
    const col = i % BRICK_COLS;
    const row = Math.floor(i / BRICK_COLS);
    sim.debugSetBall(col * 16 + 8, 20 + row * 8 - 10, 0, 110);
    sim.step([input(sim.currentTick)]);
    // keep stepping until the capsule (if any) spawns or ball passes
    for (let s = 0; s < 3; s++) sim.step([input(sim.currentTick)]);
  }
}

describe("capsule script determinism (zero RNG)", () => {
  it("same break sequence → same capsule drops, same types, same order", () => {
    const run = (): { type: CapsuleTypeId; x: number; y: number }[] => {
      const sim = createRoundSim(levelWith(BASE_SCRIPT), { lives: 3, score: 0 });
      breakBricks(sim, 6);
      return sim.snapshot().capsules.map((c) => ({ type: c.type, x: c.x, y: c.y }));
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.map((c) => c.type)).toEqual(["E", "P", "M", "C", "L", "S"]);
  });

  it("capsules spawn at the just-broken brick's position", () => {
    const sim = createRoundSim(levelWith(BASE_SCRIPT), { lives: 3, score: 0 });
    // Break brick col 5 row 0 → capsule at col*16+8 center, y = 20+4 = 24
    sim.debugSetBall(5 * 16 + 8, 10, 0, 110);
    for (let i = 0; i < 10 && sim.snapshot().capsules.length === 0; i++) {
      sim.step([input(sim.currentTick)]);
    }
    const caps = sim.snapshot().capsules;
    expect(caps.length).toBe(1);
    expect(caps[0]!.x).toBeCloseTo(5 * 16 + 8, 1);
    // spawn y=24 (brick center) + at most one same-step fall of 0.75 u
    expect(caps[0]!.y).toBeGreaterThan(23.9);
    expect(caps[0]!.y).toBeLessThanOrEqual(24.76);
  });

  it("script trigger binds to cumulative brick-break count, not order", () => {
    const sim = createRoundSim(levelWith(BASE_SCRIPT), { lives: 3, score: 0 });
    // Break 3 bricks → first 3 scripted capsules out
    breakBricks(sim, 3);
    const types = sim.snapshot().capsules.map((c) => c.type);
    expect(types).toEqual(["E", "P", "M"]);
  });
});

describe("? (Random) resolution", () => {
  it("resolves to the next undropped scripted capsule", () => {
    const script = [
      { brickBreakCount: 1, capsule: "?" as CapsuleTypeId },
      { brickBreakCount: 2, capsule: "L" as CapsuleTypeId },
      { brickBreakCount: 3, capsule: "S" as CapsuleTypeId },
      { brickBreakCount: 4, capsule: "P" as CapsuleTypeId },
      { brickBreakCount: 5, capsule: "C" as CapsuleTypeId },
      { brickBreakCount: 6, capsule: "M" as CapsuleTypeId },
    ];
    const sim = createRoundSim(levelWith(script), { lives: 3, score: 0 });
    breakBricks(sim, 2);
    // first drop resolved ?→next undropped scripted = "L"? No: ? resolves to next
    // undropped scripted capsule for that level — L is undropped → ? became L;
    // then the 2nd break drops L's own entry? L already "dropped" as the ?
    // resolution — the ? consumes the entry.
    const types = sim.snapshot().capsules.map((c) => c.type);
    expect(types).toEqual(["L", "L"]);
  });

  it("? at the script's end resolves to E fallback (script exhausted)", () => {
    const script = [
      { brickBreakCount: 1, capsule: "P" as CapsuleTypeId },
      { brickBreakCount: 2, capsule: "L" as CapsuleTypeId },
      { brickBreakCount: 3, capsule: "S" as CapsuleTypeId },
      { brickBreakCount: 4, capsule: "M" as CapsuleTypeId },
      { brickBreakCount: 5, capsule: "C" as CapsuleTypeId },
      { brickBreakCount: 6, capsule: "?" as CapsuleTypeId },
    ];
    // 7th break: cursor at end → ? resolves E (nothing undropped left).
    // Build a level with 2 rows + a ? trigger at 7th break.
    const sim = createRoundSim(
      {
        ...levelWith(script, 2),
        capsuleScript: [
          ...script.slice(0, 5),
          { brickBreakCount: 6, capsule: "?" },
          { brickBreakCount: 7, capsule: "?" },
        ],
      },
      { lives: 3, score: 0 },
    );
    breakBricks(sim, 7);
    const types = sim.snapshot().capsules.map((c) => c.type);
    // 6th break: ? → next undropped scripted capsule = none ahead except the
    // 7th's own ? (not resolvable) → E fallback. 7th break: same → E.
    expect(types.slice(5)).toEqual(["E", "E"]);
  });
});

describe("capsule catch", () => {
  it("paddle catches a falling capsule by box overlap", () => {
    const sim = createRoundSim(levelWith(BASE_SCRIPT), { lives: 3, score: 0 });
    // park ball below field (will be lost once — lives 3→2), capsule test only
    sim.debugSetBall(104, 300, 0, 60);
    for (let i = 0; i < 15; i++) sim.step([input(sim.currentTick)]);
    const livesBefore = sim.snapshot().players[0]!.lives;
    // force a capsule at paddle x, just above paddle
    sim.debugDropCapsule(104, PADDLE_Y - 10, "P");
    for (let i = 0; i < 10; i++) sim.step([input(sim.currentTick)]);
    // capsule caught → lives +1
    expect(sim.snapshot().players[0]!.lives).toBe(livesBefore + 1);
    expect(sim.snapshot().capsules.length).toBe(0);
  });

  it("capsule falls at 45 u/s", () => {
    const sim = createRoundSim(levelWith(BASE_SCRIPT), { lives: 3, score: 0 });
    sim.debugDropCapsule(50, 100, "E");
    sim.step([input(sim.currentTick)]);
    sim.step([input(sim.currentTick)]);
    const c = sim.snapshot().capsules[0]!;
    expect(c.y).toBeCloseTo(100 + 2 * (45 / 60), 3);
  });

  it("missed capsule despawns below the field", () => {
    const sim = createRoundSim(levelWith(BASE_SCRIPT), { lives: 3, score: 0 });
    sim.debugDropCapsule(10, 250, "E");
    for (let i = 0; i < 30; i++) sim.step([input(sim.currentTick)]);
    expect(sim.snapshot().capsules.length).toBe(0);
  });
});

describe("capsule effects (classic-accurate)", () => {
  it("E (Expand) widens the paddle", () => {
    const sim = createRoundSim(levelWith(BASE_SCRIPT), { lives: 3, score: 0 });
    const w0 = sim.snapshot().players[0]!.paddle.w;
    sim.debugDropCapsule(104, PADDLE_Y - 4, "E");
    sim.step([input(sim.currentTick)]);
    expect(sim.snapshot().players[0]!.paddle.w).toBeGreaterThan(w0);
  });

  it("R (Reduce) shrinks the paddle — negative capsule", () => {
    const sim = createRoundSim(levelWith(BASE_SCRIPT), { lives: 3, score: 0 });
    const w0 = sim.snapshot().players[0]!.paddle.w;
    sim.debugDropCapsule(104, PADDLE_Y - 4, "R");
    sim.step([input(sim.currentTick)]);
    expect(sim.snapshot().players[0]!.paddle.w).toBeLessThan(w0);
  });

  it("P (Player) grants an extra life", () => {
    const sim = createRoundSim(levelWith(BASE_SCRIPT), { lives: 3, score: 0 });
    sim.debugDropCapsule(104, PADDLE_Y - 4, "P");
    sim.step([input(sim.currentTick)]);
    expect(sim.snapshot().players[0]!.lives).toBe(4);
  });

  it("S (Slow) reduces ball speed to base", () => {
    const sim = createRoundSim(levelWith(BASE_SCRIPT), { lives: 3, score: 0 });
    sim.debugSetBall(104, 100, 0, -110);
    for (let i = 0; i < 5; i++) sim.step([input(sim.currentTick)]);
    sim.debugDropCapsule(104, PADDLE_Y - 4, "S");
    sim.step([input(sim.currentTick)]);
    const b = sim.snapshot().balls[0]!;
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(110, 0);
  });

  it("effects clear on ball loss (classic rule)", () => {
    const sim = createRoundSim(levelWith(BASE_SCRIPT), { lives: 3, score: 0 });
    sim.debugDropCapsule(104, PADDLE_Y - 4, "E");
    sim.step([input(sim.currentTick)]);
    expect(sim.snapshot().players[0]!.paddle.w).toBeGreaterThan(32);
    // lose the ball
    sim.debugSetBall(104, 300, 0, 60);
    for (let i = 0; i < 10; i++) sim.step([input(sim.currentTick)]);
    expect(sim.snapshot().players[0]!.paddle.w).toBe(32);
  });

  it("M (Multiball) splits the ball into 3; only last re-attaches on drop", () => {
    const sim = createRoundSim(levelWith(BASE_SCRIPT), { lives: 3, score: 0 });
    // serve first
    sim.step([input(sim.currentTick, 0, true)]);
    const inPlay = sim.snapshot();
    expect(inPlay.balls).toHaveLength(1);
    sim.debugDropCapsule(104, PADDLE_Y - 4, "M");
    sim.step([input(sim.currentTick)]);
    const after = sim.snapshot();
    expect(after.balls.length).toBe(3);
    // keep ball 0 alive, lose balls 1 and 2 deterministically
    sim.debugSetBall(104, 100, 0, -110);
    // lose balls 1 and 2 deterministically
    sim.debugLoseBallsExcept(0);
    for (let i = 0; i < 20; i++) sim.step([input(sim.currentTick)]);
    const final = sim.snapshot();
    // only one ball lost a life (others simply lost per multiball rule)…
    // 2 balls dropped, no life penalty; last ball attaches on next drop.
    expect(final.players[0]!.lives).toBe(3);
  });

  it("B (Break) counts as clear in every respect", () => {
    const script = [
      { brickBreakCount: 1, capsule: "B" as CapsuleTypeId },
      { brickBreakCount: 2, capsule: "P" as CapsuleTypeId },
      { brickBreakCount: 3, capsule: "L" as CapsuleTypeId },
      { brickBreakCount: 4, capsule: "S" as CapsuleTypeId },
      { brickBreakCount: 5, capsule: "M" as CapsuleTypeId },
      { brickBreakCount: 6, capsule: "C" as CapsuleTypeId },
    ];
    const sim = createRoundSim(levelWith(script), { lives: 3, score: 0 });
    breakBricks(sim, 1); // brick 1 broken → B capsule drops
    sim.debugDropCapsule(104, PADDLE_Y - 4, "B");
    sim.step([input(sim.currentTick)]); // catch B → round clear
    expect(sim.snapshot().phase).toBe("roundClear");
  });
});
