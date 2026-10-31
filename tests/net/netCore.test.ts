import { describe, expect, it } from "vitest";
import { serializeSnapshot, deserializeSnapshot } from "net/serializer";
import { createDelayQueue } from "net/delayQueue";
import type { InputFrame, Snapshot } from "shared/protocol";
import { ARMED_EFFECT, EMPTY_ACTIONS, LASER_BOLTS_PER_PADDLE, SNAPSHOT_PLAYERS_MAX } from "shared/protocol";
import { createRoundSim } from "sim/roundSim";
import { getLevelSync } from "content/levels";

function frame(player: number, tick: number, axisX: number, launch = false): InputFrame {
  return { player, tick, axisX, axisY: 0, launch, primaryHeld: false, actions: EMPTY_ACTIONS };
}

function fourPlayerSnapshot(): Snapshot {
  const base = createRoundSim(getLevelSync(1), { lives: 3, score: 1000 });
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
    expect(back.epoch).toBe(snap.epoch);
    expect(back.players.map((p) => [p.player, p.name, p.lives, p.score, p.meter, p.target, p.state])).toEqual(
      snap.players.map((p) => [p.player, p.name, p.lives, p.score, p.meter, p.target, p.state]),
    );
    expect(back.balls).toEqual(snap.balls);
    expect(back.capsules).toEqual(snap.capsules);
    expect(back.events).toEqual(snap.events);
    expect(back.inputAcks).toEqual(snap.inputAcks);
    expect(back.bricks).toEqual(snap.bricks);
  });

  it("round-trips the Sim epoch across the full u16 range (ticket #151)", () => {
    for (const epoch of [0, 1, 300, 0xffff]) {
      const back = deserializeSnapshot(serializeSnapshot({ ...fourPlayerSnapshot(), epoch }));
      expect(back.epoch).toBe(epoch);
      // Fields after the epoch still decode in place.
      expect(back.players.map((p) => p.name)).toEqual(["HostLocal", "RemoteGuest1", "RemoteGuest2", "RemoteGuest3"]);
    }
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

  it("round-trips a boss snapshot (ticket 49) with projectiles", () => {
    const sim = createRoundSim(getLevelSync(33), { lives: 3, score: 0 });
    sim.step([{ player: 0, tick: 0, axisX: 0, axisY: 0, launch: true, primaryHeld: false, actions: EMPTY_ACTIONS }]);
    // Advance until the boss has fired at least one projectile.
    let snap = sim.snapshot();
    for (let t = 1; t <= 200; t++) {
      sim.step([{ player: 0, tick: t, axisX: 0, axisY: 0, launch: false, primaryHeld: false, actions: EMPTY_ACTIONS }]);
      snap = sim.snapshot();
      if ((snap.bossProjectiles ?? []).length > 0) break;
    }
    expect(snap.boss).toBeDefined();
    expect((snap.bossProjectiles ?? []).length).toBeGreaterThan(0);

    const back = deserializeSnapshot(serializeSnapshot(snap));
    expect(back.boss).toEqual(snap.boss);
    expect(back.bossProjectiles).toEqual(snap.bossProjectiles);
  });

  it("non-boss snapshots carry no boss tail (backward compatible)", () => {
    const snap = fourPlayerSnapshot();
    expect(snap.boss).toBeUndefined();
    const back = deserializeSnapshot(serializeSnapshot(snap));
    expect(back.boss).toBeUndefined();
    expect(back.bossProjectiles).toBeUndefined();
  });

  // ---- Laser plumbing (ticket #141) ----

  it("round-trips the per-player Armed flag as effects.L", () => {
    const snap = fourPlayerSnapshot();
    snap.players[1] = { ...snap.players[1]!, effects: { [ARMED_EFFECT]: 1 } };
    snap.players[3] = { ...snap.players[3]!, effects: { [ARMED_EFFECT]: 1 } };
    const back = deserializeSnapshot(serializeSnapshot(snap));
    expect(back.players.map((p) => p.effects)).toEqual([{}, { L: 1 }, {}, { L: 1 }]);
  });

  it("any non-zero effects.L (timer or -1 'until ball loss') reads back as the presence flag 1", () => {
    const snap = fourPlayerSnapshot();
    snap.players[0] = { ...snap.players[0]!, effects: { [ARMED_EFFECT]: 5000 } };
    snap.players[1] = { ...snap.players[1]!, effects: { [ARMED_EFFECT]: -1 } };
    snap.players[2] = { ...snap.players[2]!, effects: { [ARMED_EFFECT]: 0, E: -1 } };
    const back = deserializeSnapshot(serializeSnapshot(snap));
    expect(back.players.slice(0, 3).map((p) => p.effects)).toEqual([{ L: 1 }, { L: 1 }, {}]);
  });

  it("round-trips bolts with owner", () => {
    const snap: Snapshot = {
      ...fourPlayerSnapshot(),
      bolts: [
        { x: 90.5, y: 230.25, owner: 0 },
        { x: 117.5, y: 12, owner: 3 },
      ],
    };
    const back = deserializeSnapshot(serializeSnapshot(snap));
    expect(back.bolts).toEqual(snap.bolts);
  });

  it("an empty bolts array stays an empty array", () => {
    const snap: Snapshot = { ...fourPlayerSnapshot(), bolts: [] };
    const back = deserializeSnapshot(serializeSnapshot(snap));
    expect(back.bolts).toEqual([]);
  });

  it("absent bolts stays absent (valid snapshot, no key)", () => {
    const snap = fourPlayerSnapshot();
    expect(snap.bolts).toBeUndefined();
    const back = deserializeSnapshot(serializeSnapshot(snap));
    expect(back.bolts).toBeUndefined();
    expect("bolts" in back).toBe(false);
  });

  it("bolts and boss tails coexist", () => {
    const snap: Snapshot = {
      ...fourPlayerSnapshot(),
      boss: { x: 104, y: 60, hp: 12, phase: 1, dead: false },
      bossProjectiles: [{ x: 1, y: 2, vx: 3, vy: 4 }],
      bolts: [{ x: 50, y: 100, owner: 1 }],
    };
    const back = deserializeSnapshot(serializeSnapshot(snap));
    expect(back.boss).toEqual(snap.boss);
    expect(back.bossProjectiles).toEqual(snap.bossProjectiles);
    expect(back.bolts).toEqual(snap.bolts);
  });

  it("a full bolt load (4 paddles x 8) fits and round-trips", () => {
    const bolts = Array.from({ length: SNAPSHOT_PLAYERS_MAX * LASER_BOLTS_PER_PADDLE }, (_, i) => ({
      x: i * 6 + 0.1,
      y: 240 - i * 7,
      owner: i % SNAPSHOT_PLAYERS_MAX,
    }));
    const snap: Snapshot = { ...fourPlayerSnapshot(), bolts };
    const back = deserializeSnapshot(serializeSnapshot(snap));
    // f32 on the wire, like balls and capsules.
    back.bolts!.forEach((b, i) => {
      expect(b.x).toBeCloseTo(bolts[i]!.x, 4);
      expect(b.y).toBe(bolts[i]!.y);
      expect(b.owner).toBe(bolts[i]!.owner);
    });
  });

  it("serializer refuses more bolts than 4 paddles x 8 (host bug, never a wrapped count)", () => {
    const bolts = Array.from({ length: SNAPSHOT_PLAYERS_MAX * LASER_BOLTS_PER_PADDLE + 1 }, () => ({ x: 1, y: 1, owner: 0 }));
    expect(() => serializeSnapshot({ ...fourPlayerSnapshot(), bolts })).toThrow(/bolt count 33 exceeds 32/);
  });

  it("serializer refuses a bolt owner outside the snapshot's players", () => {
    const snap: Snapshot = { ...fourPlayerSnapshot(), bolts: [{ x: 1, y: 1, owner: 4 }] };
    expect(() => serializeSnapshot(snap)).toThrow(/bolt owner 4 out of range/);
  });

  // Laser tail starts after the (absent) boss byte: [armedMask, boltsPresent, count, bolts...].
  function laserTailOffset(buf: ArrayBuffer, bolts: number): number {
    return buf.byteLength - (bolts > 0 ? 3 + bolts * 9 : 2);
  }

  it("decoder rejects a bolt count beyond 4 paddles x 8 (malformed)", () => {
    const buf = serializeSnapshot({ ...fourPlayerSnapshot(), bolts: [{ x: 1, y: 1, owner: 0 }] });
    new DataView(buf).setUint8(laserTailOffset(buf, 1) + 2, 33);
    expect(() => deserializeSnapshot(buf)).toThrow(/malformed snapshot: bolt count/);
  });

  it("decoder rejects an unknown bolts-present byte (malformed)", () => {
    const buf = serializeSnapshot(fourPlayerSnapshot());
    new DataView(buf).setUint8(laserTailOffset(buf, 0) + 1, 2);
    expect(() => deserializeSnapshot(buf)).toThrow(/malformed snapshot: bolts flag/);
  });

  it("decoder rejects a bolt owner outside the snapshot's players (malformed)", () => {
    const buf = serializeSnapshot({ ...fourPlayerSnapshot(), bolts: [{ x: 1, y: 1, owner: 0 }] });
    new DataView(buf).setUint8(buf.byteLength - 1, 9);
    expect(() => deserializeSnapshot(buf)).toThrow(/malformed snapshot: bolt owner/);
  });

  it("decoder rejects Armed bits beyond the player count (malformed)", () => {
    const snap = { ...fourPlayerSnapshot() };
    snap.players = snap.players.slice(0, 2);
    const buf = serializeSnapshot(snap);
    new DataView(buf).setUint8(laserTailOffset(buf, 0), 0b100);
    expect(() => deserializeSnapshot(buf)).toThrow(/malformed snapshot: armed mask/);
  });

  it("truncated bolt tail fails clean", () => {
    const buf = serializeSnapshot({ ...fourPlayerSnapshot(), bolts: [{ x: 1, y: 2, owner: 0 }] });
    expect(() => deserializeSnapshot(buf.slice(0, buf.byteLength - 3))).toThrow(/malformed/);
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
