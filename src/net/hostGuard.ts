// Host-side structural validation of guest input (spec §9, ADR 0003): clamp
// axes to [-1..1], drop out-of-bounds ticks, ignore unknown action shapes,
// dedupe by (player, tick), cap the input-frame rate. Robustness, not
// anti-cheat — a malformed frame is dropped, never a crash; a flooding guest
// is throttled by the rate cap, never disconnected by this layer.
import type { InputFrame } from "shared/protocol";
import { EMPTY_ACTIONS } from "shared/protocol";

/** Max frames per player per host tick window the guard will pass. */
export const RATE_CAP_PER_TICK = 2;

export interface GuardState {
  lastTick: Map<number, number>;
  burst: Map<number, number>;
  burstTick: number;
}

export interface GuardResult {
  /** Frames that passed validation, safe to enqueue. */
  accepted: InputFrame[];
  /** Frames dropped (out-of-order, duplicate, over rate cap). */
  dropped: number;
}

function clampAxis(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

/** Runtime boolean narrow: malformed frames never leak non-boolean edges. */
function asBool(v: unknown): boolean {
  return v === true;
}

/** Normalize an action set: unknown/absent actions read as empty. */
function sanitizeActions(a: InputFrame["actions"] | undefined): InputFrame["actions"] {
  if (a === undefined) return EMPTY_ACTIONS;
  const fire: readonly unknown[] = Array.isArray(a.fire) ? a.fire : [];
  return {
    cycleForward: asBool(a.cycleForward),
    cycleBack: asBool(a.cycleBack),
    fire: [
      fire[0] === true,
      fire[1] === true,
      fire[2] === true,
      fire[3] === true,
    ] as [boolean, boolean, boolean, boolean],
  };
}

export function createHostInputGuard(): GuardState {
  return {
    lastTick: new Map(),
    burst: new Map(),
    burstTick: -1,
  };
}

/**
 * Validate decoded guest frames at host tick `hostTick`. Input: already
 * decoded InputFrames (decode failures happen earlier and drop the whole
 * envelope). Output: deduped, clamped, rate-capped frames.
 */
export function guardGuestFrames(
  state: GuardState,
  frames: readonly InputFrame[],
  hostTick: number,
): GuardResult {
  // Reset the burst window when the host tick advances.
  if (hostTick !== state.burstTick) {
    state.burstTick = hostTick;
    state.burst.clear();
  }

  const accepted: InputFrame[] = [];
  let dropped = 0;
  for (const raw of frames) {
    const player = raw.player;
    if (!Number.isInteger(player) || player < 0 || player > 3) {
      dropped++;
      continue;
    }
    if (!Number.isInteger(raw.tick)) {
      dropped++;
      continue;
    }
    // Out-of-order / stale: behind the latest tick already seen.
    const last = state.lastTick.get(player) ?? -1;
    if (raw.tick <= last) {
      dropped++;
      continue;
    }
    // Rate cap: too many frames for one player in one host tick.
    const burst = state.burst.get(player) ?? 0;
    if (burst >= RATE_CAP_PER_TICK) {
      dropped++;
      continue;
    }
    state.burst.set(player, burst + 1);
    state.lastTick.set(player, raw.tick);
    accepted.push({
      player,
      tick: raw.tick,
      axisX: clampAxis(raw.axisX),
      axisY: clampAxis(raw.axisY),
      launch: asBool(raw.launch),
      actions: sanitizeActions(raw.actions),
    });
  }
  return { accepted, dropped };
}
