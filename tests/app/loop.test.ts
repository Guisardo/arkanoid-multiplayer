import { describe, expect, it } from "vitest";
import { createAccumulatorLoop } from "app/loop";
import { SIM_HZ } from "shared/simRates";

describe("accumulator loop", () => {
  it("runs one tick per 1/60 s of wall clock", () => {
    const ticks: number[] = [];
    const loop = createAccumulatorLoop({ tick: (t) => ticks.push(t), render: () => {} });
    loop.advance(0);
    for (let i = 0; i < 6; i++) loop.advance(1000 / SIM_HZ);
    expect(ticks).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("never drops ticks at normal frame rates (60 fps → 1 tick/frame)", () => {
    let tickCount = 0;
    const loop = createAccumulatorLoop({ tick: () => tickCount++, render: () => {} });
    loop.advance(0);
    for (let frame = 0; frame < 60; frame++) loop.advance(1000 / 60);
    expect(tickCount).toBe(60);
  });

  it("30 fps frames run 2 ticks each — sim stays 60 Hz", () => {
    let tickCount = 0;
    const loop = createAccumulatorLoop({ tick: () => tickCount++, render: () => {} });
    loop.advance(0);
    for (let frame = 0; frame < 30; frame++) loop.advance(1000 / 30);
    expect(tickCount).toBe(60);
  });

  it("caps catch-up at 5 ticks per frame under overload", () => {
    const ticks: number[] = [];
    const loop = createAccumulatorLoop({ tick: (t) => ticks.push(t), render: () => {} });
    loop.advance(0);
    loop.advance(1000); // 60 ticks of backlog → capped at 5
    expect(ticks.length).toBe(5);
  });

  it("accumulator fractional remainder carries across frames", () => {
    const ticks: number[] = [];
    const loop = createAccumulatorLoop({ tick: (t) => ticks.push(t), render: () => {} });
    loop.advance(0);
    // 59 fps-ish frames: 1 tick most frames, occasional 2 — no drift.
    let ran = 0;
    for (let frame = 0; frame < 59; frame++) {
      loop.advance(1000 / 59);
      ran++;
    }
    expect(ticks.length).toBeGreaterThanOrEqual(58);
    expect(ticks.length).toBeLessThanOrEqual(ran + 1);
  });

  // ---- Ticket 54: renderEvery + onFrameStats ----

  it("30 fps degraded mode (renderEvery=2) keeps the sim at fixed 60 Hz", () => {
    let tickCount = 0;
    let renderCount = 0;
    const loop = createAccumulatorLoop({ tick: () => tickCount++, render: () => renderCount++ });
    loop.advance(0);
    loop.setRenderEvery(2);
    // rAF still fires ~60 Hz; the loop skips every other RENDER only.
    for (let frame = 0; frame < 60; frame++) loop.advance(1000 / 60);
    expect(tickCount).toBe(60);
    expect(renderCount).toBe(30);
  });

  it("renderEvery=1 renders every frame (default)", () => {
    let renderCount = 0;
    const loop = createAccumulatorLoop({ tick: () => {}, render: () => renderCount++ });
    loop.advance(0);
    for (let frame = 0; frame < 10; frame++) loop.advance(1000 / 60);
    expect(renderCount).toBe(10);
  });

  it("setRenderEvery clamps below 1 to 1", () => {
    let renderCount = 0;
    const loop = createAccumulatorLoop({ tick: () => {}, render: () => renderCount++ });
    loop.advance(0);
    loop.setRenderEvery(0);
    for (let frame = 0; frame < 5; frame++) loop.advance(1000 / 60);
    expect(renderCount).toBe(5);
  });

  it("onFrameStats reports sim/render split + frame wall time", () => {
    const samples: Array<{ simMs: number; renderMs: number; frameMs: number }> = [];
    const loop = createAccumulatorLoop({
      tick: () => {},
      render: () => {},
      onFrameStats: (s) => samples.push({ ...s }),
    });
    loop.advance(0);
    loop.advance(1000 / 60);
    expect(samples.length).toBe(1);
    expect(samples[0]!.frameMs).toBeCloseTo(1000 / 60, 5);
    expect(samples[0]!.simMs).toBeGreaterThanOrEqual(0);
    expect(samples[0]!.renderMs).toBeGreaterThanOrEqual(0);
  });

  it("onFrameStats fires only on rendered frames under renderEvery=2", () => {
    const samples: number[] = [];
    const loop = createAccumulatorLoop({
      tick: () => {},
      render: () => {},
      onFrameStats: (s) => samples.push(s.frameMs),
    });
    loop.advance(0);
    loop.setRenderEvery(2);
    for (let frame = 0; frame < 6; frame++) loop.advance(1000 / 60);
    // 6 frames, 3 rendered → 3 stat samples.
    expect(samples.length).toBe(3);
  });

  it("timeScale + renderEvery compose: slow-motion sim, halved renders", () => {
    let tickCount = 0;
    let renderCount = 0;
    const loop = createAccumulatorLoop({ tick: () => tickCount++, render: () => renderCount++ });
    loop.advance(0);
    loop.setTimeScale(0.5);
    loop.setRenderEvery(2);
    for (let frame = 0; frame < 60; frame++) loop.advance(1000 / 60);
    // 1000 ms × 0.5 scale = 500 ms sim time = 30 ticks; 30 renders.
    expect(tickCount).toBe(30);
    expect(renderCount).toBe(30);
  });
});
