// Host input stall decay (spec §9, ticket 46): a guest that stops sending has
// its players' axes HELD at the last value for ≤STALL_HOLD missing ticks, then
// DECAYED to 0 (~0.7× per tick — a stalled paddle stops, it never ghosts on at
// full axis). The host injects these frames DIRECTLY into the sim step (not
// the delay queue): synthetic queue frames would collide with the guest's own
// frame-tick timeline and the guard would drop real input as duplicates. A
// due frame resets the miss counter.
//
// Only the axis is held. Edges (launch, actions) and held fire (`primaryHeld`,
// ticket #141) are always off in a synthetic frame: a dropped connection must
// never keep a Laser firing.
import { EMPTY_ACTIONS, type InputFrame } from "shared/protocol";

/** Missing ticks the last axis is held before decay starts. */
export const STALL_HOLD = 10;
/** Per-tick axis multiplier once the hold window is over. */
export const STALL_DECAY = 0.7;
/** Decayed axes below this magnitude snap to 0 (paddle stops). */
export const STALL_FLOOR = 0.05;

export interface StallDecay {
  /** Held/decayed frames for guest players with no due frame this tick. */
  frames(due: readonly InputFrame[], tick: number): InputFrame[];
  /** Drop a player's stall state (removal). */
  forget(player: number): void;
}

export function createStallDecay(
  guestPlayerIds: readonly number[],
  isRemoved: (player: number) => boolean,
): StallDecay {
  const missCount = new Map<number, number>();
  const lastAxis = new Map<number, number>();

  function synthetic(player: number, tick: number, axisX: number): InputFrame {
    return {
      player,
      tick,
      axisX,
      axisY: 0,
      launch: false,
      primaryHeld: false,
      actions: EMPTY_ACTIONS,
    };
  }

  return {
    frames(due, tick) {
      const out: InputFrame[] = [];
      if (guestPlayerIds.length === 0) return out;
      const seen = new Set(due.map((f) => f.player));
      for (const p of guestPlayerIds) {
        if (isRemoved(p)) continue; // removed: no synthetic input
        if (seen.has(p)) {
          const f = due.find((x) => x.player === p);
          if (f !== undefined) lastAxis.set(p, f.axisX);
          missCount.set(p, 0);
          continue;
        }
        const misses = (missCount.get(p) ?? 0) + 1;
        missCount.set(p, misses);
        const held = lastAxis.get(p) ?? 0;
        if (held === 0) continue; // nothing to hold — idle stays idle
        if (misses <= STALL_HOLD) {
          out.push(synthetic(p, tick, held));
        } else {
          const decayed = held * STALL_DECAY ** (misses - STALL_HOLD);
          out.push(synthetic(p, tick, Math.abs(decayed) < STALL_FLOOR ? 0 : decayed));
        }
      }
      return out;
    },
    forget(player) {
      missCount.delete(player);
      lastAxis.delete(player);
    },
  };
}
