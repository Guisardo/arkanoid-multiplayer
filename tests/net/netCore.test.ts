import { describe, expect, it } from "vitest";
import { serializeSnapshot, deserializeSnapshot } from "net/serializer";
import { createDelayQueue } from "net/delayQueue";
import type { InputFrame, Snapshot } from "shared/protocol";
import { EMPTY_ACTIONS } from "shared/protocol";
import { createRoundSim } from "sim/roundSim";
import { getLevel } from "content/levels";

function frame(player: number, tick: number, axisX: number, launch = false): InputFrame {
  return { player, tick, axisX, axisY: 0, launch, actions: EMPTY_ACTIONS };
}

function fourPlayerSnapshot(): Snapshot {
  const base = createRoundSim(getLevel(1), { lives: 3, score: 1000 });
  const snap = base.snapshot();
  return {
    ...snap,
    players: [
      { ...snap.players[0]!, name: "HostLocal", meter: 42, target: 2 },
      { ...snap.players[0]!, player: 1, name: "RemoteGuest1", lives: 4, score: 2200, meter: 7, target: 0 },
      { ...snap.players[0]!, player: 2, name: "RemoteGuest2", lives: 1, score: 300, meter: 100, target: 1 },
      { ...snap.players[0]!, player: 3, name: "RemoteGuest3", lives: 5, score: 999999, meter: 0, target: -1, state: "downed" },
    ],
    balls: [
      snap.balls[0]!,
      { x: 12.5, y: 200.25, vx: -60.5, vy: 92.25, attachedTo: null, owner: 2 },
      { x: 100, y: 30, vx: 0, vy: -110, attachedTo: 1, owner: 1 },
    ],
    capsules: [
      { x: 50, y: 60, type: "E" },
      { x: 150, y: 61, type: "?" },
    ],
    events: [
      { type: "ballLaunch", source: 0, target: -1, tick: 100 },
      { type: "brickBreak", source: 2, target: 42, tick: 101 },
    ],
    inputAcks: [100, 101, 102, 103],
  };
}

describe("snapshot serializer (spec §9)", () => {
  it("round-trips losslessly", () => {
    const snap = fourPlayerSnapshot();
    const buf = serializeSnapshot(snap);
    const back = deserializeSnapshot(buf);
    expect(back.tick).toBe(snap.tick);
    expect(back.phase).toBe(snap.phase);
    expect(back.round).toBe(snap.round);
    expect(back.players.map((p) => [p.player, p.name, p.lives, p.score, p.meter, p.target, p.state])).toEqual(
      snap.players.map((p) => [p.player, p.name, p.lives, p.score, p.meter, p.target, p.state]),
    );
    expect(back.balls).toEqual(snap.balls);
    expect(back.capsules).toEqual(snap.capsules);
    expect(back.events).toEqual(snap.events);
    expect(back.inputAcks).toEqual(snap.inputAcks);
    expect(back.bricks).toEqual(snap.bricks);
  });

  it("serialized 4-player snapshot ≈600 B budget", () => {
    const buf = serializeSnapshot(fourPlayerSnapshot());
    // Budget: ~600 B target (spec §9). Hard assert at a generous ceiling.
    expect(buf.byteLength).toBeLessThanOrEqual(700);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("serialized snapshot is stable (deterministic bytes)", () => {
    const a = serializeSnapshot(fourPlayerSnapshot());
    const b = serializeSnapshot(fourPlayerSnapshot());
    expect(new Uint8Array(a)).toEqual(new Uint8Array(b));
  });

  it("event ring buffer carries last 8 events with type, source, target, tick", () => {
    const snap = fourPlayerSnapshot();
    snap.events = Array.from({ length: 8 }, (_, i) => ({
      type: "brickBreak" as const,
      source: i,
      target: i * 2,
      tick: 100 + i,
    }));
    const back = deserializeSnapshot(serializeSnapshot(snap));
    expect(back.events).toHaveLength(8);
    expect(back.events[7]).toEqual({ type: "brickBreak", source: 7, target: 14, tick: 107 });
  });

  it("malformed buffer fails clean (no crash)", () => {
    const snap = fourPlayerSnapshot();
    const buf = serializeSnapshot(snap);
    // truncate the buffer
    const short = buf.slice(0, Math.max(4, buf.byteLength - 10));
    expect(() => deserializeSnapshot(short)).toThrow(/malformed|truncat|bounds/i);
    // garbage bytes
    const garbage = new ArrayBuffer(8);
    expect(() => deserializeSnapshot(garbage)).toThrow();
  });
});

describe("delay queue (spec §9: uniform tick-D, host-local skips only the network hop)", () => {
  it("applies tick-D uniformly to host-local frames", () => {
    const q = createDelayQueue({ delay: 4 });
    // push frames for ticks 0..9
    for (let t = 0; t < 10; t++) q.push(frame(0, t, 1));
    // tick 0: nothing due yet (D=4 → first delivery at tick 4)
    for (let t = 0; t < 4; t++) expect(q.due(t)).toEqual([]);
    // at tick 4, frame 0 is due
    expect(q.due(4)).toEqual([frame(0, 0, 1)]);
    expect(q.due(5)).toEqual([frame(0, 1, 1)]);
    expect(q.due(6)).toEqual([frame(0, 2, 1)]);
  });

  it("D configurable", () => {
    const q = createDelayQueue({ delay: 0 });
    q.push(frame(0, 0, -1));
    expect(q.due(0)).toEqual([frame(0, 0, -1)]);
    const q2 = createDelayQueue({ delay: 2 });
    q2.push(frame(0, 0, -1));
    expect(q2.due(0)).toEqual([]);
    expect(q2.due(1)).toEqual([]);
    expect(q2.due(2)).toEqual([frame(0, 0, -1)]);
  });

  it("dedupes by (player, tick)", () => {
    const q = createDelayQueue({ delay: 1 });
    q.push(frame(0, 5, 1));
    q.push(frame(0, 5, 1)); // duplicate
    q.push(frame(0, 5, -1)); // duplicate tick, different axis — still dup by (player,tick)
    q.push(frame(1, 5, 1)); // different player — NOT a dup
    const due = q.due(6);
    expect(due).toHaveLength(2);
    expect(due.map((f) => f.player).sort()).toEqual([0, 1]);
  });

  it("handles out-of-order frames (delivers whatever is due)", () => {
    const q = createDelayQueue({ delay: 3 });
    q.push(frame(0, 9, 1));
    q.push(frame(0, 5, 1));
    q.push(frame(0, 6, 1));
    // tick 9: frames 5 and 6 are due (9-3=6)
    const due = q.due(9);
    const ticks = due.map((f) => f.tick).sort((a, b) => a - b);
    expect(ticks).toEqual([5, 6]);
  });

  it("input redundancy window ~10 ticks: late frame still deduped/delivered once", () => {
    const q = createDelayQueue({ delay: 2 });
    // guest re-sends frame 0 nine more times (redundancy)
    for (let i = 0; i < 10; i++) q.push(frame(0, 0, 1));
    const due = q.due(2);
    expect(due).toHaveLength(1);
  });
});
