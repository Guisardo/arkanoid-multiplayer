// Host tab backgrounding (ticket 47, spec §10): a backgrounded host tab
// gets timer-throttled to ≥1 s intervals — the sim would starve. WebRTC
// in use exempts INTENSIVE throttling but not the freeze, so:
//   1. wake lock (screen) keeps the tab foreground-equivalent where
//      granted;
//   2. a Worker-driven clock keeps ticking while the main thread is
//      throttled (the worker posts ticks; the main thread runs them);
//   3. on visibility return, pause-and-resync: the accumulated drift is
//      discarded (capped by the loop) and a fresh full snapshot is
//      broadcast so guests resync.
// Browser glue only — every capability is injectable for tests.

export interface KeepAliveDeps {
  /** Request a screen wake lock; resolves null when denied/unsupported. */
  requestWakeLock?(): Promise<{ release(): Promise<void> } | null>;
  /** Visibility change subscription; returns an unsubscribe. */
  onVisibilityChange?(cb: (visible: boolean) => void): () => void;
  /** Worker-style interval: calls back every `ms` until stopped. */
  setInterval?(ms: number, cb: () => void): () => void;
  /** Called when the tab becomes visible again (pause-and-resync hook). */
  onResync?(): void;
}

export interface KeepAlive {
  /** Start: acquire wake lock + background tick + visibility watch. */
  start(): void;
  /** Stop: release everything. */
  stop(): void;
  /** Wake lock currently held (diagnostics). */
  readonly wakeLockHeld: boolean;
  /** Background tick currently running. */
  readonly ticking: boolean;
}

/** Background tick cadence — coarse is fine, the loop caps catch-up. */
export const BACKGROUND_TICK_MS = 250;

export function createKeepAlive(deps: KeepAliveDeps = {}): KeepAlive {
  let lock: { release(): Promise<void> } | null = null;
  let stopTick: (() => void) | null = null;
  let stopVisibility: (() => void) | null = null;
  let held = false;
  let ticking = false;
  let visible = true;

  return {
    get wakeLockHeld() {
      return held;
    },
    get ticking() {
      return ticking;
    },
    start() {
      void deps
        .requestWakeLock?.()
        .then((l) => {
          lock = l;
          held = l !== null;
        })
        .catch(() => {
          held = false;
        });
      if (deps.setInterval !== undefined) {
        stopTick = deps.setInterval(BACKGROUND_TICK_MS, () => {
          // Background tick: only while HIDDEN — the foreground rAF loop
          // already drives the sim; resyncing on every tick would spam
          // snapshots and defeat the guests' silence monitors.
          if (!visible) deps.onResync?.();
        });
        ticking = true;
      }
      if (deps.onVisibilityChange !== undefined) {
        stopVisibility = deps.onVisibilityChange((vis) => {
          visible = vis;
          // Pause-and-resync on return: the throttled gap may have drifted
          // guests — ship fresh full snapshots.
          if (vis) deps.onResync?.();
        });
      }
    },
    stop() {
      void lock?.release().catch(() => undefined);
      lock = null;
      held = false;
      stopTick?.();
      stopTick = null;
      ticking = false;
      stopVisibility?.();
      stopVisibility = null;
    },
  };
}
