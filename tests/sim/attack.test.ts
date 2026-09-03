import { describe, expect, it } from "vitest";
import {
  ALL_TRIGGERS_ON,
  ATTACK_FIRE_ORDER,
  DEFAULT_ATTACK_TUNING,
  NO_ATTACK_EFFECTS,
  applyAttackEffect,
  canSpend,
  chainTier,
  corruptAxis,
  crossesTier,
  cycleTarget,
  meterAdd,
  meterCost,
  rainCountForTier,
  resolveFireTarget,
  tickAttackEffects,
  type AttackTuning,
} from "sim/attack";

const T = DEFAULT_ATTACK_TUNING;

describe("attack tuning defaults (spec §6.5)", () => {
  it("chain tiers ≥4/≥7/≥10 = small/medium/large", () => {
    expect(T.chainTiers).toEqual({ small: 4, medium: 7, large: 10 });
  });
  it("meter costs: rain 30, shrink 25, speed 20, mangle 40 (of 100)", () => {
    expect(T.costs).toEqual({ rain: 30, shrink: 25, speed: 20, mangle: 40 });
  });
  it("rain magnitudes 3/6/12 by tier", () => {
    expect(T.rainBricks).toEqual({ small: 3, medium: 6, large: 12 });
  });
  it("magnitudes/durations: shrink 40%/10 s, speed +30%/8 s, mangle 6 s", () => {
    expect(T.shrinkFactor).toBeCloseTo(0.6, 10);
    expect(T.speedFactor).toBeCloseTo(1.3, 10);
    expect(T.shrinkMs).toBe(10_000);
    expect(T.speedMs).toBe(8_000);
    expect(T.mangleMs).toBe(6_000);
  });
  it("meter fill 2 per brick + 10 per capsule, cap 100", () => {
    expect(T.fillPerBrick).toBe(2);
    expect(T.fillPerCapsule).toBe(10);
    expect(T.meterMax).toBe(100);
  });
  it("all triggers default on", () => {
    expect(ALL_TRIGGERS_ON).toEqual({
      chains: true,
      capsuleCapture: true,
      levelClear: true,
      chargedManual: true,
    });
  });
  it("4 fire buttons map to the 4 attack types", () => {
    expect(ATTACK_FIRE_ORDER).toEqual(["rain", "shrink", "speed", "mangle"]);
  });
});

describe("chain tiers", () => {
  it("below 4 → no tier", () => {
    expect(chainTier(0, T)).toBeNull();
    expect(chainTier(3, T)).toBeNull();
  });
  it("≥4 small, ≥7 medium, ≥10 large", () => {
    expect(chainTier(4, T)).toBe("small");
    expect(chainTier(6, T)).toBe("small");
    expect(chainTier(7, T)).toBe("medium");
    expect(chainTier(9, T)).toBe("medium");
    expect(chainTier(10, T)).toBe("large");
    expect(chainTier(99, T)).toBe("large");
  });
  it("tier crossing fires once per tier boundary", () => {
    expect(crossesTier(3, 4, T)).toBe(true);
    expect(crossesTier(4, 5, T)).toBe(false);
    expect(crossesTier(6, 7, T)).toBe(true);
    expect(crossesTier(9, 10, T)).toBe(true);
    expect(crossesTier(10, 11, T)).toBe(false);
  });
  it("rain count scales by tier: 3/6/12", () => {
    expect(rainCountForTier("small", T)).toBe(3);
    expect(rainCountForTier("medium", T)).toBe(6);
    expect(rainCountForTier("large", T)).toBe(12);
  });
  it("tiers are live-tunable", () => {
    const tuning: AttackTuning = {
      ...T,
      chainTiers: { small: 2, medium: 5, large: 8 },
      rainBricks: { small: 1, medium: 2, large: 3 },
    };
    expect(chainTier(2, tuning)).toBe("small");
    expect(chainTier(5, tuning)).toBe("medium");
    expect(chainTier(8, tuning)).toBe("large");
    expect(rainCountForTier("large", tuning)).toBe(3);
  });
});

describe("meter economy", () => {
  it("fills 2 per brick", () => {
    expect(meterAdd(0, 1, 0, T)).toBe(2);
    expect(meterAdd(0, 5, 0, T)).toBe(10);
  });
  it("fills 10 per capsule catch", () => {
    expect(meterAdd(0, 0, 1, T)).toBe(10);
    expect(meterAdd(0, 1, 1, T)).toBe(12);
  });
  it("caps at meterMax", () => {
    expect(meterAdd(99, 5, 2, T)).toBe(100);
    expect(meterAdd(100, 1, 1, T)).toBe(100);
  });
  it("costs enforced per type", () => {
    expect(meterCost("rain", T)).toBe(30);
    expect(meterCost("shrink", T)).toBe(25);
    expect(meterCost("speed", T)).toBe(20);
    expect(meterCost("mangle", T)).toBe(40);
  });
  it("canSpend respects cost exactly", () => {
    expect(canSpend(29, "rain", T)).toBe(false);
    expect(canSpend(30, "rain", T)).toBe(true);
    expect(canSpend(24, "shrink", T)).toBe(false);
    expect(canSpend(25, "shrink", T)).toBe(true);
    expect(canSpend(19, "speed", T)).toBe(false);
    expect(canSpend(20, "speed", T)).toBe(true);
    expect(canSpend(39, "mangle", T)).toBe(false);
    expect(canSpend(40, "mangle", T)).toBe(true);
  });
  it("costs are live-tunable", () => {
    const tuning: AttackTuning = { ...T, costs: { rain: 10, shrink: 10, speed: 10, mangle: 10 } };
    expect(canSpend(10, "mangle", tuning)).toBe(true);
    expect(canSpend(9, "mangle", tuning)).toBe(false);
  });
});

