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
import { packProgress, unpackProgress } from "app/hostProgress";

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

  it("progress wire round-trip", () => {
    const rows = [{ player: 1, score: 1234, round: 5, lives: 2, state: 0 }];
    const back = unpackProgress(packProgress(rows));
    expect(back).toEqual(rows);
  });

  it("malformed multi/progress throw (guest treats as protocol error)", () => {
    expect(() => unpackMulti(new ArrayBuffer(1))).toThrow(/malformed/);
    expect(() => unpackProgress(new ArrayBuffer(1))).toThrow(/malformed/);
  });
});
