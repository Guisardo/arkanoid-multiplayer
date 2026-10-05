import type { CapsuleTypeId } from "shared/protocol";
import { BRICK_COLS, BRICK_ROWS } from "shared/gridConstants";

/** One capsule script entry: bound to a specific brick-break count (spec §4). */
export interface CapsuleScriptEntry {
  /** Fires when this many bricks have been broken (cumulative, 1-based). */
  brickBreakCount: number;
  capsule: CapsuleTypeId;
}

export interface LevelData {
  version: number;
  round: number;
  /** Char grid, 13 cols × 18 rows. Legend: `.` empty, letters colors, S silver, G gold. */
  grid: string[];
  baseBallSpeed: number;
  /** null = silver hits from formula min(1+floor(round/8), 4). */
  silverHitOverride: number | null;
  /** 6–10 entries (validated); fixed release order. */
  capsuleScript: CapsuleScriptEntry[];
  scoreOverrides: Partial<Record<string, number>>;
}

export interface LevelValidationError {
  path: string;
  message: string;
}

/** Every capsule type the engine understands, including the mystery `?`. */
export const CAPSULE_TYPES = ["B", "C", "D", "E", "L", "M", "P", "S", "R", "?"] as const;

const CAPSULE_TYPE_SET: ReadonlySet<string> = new Set<string>(CAPSULE_TYPES);

/** Capsule script bounds (spec §4): short enough to author, long enough to matter. */
export const CAPSULE_SCRIPT_MIN = 6;
export const CAPSULE_SCRIPT_MAX = 10;

function isCapsuleType(value: unknown): value is CapsuleTypeId {
  return typeof value === "string" && CAPSULE_TYPE_SET.has(value);
}

/**
 * Capsule-script rules, isolated from the grid checks so a level designer (or a
 * test) can validate just the script:
 *
 * - 6–10 entries — fewer never pays out, more cannot fit a round's break count.
 * - `brickBreakCount` strictly increasing — two capsules on the same break count
 *   (or out of order) means one of them can never fire.
 * - valid capsule types only — an unknown type silently did nothing at runtime.
 * - no entry past the round's destructible brick count — an unreachable trigger.
 *
 * `destructibleCount` = the number of non-empty, non-gold cells; pass `-1` to
 * skip that check when the grid is not known.
 */
export function validateCapsuleScript(
  script: readonly CapsuleScriptEntry[] | null | undefined,
  destructibleCount: number,
): LevelValidationError[] {
  const errors: LevelValidationError[] = [];
  const push = (message: string): void => {
    errors.push({ path: "capsuleScript", message });
  };

  // `Array.isArray` would widen a readonly array to `any[]`; a plain null check
  // keeps the entry type, which is what makes the per-field guards below typed.
  const entries: readonly CapsuleScriptEntry[] | null =
    script === null || script === undefined ? null : script;
  if (entries === null) {
    push("capsuleScript must be an array");
    return errors;
  }
  if (entries.length < CAPSULE_SCRIPT_MIN || entries.length > CAPSULE_SCRIPT_MAX) {
    push(
      `capsuleScript must have ${String(CAPSULE_SCRIPT_MIN)}–${String(CAPSULE_SCRIPT_MAX)} entries (got ${String(entries.length)})`,
    );
  }

  let prev = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    // Level data is JSON, so a corrupt entry can carry NaN, a fraction, or a
    // string. All of those silently never fire, so they fail validation here.
    const count = e?.brickBreakCount;
    if (e === undefined || typeof count !== "number" || !Number.isInteger(count) || count <= prev) {
      const got = typeof count === "number" ? String(count) : "none";
      push(
        `capsuleScript[${String(i)}] brickBreakCount must be a whole number, strictly increasing (got ${got} after ${String(prev)})`,
      );
    }
    if (e !== undefined && !isCapsuleType(e.capsule)) {
      push(`capsuleScript[${String(i)}] invalid capsule type '${String(e.capsule)}'`);
    }
    if (e !== undefined && destructibleCount >= 0 && count !== undefined && count > destructibleCount) {
      push(
        `capsuleScript[${String(i)}] brickBreakCount ${String(count)} exceeds destructible brick count ${String(destructibleCount)}`,
      );
    }
    // Only a *valid* count advances the watermark. Advancing on a corrupt one
    // would poison every later comparison (a NaN watermark makes
    // `count <= prev` false for the rest of the script), silently masking the
    // ordering violations the fail-fast check exists to surface.
    if (typeof count === "number" && Number.isInteger(count) && count > prev) prev = count;
  }
  return errors;
}

/**
 * Destructible cells in a *char* grid: everything that is not `.` or gold `G`.
 * (The sims count destructibles in the parsed `number[]` brick array instead —
 * `sim/attackSession` / `sim/assistSession` — because they work post-parse.)
 */
export function countDestructibleChars(grid: readonly string[]): number {
  let n = 0;
  for (const row of grid) {
    for (const ch of row) if (ch !== "." && ch !== "G") n++;
  }
  return n;
}

export function validateLevel(level: LevelData): LevelValidationError[] {
  const errors: LevelValidationError[] = [];
  const push = (message: string): void => {
    errors.push({ path: "", message });
  };

  if (!Array.isArray(level.grid) || level.grid.length !== BRICK_ROWS) {
    push(`grid must have exactly ${String(BRICK_ROWS)} rows (got ${String(level.grid.length)})`);
    return errors;
  }
  for (let r = 0; r < level.grid.length; r++) {
    const row = level.grid[r] ?? "";
    if (row.length !== BRICK_COLS) {
      push(`grid row ${String(r)} must have exactly ${String(BRICK_COLS)} cols (got ${String(row.length)})`);
    }
    for (const ch of row) {
      if (!/^[.A-Za-z]$/.test(ch)) {
        push(`grid row ${String(r)} has invalid char '${ch}' (allowed: . letters S G)`);
      }
    }
  }
  if (typeof level.baseBallSpeed !== "number" || level.baseBallSpeed <= 0) {
    push("baseBallSpeed must be a positive number");
  }
  errors.push(
    ...validateCapsuleScript(
      level.capsuleScript,
      Array.isArray(level.grid) ? countDestructibleChars(level.grid) : -1,
    ),
  );
  return errors;
}

/**
 * Fail fast at level load (ticket 113): a round whose data violates its own
 * rules is a content bug, and the stack that surfaces it is far more useful
 * than a capsule that silently never drops. Every message is reported at once
 * so one load fixes one level rather than one error per reload.
 */
export function assertValidLevel(level: LevelData): void {
  const errors = validateLevel(level);
  if (errors.length === 0) return;
  const detail = errors.map((e) => (e.path === "" ? e.message : `${e.path}: ${e.message}`)).join("; ");
  throw new Error(`invalid level data for round ${String(level.round)}: ${detail}`);
}
