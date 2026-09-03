import level1 from "./levels/round-001.json";
import type { LevelData } from "./levelFormat";

// Round registry (33 rounds land across tickets 31/35; 1 now for the tracer).
const LEVELS: Record<number, LevelData> = {
  1: level1 as unknown as LevelData,
};

export function getLevel(round: number): LevelData {
  const level = LEVELS[round];
  if (!level) throw new Error(`no level data for round ${String(round)}`);
  return level;
}

export function availableRounds(): number[] {
  return Object.keys(LEVELS).map(Number).sort((a, b) => a - b);
}
