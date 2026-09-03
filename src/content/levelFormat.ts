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

const CAPSULE_RE = /^[BCDELMPSR?]$/;

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
  if (
    !Array.isArray(level.capsuleScript) ||
    level.capsuleScript.length < 6 ||
    level.capsuleScript.length > 10
  ) {
    push(`capsuleScript must have 6–10 entries (got ${String(level.capsuleScript.length)})`);
  }
  let prev = 0;
  let destructible = -1;
  if (Array.isArray(level.grid)) {
    destructible = level.grid
      .join("")
      .split("")
      .filter((c) => c !== "." && c !== "G").length;
  }
  const script = Array.isArray(level.capsuleScript) ? level.capsuleScript : [];
  for (let i = 0; i < script.length; i++) {
    const e = script[i];
    if (!e || typeof e.brickBreakCount !== "number" || e.brickBreakCount <= prev) {
      const got = typeof e?.brickBreakCount === "number" ? String(e.brickBreakCount) : "none";
      push(`capsuleScript[${String(i)}] brickBreakCount must be strictly increasing (got ${got} after ${String(prev)})`);
    }
    if (e && !CAPSULE_RE.test(e.capsule)) {
      push(`capsuleScript[${String(i)}] invalid capsule type '${e.capsule}'`);
    }
    if (e && destructible >= 0 && e.brickBreakCount > destructible) {
      push(`capsuleScript[${String(i)}] brickBreakCount ${String(e.brickBreakCount)} exceeds destructible brick count ${String(destructible)}`);
    }
    if (e) prev = e.brickBreakCount;
  }
  return errors;
}
