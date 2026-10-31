// FieldEpoch overlay (ticket #151): epoch stamping + final-step event carry.
import { describe, expect, it } from "vitest";
import { FieldEpoch, finalStepEvents } from "sim/fieldEpoch";
import { SIM_EVENT_RING_SIZE, type SimEvent, type Snapshot } from "shared/protocol";

function ev(tick: number, type: SimEvent["type"] = "brickBreak"): SimEvent {
  return { type, source: 0, target: -1, tick };
}

function snap(tick: number, events: SimEvent[], epoch = 0): Snapshot {
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

describe("finalStepEvents", () => {
  it("keeps only the final step's events, restamped to tick 0", () => {
    // Sims stamp an event with the pre-increment tick: a snapshot at tick 300
    // holds the final step's events at tick 299.
    const out = finalStepEvents(snap(300, [ev(250), ev(299), ev(299, "roundClear")]));
    expect(out).toEqual([ev(0), ev(0, "roundClear")]);
  });

  it("carries nothing when the final step emitted nothing", () => {
    expect(finalStepEvents(snap(300, [ev(120)]))).toEqual([]);
  });
});

describe("FieldEpoch", () => {
  it("passes a snapshot through untouched before any rebuild", () => {
    const fe = new FieldEpoch();
    const s = snap(10, [ev(9)]);
    expect(fe.stamp(s)).toBe(s);
    expect(fe.epoch).toBe(0);
  });

  it("advance() bumps the epoch and stamps it on the new sim's snapshots", () => {
    const fe = new FieldEpoch();
    fe.advance(null);
    expect(fe.epoch).toBe(1);
    expect(fe.stamp(snap(0, [])).epoch).toBe(1);
  });

  it("carries the outgoing sim's final-step events ahead of the new ring", () => {
    const fe = new FieldEpoch();
    fe.advance(snap(300, [ev(298), ev(299, "roundClear")]));
    expect(fe.stamp(snap(0, [])).events).toEqual([ev(0, "roundClear")]);
    expect(fe.stamp(snap(2, [ev(1, "ballLaunch")])).events).toEqual([
      ev(0, "roundClear"),
      ev(1, "ballLaunch"),
    ]);
  });

  it("lets new events push carried ones out of the ring", () => {
    const fe = new FieldEpoch();
    fe.advance(snap(300, [ev(299, "roundClear")]));
    const fresh = Array.from({ length: SIM_EVENT_RING_SIZE }, (_, i) => ev(i + 1));
    expect(fe.stamp(snap(20, fresh)).events).toEqual(fresh);
  });

  it("advance(null) drops any earlier carry", () => {
    const fe = new FieldEpoch();
    fe.advance(snap(300, [ev(299, "roundClear")]));
    fe.advance(null);
    expect(fe.stamp(snap(0, [])).events).toEqual([]);
  });
});
