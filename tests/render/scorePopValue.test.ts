// Score pops show what the Brick actually paid (ticket #148 review): the sims
// and the pops share one `brickBreakScore`, and the pop reads the Brick from
// the grid drawn before the break (the snapshot carrying the event already
// shows the cell empty).
import { describe, expect, it } from "vitest";
import { VisualEffects, type VisualEffectsScene } from "render/visualEffects";
import { BRICK_GOLD, brickBreakScore, coloredCell, silverCell, type SimEvent, type Snapshot } from "shared/protocol";

describe("brickBreakScore", () => {
  it("colored tiers pay 50 + (tier - 1) × 10; silver pays 50 on the final break; gold and empty pay 0", () => {
    expect([1, 2, 3, 4, 5, 6].map((tier) => brickBreakScore(coloredCell(tier)))).toEqual([50, 60, 70, 80, 90, 100]);
    expect(brickBreakScore(silverCell(1))).toBe(50);
    expect(brickBreakScore(BRICK_GOLD)).toBe(0);
    expect(brickBreakScore(0)).toBe(0);
  });
});

describe("score pop value", () => {
  const scene: VisualEffectsScene = {
    shakeTarget: { x: 0, y: 0, rotation: 0 },
    particleLayer: null,
    popLayer: { addChild: () => undefined },
    flashLayer: { visible: false, alpha: 0, tint: 0 },
  };
  const grid = (cells: Record<number, number>): number[] => {
    const g = new Array<number>(13 * 18).fill(0);
    for (const [i, v] of Object.entries(cells)) g[Number(i)] = v;
    return g;
  };
  const snap = (tick: number, bricks: number[], events: SimEvent[]): Snapshot => ({
    tick,
    phase: "play",
    round: 1,
    players: [],
    balls: [],
    capsules: [],
    bricks,
    events,
    inputAcks: [],
  });
  const ev = (type: SimEvent["type"], target: number, tick: number): SimEvent => ({ type, source: 0, target, tick });

  it("ball and Bolt breaks pop the Brick's real points", () => {
    const fx = new VisualEffects(scene);
    fx.consume(snap(1, grid({ 15: coloredCell(6), 16: coloredCell(3) }), []));
    fx.consume(
      snap(2, grid({}), [ev("brickBreak", 15, 2), ev("boltHit", 16, 2), ev("brickBreak", 16, 2)]),
    );
    expect(fx.state.pops).toEqual(["+100", "+70"]);
  });

  it("silver's final break pops +50", () => {
    const fx = new VisualEffects(scene);
    fx.consume(snap(1, grid({ 20: silverCell(1) }), []));
    fx.consume(snap(2, grid({}), [ev("brickBreak", 20, 2)]));
    expect(fx.state.pops).toEqual(["+50"]);
  });

  it("with no earlier grid (first frame, rejoin) the pop falls back to the recipe text", () => {
    const fx = new VisualEffects(scene);
    fx.consume(snap(2, grid({}), [ev("brickBreak", 15, 2)]));
    expect(fx.state.pops).toEqual(["+50"]);
  });
});
