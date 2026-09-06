import { describe, expect, it } from "vitest";
import { parseControl, encodeControl, type ControlMsg } from "net/control";
import { PROTOCOL_VERSION } from "shared/protocol";

describe("control message parsing (spec §9 structural validation)", () => {
  it("round-trips every message type", () => {
    const msgs: ControlMsg[] = [
      { type: "hello", version: 1, name: "Alice", skinId: "abc" },
      { type: "hello-ok", playerId: 0, guestIndex: 1 },
      { type: "hello-refused", reason: "version" },
      { type: "lobby-state", state: { phase: "lobby" } },
      { type: "lobby-intent", intent: { kind: "ready", ready: true } },
      { type: "lobby-intent", intent: { kind: "name", name: "Bob" } },
      { type: "lobby-intent", intent: { kind: "skin", skinId: "xyz" } },
      { type: "lobby-intent", intent: { kind: "addLocalPlayer" } },
      { type: "lobby-start", countdown: 3 },
      {
        type: "game-start",
        mode: "race",
        localPlayers: [0],
        players: [{ name: "A", skinIndex: 0 }],
        themeId: "t",
        snapshotHz: 30,
        delayTicks: 4,
        config: {
          mode: "race",
          matchStructure: "oneOff",
          bestOf: 1,
          levelSelection: "hostPick",
          hostPickRound: 1,
          timeCapTicks: null,
          themeId: "t",
        },
      },
      { type: "game-end", mode: "duel", standings: null, coopOutcome: null },
      { type: "to-lobby" },
      { type: "ping", atMs: 123 },
      { type: "pong", atMs: 123 },
      { type: "kick", reason: "lobby" },
      { type: "bye" },
      { type: "pause-request", player: 2 },
      { type: "pause-cancel", player: 2 },
      { type: "resume", player: 1 },
      { type: "paused", by: 2 },
      { type: "resumed" },
      { type: "quit-match", player: 0 },
    ];
    for (const msg of msgs) {
      const back = parseControl(encodeControl(msg));
      expect(back.ok).toBe(true);
    }
  });

  it("rejects malformed JSON as protocol error", () => {
    expect(parseControl("not json")).toMatchObject({ ok: false, error: "protocol" });
  });

  it("rejects non-object payloads", () => {
    const r = parseControl("42");
    expect(r).toMatchObject({ ok: false, error: "protocol" });
  });

  it("rejects unknown message types", () => {
    const r = parseControl('{"type":"destroy-everything"}');
    expect(r).toMatchObject({ ok: false, error: "protocol" });
  });

  it("rejects hello missing required fields", () => {
    expect(parseControl('{"type":"hello","version":1}')).toMatchObject({ ok: false });
    expect(parseControl('{"type":"hello","version":"1","name":"a","skinId":"s"}')).toMatchObject({ ok: false });
  });

  it("rejects game-start with invalid mode", () => {
    const r = parseControl(
      '{"type":"game-start","mode":"chaos","localPlayers":[0],"players":[{"name":"a","skinIndex":0}],"themeId":"t","snapshotHz":30,"delayTicks":4,"config":{}}',
    );
    expect(r).toMatchObject({ ok: false });
  });

  it("rejects game-start with bad snapshotHz", () => {
    const base =
      '"type":"game-start","mode":"race","localPlayers":[0],"players":[{"name":"a","skinIndex":0}],"themeId":"t","delayTicks":4,"config":{}';
    expect(parseControl(`{${base},"snapshotHz":45}`)).toMatchObject({ ok: false });
    expect(parseControl(`{${base},"snapshotHz":"30"}`)).toMatchObject({ ok: false });
  });

  it("rejects lobby-intent with unknown kind", () => {
    expect(parseControl('{"type":"lobby-intent","intent":{"kind":"sabotage"}}')).toMatchObject({ ok: false });
  });

  it("rejects ping without atMs", () => {
    expect(parseControl('{"type":"ping"}')).toMatchObject({ ok: false });
  });

  it("rejects hello-refused with unknown reason", () => {
    expect(parseControl('{"type":"hello-refused","reason":"because"}')).toMatchObject({ ok: false });
  });

  it("ticket 48: pause/quit messages validate the player index (0–3)", () => {
    expect(parseControl('{"type":"pause-request","player":0}')).toMatchObject({ ok: true });
    expect(parseControl('{"type":"pause-request","player":3}')).toMatchObject({ ok: true });
    expect(parseControl('{"type":"pause-request","player":4}')).toMatchObject({ ok: false });
    expect(parseControl('{"type":"pause-request","player":-1}')).toMatchObject({ ok: false });
    expect(parseControl('{"type":"pause-request","player":1.5}')).toMatchObject({ ok: false });
    expect(parseControl('{"type":"pause-request","player":"1"}')).toMatchObject({ ok: false });
    expect(parseControl('{"type":"pause-request"}')).toMatchObject({ ok: false });
    expect(parseControl('{"type":"paused","by":2}')).toMatchObject({ ok: true });
    expect(parseControl('{"type":"paused","by":9}')).toMatchObject({ ok: false });
    expect(parseControl('{"type":"paused"}')).toMatchObject({ ok: false });
    expect(parseControl('{"type":"resumed"}')).toMatchObject({ ok: true });
    expect(parseControl('{"type":"quit-match","player":0}')).toMatchObject({ ok: true });
    expect(parseControl('{"type":"quit-match","player":7}')).toMatchObject({ ok: false });
  });

  it("fuzz: random JSON bodies never pass with wrong shapes", () => {
    let seed = 999;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const types = ["hello", "hello-ok", "lobby-state", "game-start", "ping", "kick", "bye", "junk"];
    for (let i = 0; i < 300; i++) {
      const type = types[Math.floor(rand() * types.length)];
      const body = JSON.stringify({ type, v: rand() });
      const r = parseControl(body);
      if (r.ok) {
        // Only typed, complete messages pass — junk never.
        expect(type).not.toBe("junk");
      }
    }
  });

  it("protocol version is exposed for the handshake", () => {
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});
