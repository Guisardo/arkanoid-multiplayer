// Event watermark (ticket #151): which snapshot ring events a consumer has
// already acted on. The ring repeats across consecutive snapshots (and guest
// interpolation replays it), so render effects and audio both dedupe through
// this one rule instead of each keeping a bare "newest tick" number.
//
// Ticks only order within one Sim epoch — a replaced sim restarts at tick 0 —
// so a newer epoch resets the watermark and a stale (older) epoch is ignored.
// Within an epoch, several events can share a tick (a carried CLEAR and the
// new sim's first-step events both sit on tick 0), so the watermark tracks
// how many events at its newest tick were already taken.
import { compareEpoch, type SimEvent, type Snapshot } from "./protocol";

export class EventWatermark {
  private epoch: number | null = null;
  /** Newest event tick taken in this epoch; -1 = none yet. */
  private lastTick = -1;
  /** Events at `lastTick` already taken. */
  private takenAtLastTick = 0;

  /** Ring events not taken before, in ring order. Advances the watermark. */
  take(snap: Snapshot): SimEvent[] {
    if (this.epoch === null || compareEpoch(snap.epoch, this.epoch) > 0) {
      this.epoch = snap.epoch;
      this.lastTick = -1;
      this.takenAtLastTick = 0;
    } else if (compareEpoch(snap.epoch, this.epoch) < 0) {
      return [];
    }

    const fresh: SimEvent[] = [];
    let ordinal = 0;
    let prevTick: number | null = null;
    for (const event of snap.events) {
      ordinal = event.tick === prevTick ? ordinal + 1 : 0;
      prevTick = event.tick;
      const isNewTick = event.tick > this.lastTick;
      const isUntakenAtTick = event.tick === this.lastTick && ordinal >= this.takenAtLastTick;
      if (isNewTick || isUntakenAtTick) fresh.push(event);
    }

    const newest = snap.events[snap.events.length - 1];
    if (newest !== undefined && newest.tick >= this.lastTick) {
      const atNewest = snap.events.filter((e) => e.tick === newest.tick).length;
      this.takenAtLastTick =
        newest.tick > this.lastTick ? atNewest : Math.max(this.takenAtLastTick, atNewest);
      this.lastTick = newest.tick;
    }
    return fresh;
  }

  /** Forget everything — the next snapshot's whole ring counts as fresh. */
  reset(): void {
    this.epoch = null;
    this.lastTick = -1;
    this.takenAtLastTick = 0;
  }
}
