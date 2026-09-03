// Capsule system (spec §4, §5): deterministic script-driven drops, zero RNG,
// classic-accurate effect behaviors. Data-only tuning values.
import type { CapsuleTypeId } from "shared/protocol";
import type { CapsuleScriptEntry } from "content/levelFormat";

/**
 * Runs a level's capsule script: each entry bound to a cumulative brick-break
 * count. `?` resolves to the next undropped scripted capsule (by script order);
 * E fallback when the script is exhausted. Player-opaque, zero RNG.
 */
export class CapsuleScriptRunner {
  private readonly script: readonly CapsuleScriptEntry[];
  private cursor = 0;

  constructor(script: readonly CapsuleScriptEntry[]) {
    this.script = script;
  }

  /**
   * Bricks broken just now (cumulative count after the break). Returns the
   * capsule type to drop, or null if no script entry triggers at this count.
   */
  onBrickBreak(cumulativeBreaks: number): CapsuleTypeId | null {
    let trigger: CapsuleScriptEntry | null = null;
    while (this.cursor < this.script.length) {
      const entry = this.script[this.cursor];
      if (!entry) break;
      if (entry.brickBreakCount <= cumulativeBreaks) {
        trigger = entry;
        this.cursor++;
      } else {
        break;
      }
    }
    if (!trigger) return null;
    return this.resolve(trigger.capsule);
  }

  /**
   * Resolve a scripted type: `?` → next undropped scripted capsule (does not
   * consume it — that entry still fires at its own break count); E fallback
   * when the script is exhausted.
   */
  private resolve(type: CapsuleTypeId): CapsuleTypeId {
    if (type !== "?") return type;
    for (let i = this.cursor; i < this.script.length; i++) {
      const entry = this.script[i];
      if (!entry) break;
      if (entry.capsule !== "?") return entry.capsule;
    }
    return "E"; // fallback when script exhausted
  }
}

// ---- Effect parameters (classic-accurate, data-only [authoring]) ----

export const CAPSULE_EFFECTS = {
  /** Expand: paddle ×1.5 width. */
  expandFactor: 1.5,
  /** Reduce: paddle ×0.65 width (negative capsule). */
  reduceFactor: 0.65,
  /** Laser fire cooldown (ms). */
  laserCooldownMs: 350,
  /** Catch hold max (ms) — classic ~ until next paddle hit or 10 s. */
  catchMaxMs: 10_000,
  /** Multiball split count. */
  multiballCount: 3,
  /** Catch bonus score per capsule. */
  capsuleCatchBonus: 100,
} as const;

/** Classic-accurate: effects that clear on ball loss. */
export const EFFECTS_CLEAR_ON_BALL_LOSS = new Set<CapsuleTypeId>([
  "E", "R", "C", "L", "S",
]);
