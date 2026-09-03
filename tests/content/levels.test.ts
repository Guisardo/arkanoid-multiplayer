import { describe, expect, it } from "vitest";
import { getLevel, availableRounds } from "content/levels";
import { validateLevel } from "content/levelFormat";
import { CHAR_TIER, TIER_SCORE, DUEL_DROP_BONUS } from "content/scoring";
import { createRoundSim } from "sim/roundSim";
import { BRICK_COLS, BRICK_ROWS } from "sim/constants";
import { EMPTY_ACTIONS, isDestructibleCell, type InputFrame } from "shared/protocol";

function input(tick: number, axisX = 0): InputFrame {
  return { player: 0, tick, axisX, axisY: 0, launch: false, actions: EMPTY_ACTIONS };
}

describe("level JSON validation (spec §4)", () => {
  it("rounds 1–16 all present and validate with zero errors", () => {
    expect(availableRounds()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    for (const round of availableRounds()) {
      const level = getLevel(round);
      const errors = validateLevel(level);
      expect(errors, `round ${String(round)}: ${JSON.stringify(errors)}`).toEqual([]);
    }
  });

  it("grid dims exact 13×18 every round", () => {
    for (const round of availableRounds()) {
      const level = getLevel(round);
      expect(level.grid).toHaveLength(BRICK_ROWS);
      for (const row of level.grid) {
        expect(row.length, `round ${String(round)} row len`).toBe(BRICK_COLS);
      }
    }
  });

  it("capsule scripts: 6–10 entries, strictly increasing, ≤ destructible count", () => {
    for (const round of availableRounds()) {
      const level = getLevel(round);
      expect(level.capsuleScript.length).toBeGreaterThanOrEqual(6);
      expect(level.capsuleScript.length).toBeLessThanOrEqual(10);
      const destructible = level.grid
        .join("")
        .split("")
        .filter((c) => c !== "." && c !== "G").length;
      let prev = 0;
      for (const e of level.capsuleScript) {
        expect(e.brickBreakCount).toBeGreaterThan(prev);
        expect(e.brickBreakCount).toBeLessThanOrEqual(destructible);
        prev = e.brickBreakCount;
      }
    }
  });

  it("base speeds escalate (round 1 = 110)", () => {
    expect(getLevel(1).baseBallSpeed).toBe(110);
    let prev = 0;
    for (const round of availableRounds()) {
      const speed = getLevel(round).baseBallSpeed;
      if (round !== 1) expect(speed).toBeGreaterThan(prev);
      prev = speed;
    }
  });

  it("scoring table covers every colored char used in grids; duel drop 500", () => {
    const used = new Set<string>();
    for (const round of availableRounds()) {
      for (const ch of getLevel(round).grid.join("")) {
        if (ch !== "." && ch !== "G" && ch !== "S") used.add(ch);
      }
    }
    for (const ch of used) {
      const tier = CHAR_TIER[ch];
      expect(tier, `char ${ch}`).toBeDefined();
      expect(TIER_SCORE[tier ?? 0]).toBeDefined();
    }
    expect(DUEL_DROP_BONUS).toBe(500);
  });
});

describe("playability: every round clears under scripted play", () => {
  for (const round of availableRounds()) {
    it(`round ${String(round)} clears start-to-finish`, () => {
      const level = getLevel(round);
      const sim = createRoundSim(level, { lives: 99, score: 0 });
      let steps = 0;
      while (sim.snapshot().phase !== "roundClear" && steps < 3000) {
        // Lowest (min row) destructible brick; approach from below, moving up
        // (real play direction — gold ceilings above never block this path).
        const snap = sim.snapshot();
        let target = -1;
        for (let i = 0; i < snap.bricks.length; i++) {
          if (isDestructibleCell(snap.bricks[i] ?? 0)) {
            target = i;
            break;
          }
        }
        if (target < 0) break;
        const col = target % BRICK_COLS;
        const row = Math.floor(target / BRICK_COLS);
        // Just below the brick's bottom edge, small x jitter to dodge gold
        // walls directly beneath (none below the lowest row in practice).
        const bx = col * 16 + 8 + ((steps % 3) - 1) * 2;
        const by = 20 + (row + 1) * 8 + 6;
        sim.debugSetBall(Math.max(4, Math.min(204, bx)), by, 0, -200);
        for (let s = 0; s < 20; s++) {
          sim.step([input(sim.currentTick)]);
          steps++;
          if (sim.snapshot().phase === "roundClear") break;
        }
      }
      expect(sim.snapshot().phase).toBe("roundClear");
      expect(sim.snapshot().bricks.every((c) => !isDestructibleCell(c))).toBe(true);
    });
  }
});
