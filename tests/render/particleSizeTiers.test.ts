// Particle size tiers (ticket #151, ADR 0009 amendment).
//
// Regression: recipe scales were tuned against nothing — brick-break debris
// came out half a brick wide and a full brick tall, the ball-loss splat over
// twice the ball. Every recipe's largest possible particle is now bounded by
// its tier, measured in the same field units as the bricks.
import { describe, expect, it } from "vitest";
import { BRICK_H, BRICK_W } from "shared/gridConstants";
import {
  CELEBRATION_EVENTS,
  CELEBRATION_PARTICLE_MAX,
  CHAIN_RECIPES,
  EFFECT_RECIPES,
  IMPACT_PARTICLE_MAX,
  PARTICLE_FRAME_UNITS,
  PARTICLE_SCALE_VARIANCE_MAX,
  maxParticleSize,
  particleSizeLimit,
} from "render/effectPresets";

const allRecipes = [
  ...Object.entries(EFFECT_RECIPES).map(([event, recipe]) => ({ name: event, recipe, event })),
  ...Object.entries(CHAIN_RECIPES).map(([level, recipe]) => ({ name: `chain ${level}`, recipe, event: null })),
];

describe("particle size tiers", () => {
  it("tier limits are expressed against the brick grid", () => {
    expect(IMPACT_PARTICLE_MAX).toBe(BRICK_W / 4);
    expect(CELEBRATION_PARTICLE_MAX).toBe(BRICK_H);
  });

  it("maxParticleSize is the frame edge × scale × the largest variance", () => {
    const burst = EFFECT_RECIPES.brickBreak!.burst!;
    expect(maxParticleSize(burst)).toBeCloseTo(PARTICLE_FRAME_UNITS * burst.scale * PARTICLE_SCALE_VARIANCE_MAX);
  });

  it("celebrations are the round clear, the boss kill and the ball loss", () => {
    expect([...CELEBRATION_EVENTS].sort()).toEqual(["ballLoss", "bossDead", "roundClear"]);
    expect(particleSizeLimit("roundClear")).toBe(CELEBRATION_PARTICLE_MAX);
    expect(particleSizeLimit("brickBreak")).toBe(IMPACT_PARTICLE_MAX);
    expect(particleSizeLimit(null)).toBe(IMPACT_PARTICLE_MAX);
  });

  for (const { name, recipe, event } of allRecipes) {
    if (recipe.burst === undefined) continue;
    const burst = recipe.burst;
    it(`${name}: largest particle fits its tier`, () => {
      expect(maxParticleSize(burst)).toBeLessThanOrEqual(particleSizeLimit(event as Parameters<typeof particleSizeLimit>[0]));
    });
  }

  it("chain escalation still grows with the chain level", () => {
    const sizes = ([1, 2, 3] as const).map((l) => CHAIN_RECIPES[l].burst!.scale);
    expect(sizes[0]).toBeLessThan(sizes[1]!);
    expect(sizes[1]).toBeLessThan(sizes[2]!);
  });
});
