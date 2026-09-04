// Attack economy (spec §6.5, ticket 39): pure, headless, deterministic.
// All magnitudes/costs/durations are data on one tuning object — lobby
// live-tunable, no magic numbers at call sites. No DOM/Pixi/net imports.

export type AttackEffectId = "rain" | "shrink" | "speed" | "mangle";
export type ChainTierId = "small" | "medium" | "large";

/** Prototype-validated defaults (spec §6.5) — adjust-after-prototype values. */
export interface AttackTuning {
  /** Chain tier thresholds in consecutive bricks (≥ threshold = tier). */
  chainTiers: Readonly<Record<ChainTierId, number>>;
  /** Meter cost per attack type (of meterMax). */
  costs: Readonly<Record<AttackEffectId, number>>;
  /** Brick-rain brick counts by chain tier. */
  rainBricks: Readonly<Record<ChainTierId, number>>;
  /** Paddle width multiplier while shrink is active (40% reduction → 0.6). */
  shrinkFactor: number;
  /** Ball speed multiplier while speed-up is active (+30% → 1.3). */
  speedFactor: number;
  /** Effect durations (ms): shrink 10 s, speed-up 8 s, mangle 6 s. */
  shrinkMs: number;
  speedMs: number;
  mangleMs: number;
  /** Meter fill: 2 per brick break, 10 per capsule catch. */
  fillPerBrick: number;
  fillPerCapsule: number;
  /** Meter cap. */
  meterMax: number;
}

export const DEFAULT_ATTACK_TUNING: AttackTuning = {
  chainTiers: { small: 4, medium: 7, large: 10 },
  costs: { rain: 30, shrink: 25, speed: 20, mangle: 40 },
  rainBricks: { small: 3, medium: 6, large: 12 },
  shrinkFactor: 0.6,
  speedFactor: 1.3,
  shrinkMs: 10_000,
  speedMs: 8_000,
  mangleMs: 6_000,
  fillPerBrick: 2,
  fillPerCapsule: 10,
  meterMax: 100,
};

/** Lobby-toggleable triggers — all-on default (ticket 39). */
export interface AttackTriggerToggles {
  chains: boolean;
  capsuleCapture: boolean;
  levelClear: boolean;
  chargedManual: boolean;
}

export const ALL_TRIGGERS_ON: AttackTriggerToggles = {
  chains: true,
  capsuleCapture: true,
  levelClear: true,
  chargedManual: true,
};

/** Fire-button → attack type (4 attack buttons, ticket 39). */
export const ATTACK_FIRE_ORDER: readonly [AttackEffectId, AttackEffectId, AttackEffectId, AttackEffectId] =
  ["rain", "shrink", "speed", "mangle"];

/** Chain tier for a consecutive-brick count: ≥10 large, ≥7 medium, ≥4 small. */
export function chainTier(chain: number, tuning: AttackTuning): ChainTierId | null {
  if (chain >= tuning.chainTiers.large) return "large";
  if (chain >= tuning.chainTiers.medium) return "medium";
  if (chain >= tuning.chainTiers.small) return "small";
  return null;
}

/** True exactly when the count crosses into a new tier (fires once per tier). */
export function crossesTier(before: number, after: number, tuning: AttackTuning): boolean {
  return chainTier(before, tuning) !== chainTier(after, tuning);
}

/** Brick-rain brick count for a chain tier (3/6/12 by default). */
export function rainCountForTier(tier: ChainTierId, tuning: AttackTuning): number {
  return tuning.rainBricks[tier];
}

/** Meter after income: fillPerBrick per brick + fillPerCapsule per capsule, capped. */
export function meterAdd(
  meter: number,
  bricks: number,
  capsules: number,
  tuning: AttackTuning,
): number {
  return meterFill(meter, bricks, capsules, tuning.fillPerBrick, tuning.fillPerCapsule, tuning.meterMax);
}

/** Shared meter-fill primitive (attack + assist use the same rules, spec §6.5). */
export function meterFill(
  meter: number,
  bricks: number,
  capsules: number,
  fillPerBrick: number,
  fillPerCapsule: number,
  meterMax: number,
): number {
  const income = bricks * fillPerBrick + capsules * fillPerCapsule;
  return Math.min(meterMax, meter + income);
}

