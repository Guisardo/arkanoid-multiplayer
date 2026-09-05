// Skin index assignment (ticket 44, spec §13): full UUID rides the lobby
// join once (control channel); the host assigns a compact per-session skin
// index (byte) that snapshots carry. Index is session-scoped — it points
// into THIS session's uuid table, not the registry array. UUID is the
// cross-session identity. Pure + deterministic — same players, same
// indices. Lives in content/ (leaf) so sim + app can both consume it.
import { SKINS, DEFAULT_SKIN_ID } from "./skins";

export interface SkinAssignment {
  /** playerId → compact session skin index (byte). */
  indices: number[];
  /** Distinct skin UUIDs in assignment order (session index → UUID). */
  uuids: string[];
}

/**
 * Assign compact per-session skin indices from player skin UUIDs.
 * Deterministic: distinct UUIDs in first-appearance order get 0, 1, 2, …
 */
export function assignSkinIndices(skinIds: readonly string[]): SkinAssignment {
  const uuids: string[] = [];
  const indexOf = (id: string): number => {
    let i = uuids.indexOf(id);
    if (i < 0) {
      i = uuids.length;
      uuids.push(id);
    }
    return i;
  };
  const indices = skinIds.map((id) => indexOf(id));
  return { indices, uuids };
}

/**
 * Auto-assign distinct skins to bots (ticket 44): never colliding with any
 * human's chosen skin. Picks the first registry skins the humans did not
 * take, in registry order; wraps when bots outnumber free skins (then
 * collision-free is impossible — registry smaller than players — and we
 * degrade to modulo, still deterministic).
 */
export function autoAssignBotSkins(humanSkinIds: readonly string[], botCount: number): string[] {
  const taken = new Set(humanSkinIds);
  const free = SKINS.filter((s) => !taken.has(s.id)).map((s) => s.id);
  const out: string[] = [];
  for (let i = 0; i < botCount; i++) {
    out.push(free[i % free.length] ?? SKINS[0]?.id ?? "");
  }
  return out;
}

/**
 * Resolve a session skin index (snapshot byte) to its UUID. Out-of-range
 * (malformed/host-version-skew) falls back to the default skin — never a
 * crash (spec §13).
 */
export function skinUuidFor(assignment: SkinAssignment, index: number): string {
  return assignment.uuids[index] ?? DEFAULT_SKIN_ID;
}
