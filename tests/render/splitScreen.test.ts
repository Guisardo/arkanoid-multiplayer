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

  // ---- Ticket 53 (N2): regionOf — mouse/touch overlay anchor ----

  it("regionOf maps each player to its N-across region", () => {
    const view = new SplitScreenView({
      viewport: { w: 1600, h: 900 },
      players: [0, 1, 2, 3],
      locale: "en-US",
      maxRound: 33,
    });
    const r0 = view.regionOf(0);
    const r1 = view.regionOf(1);
    const r3 = view.regionOf(3);
    expect(r0).toEqual({ x: 0, y: 0, w: 394, h: 900 });
    expect(r1).toEqual({ x: 402, y: 0, w: 394, h: 900 });
    expect(r3).toEqual({ x: 1206, y: 0, w: 394, h: 900 });
    // Unknown player → null.
    expect(view.regionOf(9)).toBeNull();
    view.container.destroy({ children: true });
  });

  it("regionOf follows resize (regions recomputed)", () => {
    const view = new SplitScreenView({
      viewport: { w: 800, h: 600 },
      players: [0, 1],
      locale: "en-US",
      maxRound: 33,
    });
    const before = view.regionOf(1);
    expect(before).toEqual({ x: 404, y: 0, w: 396, h: 600 });
    view.resize({ w: 400, h: 300 });
    const after = view.regionOf(1);
    expect(after).toEqual({ x: 204, y: 0, w: 196, h: 300 });
    view.container.destroy({ children: true });
  });

  it("per-player skins + theme + reduced effects flow into every FieldView", () => {
    const sim = createRoundSim(getLevel(1), { lives: 3, score: 0, playerName: "P" });
    const view = new SplitScreenView({
      viewport: { w: 800, h: 600 },
      players: [0, 1],
      locale: "en-US",
      maxRound: 33,
      skinIds: ["skin-a", "skin-b"],
      themeId: "theme-x",
      reducedEffects: true,
    });
    expect(view.fieldCount).toBe(2);
    // Both fields render with the options (sync exercises the views).
    view.sync([sim.snapshot(), sim.snapshot()]);
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

  // ---- Ticket 54: perf wiring ----

  it("reducedEffects flows into every field", () => {
    const view = new SplitScreenView({
      viewport: { w: 1600, h: 900 },
      players: [0, 1],
      locale: "en-US",
      maxRound: 33,
      reducedEffects: true,
    });
    expect(view.fieldCount).toBe(2);
    view.container.destroy({ children: true });
  });

  it("invalidate + setReducedEffects reach every field (context resync)", () => {
    const view = new SplitScreenView({
      viewport: { w: 1600, h: 900 },
      players: [0, 1],
      locale: "en-US",
      maxRound: 33,
    });
    expect(() => {
      view.invalidate();
      view.setReducedEffects(true);
      view.setReducedEffects(false);
    }).not.toThrow();
    view.container.destroy({ children: true });
  });

  it("degradation never collapses fields: resize under reduced effects keeps both", () => {
    const view = new SplitScreenView({
      viewport: { w: 1600, h: 900 },
      players: [0, 1],
      locale: "en-US",
      maxRound: 33,
      reducedEffects: true,
    });
    view.resize({ w: 320, h: 200 }); // heavy degradation size
    expect(view.fieldCount).toBe(2);
    view.container.destroy({ children: true });
  });
});
