// Disconnect detection (ticket 47, spec §9): heartbeat + channel-close,
// whichever first. The GUEST pings every 5 s; the HOST drops a guest after
// ~10–15 s of silence (12 s default). The GUEST watches the host's game
// channel: ~1 s of snapshot silence = blind period (reconnect banner),
// ~10–15 s (12 s default) = session over. Pure tick-driven state machines —
// the app layer owns the timers and feeds elapsed ms.

/** Guest → host ping cadence (spec: 5 s). */
export const PING_INTERVAL_MS = 5000;
/** Host drops a silent guest after this long (spec: ~10–15 s). */
export const HOST_DROP_SILENCE_MS = 12_000;
/** Guest blind banner after this much snapshot silence (spec: ~1 s). */
export const GUEST_BLIND_BANNER_MS = 1000;
/** Guest gives up on the host after this much silence (spec: ~10–15 s). */
export const GUEST_SESSION_OVER_MS = 12_000;

/**
 * Host-side per-guest watchdog: last-heard timestamp vs. now. A ping or ANY
 * control/binary traffic counts as heard (whichever-first semantics with
 * channel close — the app layer calls `close()` on the close event).
 */
export interface HostWatchdog {
  /** Record activity from the guest (ping, pong, input, anything). */
  heard(nowMs: number): void;
  /** Advance; true = silence exceeded the drop threshold. */
  tick(nowMs: number): boolean;
  /** Channel closed — dead immediately (whichever-first). */
  close(): boolean;
  readonly dropped: boolean;
}

export function createHostWatchdog(
  nowMs: number,
  opts: { dropSilenceMs?: number } = {},
): HostWatchdog {
  const dropMs = opts.dropSilenceMs ?? HOST_DROP_SILENCE_MS;
  let lastHeard = nowMs;
  let dropped = false;
  return {
    get dropped() {
      return dropped;
    },
    heard(now) {
      if (!dropped) lastHeard = now;
    },
    tick(now) {
      if (!dropped && now - lastHeard >= dropMs) dropped = true;
      return dropped;
    },
    close() {
      dropped = true;
      return dropped;
    },
  };
}

/**
 * Guest-side silence monitor over the host's game channel: banner at ~1 s
 * of snapshot silence, session-over at ~12 s. Any snapshot resets it.
 */
export interface GuestSilenceMonitor {
  /** A snapshot (or any host traffic) arrived. */
  fed(nowMs: number): void;
  /** Advance; returns the current blind state. */
  tick(nowMs: number): GuestBlindState;
  /** Control channel closed — session over immediately. */
  controlClosed(): GuestBlindState;
  readonly state: GuestBlindState;
}

export type GuestBlindState = "live" | "blind" | "over";

export function createGuestSilenceMonitor(
  nowMs: number,
  opts: { bannerMs?: number; overMs?: number } = {},
): GuestSilenceMonitor {
  const bannerMs = opts.bannerMs ?? GUEST_BLIND_BANNER_MS;
  const overMs = opts.overMs ?? GUEST_SESSION_OVER_MS;
  let lastFed = nowMs;
  let state: GuestBlindState = "live";
  return {
    get state() {
      return state;
    },
    fed(now) {
      lastFed = now;
      // "over" is terminal — a late snapshot never resurrects the session.
      if (state !== "over") state = "live";
    },
    tick(now) {
      if (state === "over") return state;
      const silence = now - lastFed;
      if (silence >= overMs) state = "over";
      else if (silence >= bannerMs) state = "blind";
      return state;
    },
    controlClosed() {
      state = "over";
      return state;
    },
  };
}

/** Ping scheduler: fires a ping when PING_INTERVAL_MS elapsed since last. */
export function pingDue(lastPingMs: number, nowMs: number): boolean {
  return nowMs - lastPingMs >= PING_INTERVAL_MS;
}
