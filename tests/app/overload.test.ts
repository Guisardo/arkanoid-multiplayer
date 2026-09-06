// Ticket 47: host overload — sustained catch-up capping engages slow-motion,
// headroom recovers it; snapshot cadence stays 30 Hz wall-clock.
import { describe, expect, it } from "vitest";
import {
  createOverloadMonitor,
  snapshotEveryTicks,
  OVERLOAD_ENGAGE_FRAMES,
  MIN_TIME_SCALE,
} from "app/overload";

describe("overload monitor (spec §9 slow-motion)", () => {
  it("stays at full speed under brief spikes", () => {
    const m = createOverloadMonitor();
    for (let i = 0; i < OVERLOAD_ENGAGE_FRAMES - 1; i++) m.observe(true);
    expect(m.state.timeScale).toBe(1);
    expect(m.state.degraded).toBe(false);
  });

  it("sustained capping engages slow-motion at the floor", () => {
    const m = createOverloadMonitor();
    for (let i = 0; i < OVERLOAD_ENGAGE_FRAMES; i++) m.observe(true);
    expect(m.state.timeScale).toBe(MIN_TIME_SCALE);
    expect(m.state.degraded).toBe(true);
  });

  it("recovers in steps after sustained headroom", () => {
    const m = createOverloadMonitor();
    for (let i = 0; i < OVERLOAD_ENGAGE_FRAMES; i++) m.observe(true);
    expect(m.state.timeScale).toBe(0.5);
    // 60 uncapped frames = one +0.1 step.
    for (let i = 0; i < 60; i++) m.observe(false);
    expect(m.state.timeScale).toBeCloseTo(0.6, 10);
    for (let i = 0; i < 60 * 4; i++) m.observe(false);
    expect(m.state.timeScale).toBe(1);
    expect(m.state.degraded).toBe(false);
  });

  it("a single capped frame resets the recovery streak", () => {
    const m = createOverloadMonitor();
    for (let i = 0; i < OVERLOAD_ENGAGE_FRAMES; i++) m.observe(true);
    for (let i = 0; i < 59; i++) m.observe(false);
    m.observe(true); // spike mid-recovery
    for (let i = 0; i < 59; i++) m.observe(false);
    // 59 + 59 with a reset between: no step taken.
    expect(m.state.timeScale).toBe(0.5);
  });

  it("cappedStreak tracks consecutive capped frames", () => {
    const m = createOverloadMonitor();
    m.observe(true);
    m.observe(true);
    expect(m.state.cappedStreak).toBe(2);
    m.observe(false);
    expect(m.state.cappedStreak).toBe(0);
  });
});

describe("snapshot cadence under slow-motion (30 Hz wall-clock)", () => {
  it("full speed: every 2 ticks at 30 Hz", () => {
    expect(snapshotEveryTicks(1, 30)).toBe(2);
  });

  it("half speed: every 1 tick at 30 Hz — wire rate holds", () => {
    // Sim runs at half speed; snapshots still ship every 33 ms wall-clock.
    expect(snapshotEveryTicks(0.5, 30)).toBe(1);
  });

  it("60 Hz duel: every 1 tick regardless", () => {
    expect(snapshotEveryTicks(1, 60)).toBe(1);
    expect(snapshotEveryTicks(0.5, 60)).toBe(1);
  });

  it("clamps out-of-range scales", () => {
    expect(snapshotEveryTicks(2, 30)).toBe(2);
    expect(snapshotEveryTicks(0.1, 30)).toBe(1);
  });
});
