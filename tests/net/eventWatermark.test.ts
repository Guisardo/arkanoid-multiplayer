// Event watermark (ticket #151): ring dedupe that survives sim rebuilds.
//
// Regression: render effects and audio each kept a bare "newest event tick"
// that never reset, so once a round cleared and the next round's sim
// restarted at tick 0, every Round 2 event fell at or below the Round 1
// watermark and was silently dropped — no FX and no SFX on Round 2.
import { describe, expect, it } from "vitest";
import { EventWatermark } from "shared/eventWatermark";
import { EPOCH_MODULUS, compareEpoch, nextEpoch, type SimEvent, type Snapshot } from "shared/protocol";

function ev(tick: number, type: SimEvent["type"] = "brickBreak", target = -1): SimEvent {
  return { type, source: 0, target, tick };
}

function snap(epoch: number, tick: number, events: SimEvent[]): Snapshot {
  return {
    tick,
    phase: "play",
    round: 1,
    epoch,
    players: [],
    balls: [],
    capsules: [],
    bricks: [],
    events,
    inputAcks: [],
  };
}

describe("EventWatermark", () => {
  it("takes each ring event once across repeated snapshots", () => {
    const w = new EventWatermark();
    expect(w.take(snap(0, 3, [ev(1), ev(2)]))).toEqual([ev(1), ev(2)]);
    expect(w.take(snap(0, 3, [ev(1), ev(2)]))).toEqual([]);
    expect(w.take(snap(0, 6, [ev(1), ev(2), ev(5)]))).toEqual([ev(5)]);
  });

  it("takes a new epoch's events even though its ticks restarted below the watermark", () => {
    const w = new EventWatermark();
    w.take(snap(0, 5000, [ev(4990), ev(4999, "roundClear")]));
    expect(w.take(snap(1, 12, [ev(3), ev(11)]))).toEqual([ev(3), ev(11)]);
  });

  it("ignores a stale snapshot from an older epoch", () => {
    const w = new EventWatermark();
    w.take(snap(1, 10, [ev(4)]));
    expect(w.take(snap(0, 5000, [ev(4999)]))).toEqual([]);
    expect(w.take(snap(1, 20, [ev(4), ev(15)]))).toEqual([ev(15)]);
  });

  it("takes events sharing the watermark tick that arrive in a later snapshot", () => {
    // A carried CLEAR (restamped to tick 0) is seen alone first; the new sim's
    // first step then emits its own tick-0 event into the same ring.
    const w = new EventWatermark();
    const carried = ev(0, "roundClear");
    expect(w.take(snap(2, 0, [carried]))).toEqual([carried]);
    const launch = ev(0, "ballLaunch");
    expect(w.take(snap(2, 1, [carried, launch]))).toEqual([launch]);
    expect(w.take(snap(2, 1, [carried, launch]))).toEqual([]);
  });

  it("takes nothing new from an older same-epoch snapshot (guest interpolation jitter)", () => {
    const w = new EventWatermark();
    w.take(snap(0, 30, [ev(10), ev(20), ev(29)]));
    expect(w.take(snap(0, 25, [ev(10), ev(20)]))).toEqual([]);
    expect(w.take(snap(0, 31, [ev(10), ev(20), ev(29), ev(30)]))).toEqual([ev(30)]);
  });

  it("orders epochs across the u16 wrap", () => {
    const w = new EventWatermark();
    const last = EPOCH_MODULUS - 1;
    w.take(snap(last, 900, [ev(899)]));
    expect(w.take(snap(nextEpoch(last), 2, [ev(1)]))).toEqual([ev(1)]);
  });

  it("reset() makes the whole next ring fresh", () => {
    const w = new EventWatermark();
    w.take(snap(0, 3, [ev(1), ev(2)]));
    w.reset();
    expect(w.take(snap(0, 3, [ev(1), ev(2)]))).toEqual([ev(1), ev(2)]);
  });
});

describe("epoch ordering", () => {
  it("nextEpoch wraps at the u16 modulus", () => {
    expect(nextEpoch(0)).toBe(1);
    expect(nextEpoch(EPOCH_MODULUS - 1)).toBe(0);
  });

  it("compareEpoch is wrap-aware", () => {
    expect(compareEpoch(5, 5)).toBe(0);
    expect(compareEpoch(6, 5)).toBe(1);
    expect(compareEpoch(5, 6)).toBe(-1);
    expect(compareEpoch(0, EPOCH_MODULUS - 1)).toBe(1);
    expect(compareEpoch(EPOCH_MODULUS - 1, 0)).toBe(-1);
  });
});
