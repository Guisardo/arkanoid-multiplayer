// Field epoch overlay (ticket #151, CONTEXT.md "Sim epoch"). A composer that
// replaces a field's RoundSim — round advance, field reset, Continue, Restart —
// owns one FieldEpoch per field. It stamps the field's snapshots with the
// current epoch, so consumers know ticks restarted, and carries the outgoing
// sim's final-step events (the CLEAR that triggered the rebuild, the last
// ballLoss/gameOver) into the new epoch's ring. Without the carry those events
// vanish: the sim is swapped inside the very step that emitted them, before
// any renderer or audio consumer reads a snapshot.
//
// The carry is an overlay, not seeded into the sim's own ring, so composer
// bookkeeping that reads the raw sim ring (assist meter income) never counts a
// carried event twice.
import { EVENT_RING_SIZE, nextEpoch, type SimEvent, type Snapshot } from "shared/protocol";

/** Tick the carried events are restamped to: the new epoch's first tick. */
const CARRY_TICK = 0;

export class FieldEpoch {
  private current: number;
  private carried: readonly SimEvent[] = [];

  constructor(initialEpoch = 0) {
    this.current = initialEpoch;
  }

  get epoch(): number {
    return this.current;
  }

  /**
   * The field's sim is being replaced. `outgoing` is the replaced sim's last
   * snapshot; events from its final step ride into the new epoch. Pass null
   * when nothing should carry (the outgoing events were already shown).
   */
  advance(outgoing: Snapshot | null): void {
    this.current = nextEpoch(this.current);
    this.carried = outgoing === null ? [] : finalStepEvents(outgoing);
  }

  /** Stamp a snapshot of the field's current sim: epoch + carried events. */
  stamp(snap: Snapshot): Snapshot {
    if (this.carried.length === 0) {
      return snap.epoch === this.current ? snap : { ...snap, epoch: this.current };
    }
    return {
      ...snap,
      epoch: this.current,
      events: [...this.carried, ...snap.events].slice(-EVENT_RING_SIZE),
    };
  }
}

/**
 * Events the snapshot's final step emitted, restamped to the next epoch's
 * first tick. Sims stamp an event with the tick count *before* the step's
 * increment, so the final step's events carry `snap.tick - 1`.
 */
export function finalStepEvents(snap: Snapshot): SimEvent[] {
  const finalTick = snap.tick - 1;
  return snap.events
    .filter((e) => e.tick === finalTick)
    .map((e) => ({ ...e, tick: CARRY_TICK }));
}
