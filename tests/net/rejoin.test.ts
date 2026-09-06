// Ticket 47: rejoin window — 90 s hold, join-with-original-player-id
// validation, expiry removal, spam bounds (ADR 0003).
import { describe, expect, it } from "vitest";
import {
  createRejoinRegistry,
  REJOIN_WINDOW_MS,
} from "net/rejoin";
import { parseControl } from "net/control";

describe("rejoin registry (spec §9: 90 s window)", () => {
  it("holds a dropped guest's slot and accepts its rejoin", () => {
    const reg = createRejoinRegistry();
    reg.hold(0, [100], 0);
    const d = reg.rejoin(100, 50_000);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.guestIndex).toBe(0);
      expect(d.playerIds).toEqual([100]);
    }
  });

  it("rejoin consumes the hold (second rejoin refused)", () => {
    const reg = createRejoinRegistry();
    reg.hold(0, [100], 0);
    expect(reg.rejoin(100, 1000).ok).toBe(true);
    const second = reg.rejoin(100, 2000);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("unknownPlayer");
  });

  it("rejoin after 90 s is refused as expired", () => {
    const reg = createRejoinRegistry();
    reg.hold(0, [100], 0);
    const d = reg.rejoin(100, REJOIN_WINDOW_MS + 1);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("expired");
  });

  it("rejoin inside the window boundary is accepted", () => {
    const reg = createRejoinRegistry();
    reg.hold(0, [100], 0);
    expect(reg.rejoin(100, REJOIN_WINDOW_MS).ok).toBe(true);
  });

  it("unknown player id refused (rejoin spam bound)", () => {
    const reg = createRejoinRegistry();
    const d = reg.rejoin(999, 100);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("unknownPlayer");
  });

  it("multi-player guest device rejoins via any of its player ids", () => {
    const reg = createRejoinRegistry();
    reg.hold(3, [103, 113], 0); // second local player rides guestIndex+10
    const d = reg.rejoin(113, 1000);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.playerIds).toEqual([103, 113]);
  });

  it("expire returns guests past the window and clears them", () => {
    const reg = createRejoinRegistry();
    reg.hold(0, [100], 0);
    reg.hold(1, [101], 50_000);
    const expired = reg.expire(100_000);
    expect(expired).toEqual([0]);
    expect(reg.entry(0)).toBeNull();
    expect(reg.entry(1)).not.toBeNull();
  });

  it("live clears a hold (guest rebound without rejoin message)", () => {
    const reg = createRejoinRegistry();
    reg.hold(0, [100], 0);
    reg.live(0);
    expect(reg.rejoin(100, 1000).ok).toBe(false);
  });
});

describe("rejoin control messages (wire format)", () => {
  it("rejoin parses with its player id", () => {
    const parsed = parseControl(JSON.stringify({ type: "rejoin", playerId: 103 }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.msg.type).toBe("rejoin");
      if (parsed.msg.type === "rejoin") expect(parsed.msg.playerId).toBe(103);
    }
  });

  it("rejoin-ok parses with its guest index", () => {
    const parsed = parseControl(JSON.stringify({ type: "rejoin-ok", guestIndex: 2 }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.msg.type === "rejoin-ok") {
      expect(parsed.msg.guestIndex).toBe(2);
    }
  });

  it("rejoin-refused parses with its reason", () => {
    for (const reason of ["unknownPlayer", "expired", "alreadyLive"] as const) {
      const parsed = parseControl(JSON.stringify({ type: "rejoin-refused", reason }));
      expect(parsed.ok).toBe(true);
      if (parsed.ok && parsed.msg.type === "rejoin-refused") {
        expect(parsed.msg.reason).toBe(reason);
      }
    }
  });

  it("malformed rejoin messages are protocol errors", () => {
    expect(parseControl(JSON.stringify({ type: "rejoin" })).ok).toBe(false);
    expect(parseControl(JSON.stringify({ type: "rejoin", playerId: "x" })).ok).toBe(false);
    expect(parseControl(JSON.stringify({ type: "rejoin-ok" })).ok).toBe(false);
    expect(parseControl(JSON.stringify({ type: "rejoin-refused", reason: "nope" })).ok).toBe(false);
  });
});
