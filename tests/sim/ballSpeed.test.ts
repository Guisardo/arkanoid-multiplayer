// Classic ball-speed mechanics: ceiling/back-wall speed-up (ticket 96) and the
// multiball spawn boost (ticket 97). Unit level — the pure arithmetic the sims
// share, plus the tunnelling budget the caps exist to protect.
import { describe, expect, it } from "vitest";
import {
  CEILING_SPEEDUP,
  MULTIBALL_BOOST,
  ballSpeedFor,
  boostMultiplier,
  ceilingSpeedMultiplier,
  ceilingSpeedTier,
  decayBoost,
  registerCeilingHit,
} from "sim/ballSpeed";
import { makeBallState } from "sim/simState";
import { BRICK_H, TICK_DT } from "sim/constants";
import { getLevelSync } from "content/levels";

describe("ceiling speed-up (ticket 96)", () => {
  it("no contacts → no tier, multiplier exactly 1", () => {
    expect(ceilingSpeedTier(0)).toBe(0);
    expect(ceilingSpeedMultiplier(0)).toBe(1);
  });

  it("a tier is only bought once a full threshold of contacts accumulates", () => {
    const n = CEILING_SPEEDUP.hitsPerTier;
    for (let hits = 1; hits < n; hits++) expect(ceilingSpeedTier(hits)).toBe(0);
    expect(ceilingSpeedTier(n)).toBe(1);
    expect(ceilingSpeedTier(n + 1)).toBe(1);
    expect(ceilingSpeedTier(n * 2)).toBe(2);
  });

  it("each tier multiplies speed by the tier factor", () => {
    expect(ceilingSpeedMultiplier(CEILING_SPEEDUP.hitsPerTier)).toBeCloseTo(1.05, 10);
    expect(ceilingSpeedMultiplier(CEILING_SPEEDUP.hitsPerTier * 2)).toBeCloseTo(1.05 ** 2, 10);
    expect(ceilingSpeedMultiplier(CEILING_SPEEDUP.hitsPerTier * 3)).toBeCloseTo(1.05 ** 3, 10);
  });

  it("the tier count is capped so the bonus stays bounded", () => {
    const absurd = CEILING_SPEEDUP.hitsPerTier * 1000;
    expect(ceilingSpeedTier(absurd)).toBe(CEILING_SPEEDUP.maxTiers);
    expect(ceilingSpeedMultiplier(absurd)).toBeCloseTo(1.05 ** CEILING_SPEEDUP.maxTiers, 10);
  });

  it("negative / non-finite counters degrade to no tier", () => {
    expect(ceilingSpeedTier(-3)).toBe(0);
    expect(ceilingSpeedTier(Number.NaN)).toBe(0);
  });

  it("registerCeilingHit only rescales on a tier crossing, and never turns the ball", () => {
    const b = makeBallState();
    b.vx = 30;
    b.vy = -40;
    for (let i = 1; i <= CEILING_SPEEDUP.hitsPerTier - 1; i++) {
      expect(registerCeilingHit(b)).toBe(false);
      expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(50, 10);
      expect(b.ceilingHits).toBe(i);
    }
    expect(registerCeilingHit(b)).toBe(true);
    expect(b.ceilingHits).toBe(CEILING_SPEEDUP.hitsPerTier);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(50 * CEILING_SPEEDUP.tierFactor, 10);
    // direction preserved (ratio unchanged)
    expect(b.vx / b.vy).toBeCloseTo(30 / -40, 10);
  });

  it("the bonus survives later paddle hits because it is folded in per ball", () => {
    const b = makeBallState();
    b.ceilingHits = CEILING_SPEEDUP.hitsPerTier;
    expect(ballSpeedFor(110, b)).toBeCloseTo(110 * CEILING_SPEEDUP.tierFactor, 10);
  });

  it("stays tunnel-safe at the highest round (physics-validation §9)", () => {
    // The probe takes the ball's own cell plus its eight neighbours, so a brick
    // can only be missed if the ball crosses a full cell in one tick. The worst
    // case is therefore every speed source at once: the highest base speed,
    // both brick-count tiers, every ceiling tier, and the multiball boost.
    const worst =
      getLevelSync(33).baseBallSpeed *
      1.08 *
      1.08 *
      ceilingSpeedMultiplier(CEILING_SPEEDUP.hitsPerTier * 1000) *
      MULTIBALL_BOOST.factor;
    // Room for a whole brick cell per tick; the ceiling tiers and the boost
    // together need the cell-relative probe, not a half-cell one.
    expect(worst * TICK_DT).toBeLessThan(BRICK_H);
    // And a wide margin, so raising a cap does not silently eat the budget.
    expect(worst * TICK_DT).toBeLessThan(BRICK_H * 0.75);
  });
});

describe("multiball spawn boost (ticket 97)", () => {
  it("is inactive with no timer and active with one", () => {
    expect(boostMultiplier(0)).toBe(1);
    expect(boostMultiplier(1)).toBe(MULTIBALL_BOOST.factor);
    expect(boostMultiplier(-5)).toBe(1);
  });

  it("lasts 10 s of ticks, not wall-clock ms", () => {
    expect(MULTIBALL_BOOST.ticks * TICK_DT).toBeCloseTo(10, 10);
  });

  it("decayBoost ticks down and floors at zero", () => {
    const b = makeBallState();
    b.boostTicks = 3;
    decayBoost(b);
    decayBoost(b);
    decayBoost(b);
    expect(b.boostTicks).toBe(0);
    decayBoost(b);
    expect(b.boostTicks).toBe(0);
  });

  it("boostMultiplier never goes negative when decremented to zero", () => {
    const b = makeBallState();
    b.boostTicks = 1;
    decayBoost(b);
    expect(boostMultiplier(b.boostTicks)).toBe(1);
  });

  it("ballSpeedFor composes round speed × ceiling tier × boost", () => {
    const b = makeBallState();
    b.ceilingHits = CEILING_SPEEDUP.hitsPerTier;
    b.boostTicks = MULTIBALL_BOOST.ticks;
    expect(ballSpeedFor(120, b)).toBeCloseTo(
      120 * CEILING_SPEEDUP.tierFactor * MULTIBALL_BOOST.factor,
      10,
    );
  });
});
