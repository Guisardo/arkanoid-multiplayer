// Lobby state machine tests (ticket 43): create/join, local-player caps
// (desktop 4 / mobile 2, session cap 4), ready checks + config reset,
// all-ready gate, mode validation, kick, join windows (no mid-game
// late-join, between-match join), host-left reset.
import { describe, expect, it } from "vitest";
import {
  createLobbyState,
  reduceLobby,
  validModes,
  modeErrorFor,
  DESKTOP_DEVICE,
  MOBILE_DEVICE,
  type LobbyState,
} from "app/lobbyState";

function hostLobby(): LobbyState {
  return createLobbyState(true);
}

function withRemote(state: LobbyState, guestIndex: number): LobbyState {
  return reduceLobby(state, { type: "remoteJoined", guestIndex, name: `Guest ${String(guestIndex)}` }).state;
}

function allReady(state: LobbyState): LobbyState {
  let s = state;
  for (const p of s.players) {
    s = reduceLobby(s, { type: "setReady", playerId: p.id, ready: true }).state;
  }
  return s;
}

describe("room create/join", () => {
  it("createRoom accepts valid codes, rejects invalid", () => {
    const s = hostLobby();
    const ok = reduceLobby(s, { type: "createRoom", code: "ABC23" });
    expect(ok.error).toBeUndefined();
    expect(ok.state.code).toBe("ABC23");
    const bad = reduceLobby(s, { type: "createRoom", code: "ABC2" });
    expect(bad.error).toBe("invalidCode");
    // Lookalike chars excluded from the charset.
    expect(reduceLobby(s, { type: "createRoom", code: "AB0IL" }).error).toBe("invalidCode");
  });

  it("joinRoom during game rejected (no late-join); lobby + betweenMatches OK", () => {
    let s = hostLobby();
    s = reduceLobby(s, { type: "createRoom", code: "ABC23" }).state;
    s = reduceLobby(s, { type: "matchStarted" }).state;
    expect(reduceLobby(s, { type: "joinRoom", code: "ABC23" }).error).toBe("noLateJoin");
    s = reduceLobby(s, { type: "matchEnded" }).state;
    expect(reduceLobby(s, { type: "joinRoom", code: "ABC23" }).error).toBeUndefined();
  });
});

describe("local-player caps", () => {
  it("desktop: up to 4 local players", () => {
    let s = hostLobby();
    for (let i = 0; i < 3; i++) {
      s = reduceLobby(s, { type: "addLocalPlayer" }, DESKTOP_DEVICE).state;
    }
    expect(s.players).toHaveLength(4);
    const r = reduceLobby(s, { type: "addLocalPlayer" }, DESKTOP_DEVICE);
    expect(r.error).toBe("deviceFull");
  });

  it("mobile: up to 2 local players", () => {
    let s = hostLobby();
    s = reduceLobby(s, { type: "addLocalPlayer" }, MOBILE_DEVICE).state;
    expect(s.players).toHaveLength(2);
    const r = reduceLobby(s, { type: "addLocalPlayer" }, MOBILE_DEVICE);
    expect(r.error).toBe("deviceFull");
  });

  it("session cap 4 across local + remote", () => {
    let s = hostLobby();
    s = reduceLobby(s, { type: "addLocalPlayer" }).state; // 2 local
    s = withRemote(s, 0); // +1 remote
    s = withRemote(s, 1); // 4 total
    const r = reduceLobby(s, { type: "remoteJoined", guestIndex: 2, name: "G3" });
    expect(r.error).toBe("sessionFull");
    const r2 = reduceLobby(s, { type: "addLocalPlayer" });
    expect(r2.error).toBe("sessionFull");
  });
});

