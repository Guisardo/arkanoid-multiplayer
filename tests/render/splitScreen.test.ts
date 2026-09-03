import { describe, expect, it } from "vitest";
import { SplitScreenView } from "render/splitScreen";
import { createRoundSim } from "sim/roundSim";
import { getLevel } from "content/levels";
import { splitRegions } from "render/layout";

describe("SplitScreenView (ticket 34)", () => {
  it("creates one FieldView per player, N-across", () => {
    const view = new SplitScreenView({
      viewport: { w: 1600, h: 900 },
      players: [0, 1, 2, 3],
      locale: "en-US",
      maxRound: 33,
    });
    expect(view.fieldCount).toBe(4);
    view.container.destroy({ children: true });
  });

  it("single player = one centered field", () => {
    const view = new SplitScreenView({
      viewport: { w: 800, h: 600 },
      players: [0],
      locale: "en-US",
      maxRound: 33,
    });
    expect(view.fieldCount).toBe(1);
    view.container.destroy({ children: true });
  });

  it("resize keeps all fields (never collapses)", () => {
    const view = new SplitScreenView({
      viewport: { w: 1600, h: 900 },
      players: [0, 1],
      locale: "en-US",
      maxRound: 33,
    });
    view.resize({ w: 400, h: 300 });
    expect(view.fieldCount).toBe(2);
    view.container.destroy({ children: true });
  });

  it("sync consumes snapshots per field without sim internals", () => {
    const view = new SplitScreenView({
      viewport: { w: 1600, h: 900 },
      players: [0, 1],
      locale: "en-US",
      maxRound: 33,
    });
    const level = getLevel(1);
    const sims = [createRoundSim(level, { lives: 3, score: 0 }), createRoundSim(level, { lives: 3, score: 0 })];
    const snaps = sims.map((s) => s.snapshot());
    view.sync(snaps);
    view.sync(snaps); // idempotent
    view.container.destroy({ children: true });
  });

  it("regions match splitRegions math (8px gutters, equal columns)", () => {
    const regions = splitRegions({ w: 808, h: 600 }, 2);
    expect(regions[1]!.x - (regions[0]!.x + regions[0]!.w)).toBe(8);
    expect(regions[0]!.w).toBe(regions[1]!.w);
  });
});
