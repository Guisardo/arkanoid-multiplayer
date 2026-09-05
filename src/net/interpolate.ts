// Guest-side interpolation of remote entities (spec §9): remote paddles,
// balls and capsules render from a snapshot buffer at (latest − delay); the
// ball is NEVER extrapolated — when the buffer runs dry the newest sample
// holds. Buffer delay adapts: grows toward ~2.5 snapshot intervals when gaps
// appear (late arrivals), shrinks slowly when consistently full.
import type { Snapshot } from "shared/protocol";

export interface InterpolationOptions {
  /** Nominal broadcast rate (Hz) — Duel 60, everything else 30. */
  snapshotHz: 30 | 60;
  /** Multiplier on the interval kept as buffer delay (default 2.5). */
  intervalMultiple?: number;
  /** Max buffer delay in ms (default 150). */
  maxDelayMs?: number;
}

interface TimedSnapshot {
  receivedAtMs: number;
  snap: Snapshot;
}

export interface Interpolator {
  /** Feed a decoded snapshot; `nowMs` is the shared wall clock (caller-owned). */
  push(snap: Snapshot, nowMs: number): void;
  /** Render-time state for the same clock; newest holds when starved. */
  sample(nowMs: number): Snapshot | null;
  /** Current buffer delay in ms (diagnostic/tests). */
  readonly delayMs: number;
  /** Snapshots currently buffered (tests). */
  readonly size: number;
}

export function createInterpolator(opts: InterpolationOptions): Interpolator {
  const intervalMs = 1000 / opts.snapshotHz;
  const multiple = opts.intervalMultiple ?? 2.5;
  const maxDelayMs = opts.maxDelayMs ?? 150;
  const nominal = intervalMs * multiple;
  let targetDelay = nominal;
  let size = 0;
  let buffer: TimedSnapshot[] = [];

  return {
    get delayMs() {
      return targetDelay;
    },
    get size() {
      return size;
    },
    push(snap, nowMs) {
      const last = buffer[buffer.length - 1];
      if (last !== undefined && snap.tick <= last.snap.tick) {
        // Stale duplicate or reorder on the unreliable channel: refresh the
        // matching tick in place, otherwise drop.
        const existing = buffer.find((e) => e.snap.tick === snap.tick);
        if (existing !== undefined) existing.snap = snap;
        return;
      }
      buffer.push({ receivedAtMs: nowMs, snap });
      // Memory trim: never keep more than the last 16 samples.
      if (buffer.length > 16) buffer = buffer.slice(-16);
      size = buffer.length;
    },
    sample(nowMs) {
      size = buffer.length;
      if (buffer.length === 0) return null;
      const targetTime = nowMs - targetDelay;
      let chosen: TimedSnapshot | null = null;
      for (const entry of buffer) {
        if (entry.receivedAtMs <= targetTime) chosen = entry;
        else break;
      }
      if (chosen === null) {
        // Starved: every sample is younger than the target time — hold the
        // newest (never extrapolate the ball) and grow the delay.
        targetDelay = Math.min(targetDelay + intervalMs * 0.5, maxDelayMs);
        const newest = buffer[buffer.length - 1];
        return newest === undefined ? null : newest.snap;
      }
      if (chosen === buffer[buffer.length - 1]) {
        // Just-in-time: nudge the delay up so jitter headroom grows.
        targetDelay = Math.min(targetDelay + intervalMs * 0.25, maxDelayMs);
      } else {
        // Comfortably fed: decay back toward nominal.
        targetDelay = Math.max(targetDelay - intervalMs * 0.05, nominal);
      }
      return chosen.snap;
    },
  };
}
