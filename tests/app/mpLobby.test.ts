import { describe, expect, it } from "vitest";
import {
  createHostLobbySession,
  createGuestLobbySession,
  guestPlayerId,
} from "app/mpLobby";
import { PROTOCOL_VERSION } from "shared/protocol";

/** Wire pair: host→guest and guest→host captures with manual pump. */
function loopback() {
  const hostToGuest: Map<number, string[]> = new Map();
  const guestToHost: string[] = [];
  const host = createHostLobbySession((gi, msg) => {
    const list = hostToGuest.get(gi) ?? [];
    list.push(JSON.stringify(msg));
    hostToGuest.set(gi, list);
  });
  const guest = createGuestLobbySession(
    (msg) => guestToHost.push(JSON.stringify(msg)),
    PROTOCOL_VERSION,
  );
  return {
    host,
    guest,
    /** Guest processes everything the host sent it. */
    pumpToGuest: (gi: number): void => {
      for (const raw of hostToGuest.get(gi) ?? []) guest.onHostMessage(raw);
      hostToGuest.set(gi, []);
    },
    /** Host processes everything the guest sent. */
    pumpToHost: (gi: number): void => {
      for (const raw of guestToHost.splice(0)) host.guestMessage(gi, raw);
    },
  };
}

describe("mp lobby sync (ticket 45)", () => {
  it("guest hello is accepted and the lobby broadcasts to it", () => {
    const { host, guest, pumpToGuest, pumpToHost } = loopback();
    guest.hello("Alice", "skin-1");
    pumpToHost(0);
    pumpToGuest(0);
    expect(guest.playerId()).toBe(guestPlayerId(0));
    const s = guest.state();
    expect(s.players.some((p) => p.name === "Alice" && p.kind === "remote")).toBe(true);
    // Host state and guest replica agree.
    expect(host.state().players.map((p) => p.name)).toContain("Alice");
  });

  it("version mismatch is refused", () => {
    const refused: string[] = [];
    const host = createHostLobbySession((gi, msg) => {
      refused.push(JSON.stringify(msg));
    });
    const guest = createGuestLobbySession(
      (msg) => { host.guestMessage(0, JSON.stringify(msg)); },
      PROTOCOL_VERSION + 1,
      { onRefused: (r) => refused.push(r) },
    );
    guest.hello("Bob", "s");
    expect(refused.some((r) => r.includes("hello-refused") || r === "version")).toBe(true);
    expect(host.state().players).toHaveLength(1); // host only
  });

  it("guest ready intent toggles its players", () => {
    const { host, guest, pumpToGuest, pumpToHost } = loopback();
    guest.hello("C", "s");
    pumpToHost(0);
    pumpToGuest(0);
    guest.intent({ kind: "ready", ready: true });
    pumpToHost(0);
    pumpToGuest(0);
    const p = host.state().players.find((x) => x.id === guestPlayerId(0));
    expect(p?.ready).toBe(true);
  });

  it("guest name + skin intents apply", () => {
    const { host, guest, pumpToHost, pumpToGuest } = loopback();
    guest.hello("D", "s");
    pumpToHost(0);
    pumpToGuest(0);
    guest.intent({ kind: "name", name: "Dude" });
    pumpToHost(0);
    guest.intent({ kind: "skin", skinId: "whatever" });
    pumpToHost(0);
    pumpToGuest(0);
    const p = host.state().players.find((x) => x.id === guestPlayerId(0));
    expect(p?.name).toBe("Dude");
  });

  it("guest addLocalPlayer adds a second remote slot up to cap", () => {
    const { host, guest, pumpToHost, pumpToGuest } = loopback();
    guest.hello("E", "s");
    pumpToHost(0);
    pumpToGuest(0);
    guest.intent({ kind: "addLocalPlayer" });
    pumpToHost(0);
    pumpToGuest(0);
    expect(host.state().players.filter((p) => p.kind === "remote")).toHaveLength(2);
    // Second add: rejected (max 2 local on a guest device).
    guest.intent({ kind: "addLocalPlayer" });
    pumpToHost(0);
    expect(host.state().players.filter((p) => p.kind === "remote")).toHaveLength(2);
  });

  it("guest close removes its players", () => {
    const { host, guest, pumpToHost } = loopback();
    guest.hello("F", "s");
    pumpToHost(0);
    expect(host.state().players.some((p) => p.name === "F")).toBe(true);
    host.guestClosed(0);
    expect(host.state().players.some((p) => p.name === "F")).toBe(false);
  });

  it("countdown reaches matchStarted + notifies guests", () => {
    const starts: number[] = [];
    const host = createHostLobbySession((_gi, msg) => {
      if (msg.type === "lobby-start") starts.push(msg.countdown);
    });
    // Connect a guest so the lobby-start broadcast has a recipient.
    host.guestMessage(
      0,
      JSON.stringify({ type: "hello", version: PROTOCOL_VERSION, name: "H", skinId: "s" }),
    );
    // Enough players (host local + guest), host local ready, then start.
    host.localEvent({ type: "setReady", playerId: 0, ready: true });
    // Guest marks ready via intent.
    host.guestMessage(0, JSON.stringify({ type: "lobby-intent", intent: { kind: "ready", ready: true } }));
    host.startCountdown();
    expect(starts).toEqual([3]);
    expect(host.state().phase).toBe("countdown");
    host.countdownTick(); // 3 → 2
    host.countdownTick(); // 2 → 1
    host.countdownTick(); // 1 → 0 → matchStarted
    expect(host.state().phase).toBe("inGame");
  });

  it("ping is answered with pong", () => {
    const sent: string[] = [];
    const host = createHostLobbySession((_gi, msg) => sent.push(JSON.stringify(msg)));
    host.guestMessage(0, JSON.stringify({ type: "ping", atMs: 42 }));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('"pong"');
  });

  it("malformed guest control is dropped without crashing", () => {
    const host = createHostLobbySession(() => undefined);
    expect(() => { host.guestMessage(0, "garbage{{{"); }).not.toThrow();
    expect(host.state().players).toHaveLength(1);
  });

  it("session full: 4th player rejected at hello", () => {
    const host = createHostLobbySession(() => undefined);
    host.localEvent({ type: "addLocalPlayer" });
    host.localEvent({ type: "addLocalPlayer" });
    // 3 host locals; guest 1 joins fine (4 total), guest 2 refused.
    host.guestMessage(1, JSON.stringify({ type: "hello", version: PROTOCOL_VERSION, name: "G1", skinId: "s" }));
    expect(host.state().players).toHaveLength(4);
    host.guestMessage(2, JSON.stringify({ type: "hello", version: PROTOCOL_VERSION, name: "G2", skinId: "s" }));
    expect(host.state().players).toHaveLength(4); // unchanged
  });

  it("guestPlayerId maps indices to stable slot ids", () => {
    expect(guestPlayerId(0)).toBe(100);
    expect(guestPlayerId(2)).toBe(102);
  });
});
