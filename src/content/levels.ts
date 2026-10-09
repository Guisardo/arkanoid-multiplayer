import { assertValidLevel, type LevelData } from "./levelFormat";

/**
 * ADR 0007: rounds are no longer statically imported into the bundle. Round
 * data lives in one JSON file per round, loaded on demand through a dynamic
 * import and cached in memory for the rest of the page's life, so the initial
 * bundle carries the level registry (a static round list) but none of the
 * grids.
 *
 * Two access paths:
 * - `getLevel(round)` — async, the only path that can load a round. Returns a
 *   promise so callers can await the fetch.
 * - `getLevelSync(round)` — the sync fallback for code that runs on the hot
 *   path (a sim advancing to the next round mid-match, headless tests). It
 *   reads the in-memory cache and throws when the round has not been
 *   preloaded; session creators warm their range with `preloadLevels` before
 *   they build anything.
 */

/** First shipped round (ticket 31). */
export const MIN_ROUND = 1;
/** Last shipped round (ticket 35): 33 rounds, Doh at 33. */
export const MAX_ROUND = 33;

/** In-memory cache: one entry per round already fetched this page life. */
const levelCache = new Map<number, LevelData>();

/**
 * Ticket 113: rounds are validated the first time they are loaded, so a level
 * whose grid or capsule script breaks its own rules fails here — at the load
 * site, naming the round — instead of surfacing as a capsule that never drops
 * three rounds later. Level data is a frozen import, so the verdict is cached:
 * validation runs once per round per page, never per `getLevel` call.
 */
const validated = new Set<number>();

function roundFile(round: number): string {
  return `./levels/round-${String(round).padStart(3, "0")}.json`;
}

/** Round data for a round, loaded (once) through the dynamic import. */
export async function getLevel(round: number): Promise<LevelData> {
  const cached = levelCache.get(round);
  if (cached !== undefined) return cached;
  if (!Number.isInteger(round) || round < MIN_ROUND || round > MAX_ROUND) {
    throw new Error(`no level data for round ${String(round)}`);
  }
  const mod = (await import(roundFile(round))) as { default: LevelData };
  const level = mod.default;
  levelCache.set(round, level);
  if (!validated.has(round)) {
    assertValidLevel(level);
    validated.add(round);
  }
  return level;
}

/**
 * Sync fallback: the cached instance, or a throw naming the round that still
 * needs `await getLevel(round)`. Used where a level must be read inside a
 * synchronous step (round advance) after the session creator preloaded it.
 */
export function getLevelSync(round: number): LevelData {
  const level = levelCache.get(round);
  if (level === undefined) {
    throw new Error(`round ${String(round)} not loaded — await getLevel(${String(round)}) or preloadLevels first`);
  }
  return level;
}

/** Warm the cache for a set of rounds ahead of building a sim over them. */
export async function preloadLevels(rounds: readonly number[]): Promise<void> {
  await Promise.all(rounds.map((round) => getLevel(round)));
}

/** The static round list — sync, so pickers can offer rounds with no fetch. */
export function availableRounds(): number[] {
  return roundRange(MIN_ROUND, MAX_ROUND);
}

/** Every shipped round in an inclusive range (clamped, ascending). */
export function roundRange(from: number, to: number): number[] {
  const rounds: number[] = [];
  for (let round = Math.max(MIN_ROUND, from); round <= Math.min(MAX_ROUND, to); round++) rounds.push(round);
  return rounds;
}

/** Every round of the episode an assist team (or a solo run) can reach. */
export function episodeRounds(): number[] {
  return availableRounds();
}

/** Attack draws rounds 1–32 only — round 33 (Doh) never selected (spec §4:
 * attack triggers on level clear conflict with a boss round). */
export const ATTACK_MAX_ROUND = 32;

export function assertAttackRound(round: number): void {
  if (round > ATTACK_MAX_ROUND) {
    throw new Error(`attack cannot select round ${String(round)} (max ${String(ATTACK_MAX_ROUND)})`);
  }
}