describe("effect stacking (spec §6.5)", () => {
  it("same-type re-application refreshes duration", () => {
    let fx = applyAttackEffect(NO_ATTACK_EFFECTS, "shrink", T.shrinkMs);
    fx = tickAttackEffects(fx, 5_000); // 5 s left
    expect(fx.shrinkMs).toBe(5_000);
    fx = applyAttackEffect(fx, "shrink", T.shrinkMs); // refresh
    expect(fx.shrinkMs).toBe(10_000);
  });
  it("different types apply independently", () => {
    let fx = applyAttackEffect(NO_ATTACK_EFFECTS, "shrink", T.shrinkMs);
    fx = applyAttackEffect(fx, "speed", T.speedMs);
    fx = applyAttackEffect(fx, "mangle", T.mangleMs);
    expect(fx).toEqual({ shrinkMs: 10_000, speedMs: 8_000, mangleMs: 6_000 });
  });
  it("timers tick down independently and floor at 0", () => {
    let fx = applyAttackEffect(NO_ATTACK_EFFECTS, "shrink", 10_000);
    fx = applyAttackEffect(fx, "speed", 8_000);
    fx = tickAttackEffects(fx, 9_000);
    expect(fx).toEqual({ shrinkMs: 1_000, speedMs: 0, mangleMs: 0 });
    fx = tickAttackEffects(fx, 2_000);
    expect(fx).toEqual({ shrinkMs: 0, speedMs: 0, mangleMs: 0 });
  });
  it("rain is instant — no timer to stack", () => {
    const fx = applyAttackEffect(NO_ATTACK_EFFECTS, "rain", 123);
    expect(fx).toEqual(NO_ATTACK_EFFECTS);
  });
});

describe("control mangle (sim-side input corruption)", () => {
  it("r < 0.5 inverts the axis", () => {
    expect(corruptAxis(0.8, 0.25)).toBeCloseTo(-0.8, 12);
    expect(corruptAxis(-0.6, 0.0)).toBeCloseTo(0.6, 12);
    expect(corruptAxis(0, 0.49)).toBeCloseTo(0, 12);
  });
  it("r ≥ 0.5 jitters the axis (bounded ±0.5)", () => {
    const out = corruptAxis(0.5, 0.75);
    expect(out).toBeCloseTo(0.5, 12); // (0.75-0.75)*2 = 0 jitter at r=0.75
    expect(corruptAxis(0.5, 1.0)).toBeCloseTo(1.0, 12); // +0.5 jitter
    expect(corruptAxis(0.5, 0.5)).toBeCloseTo(0.0, 12); // -0.5 jitter
  });
  it("output clamped to [-1, 1]", () => {
    expect(corruptAxis(1, 0.99)).toBeLessThanOrEqual(1);
    expect(corruptAxis(-1, 0.99)).toBeGreaterThanOrEqual(-1);
    expect(corruptAxis(0.9, 0.1)).toBeCloseTo(-0.9, 12);
  });
});

describe("targeting", () => {
  it("cycles forward through opponents only", () => {
    expect(cycleTarget(0, -1, 3, true)).toBe(1);
    expect(cycleTarget(0, 1, 3, true)).toBe(2);
    expect(cycleTarget(0, 2, 3, true)).toBe(1); // wraps, skips self
    expect(cycleTarget(1, 0, 3, true)).toBe(2);
  });
  it("cycles backward", () => {
    expect(cycleTarget(0, 1, 3, false)).toBe(2);
    expect(cycleTarget(0, 2, 3, false)).toBe(1);
  });
  it("no opponents → -1", () => {
    expect(cycleTarget(0, -1, 1, true)).toBe(-1);
  });
  it("manual fire auto-retargets to first valid opponent", () => {
    expect(resolveFireTarget(0, 1, 3, () => true)).toBe(1);
    expect(resolveFireTarget(0, 1, 3, (c) => c !== 1)).toBe(2);
    expect(resolveFireTarget(0, 2, 3, (c) => c !== 2)).toBe(1);
  });
  it("no valid opponent → -1", () => {
    expect(resolveFireTarget(0, 1, 3, () => false)).toBe(-1);
  });
});
