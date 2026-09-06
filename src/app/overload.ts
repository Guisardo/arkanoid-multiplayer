// Host overload protection (ticket 47, spec §9): the accumulator loop already
// caps catch-up at 5 sim ticks per render frame (loop.ts). SUSTAINED
// overload — the cap biting frame after frame — degrades the sim to
// slow-motion (time scale < 1) so wall-clock snapshot cadence holds at 30 Hz
// while the sim falls behind real time. Recovery is clean: sustained
// headroom walks the scale back to 1. Pure decision logic — the loop feeds
// per-frame observations, the app layer applies the scale.

/** Frames the cap must bite consecutively before slow-motion engages. */
export const OVERLOAD_ENGAGE_FRAMES = 30;
/** Frames of headroom needed to step the scale back up. */
export const RECOVER_FRAMES = 60;
/** Slow-motion floor (never below 50% speed). */
export const MIN_TIME_SCALE = 0.5;
/** Scale step per recovery window. */
export const RECOVER_STEP = 0.1;

export interface OverloadState {
  /** Current sim time scale (1 = full speed). */
  readonly timeScale: number;
  /** Slow-motion currently engaged. */
  readonly degraded: boolean;
  /** Consecutive capped frames (diagnostics). */
  readonly cappedStreak: number;
}

/**
 * Sustained-overload detector + slow-motion controller. Feed one observation
 * per render frame: `capped` = the accumulator hit its catch-up cap (the
 * loop already clamps — this only decides the time scale).
 */
export interface OverloadMonitor {
  /** Record a frame observation; returns the (possibly new) time scale. */
  observe(capped: boolean): number;
  /** Current state. */
  readonly state: OverloadState;
}

export function createOverloadMonitor(
  opts: { engageFrames?: number; recoverFrames?: number } = {},
): OverloadMonitor {
  const engage = opts.engageFrames ?? OVERLOAD_ENGAGE_FRAMES;
  const recover = opts.recoverFrames ?? RECOVER_FRAMES;
  let timeScale = 1;
  let cappedStreak = 0;
  let headroomStreak = 0;

  return {
    get state(): OverloadState {
      return { timeScale, degraded: timeScale < 1, cappedStreak };
    },
    observe(capped) {
      if (capped) {
        cappedStreak++;
        headroomStreak = 0;
        if (cappedStreak >= engage && timeScale > MIN_TIME_SCALE) {
          // Engage: drop to the floor in one step (validated: engages
          // cleanly; partial steps just delay the inevitable).
          timeScale = MIN_TIME_SCALE;
        }
      } else {
        cappedStreak = 0;
        headroomStreak++;
        if (headroomStreak >= recover && timeScale < 1) {
          // Round to the step grid — FP drift must never strand the scale
          // at 0.9999… instead of recovered.
          timeScale = Math.min(1, Math.round((timeScale + RECOVER_STEP) * 10) / 10);
          headroomStreak = 0;
        }
      }
      return timeScale;
    },
  };
}

/**
 * Snapshot cadence under slow-motion: snapshots keep 30 Hz WALL-CLOCK (spec
 * §9) — the sim tick between broadcasts shrinks with the time scale so the
 * wire rate never drops. Returns sim ticks between broadcasts.
 */
export function snapshotEveryTicks(timeScale: number, snapshotHz: 30 | 60): number {
  const scale = Math.max(MIN_TIME_SCALE, Math.min(1, timeScale));
  return Math.max(1, Math.round((60 / snapshotHz) * scale));
}
