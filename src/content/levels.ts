import level1 from "./levels/round-001.json";
import level2 from "./levels/round-002.json";
import level3 from "./levels/round-003.json";
import level4 from "./levels/round-004.json";
import level5 from "./levels/round-005.json";
import level6 from "./levels/round-006.json";
import level7 from "./levels/round-007.json";
import level8 from "./levels/round-008.json";
import level9 from "./levels/round-009.json";
import level10 from "./levels/round-010.json";
import level11 from "./levels/round-011.json";
import level12 from "./levels/round-012.json";
import level13 from "./levels/round-013.json";
import level14 from "./levels/round-014.json";
import level15 from "./levels/round-015.json";
import level16 from "./levels/round-016.json";
import level17 from "./levels/round-017.json";
import level18 from "./levels/round-018.json";
import level19 from "./levels/round-019.json";
import level20 from "./levels/round-020.json";
import level21 from "./levels/round-021.json";
import level22 from "./levels/round-022.json";
import level23 from "./levels/round-023.json";
import level24 from "./levels/round-024.json";
import level25 from "./levels/round-025.json";
import level26 from "./levels/round-026.json";
import level27 from "./levels/round-027.json";
import level28 from "./levels/round-028.json";
import level29 from "./levels/round-029.json";
import level30 from "./levels/round-030.json";
import level31 from "./levels/round-031.json";
import level32 from "./levels/round-032.json";
import level33 from "./levels/round-033.json";
import type { LevelData } from "./levelFormat";

// Round registry (33 rounds land across tickets 31/35).
const LEVELS: Record<number, LevelData> = {
  1: level1,
  2: level2,
  3: level3,
  4: level4,
  5: level5,
  6: level6,
  7: level7,
  8: level8,
  9: level9,
  10: level10,
  11: level11,
  12: level12,
  13: level13,
  14: level14,
  15: level15,
  16: level16,
  17: level17,
  18: level18,
  19: level19,
  20: level20,
  21: level21,
  22: level22,
  23: level23,
  24: level24,
  25: level25,
  26: level26,
  27: level27,
  28: level28,
  29: level29,
  30: level30,
  31: level31,
  32: level32,
  33: level33,
} as Record<number, LevelData>;

export function getLevel(round: number): LevelData {
  const level = LEVELS[round];
  if (!level) throw new Error(`no level data for round ${String(round)}`);
  return level;
}

export function availableRounds(): number[] {
  return Object.keys(LEVELS).map(Number).sort((a, b) => a - b);
}

/** Attack draws rounds 1–32 only — round 33 (Doh) never selected (spec §4:
 * attack triggers on level clear conflict with a boss round). */
export const ATTACK_MAX_ROUND = 32;

export function assertAttackRound(round: number): void {
  if (round > ATTACK_MAX_ROUND) {
    throw new Error(`attack cannot select round ${String(round)} (max ${String(ATTACK_MAX_ROUND)})`);
  }
}
