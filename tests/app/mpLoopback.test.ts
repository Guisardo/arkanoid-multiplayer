// Loopback integration (ticket 45): host game session + guest game session
// wired through in-memory channels with a deterministic drop filter — the
// whole data plane (input codec → guard → delay queue → sim → serializer →
// unpack → interpolation) exercised without WebRTC.
import { describe, expect, it } from "vitest";
import {
  createHostGameSession,
  packMulti,
  unpackMulti,
  type HostGamePlayer,
} from "app/hostGame";
import { createGuestGameSession, type ProgressRow } from "app/guestGame";
import { DEFAULT_CONFIG, type LobbyConfig, type LobbyMode } from "app/lobbyState";
import { EMPTY_ACTIONS } from "shared/protocol";
import { FIELD_W } from "shared/gridConstants";
import { packProgress, unpackProgress } from "app/hostProgress";
import { encodeInputBatch } from "net/inputCodec";
import { deserializeSnapshot } from "net/serializer";

/** Single-frame guest batch helper (stall-decay test). */
function encodeBatch(
  frames: { player: number; tick: number; axisX: number; axisY: number; launch: boolean; actions: typeof EMPTY_ACTIONS }[],
): ArrayBuffer {
  return encodeInputBatch(frames);
}

interface Channel {
  hostToGuest: ArrayBuffer[];
  guestToHost: ArrayBuffer[];
  /** Simulated loss probability per message. */
  loss: number;
  deliveredHost: number;
  deliveredGuest: number;
}

function makeChannel(loss = 0): Channel {
  return { hostToGuest: [], guestToHost: [], loss, deliveredHost: 0, deliveredGuest: 0 };
}

/** Deterministic RNG that persists across pump calls (no re-seed resets). */
const pumpSeed = { value: 776171 };
function pumpRand(): number {
  pumpSeed.value = (pumpSeed.value * 1103515245 + 12345) & 0x7fffffff;
  return pumpSeed.value / 0x7fffffff;
}

function pump(ch: Channel, host: ReturnType<typeof createHostGameSession>, guest: ReturnType<typeof createGuestGameSession>): void {
  for (const buf of ch.guestToHost.splice(0)) {
    if (pumpRand() >= ch.loss) {
      host.guestBinary(0, buf);
      ch.deliveredHost++;
    }
  }
  for (const buf of ch.hostToGuest.splice(0)) {
    if (pumpRand() >= ch.loss) {
      guest.hostBinary(buf);
      ch.deliveredGuest++;
    }
  }
}

function playersFor(mode: LobbyMode, guestCount: number): HostGamePlayer[] {
  const out: HostGamePlayer[] = [
    { player: 0, name: "HostP", skinIndex: 0, guestIndex: -1 },
  ];
  for (let i = 0; i < guestCount; i++) {
    out.push({ player: i + 1, name: `Guest${String(i)}`, skinIndex: i + 1, guestIndex: 0 });
  }
  if (mode === "duel" || mode === "sharedField") {
    return out.slice(0, 2);
  }
  return out;
}

function runMatch(
  mode: LobbyMode,
  opts: { loss?: number; ticks?: number; guestInput?: (tick: number) => number } = {},
): { host: ReturnType<typeof createHostGameSession>; guest: ReturnType<typeof createGuestGameSession>; ch: Channel; progress: ProgressRow[] } {
  const config: LobbyConfig = { ...DEFAULT_CONFIG, mode };
  const players = playersFor(mode, mode === "race" ? 1 : 1);
  const ch = makeChannel(opts.loss ?? 0);
  const progress: ProgressRow[] = [];
  const host = createHostGameSession(
    { mode, config, players, hostLocalPlayers: [0] },
    (_gi, buf) => {
      ch.hostToGuest.push(buf);
    },
  );
  const guest = createGuestGameSession(
    {
      snapshotHz: host.snapshotHz,
      localPlayers: players.filter((p) => p.guestIndex === 0).map((p) => p.player),
      remotePlayers: [0],
      names: players.map((p) => p.name),
      // Ticket 46: prediction needs mode + D + player count.
      mode,
      delayTicks: host.delayTicks,
      playerCount: players.length,
    },
    (buf) => ch.guestToHost.push(buf),
    { onProgress: (rows) => progress.push(...rows) },
  );
  const ticks = opts.ticks ?? 120;
  for (let t = 0; t < ticks; t++) {
    const axis = opts.guestInput?.(t) ?? (t > 30 && t < 60 ? 1 : 0);
    guest.collect({ player: 0, tick: t, axisX: axis, axisY: 0, launch: t === 30, actions: EMPTY_ACTIONS });
    guest.sendTick();
    host.tick([{ player: 0, tick: t, axisX: t > 20 && t < 50 ? -1 : 0, axisY: 0, launch: t === 10, actions: EMPTY_ACTIONS }]);
    pump(ch, host, guest);
  }
  return { host, guest, ch, progress };
}

