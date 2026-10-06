// Classic Arkanoid ceiling speed-up, shared by every sim (ticket 96).
//
// The sim's own speed model is the brick-count tier in each round engine
// (`speedFor`). This module adds the arcade mechanic the physics audit found
// missing:
//
//   Ceiling / back-wall speed-up — "the ball will not speed up completely until
//   it hits the back wall" (arcade-history). Every ceiling contact counts; each
//   full threshold of contacts buys one more speed tier, so a round ramps up
//   instead of starting at its ceiling speed.
//
// It lives here rather than in each engine because three engines own balls and
// a rule that only reaches one of them is a rule that will drift. Pure
// arithmetic over integers — no RNG, no wall clock — so the 60 Hz tick stays
// bit-identical across runs.
import type { BallState } from "./simState";

/** Classic-accurate tuning (data-only [authoring]). */
export const CEILING_SPEEDUP = {
  /** Ceiling contacts per speed tier (configurable threshold N). */
  hitsPerTier: 8,
  /** Speed multiplier bought per tier. */
  tierFactor: 1.05,
  /**
   * Hard cap on tiers. `docs/physics-validation.md` §9 tracks the brick probe's
   * tunnelling budget, and this cap keeps the worst case — the highest round's
   * base speed × both brick-count tiers × every ceiling tier — inside one brick
   * cell per tick. Raise it and `ballSpeed.test.ts` fails.
   */
  maxTiers: 3,
} as const;

/** Speed tier earned by `hits` ceiling contacts (0 = no boost). */
export function ceilingSpeedTier(hits: number): number {
  if (!Number.isFinite(hits) || hits <= 0) return 0;
  return Math.min(CEILING_SPEEDUP.maxTiers, Math.floor(hits / CEILING_SPEEDUP.hitsPerTier));
}

/** Total speed multiplier earned by `hits` ceiling contacts. */
export function ceilingSpeedMultiplier(hits: number): number {
  const tiers = ceilingSpeedTier(hits);
  let m = 1;
  for (let i = 0; i < tiers; i++) m *= CEILING_SPEEDUP.tierFactor;
  return m;
}

/**
 * Register one ceiling contact on `b` and scale its velocity by whatever the
 * new tier adds. Direction is preserved; only magnitude changes, so the boost
 * can never flatten a trajectory. Returns true when a tier was crossed (the
 * caller can use it for feedback).
 */
export function registerCeilingHit(b: BallState): boolean {
  const before = ceilingSpeedMultiplier(b.ceilingHits);
  b.ceilingHits += 1;
  const after = ceilingSpeedMultiplier(b.ceilingHits);
  if (after === before) return false;
  const scale = after / before;
  b.vx *= scale;
  b.vy *= scale;
  return true;
}

/**
 * The speed this ball should have when it next touches a paddle: the round's
 * own `speedFor` result scaled by the ceiling tier. Keeping the tier in
 * `speedFor`'s caller (rather than baking it into `speedFor`) is what makes the
 * boost survive subsequent paddle hits.
 */
export function ballSpeedFor(roundSpeed: number, b: BallState): number {
  return roundSpeed * ceilingSpeedMultiplier(b.ceilingHits);
}