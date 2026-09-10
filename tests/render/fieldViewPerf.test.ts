// Ticket 54: reduced-effects mode measurably reduces per-frame render
// work. Real Pixi Graphics runs headless (instruction-list only — proven
// by fieldViewSkins tests); the painters are the measurable seam —
// mocked here with call counters. Full mode: owner-glow + cracks +
// ball body; reduced mode: ball body only (readability gate preserved).
import { describe, expect, it, vi } from "vitest";

const painterCalls: Record<string, number> = {
  paintPaddle: 0,
  paintBall: 0,
  paintOwnerGlow: 0,
  paintCapsule: 0,
  paintBoss: 0,
  crackSegments: 0,
};

vi.mock("render/skinPainter", () => ({
  paintPaddle: (): void => {
    painterCalls["paintPaddle"] = (painterCalls["paintPaddle"] ?? 0) + 1;
  },
  paintBall: (): void => {
    painterCalls["paintBall"] = (painterCalls["paintBall"] ?? 0) + 1;
  },
  paintOwnerGlow: (): void => {
    painterCalls["paintOwnerGlow"] = (painterCalls["paintOwnerGlow"] ?? 0) + 1;
  },
  paintCapsule: (): void => {
    painterCalls["paintCapsule"] = (painterCalls["paintCapsule"] ?? 0) + 1;
  },
  paintBoss: (): void => {
    painterCalls["paintBoss"] = (painterCalls["paintBoss"] ?? 0) + 1;
  },
}));

vi.mock("render/brickCracks", () => ({
  crackSegments: (): Array<{ x1: number; y1: number; x2: number; y2: number }> => {
    painterCalls["crackSegments"] = (painterCalls["crackSegments"] ?? 0) + 1;
    return [];
  },
}));

import { FieldView } from "render/fieldView";
import { layoutField } from "render/layout";
import { createRoundSim } from "sim/roundSim";
import { getLevel } from "content/levels";
import type { Snapshot } from "shared/protocol";

const layout = layoutField({ x: 0, y: 0, w: 800, h: 600 });

/** Snapshot with an owned ball + silver bricks (glow + crack paths). */
function busySnapshot(): Snapshot {
  const sim = createRoundSim(getLevel(1), { lives: 3, score: 0 });
  const snap = sim.snapshot();
  return {
    ...snap,
    // Two players = duel shape — ownership marking active (solo fields
    // carry no ownership semantics and skip tint/ring/bars).
    players: [
      snap.players[0]!,
      { ...snap.players[0]!, player: 1, name: "Bot 1" },
    ],
    balls: snap.balls.map((b) => ({ ...b, owner: 1 })),
    bricks: snap.bricks.map((c, i) => (i < 6 ? 9 : c)), // silver tier
  };
}

function resetCalls(): void {
  for (const k of Object.keys(painterCalls)) painterCalls[k] = 0;
}

describe("FieldView reduced-effects (ticket 54)", () => {
  it("reduced mode skips owner-glow and crack painters on a busy frame", () => {
    const snap = busySnapshot();
    const full = new FieldView({ layout, player: 0, locale: "en-US", maxRound: 33 });
    resetCalls();
    full.sync(snap);
    expect(painterCalls.paintOwnerGlow).toBeGreaterThan(0); // owned ball
    expect(painterCalls.crackSegments).toBeGreaterThan(0); // silver bricks
    expect(painterCalls.paintBall).toBeGreaterThan(0); // body always drawn

    const reduced = new FieldView({
      layout,
      player: 0,
      locale: "en-US",
      maxRound: 33,
      reducedEffects: true,
    });
    resetCalls();
    reduced.sync(snap);
    expect(painterCalls.paintOwnerGlow).toBe(0); // glow skipped
    expect(painterCalls.crackSegments).toBe(0); // cracks skipped
    expect(painterCalls.paintBall).toBeGreaterThan(0); // body kept

    full.container.destroy({ children: true });
    reduced.container.destroy({ children: true });
  });

  it("setReducedEffects toggles live (glow returns when turned back off)", () => {
    const snap = busySnapshot();
    const view = new FieldView({
      layout,
      player: 0,
      locale: "en-US",
      maxRound: 33,
      reducedEffects: true,
    });
    view.sync(snap);
    resetCalls();
    view.setReducedEffects(false);
    view.sync(snap); // invalidate → full redraw
    expect(painterCalls.paintOwnerGlow).toBeGreaterThan(0);
    expect(painterCalls.crackSegments).toBeGreaterThan(0);

    view.setReducedEffects(true);
    resetCalls();
    view.sync(snap);
    expect(painterCalls.paintOwnerGlow).toBe(0);
    expect(painterCalls.crackSegments).toBe(0);
    view.container.destroy({ children: true });
  });

  it("invalidate forces a full brick redraw on next sync", () => {
    const snap = busySnapshot();
    const view = new FieldView({ layout, player: 0, locale: "en-US", maxRound: 33 });
    view.sync(snap);
    // Identical bricks → diff empty → no crack painter calls.
    resetCalls();
    view.sync(snap);
    expect(painterCalls.crackSegments).toBe(0);
    // Invalidate → next sync redraws all bricks (crack path runs again).
    view.invalidate();
    resetCalls();
    view.sync(snap);
    expect(painterCalls.crackSegments).toBeGreaterThan(0);
    view.container.destroy({ children: true });
  });
});
