// Classic-accurate scoring table (spec §4). Data-only [authoring] values —
// placeholders follow the classic-accurate shape: colored tiers ~50–120
// ascending, silver pays per hit, gold 0.
// [authoring] exact values verified during content authoring.

/** Tier per grid char (1-based). A..F → tiers 1..6. */
export const CHAR_TIER: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6,
};

/** Points per colored tier (single hit destroys; pays once). */
export const TIER_SCORE: Record<number, number> = {
  1: 50,
  2: 60,
  3: 70,
  4: 80,
  5: 90,
  6: 120,
};

/** Silver pays per hit. */
export const SILVER_SCORE_PER_HIT = 50;

/** Gold is indestructible — no score. */
export const GOLD_SCORE = 0;

/** Capsule catch bonus. */
export const CAPSULE_CATCH_BONUS = 100;

/** Level clear bonus: 1000 + 500 × round. */
export function levelClearBonus(round: number): number {
  return 1000 + 500 * round;
}

/** Duel ball-drop bonus (prototype-validated). */
export const DUEL_DROP_BONUS = 500;
