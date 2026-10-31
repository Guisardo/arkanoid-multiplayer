// Event ring on the wire (ticket #148): the sim ring grew to 32 for Laser
// bursts, but a snapshot only carries the newest 8 plus whatever is newer than
// `SNAPSHOT_EVENT_BURST_TICKS`, so quiet snapshots stay the same size.
import { describe, expect, it } from "vitest";
import { deserializeSnapshot, serializeSnapshot } from "net/serializer";
import {
  SIM_EVENT_RING_SIZE,
  SNAPSHOT_EVENTS_BASE,
  SNAPSHOT_EVENT_BURST_TICKS,
  forEachFreshEvent,
  type SimEvent,
  type Snapshot,
} from "shared/protocol";

function snapAt(tick: number, events: SimEvent[]): Snapshot {
  return {
    tick,
    phase: "play",
    round: 1,
    players: [
      {
        player: 0,
        name: "P1",
        skinIndex: 0,
        paddle: { x: 104, y: 242, w: 32, h: 6, edge: "bottom" },
        lives: 3,
        score: 0,
        meter: 0,
        target: -1,
        chain: 0,
        state: "playing",
        effects: {},
      },
    ],
    balls: [],
    capsules: [],
    bricks: new Array<number>(13 * 18).fill(0),
    events,
    inputAcks: [tick],
  };
}

const brick = (tick: number, target: number): SimEvent => ({ type: "brickBreak", source: 0, target, tick });
const roundTrip = (s: Snapshot): Snapshot => deserializeSnapshot(serializeSnapshot(s));

describe("snapshot event slice", () => {
  it("quiet ring: only the newest 8 events, however many the ring holds", () => {
    const events = Array.from({ length: 20 }, (_, i) => brick(i * 10, i));
    const back = roundTrip(snapAt(1000, events));
    expect(back.events).toHaveLength(SNAPSHOT_EVENTS_BASE);
    expect(back.events[0]?.target).toBe(12);
  });

  it("a burst inside the recent window rides along in full", () => {
    const old = Array.from({ length: 10 }, (_, i) => brick(i, i));
    const burst = Array.from({ length: 18 }, (_, i) => brick(500, 50 + i));
    const back = roundTrip(snapAt(500, [...old, ...burst]));
    expect(back.events).toEqual(burst);
  });

  it("the window is exclusive of its far edge", () => {
    const tick = 500;
    const edge = Array.from({ length: 5 }, (_, i) => brick(tick - SNAPSHOT_EVENT_BURST_TICKS, i));
    const recent = Array.from({ length: 8 }, (_, i) => brick(tick - SNAPSHOT_EVENT_BURST_TICKS + 1, 10 + i));
    expect(roundTrip(snapAt(tick, [...edge, ...recent])).events).toEqual(recent);
  });

  it("never carries more than the ring size", () => {
    const flood = Array.from({ length: 40 }, (_, i) => brick(500, i));
    const back = roundTrip(snapAt(500, flood));
    expect(back.events).toHaveLength(SIM_EVENT_RING_SIZE);
    expect(back.events[0]?.target).toBe(8);
  });

  it("the decoder rejects an event count above the ring size", () => {
    const buf = serializeSnapshot(snapAt(500, Array.from({ length: 8 }, (_, i) => brick(500, i))));
    const bytes = new Uint8Array(buf);
    // Header: u32 tick, u8 phase, u16 round, u8 players, u8 balls, u8 capsules, u8 eventCount.
    bytes[10] = SIM_EVENT_RING_SIZE + 1;
    expect(() => deserializeSnapshot(bytes.buffer)).toThrow(/counts out of bounds/);
  });
});

describe("forEachFreshEvent", () => {
  const ev = (tick: number, target: number): SimEvent => ({ type: "brickBreak", source: 0, target, tick });

  it("visits only events after the watermark, each with its ring predecessor", () => {
    const ring = [ev(1, 0), ev(2, 1), ev(3, 2), ev(3, 3)];
    const seen: [number, number | undefined][] = [];
    const mark = forEachFreshEvent(ring, 2, (e, prev) => seen.push([e.target, prev?.target]));
    expect(seen).toEqual([[2, 1], [3, 2]]);
    expect(mark).toBe(3);
  });

  it("nothing fresh: no visits and the watermark is unchanged", () => {
    const seen: number[] = [];
    expect(forEachFreshEvent([ev(1, 0)], 5, (e) => seen.push(e.target))).toBe(5);
    expect(forEachFreshEvent([], 5, (e) => seen.push(e.target))).toBe(5);
    expect(seen).toEqual([]);
  });
});