describe("ready checks + config", () => {
  it("config change resets all ready checks", () => {
    let s = hostLobby();
    s = withRemote(s, 0);
    s = allReady(s);
    expect(s.players.every((p) => p.ready)).toBe(true);
    s = reduceLobby(s, { type: "setConfig", config: { mode: "duel" } }).state;
    expect(s.players.every((p) => !p.ready)).toBe(true);
  });

  it("guests cannot set config", () => {
    const guest = createLobbyState(false);
    const r = reduceLobby(guest, { type: "setConfig", config: { mode: "duel" } });
    expect(r.error).toBe("notHost");
  });

  it("start requires all ready (incl. host locals)", () => {
    let s = hostLobby();
    s = withRemote(s, 0);
    s = reduceLobby(s, { type: "setReady", playerId: 0, ready: true }).state;
    const r = reduceLobby(s, { type: "startCountdown" });
    expect(r.error).toBe("notAllReady");
    s = allReady(s);
    const ok = reduceLobby(s, { type: "startCountdown" });
    expect(ok.error).toBeUndefined();
    expect(ok.state.phase).toBe("countdown");
    expect(ok.state.countdownRemaining).toBe(3);
  });

  it("countdown ticks 3-2-1 then matchStarted", () => {
    let s = hostLobby();
    s = withRemote(s, 0);
    s = allReady(s);
    s = reduceLobby(s, { type: "startCountdown" }).state;
    s = reduceLobby(s, { type: "countdownTick" }).state;
    expect(s.countdownRemaining).toBe(2);
    s = reduceLobby(s, { type: "countdownTick" }).state;
    s = reduceLobby(s, { type: "countdownTick" }).state;
    expect(s.countdownRemaining).toBe(0);
    s = reduceLobby(s, { type: "matchStarted" }).state;
    expect(s.phase).toBe("inGame");
  });
});

describe("mode validation", () => {
  it("all modes need >=2; Duel needs exactly 2", () => {
    expect(modeErrorFor("race", 1)).toBe("modeNeedsTwo");
    expect(modeErrorFor("duel", 3)).toBe("duelNeedsExactlyTwo");
    expect(modeErrorFor("duel", 2)).toBeNull();
    expect(modeErrorFor("race", 4)).toBeNull();
  });

  it("validModes greys Duel unless exactly 2", () => {
    expect(validModes(1)).toEqual([]);
    expect(validModes(2)).toContain("duel");
    expect(validModes(3)).not.toContain("duel");
    expect(validModes(4)).not.toContain("duel");
    expect(validModes(4)).toContain("race");
  });

  it("start rejects invalid mode for player count", () => {
    let s = hostLobby();
    s = withRemote(s, 0);
    s = withRemote(s, 1);
    s = allReady(s);
    s = reduceLobby(s, { type: "setConfig", config: { mode: "duel" } }).state;
    s = allReady(s);
    const r = reduceLobby(s, { type: "startCountdown" });
    expect(r.error).toBe("duelNeedsExactlyTwo");
  });
});

describe("kick + removal", () => {
  it("host kicks remote; guest cannot kick", () => {
    let s = hostLobby();
    s = withRemote(s, 0);
    const remoteId = s.players.find((p) => p.kind === "remote")?.id ?? -1;
    s = reduceLobby(s, { type: "removePlayer", playerId: remoteId }).state;
    expect(s.players.every((p) => p.kind === "local")).toBe(true);

    const guest = createLobbyState(false);
    const guestRemote = withRemote(guest, 0);
    const r = reduceLobby(guestRemote, { type: "removePlayer", playerId: 100 });
    expect(r.error).toBe("notHost");
  });

  it("remoteLeft removes the player", () => {
    let s = hostLobby();
    s = withRemote(s, 0);
    s = reduceLobby(s, { type: "remoteLeft", guestIndex: 0 }).state;
    expect(s.players).toHaveLength(1);
  });
});

describe("between-match join", () => {
  it("joiners start unready; existing keep ready state", () => {
    let s = hostLobby();
    s = withRemote(s, 0);
    s = allReady(s);
    s = reduceLobby(s, { type: "matchStarted" }).state;
    s = reduceLobby(s, { type: "matchEnded" }).state;
    s = withRemote(s, 1);
    const joiner = s.players.find((p) => p.id === 101);
    const existing = s.players.find((p) => p.id === 100);
    expect(joiner?.ready).toBe(false);
    expect(existing?.ready).toBe(true);
  });

  it("addLocalPlayer blocked mid-game, allowed between matches", () => {
    let s = hostLobby();
    s = reduceLobby(s, { type: "matchStarted" }).state;
    expect(reduceLobby(s, { type: "addLocalPlayer" }).error).toBe("noLateJoin");
    s = reduceLobby(s, { type: "matchEnded" }).state;
    expect(reduceLobby(s, { type: "addLocalPlayer" }).error).toBeUndefined();
  });
});

describe("host left (ADR 0001)", () => {
  it("hostLeft resets to a fresh local lobby", () => {
    let s = hostLobby();
    s = reduceLobby(s, { type: "createRoom", code: "ABC23" }).state;
    s = withRemote(s, 0);
    const r = reduceLobby(s, { type: "hostLeft" });
    expect(r.state.code).toBeNull();
    expect(r.state.players).toHaveLength(1);
    expect(r.state.phase).toBe("lobby");
  });
});
