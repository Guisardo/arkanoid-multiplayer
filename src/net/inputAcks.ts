// Host input acks (ticket #155, CONTEXT.md "Match tick"): per sim player, the
// newest Match tick whose REAL input frame the delay queue has fed the sim.
// The guest predictor reconciles at exactly that tick. Sims can't supply it:
// their own tick restarts every Sim epoch, and they never see the delay
// queue. Stall-decay frames are synthetic, so they are never recorded here.
import {
  NO_INPUT_ACK,
  type InputFrame,
  type PlayerSnapshot,
  type Snapshot,
} from "shared/protocol";

export interface InputAckTracker {
  /** Record the real frames the delay queue just delivered. */
  delivered(frames: readonly InputFrame[]): void;
  /** Newest delivered Match tick for a sim player, or NO_INPUT_ACK. */
  ackOf(player: number): number;
  /**
   * The snapshot with `inputAcks` parallel to its `players`: each slot's
   * ack is `ackOf(simPlayerOf(slot))`.
   */
  stamp(snap: Snapshot, simPlayerOf: (slot: PlayerSnapshot) => number): Snapshot;
}

export function createInputAckTracker(): InputAckTracker {
  const acks = new Map<number, number>();

  const tracker: InputAckTracker = {
    delivered(frames) {
      for (const f of frames) {
        const prev = acks.get(f.player);
        if (prev === undefined || f.tick > prev) acks.set(f.player, f.tick);
      }
    },
    ackOf(player) {
      return acks.get(player) ?? NO_INPUT_ACK;
    },
    stamp(snap, simPlayerOf) {
      return { ...snap, inputAcks: snap.players.map((p) => tracker.ackOf(simPlayerOf(p))) };
    },
  };
  return tracker;
}
