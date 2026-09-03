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
} as Record<number, LevelData>;

export function getLevel(round: number): LevelData {
  const level = LEVELS[round];
  if (!level) throw new Error(`no level data for round ${String(round)}`);
  return level;
}

export function availableRounds(): number[] {
  return Object.keys(LEVELS).map(Number).sort((a, b) => a - b);
}