export function meterCost(effect: AttackEffectId, tuning: AttackTuning): number {
  return tuning.costs[effect];
}

export function canSpend(meter: number, effect: AttackEffectId, tuning: AttackTuning): boolean {
  return meter >= tuning.costs[effect];
}

/** Timed attack-effect state on one target (rain is instant — no timer). */
export interface ActiveAttackEffects {
  shrinkMs: number;
  speedMs: number;
  mangleMs: number;
}

export const NO_ATTACK_EFFECTS: ActiveAttackEffects = {
  shrinkMs: 0,
  speedMs: 0,
  mangleMs: 0,
};

/**
 * Stacking (spec §6.5): same-type refreshes to the full duration; different
 * types apply independently. Durations come from the caller's tuning so the
 * session stays live-tunable.
 */
export function applyAttackEffect(
  active: ActiveAttackEffects,
  effect: AttackEffectId,
  durationMs: number,
): ActiveAttackEffects {
  switch (effect) {
    case "shrink":
      return { shrinkMs: durationMs, speedMs: active.speedMs, mangleMs: active.mangleMs };
    case "speed":
      return { shrinkMs: active.shrinkMs, speedMs: durationMs, mangleMs: active.mangleMs };
    case "mangle":
      return { shrinkMs: active.shrinkMs, speedMs: active.speedMs, mangleMs: durationMs };
    case "rain":
      return active; // instant, no timer to stack
  }
}

/** Advance all effect timers by dtMs; each floors at 0 independently. */
export function tickAttackEffects(
  active: ActiveAttackEffects,
  dtMs: number,
): ActiveAttackEffects {
  const decay = (ms: number): number => {
    const next = ms - dtMs;
    // Sub-microsecond residue from repeated float subtraction reads as
    // "still active" — snap it to expired.
    return next <= 0.001 ? 0 : next;
  };
  return {
    shrinkMs: decay(active.shrinkMs),
    speedMs: decay(active.speedMs),
    mangleMs: decay(active.mangleMs),
  };
}

/**
 * Control mangle (spec §6.5): corrupt the consumed axis for one tick.
 * r ∈ [0,1) comes from a seeded LCG — never Math.random. r < 0.5 inverts the
 * axis; otherwise jitters it by up to ±0.5. Applied sim-side after the input
 * frame arrives, so every input method (keyboard/mouse/gamepad/touch) is hit
 * equally.
 */
export function corruptAxis(axis: number, r: number): number {
  const a = Math.max(-1, Math.min(1, axis));
  const corrupted = r < 0.5 ? -a : a + (r - 0.75) * 2;
  return Math.max(-1, Math.min(1, corrupted));
}

/**
 * Cycle a target among the player's opponents (ring order). Returns -1 when
 * the player has no opponents.
 */
export function cycleTarget(
  player: number,
  currentTarget: number,
  playerCount: number,
  forward: boolean,
): number {
  const others: number[] = [];
  for (let i = 0; i < playerCount; i++) if (i !== player) others.push(i);
  if (others.length === 0) return -1;
  const idx = others.indexOf(currentTarget);
  if (idx === -1) return forward ? (others[0] ?? -1) : (others[others.length - 1] ?? -1);
  const next = (idx + (forward ? 1 : -1) + others.length) % others.length;
  return others[next] ?? -1;
}

/**
 * Resolve a manual fire target (ticket 39: manual attacks auto-retarget).
 * Walks the opponent ring starting at the preferred target; the first
 * candidate passing isValid wins. Returns -1 when no valid opponent exists.
 */
export function resolveFireTarget(
  player: number,
  preferred: number,
  playerCount: number,
  isValid: (candidate: number) => boolean,
): number {
  const others: number[] = [];
  for (let i = 0; i < playerCount; i++) if (i !== player) others.push(i);
  if (others.length === 0) return -1;
  const start = others.indexOf(preferred);
  for (let k = 0; k < others.length; k++) {
    const idx = start === -1 ? k : (start + k) % others.length;
    const cand = others[idx];
    if (cand !== undefined && isValid(cand)) return cand;
  }
  return -1;
}