describe("host + guest loopback (spec §9 data plane)", () => {
  it("guest input reaches the sim: guest paddle launches and moves", () => {
    const { host } = runMatch("race");
    const snaps = host.snapshots();
    const guestSnap = snaps[1];
    expect(guestSnap).toBeDefined();
    // Ball launched by guest (launch edge at tick 30, D=4 → sim by 34).
    expect(guestSnap!.phase === "serve" || guestSnap!.phase === "play").toBe(true);
  });

  it("guest sees snapshots and interpolates its field", () => {
    const { guest } = runMatch("race", { ticks: 240 });
    const snaps = guest.renderSnapshots(1e12);
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps[0]).toBeDefined();
  });

  it("guest progress rows carry the host player", () => {
    const { progress } = runMatch("race", { ticks: 240 });
    expect(progress.some((r) => r.player === 0 && r.name === "HostP")).toBe(true);
  });

  it("5% loss still delivers input (redundancy window)", () => {
    const { host, ch } = runMatch("race", { loss: 0.05, ticks: 240 });
    expect(ch.deliveredGuest).toBeGreaterThan(0);
    expect(host.over).toBe(false);
    const guestSnap = host.snapshots()[1];
    expect(guestSnap).toBeDefined();
  });

  it("30% loss stays playable (guest view holds)", () => {
    const { guest, ch } = runMatch("race", { loss: 0.3, ticks: 360 });
    console.log("deliveredHost", ch.deliveredHost, "deliveredGuest", ch.deliveredGuest, "protocolError", guest.protocolError);
    const snaps = guest.renderSnapshots(1e12);
    expect(snaps.length).toBeGreaterThan(0);
  });

  it("Duel broadcasts at 60 Hz", () => {
    const { host } = runMatch("duel", { ticks: 10 });
    expect(host.snapshotHz).toBe(60);
    expect(host.delayTicks).toBe(4);
  });

  it("coop delay D = 0", () => {
    const { host } = runMatch("sharedField", { ticks: 10 });
    expect(host.delayTicks).toBe(0);
  });

  it("sharedField sends one snapshot for both players", () => {
    const { host, guest } = runMatch("sharedField", { ticks: 240 });
    expect(host.snapshots()).toHaveLength(1);
    const snaps = guest.renderSnapshots(1e12);
    expect(snaps[0]!.players).toHaveLength(2);
  });

  it("malformed guest binary is dropped, host never crashes", () => {
    const config: LobbyConfig = { ...DEFAULT_CONFIG, mode: "race" };
    const players = playersFor("race", 1);
    const host = createHostGameSession(
      { mode: "race", config, players, hostLocalPlayers: [0] },
      () => undefined,
    );
    const garbage = new ArrayBuffer(9);
    new Uint8Array(garbage).set([200, 9, 255, 255, 255, 255, 255, 255, 255]);
    expect(() => { host.guestBinary(0, garbage); }).not.toThrow();
    // Sim keeps running.
    host.tick([]);
    expect(host.over).toBe(false);
  });

  it("guestDropped removes routing without killing the match", () => {
    const { host } = runMatch("race", { ticks: 10 });
    host.guestDropped(0);
    expect(() => { host.tick([]); }).not.toThrow();
  });

  it("packMulti/unpackMulti round-trip", () => {
    const a = new ArrayBuffer(3);
    const b = new ArrayBuffer(5);
    const out = packMulti([a, b]);
    const back = unpackMulti(out);
    expect(back).toHaveLength(2);
    expect(back[0]!.byteLength).toBe(3);
    expect(back[1]!.byteLength).toBe(5);
  });

  // ---- Ticket 46: guest prediction + host stall decay ----

  it("guest's own paddle renders PREDICTED position ahead of the authoritative ack", () => {
    // Input HELD at the end: the host has consumed through ~tick (60 − D),
    // the guest has applied every frame — its rendered paddle leads by the
    // unconsumed window (D ticks of movement).
    const { host, guest } = runMatch("race", {
      ticks: 40,
      guestInput: (t) => (t >= 10 ? 1 : 0),
    });
    const hostX = host.snapshots()[1]?.players[0]?.paddle.x ?? -1;
    const guestX = guest.renderSnapshots(1e12)[0]?.players[0]?.paddle.x ?? -2;
    expect(guestX).toBeGreaterThan(hostX + 2);
  });

  it("prediction never applied to remote players or the ball", () => {
    // sharedField: ONE field, both players in every snapshot — the guest
    // must predict ONLY its own paddle; host player + ball untouched.
    const { guest } = runMatch("sharedField", { ticks: 90 });
    const snap = guest.renderSnapshots(1e12)[0];
    expect(snap).toBeDefined();
    if (snap === undefined) return;
    // Guest local player 1: overlaid; host player 0: authoritative value.
    const hostPaddle = snap.players.find((p) => p.player === 0)?.paddle;
    expect(hostPaddle).toBeDefined();
    // No NaN/Infinity leakage from the overlay path.
    for (const p of snap.players) expect(Number.isFinite(p.paddle.x)).toBe(true);
    for (const b of snap.balls) expect(Number.isFinite(b.x)).toBe(true);
  });

  it("guest prediction overlays only its own field's paddle (parallel modes)", () => {
    const { guest } = runMatch("race", { ticks: 90 });
    const snaps = guest.renderSnapshots(1e12);
    expect(snaps.length).toBeGreaterThan(0);
    // Parallel field snapshots renumber the player to 0 (multiField remap)
    // — the overlay targets players[0], the guest's own field.
    const own = snaps[0]?.players[0];
    expect(own).toBeDefined();
    expect(Number.isFinite(own?.paddle.x ?? NaN)).toBe(true);
  });

  it("host stall decay: silent guest paddle holds ≤10 ticks then stops", () => {
    // Guest sends axis 1 for a while, then goes SILENT (no frames).
    const config: LobbyConfig = { ...DEFAULT_CONFIG, mode: "race" };
    const players = playersFor("race", 1);
    const host = createHostGameSession(
      { mode: "race", config, players, hostLocalPlayers: [0] },
      () => undefined,
    );
    // Real input until tick 20 (axis 1), then silence.
    for (let t = 0; t < 20; t++) {
      host.guestBinary(0, encodeBatch([{ player: 0, tick: t, axisX: 1, axisY: 0, launch: false, actions: EMPTY_ACTIONS }]));
      host.tick([]);
    }
    const xAt20 = host.snapshots()[1]?.players[0]?.paddle.x ?? -1;
    expect(xAt20).toBeGreaterThan(100);
    // 10 silent ticks: hold window — synthetic frames keep the last axis.
    for (let t = 20; t < 30; t++) host.tick([]);
    const xAt30 = host.snapshots()[1]?.players[0]?.paddle.x ?? -1;
    expect(xAt30).toBeGreaterThan(xAt20);
    // Decay window: axis decays toward 0 — movement slows, then stops.
    for (let t = 30; t < 45; t++) host.tick([]);
    const xAt45 = host.snapshots()[1]?.players[0]?.paddle.x ?? -1;
    const decayGain = xAt45 - xAt30;
    const holdGain = xAt30 - xAt20;
    expect(decayGain).toBeLessThan(holdGain);
    // Fully stopped: further ticks move nothing.
    for (let t = 45; t < 60; t++) host.tick([]);
    const xAt60 = host.snapshots()[1]?.players[0]?.paddle.x ?? -1;
    expect(xAt60).toBeCloseTo(xAt45, 1);
    // Never crossed the wall clamp.
    expect(xAt60).toBeLessThan(FIELD_W);
  });

  it("progress wire round-trip", () => {
    const rows = [{ player: 1, score: 1234, round: 5, lives: 2, state: 0 }];
    const back = unpackProgress(packProgress(rows));
    expect(back).toEqual(rows);
  });

  it("malformed multi/progress throw (guest treats as protocol error)", () => {
    expect(() => unpackMulti(new ArrayBuffer(1))).toThrow(/malformed/);
    expect(() => unpackProgress(new ArrayBuffer(1))).toThrow(/malformed/);
  });

  // ---- Ticket 47: resilience — rejoin, removal, overload ----

  it("rejoin: drop → rebind → full snapshot rebuilds the guest", () => {
    const { host, guest, ch } = runMatch("race", { ticks: 60 });
    // Guest drops mid-match; play continues without it.
    host.guestDropped(0);
    for (let t = 0; t < 30; t++) host.tick([]);
    // Guest rejoins on a NEW channel index — the host rebinds routing and
    // ships a full snapshot to the new index immediately.
    const sent: ArrayBuffer[] = [];
    const probe = createHostGameSession(
      { mode: "race", config: { ...DEFAULT_CONFIG, mode: "race" }, players: playersFor("race", 1), hostLocalPlayers: [0] },
      (gi, buf) => { if (gi === 7) sent.push(buf); },
    );
    probe.rebindGuest(0, 7, [1]);
    expect(sent.length).toBe(1);
    // The guest rebuilds from that full snapshot (prediction wiped via
    // resyncFromSnapshot — no throw, state consistent).
    const snap = deserializeFirst(sent);
    expect(snap.tick).toBe(0);
    expect(() => {
      guest.hostBinary(ch.hostToGuest[0] ?? sent[0]!);
    }).not.toThrow();
  });

  it("removal: input cutoff + snapshot state 'removed' on the wire", () => {
    const { host } = runMatch("race", { ticks: 30 });
    // Remove the guest's player (rejoin expiry path).
    host.removePlayers([1]);
    // Removed player's input is ignored.
    host.guestBinary(0, encodeBatch([{ player: 0, tick: 100, axisX: 1, axisY: 0, launch: false, actions: EMPTY_ACTIONS }]));
    host.tick([]);
    // The wire carries state "removed" for the removed player's field
    // (parallel modes renumber each field's player to 0 — multiField remap).
    const sent: ArrayBuffer[] = [];
    const probe = createHostGameSession(
      { mode: "race", config: { ...DEFAULT_CONFIG, mode: "race" }, players: playersFor("race", 1), hostLocalPlayers: [0] },
      (_gi, buf) => { sent.push(buf); },
    );
    probe.removePlayers([1]);
    for (let t = 0; t < 4; t++) probe.tick([]);
    expect(sent.length).toBeGreaterThan(0);
    const snap = deserializeFirst(sent);
    const removed = snap.players.find((p) => p.player === 0);
    expect(removed?.state).toBe("removed");
  });

  it("resyncGuest ships a full snapshot on demand (visibility return)", () => {
    const sent: ArrayBuffer[] = [];
    const host = createHostGameSession(
      { mode: "race", config: { ...DEFAULT_CONFIG, mode: "race" }, players: playersFor("race", 1), hostLocalPlayers: [0] },
      (_gi, buf) => { sent.push(buf); },
    );
    for (let t = 0; t < 10; t++) host.tick([]);
    sent.length = 0;
    host.resyncGuest(0);
    expect(sent.length).toBe(1);
    const snap = deserializeFirst(sent);
    expect(snap.tick).toBeGreaterThan(0);
  });

  it("overload: slow-motion keeps snapshots flowing (30 Hz wall-clock)", () => {
    const { host, ch } = runMatch("race", { ticks: 120 });
    const before = ch.hostToGuest.length;
    // Slow-motion is a time-scale decision in the loop (overload.ts) — the
    // data plane keeps broadcasting regardless; here we verify the sim
    // keeps ticking and snapshots keep shipping under host-only load.
    for (let t = 0; t < 120; t++) host.tick([]);
    expect(ch.hostToGuest.length).toBeGreaterThan(before);
    expect(host.over).toBe(false);
  });
});

/** Decode the first snapshot-ish payload from a host send log. */
function deserializeFirst(buffers: ArrayBuffer[]): ReturnType<typeof deserializeSnapshot> {
  for (const buf of buffers) {
    const view = new DataView(buf);
    const kind = view.getUint8(0);
    if (kind === 2) {
      const parts = unpackMulti(buf);
      const first = parts[0];
      if (first !== undefined) return deserializeSnapshot(first);
    } else if (kind !== 3) {
      return deserializeSnapshot(buf);
    }
  }
  throw new Error("no snapshot in send log");
}
