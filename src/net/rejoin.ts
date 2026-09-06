// Rejoin window (ticket 47, spec §9): after a guest drops mid-match, its slot
// is held for 90 s. Rejoin = join-with-original-player-id on the control
// channel; the host validates the held slot, rebinds the guest's players to
// its new channel, and ships a full snapshot. Expiry = removal (competitive
// loss / coop slot gone). Rejoin spam is bounded by the held-slot + window
// only (ADR 0003): a rejoin for an unknown player id is refused, a rejoin
// after expiry is refused, a rejoin while the slot is live is refused.
import { parseControl, type RejoinRefusedMsg } from "net/control";

/** Rejoin window length (spec: 90 s). */
export const REJOIN_WINDOW_MS = 90_000;

/** Host-side outcome of a rejoin request. */
export type RejoinDecision =
  | { ok: true; guestIndex: number; playerIds: number[] }
  | { ok: false; reason: "unknownPlayer" | "expired" | "alreadyLive" };

/**
 * Host-side rejoin registry: one entry per dropped guest device still inside
 * its window. Pure — the app layer feeds wall-clock ms.
 */
export interface RejoinRegistry {
  /** A guest dropped at `nowMs` — hold its slot for the window. */
  hold(guestIndex: number, playerIds: number[], nowMs: number): void;
  /** A guest device is live again (rebound) — clear any held entry. */
  live(guestIndex: number): void;
  /** Evaluate a rejoin request carrying the ORIGINAL player id. */
  rejoin(playerId: number, nowMs: number): RejoinDecision;
  /** Expire windows past 90 s; returns the guest indices now expired. */
  expire(nowMs: number): number[];
  /** Held entry for a guest index (diagnostics/tests). */
  entry(guestIndex: number): { playerIds: number[]; heldSinceMs: number } | null;
}

interface HeldEntry {
  playerIds: number[];
  heldSinceMs: number;
}

export function createRejoinRegistry(): RejoinRegistry {
  const held = new Map<number, HeldEntry>();

  function findByPlayer(playerId: number): { guestIndex: number; entry: HeldEntry } | null {
    for (const [guestIndex, entry] of held) {
      if (entry.playerIds.includes(playerId)) return { guestIndex, entry };
    }
    return null;
  }

  return {
    hold(guestIndex, playerIds, nowMs) {
      held.set(guestIndex, { playerIds, heldSinceMs: nowMs });
    },
    live(guestIndex) {
      held.delete(guestIndex);
    },
    rejoin(playerId, nowMs) {
      const found = findByPlayer(playerId);
      if (found === null) return { ok: false, reason: "unknownPlayer" };
      if (nowMs - found.entry.heldSinceMs > REJOIN_WINDOW_MS) {
        return { ok: false, reason: "expired" };
      }
      held.delete(found.guestIndex);
      return { ok: true, guestIndex: found.guestIndex, playerIds: found.entry.playerIds };
    },
    expire(nowMs) {
      const expired: number[] = [];
      for (const [guestIndex, entry] of held) {
        if (nowMs - entry.heldSinceMs > REJOIN_WINDOW_MS) {
          expired.push(guestIndex);
          held.delete(guestIndex);
        }
      }
      return expired;
    },
    entry(guestIndex) {
      const e = held.get(guestIndex);
      return e === undefined ? null : { playerIds: [...e.playerIds], heldSinceMs: e.heldSinceMs };
    },
  };
}

// Rejoin rides the reliable control channel (spec §9) — messages defined in
// net/control.ts (RejoinMsg / RejoinOkMsg / RejoinRefusedMsg).

/** Narrow a host control message to a rejoin-refused (tests + UI). */
export function parseRejoinRefused(raw: string): RejoinRefusedMsg | null {
  const parsed = parseControl(raw);
  if (!parsed.ok) return null;
  const msg = parsed.msg;
  if (msg.type === "rejoin-refused") return msg;
  return null;
}
