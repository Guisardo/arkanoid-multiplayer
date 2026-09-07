import { describe, expect, it } from "vitest";
import {
  BUDGETS,
  createDrawCallCounter,
  estimateTextureBytes,
  FrameStats,
  textureWithinBudget,
  type DrawCallContext,
} from "app/frameStats";

describe("frame budgets (ticket 54, spec §12)", () => {
  it("locks the spec budget constants", () => {
    expect(BUDGETS.simMs).toBe(2);
    expect(BUDGETS.syncMs).toBe(3);
    expect(BUDGETS.renderMs).toBe(5);
    expect(BUDGETS.totalMs).toBe(10);
    expect(BUDGETS.headroomMs).toBe(8);
    expect(BUDGETS.drawCalls).toBe(20);
    expect(BUDGETS.drawCallsExpected).toBe(10);
    expect(BUDGETS.textureMb).toBe(64);
  });
});

describe("FrameStats rolling window", () => {
  it("empty view reports zeros and no over-budget", () => {
    const stats = new FrameStats();
    const v = stats.view;
    expect(v.samples).toBe(0);
    expect(v.fps).toBe(0);
    expect(v.overBudget).toEqual({ sim: false, sync: false, render: false, total: false });
  });

  it("averages samples over the window", () => {
    const stats = new FrameStats();
    stats.push({ simMs: 1, syncMs: 2, renderMs: 4, frameMs: 16.7 } as never, 16.7);
    stats.push({ simMs: 3, syncMs: 4, renderMs: 6, frameMs: 16.7 } as never, 16.7);
    const v = stats.view;
    expect(v.avg.simMs).toBe(2);
    expect(v.avg.syncMs).toBe(3);
    expect(v.avg.renderMs).toBe(5);
    expect(v.worst.simMs).toBe(3);
    expect(v.worst.syncMs).toBe(4);
    expect(v.worst.renderMs).toBe(6);
  });

  it("flags over-budget averages per spec split", () => {
    const stats = new FrameStats();
    stats.push({ simMs: 2.5, syncMs: 0.5, renderMs: 1, frameMs: 16.7 } as never, 16.7);
    expect(stats.view.overBudget.sim).toBe(true);
    expect(stats.view.overBudget.sync).toBe(false);
    // Later frames drop sim, spike sync — averages converge: sim falls
    // under 2, sync climbs over 3.
    for (let i = 0; i < 9; i++) {
      stats.push({ simMs: 0.5, syncMs: 3.5, renderMs: 1, frameMs: 16.7 } as never, 16.7);
    }
    const v = stats.view;
    expect(v.overBudget.sim).toBe(false); // avg (2.5 + 9×0.5)/10 = 0.7
    expect(v.overBudget.sync).toBe(true); // avg (0.5 + 9×3.5)/10 = 3.2
  });

  it("total over-budget when the sum of averages exceeds 10 ms", () => {
    const stats = new FrameStats();
    stats.push({ simMs: 4, syncMs: 4, renderMs: 4, frameMs: 16.7 } as never, 16.7);
    expect(stats.view.overBudget.total).toBe(true);
  });

  it("estimates fps from frame times", () => {
    const stats = new FrameStats();
    for (let i = 0; i < 60; i++) {
      stats.push({ simMs: 1, syncMs: 1, renderMs: 1, frameMs: 16.7 } as never, 16.7);
    }
    expect(stats.view.fps).toBeGreaterThan(55);
    expect(stats.view.fps).toBeLessThan(65);
  });

  it("window drops old samples", () => {
    const stats = new FrameStats(3);
    for (let i = 0; i < 10; i++) {
      stats.push({ simMs: i, syncMs: 0, renderMs: 0, frameMs: 16.7 } as never, 16.7);
    }
    expect(stats.view.samples).toBe(3);
    // Last three pushes: 7, 8, 9 → avg 8.
    expect(stats.view.avg.simMs).toBe(8);
  });
});

describe("texture estimator", () => {
  it("sums w×h×4 bytes", () => {
    const bytes = estimateTextureBytes([
      { w: 64, h: 16 },
      { w: 16, h: 16 },
    ]);
    expect(bytes).toBe(64 * 16 * 4 + 16 * 16 * 4);
  });

  it("shipped sprite set sits far inside the 64 MB budget", () => {
    // The real shipped set (7 small PNGs) — exact for the static assets.
    const bytes = estimateTextureBytes([
      { w: 64, h: 16 }, { w: 64, h: 16 }, { w: 64, h: 16 },
      { w: 16, h: 16 }, { w: 16, h: 16 }, { w: 16, h: 16 },
      { w: 64, h: 64 },
    ]);
    expect(textureWithinBudget(bytes)).toBe(true);
    expect(bytes).toBeLessThan(1024 * 1024); // < 1 MB
  });

  it("rejects a set over the ceiling", () => {
    expect(textureWithinBudget(65 * 1024 * 1024)).toBe(false);
  });
});

describe("draw-call counter", () => {
  it("counts drawArrays + drawElements calls", () => {
    const counter = createDrawCallCounter();
    const drawArrays: NonNullable<DrawCallContext["drawArrays"]> = () => {};
    const drawElements: NonNullable<DrawCallContext["drawElements"]> = () => {};
    const ctx: DrawCallContext = { drawArrays, drawElements };
    const restore = counter.wrap(ctx);
    // Call through the wrapped ctx (the counter replaced the methods).
    ctx.drawArrays?.(0, 0, 6);
    ctx.drawArrays?.(0, 0, 6);
    ctx.drawElements?.(0, 6, 0, 0);
    expect(counter.count).toBe(3);
    restore();
  });

  it("counts instanced variants too", () => {
    const counter = createDrawCallCounter();
    const drawArraysInstanced: NonNullable<DrawCallContext["drawArraysInstanced"]> = () => {};
    const drawElementsInstanced: NonNullable<DrawCallContext["drawElementsInstanced"]> = () => {};
    const ctx: DrawCallContext = { drawArraysInstanced, drawElementsInstanced };
    counter.wrap(ctx);
    ctx.drawArraysInstanced?.(0, 0, 6, 1);
    ctx.drawElementsInstanced?.(0, 6, 0, 0, 1);
    expect(counter.count).toBe(2);
  });

  it("resetFrame zeroes the count", () => {
    const counter = createDrawCallCounter();
    const drawArrays: NonNullable<DrawCallContext["drawArrays"]> = () => {};
    const ctx: DrawCallContext = { drawArrays };
    counter.wrap(ctx);
    ctx.drawArrays?.(0, 0, 6);
    counter.resetFrame();
    expect(counter.count).toBe(0);
  });

  it("wrapping a context without the methods is a no-op", () => {
    const counter = createDrawCallCounter();
    expect(() => counter.wrap({})).not.toThrow();
    expect(counter.count).toBe(0);
  });
});
