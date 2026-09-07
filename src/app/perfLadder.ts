// Perf fallback ladder (ticket 54, spec §12): dpr 2 → 1.5 → 1.0 → 30 fps
// degraded. Render-only — the sim stays fixed 60 Hz no matter what. Pure
// state machine: feed it frame timings, read out the target dpr + render
// cadence. Hysteresis both directions so a device sitting on the edge
// never oscillates. Degraded mode is EXPLICIT (never a design target).
export interface PerfRung {
  /** Renderer resolution (devicePixelRatio cap applied by the caller). */
  readonly dpr: number;
  /** Render every Nth frame; 2 = 30 fps degraded (sim stays 60 Hz). */
  readonly renderEvery: number;
  /** True only on the final rung (explicit degraded mode). */
  readonly degraded: boolean;
}

export const PERF_RUNGS: readonly PerfRung[] = [
  { dpr: 2, renderEvery: 1, degraded: false },
  { dpr: 1.5, renderEvery: 1, degraded: false },
  { dpr: 1, renderEvery: 1, degraded: false },
  { dpr: 1, renderEvery: 2, degraded: true },
] as const;

/** Frame is "slow" when it misses the 60 fps budget by this factor. */
export const SLOW_FRAME_MS = 1000 / 50; // 20 ms — sustained 50 fps or worse
/** Frame is "fast" when it holds comfortably above 60 fps. */
export const FAST_FRAME_MS = 1000 / 65; // ~15.4 ms

/** Consecutive slow frames before stepping down a rung. */
export const STEP_DOWN_FRAMES = 45; // ~0.75 s at 60 fps
/** Consecutive fast frames before stepping up a rung (recovery). */
export const STEP_UP_FRAMES = 240; // ~4 s — recovery is deliberately lazy

export interface PerfLadderState {
  readonly rung: number;
  readonly slowStreak: number;
  readonly fastStreak: number;
}

export interface PerfLadder {
  /** Feed one frame's total app time (sim + sync + render, ms). */
  observe(frameMs: number): void;
  /** Current rung (see PERF_RUNGS). */
  readonly state: PerfLadderState;
  /** Effective rung descriptor. */
  readonly rung: PerfRung;
  /** True when the rung index changed on the last observe(). */
  readonly changed: boolean;
  /** Test hook: jump straight to a rung (settings dpr mode wiring). */
  setRung(index: number): void;
}

export function createPerfLadder(startRung = 0): PerfLadder {
  let rung = clampRung(startRung);
  let slowStreak = 0;
  let fastStreak = 0;
  let changed = false;

  return {
    get state(): PerfLadderState {
      return { rung, slowStreak, fastStreak };
    },
    get rung(): PerfRung {
      return PERF_RUNGS[rung] ?? { dpr: 2, renderEvery: 1, degraded: false };
    },
    get changed(): boolean {
      return changed;
    },
    observe(frameMs) {
      changed = false;
      if (frameMs >= SLOW_FRAME_MS) {
        slowStreak++;
        fastStreak = 0;
      } else if (frameMs <= FAST_FRAME_MS) {
        fastStreak++;
        slowStreak = 0;
      } else {
        // Between thresholds: neither streak grows — edge devices hold.
        slowStreak = 0;
        fastStreak = 0;
      }
      if (slowStreak >= STEP_DOWN_FRAMES && rung < PERF_RUNGS.length - 1) {
        rung = clampRung(rung + 1);
        slowStreak = 0;
        fastStreak = 0;
        changed = true;
      } else if (fastStreak >= STEP_UP_FRAMES && rung > 0) {
        rung = clampRung(rung - 1);
        slowStreak = 0;
        fastStreak = 0;
        changed = true;
      }
    },
    setRung(index) {
      rung = clampRung(index);
      slowStreak = 0;
      fastStreak = 0;
      changed = true;
    },
  };
}

function clampRung(index: number): number {
  return Math.max(0, Math.min(PERF_RUNGS.length - 1, Math.trunc(index)));
}

/**
 * Map a Settings dpr mode (spec §14: auto/2/1.5/1) to the ladder rung the
 * session starts from. "auto" starts at the top; numeric modes pin the
 * starting rung (the ladder may still step DOWN from it under sustained
 * load, and recovers back up toward it — never above it).
 */
export function rungForDprMode(mode: "auto" | "2" | "1.5" | "1"): number {
  switch (mode) {
    case "2":
      return 0;
    case "1.5":
      return 1;
    case "1":
      return 2;
    case "auto":
      return 0;
  }
}
