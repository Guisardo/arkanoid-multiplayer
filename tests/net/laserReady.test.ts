// Laser readiness on the wire (ticket #148 review): the host replicates
// whether each Armed Paddle is off cooldown, so ready-ticks follow the Paddle
// (Shared Field mode C shares one) and a re-catch that zeroes the cooldown,
// with no client-side inference. Packed in the Armed mask's high nibble.
import { describe, expect, it } from "vitest";
import { deserializeSnapshot, serializeSnapshot } from "net/serializer";
import type { PlayerSnapshot, Snapshot } from "shared/protocol";

function player(i: number, over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    player: i,
    name: `P${String(i + 1)}`,
    skinIndex: i,
    paddle: { x: 104, y: 242, w: 32, h: 6, edge: "bottom" },
    lives: 3,
    score: 0,
    meter: 0,
    target: -1,
    chain: 0,
    state: "playing",
    effects: {},
    ...over,
  };
}

function snap(players: PlayerSnapshot[]): Snapshot {
  return {
    tick: 10,
    phase: "play",
    round: 1,
    players,
    balls: [],
    capsules: [],
    bricks: new Array<number>(13 * 18).fill(0),
    events: [],
    inputAcks: players.map(() => 10),
  };
}

const roundTrip = (s: Snapshot): Snapshot => deserializeSnapshot(serializeSnapshot(s));

describe("laserReady replication", () => {
  it("round-trips ready per Armed player", () => {
    const back = roundTrip(
      snap([
        player(0, { effects: { L: 1 }, laserReady: true }),
        player(1, { effects: { L: 1 }, laserReady: false }),
        player(2),
        player(3, { effects: { L: 1 }, laserReady: true }),
      ]),
    );
    expect(back.players.map((p) => p.laserReady === true)).toEqual([true, false, false, true]);
  });

  it("ready without Armed is not sent (a disarmed Paddle has no cooldown)", () => {
    const back = roundTrip(snap([player(0, { laserReady: true })]));
    expect(back.players[0]?.laserReady).toBeUndefined();
    expect(back.players[0]?.effects.L).toBeUndefined();
  });

  it("snapshot size is unchanged (packed into the Armed mask)", () => {
    const plain = serializeSnapshot(snap([player(0, { effects: { L: 1 } })]));
    const ready = serializeSnapshot(snap([player(0, { effects: { L: 1 }, laserReady: true })]));
    expect(ready.byteLength).toBe(plain.byteLength);
  });

  it("decoder rejects a ready bit on an unarmed player (malformed)", () => {
    const buf = serializeSnapshot(snap([player(0), player(1)]));
    // Laser tail = [mask, boltsPresent] at the end (no bolts).
    new DataView(buf).setUint8(buf.byteLength - 2, 0b0001_0000);
    expect(() => deserializeSnapshot(buf)).toThrow(/malformed snapshot: laser ready without Armed/);
  });
});
