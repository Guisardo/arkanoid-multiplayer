import { describe, expect, it } from "vitest";
import {
  createPerfLadder,
  PERF_RUNGS,
  rungForDprMode,
  SLOW_FRAME_MS,
  STEP_DOWN_FRAMES,
  STEP_UP_FRAMES,
  FAST_FRAME_MS,
} from "app/perfLadder";

describe("perf fallback ladder (ticket 54, spec §12)", () => {
  it("ships the exact rung sequence dpr 2 → 1.5 → 1 → 30 fps degraded", () => {
    expect(PERF_RUNGS).toEqual([
      { dpr: 2, renderEvery: 1, degraded: false },
      { dpr: 1.5, renderEvery: 1, degraded: false },
      { dpr: 1, renderEvery: 1, degraded: false },
      { dpr: 1, renderEvery: 2, degraded: true },
    ]);
  });

  it("holds the top rung under fast frames", () => {
    const ladder = createPerfLadder(0);
    for (let i = 0; i < STEP_UP_FRAMES + 10; i++) ladder.observe(FAST_FRAME_MS);
    expect(ladder.rung).toBe(PERF_RUNGS[0]);
    expect(ladder.rung.degraded).toBe(false);
  });

  it("steps down one rung after sustained slow frames", () => {
    const ladder = createPerfLadder(0);
    for (let i = 0; i < STEP_DOWN_FRAMES; i++) ladder.observe(SLOW_FRAME_MS);
    expect(ladder.rung.dpr).toBe(1.5);
    expect(ladder.rung.degraded).toBe(false);
    expect(ladder.changed).toBe(true);
  });

  it("reaches the explicit degraded 30 fps rung at the bottom", () => {
    const ladder = createPerfLadder(0);
    // Three step-downs: 2 → 1.5 → 1 → 30fps.
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < STEP_DOWN_FRAMES; i++) ladder.observe(SLOW_FRAME_MS);
    }
    expect(ladder.rung.dpr).toBe(1);
    expect(ladder.rung.renderEvery).toBe(2);
    expect(ladder.rung.degraded).toBe(true);
  });

  it("never steps below the last rung", () => {
    const ladder = createPerfLadder(0);
    for (let i = 0; i < STEP_DOWN_FRAMES * 10; i++) ladder.observe(SLOW_FRAME_MS);
    expect(ladder.state.rung).toBe(PERF_RUNGS.length - 1);
  });

  it("recovers upward lazily after sustained fast frames", () => {
    const ladder = createPerfLadder(3); // degraded rung
    for (let i = 0; i < STEP_UP_FRAMES; i++) ladder.observe(FAST_FRAME_MS);
    expect(ladder.rung.dpr).toBe(1);
    expect(ladder.rung.renderEvery).toBe(1);
    expect(ladder.rung.degraded).toBe(false);
  });

  it("hysteresis: mid-band frames move neither direction", () => {
    const ladder = createPerfLadder(0);
    // Between FAST and SLOW: no streak grows.
    for (let i = 0; i < 500; i++) ladder.observe((SLOW_FRAME_MS + FAST_FRAME_MS) / 2);
    expect(ladder.state.rung).toBe(0);
    expect(ladder.state.slowStreak).toBe(0);
    expect(ladder.state.fastStreak).toBe(0);
  });

  it("no oscillation: a step-down resets streaks (edge device holds)", () => {
    const ladder = createPerfLadder(0);
    // Enough to step down once.
    for (let i = 0; i < STEP_DOWN_FRAMES; i++) ladder.observe(SLOW_FRAME_MS);
    expect(ladder.state.rung).toBe(1);
    // A single fast frame must NOT bounce back (recovery needs a streak).
    ladder.observe(FAST_FRAME_MS);
    expect(ladder.state.rung).toBe(1);
    expect(ladder.state.fastStreak).toBe(1);
  });

  it("slow streak resets on a fast frame and vice versa", () => {
    const ladder = createPerfLadder(0);
    for (let i = 0; i < STEP_DOWN_FRAMES - 1; i++) ladder.observe(SLOW_FRAME_MS);
    ladder.observe(FAST_FRAME_MS);
    expect(ladder.state.slowStreak).toBe(0);
    for (let i = 0; i < STEP_UP_FRAMES - 1; i++) ladder.observe(FAST_FRAME_MS);
    ladder.observe(SLOW_FRAME_MS);
    expect(ladder.state.fastStreak).toBe(0);
  });

  it("setRung clamps out-of-range indices", () => {
    const ladder = createPerfLadder(0);
    ladder.setRung(99);
    expect(ladder.state.rung).toBe(PERF_RUNGS.length - 1);
    ladder.setRung(-5);
    expect(ladder.state.rung).toBe(0);
  });

  it("maps Settings dpr modes to start rungs (auto = top)", () => {
    expect(rungForDprMode("auto")).toBe(0);
    expect(rungForDprMode("2")).toBe(0);
    expect(rungForDprMode("1.5")).toBe(1);
    expect(rungForDprMode("1")).toBe(2);
  });
});
