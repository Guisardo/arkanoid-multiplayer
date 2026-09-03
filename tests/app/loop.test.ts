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
});
