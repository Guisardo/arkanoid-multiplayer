// Ticket 103: conflict resolution for the composite save key (ADR 0008 §6).
//
// The save document already carries the two primitives this needs — `updatedAt`
// (epoch ms of the last write) and `deviceId` (stable per-install id). This
// module turns those into a decision, and nothing else: no storage, no
// listeners, no throwing.
//
// The ordering is deliberately a *total order* over (updatedAt, deviceId):
//
//     A beats B  ⟺  A.updatedAt > B.updatedAt
//                  ∨ (A.updatedAt === B.updatedAt ∧ A.deviceId > B.deviceId)
//
// Total ordering is the whole point. Wall-clock ms are not unique across tabs,
// so if the tie-break were "first argument wins", two tabs holding the same
// pair would disagree and flip the save back and forth forever. Comparing the
// id as the second key makes every tab reach the same answer from the same
// inputs, which is what lets the default path be plain last-write-wins and
// leave manual merging for the cases a player actually cares about.

import type { SaveDocument } from "./saveDocument";

export type { SaveDocument };

/** The two sides in a collision, plus the winner. */
export interface ConflictResolution {
  readonly winner: SaveDocument;
  readonly loser: SaveDocument;
  /** True when the tie-break had to use deviceId (same millisecond). */
  readonly tieBroken: boolean;
}

/**
 * Strict weak ordering over documents: does `a` beat `b`?
 *
 * Every comparison the module makes routes through this one function, so the
 * symmetry/transitivity that makes last-write-wins converge is established in
 * exactly one place.
 */
export function beats(a: SaveDocument, b: SaveDocument): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  // Same millisecond from two different tabs. The id is the tie-break, and
  // string comparison gives an order every tab computes identically.
  return a.deviceId > b.deviceId;
}

/** Last-write-wins with a deterministic tie-break. */
export function resolveConflict(local: SaveDocument, remote: SaveDocument): ConflictResolution {
  const remoteWins = beats(remote, local);
  return {
    winner: remoteWins ? remote : local,
    loser: remoteWins ? local : remote,
    tieBroken: local.updatedAt === remote.updatedAt,
  };
}

/**
 * A document minus its bookkeeping fields — the part a player would actually
 * look at in the merge UI. Two documents with identical content but different
 * timestamps are the same save, not a conflict.
 */
function contentKey(doc: SaveDocument): string {
  return JSON.stringify([doc.settings, doc.solo, doc.soloEpisode ?? null]);
}

/**
 * True when both sides carry changes that the other lacks — the only case worth
 * interrupting a player over.
 *
 * `base` is the last document both sides agreed on (what this tab last wrote or
 * read). With no base we cannot prove divergence, so we report false and let
 * last-write-wins stand: guessing "conflict" on every fresh tab would make the
 * merge UI pop up constantly.
 *
 * Three situations are deliberately NOT conflicts:
 *   - One side is unchanged from base (the other simply overwrote it).
 *   - Both sides are byte-identical (same save, written twice).
 *   - Both sides share a deviceId (one install's own echo arriving back).
 */
export function isDivergent(
  local: SaveDocument,
  remote: SaveDocument,
  base: SaveDocument | null,
): boolean {
  if (base === null) return false;
  // Our own write coming back through the channel is never a conflict.
  if (local.deviceId === remote.deviceId) return false;
  if (contentKey(local) === contentKey(remote)) return false;

  const localChanged = contentKey(local) !== contentKey(base);
  const remoteChanged = contentKey(remote) !== contentKey(base);
  return localChanged && remoteChanged;
}

/** What the storage layer should do with a write arriving from another tab. */
export type WriteClassification =
  /** Identical to what we already hold — drop it, nothing changed. */
  | "same"
  /** The incoming write loses the ordering — keep ours, drop theirs. */
  | "ignore"
  /** The incoming write wins outright — adopt it silently. */
  | "apply"
  /** Both sides moved on — surface the manual merge UI. */
  | "conflict";

/**
 * Classify an incoming write against what we hold. Pure decision, so the
 * caller owns the side effect (and can still choose to prompt).
 */
export function classifyWrite(
  local: SaveDocument,
  incoming: SaveDocument,
  base: SaveDocument | null,
): WriteClassification {
  if (contentKey(local) === contentKey(incoming) && local.updatedAt === incoming.updatedAt) {
    return "same";
  }
  if (isDivergent(local, incoming, base)) return "conflict";
  return beats(incoming, local) ? "apply" : "ignore";
}
