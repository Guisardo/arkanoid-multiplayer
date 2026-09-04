// Lobby state machine (ticket 43, spec §8): room-code session flow —
// create/join, local-player management (device caps, session cap 4),
// host-only config with ready-check reset, all-ready gate, mode validation
// by player count, kick, join states (lobby-join between matches, no
// mid-game late-join), host-left handling. Pure logic — the UI and
// signaling layers drive it with events.
import { validateRoomCode } from "signaling/code";

export const SESSION_CAP = 4;
export const NAME_MAX_CHARS = 12;

export type LobbyMode = "race" | "attack" | "duel" | "sharedField" | "parallelAssist";

export interface LobbyConfig {
  mode: LobbyMode;
  /** Match structure (mode-specific; opaque to the lobby core). */
  matchStructure: "bestOf" | "continuous" | "oneOff";
  bestOf: number;
  levelSelection: "hostPick" | "fixedOrder" | "random";
  hostPickRound: number;
  timeCapTicks: number | null;
}

export const DEFAULT_CONFIG: LobbyConfig = {
  mode: "race",
  matchStructure: "oneOff",
  bestOf: 1,
  levelSelection: "hostPick",
  hostPickRound: 1,
  timeCapTicks: null,
};

export type PlayerKind = "local" | "remote";

export interface LobbyPlayer {
  /** Stable slot id (0–3). */
  id: number;
  kind: PlayerKind;
  name: string;
  ready: boolean;
}

export type LobbyPhase =
  | "lobby" // gathering + config
  | "countdown" // 3-2-1 started
  | "inGame" // match running — no late-join
  | "betweenMatches"; // end screen / rematch window — lobby-join OK

export interface LobbyState {
  phase: LobbyPhase;
  code: string | null;
  isHost: boolean;
  players: LobbyPlayer[];
  config: LobbyConfig;
  /** Countdown ticks remaining (3-2-1 at 1 s each). */
  countdownRemaining: number;
}

export type LobbyEvent =
  | { type: "createRoom"; code: string }
  | { type: "joinRoom"; code: string }
  | { type: "addLocalPlayer"; name?: string }
  | { type: "remoteJoined"; guestIndex: number; name: string }
  | { type: "remoteLeft"; guestIndex: number }
  | { type: "removePlayer"; playerId: number } // kick (host-only) or local remove
  | { type: "setReady"; playerId: number; ready: boolean }
  | { type: "setConfig"; config: Partial<LobbyConfig> }
  | { type: "startCountdown" }
  | { type: "countdownTick" }
  | { type: "matchStarted" }
  | { type: "matchEnded" } // → betweenMatches (lobby-join window)
  | { type: "hostLeft" };

export type LobbyError =
  | "invalidCode"
  | "sessionFull"
  | "deviceFull"
  | "notHost"
  | "modeNeedsTwo"
  | "duelNeedsExactlyTwo"
  | "notAllReady"
  | "noLateJoin"
  | "playerNotFound";

/** Device class for local-player caps (desktop 4, mobile 2 — spec §12). */
export interface LobbyDevice {
  maxLocal: number;
}

export const DESKTOP_DEVICE: LobbyDevice = { maxLocal: 4 };
export const MOBILE_DEVICE: LobbyDevice = { maxLocal: 2 };

export function createLobbyState(isHost: boolean): LobbyState {
  return {
    phase: "lobby",
    code: null,
    isHost,
    players: [{ id: 0, kind: "local", name: "Player 1", ready: false }],
    config: { ...DEFAULT_CONFIG },
    countdownRemaining: 0,
  };
}

/** Mode validity by current player count (spec §8: Duel = exactly 2, all ≥2). */
export function modeErrorFor(mode: LobbyMode, playerCount: number): LobbyError | null {
  if (playerCount < 2) return "modeNeedsTwo";
  if (mode === "duel" && playerCount !== 2) return "duelNeedsExactlyTwo";
  return null;
}

/** All modes valid for this player count (mode picker greying). */
export function validModes(playerCount: number): LobbyMode[] {
  const all: LobbyMode[] = ["race", "attack", "duel", "sharedField", "parallelAssist"];
  return all.filter((m) => modeErrorFor(m, playerCount) === null);
}

export function reduceLobby(
  state: LobbyState,
  event: LobbyEvent,
  device: LobbyDevice = DESKTOP_DEVICE,
): { state: LobbyState; error?: LobbyError } {
  const next: LobbyState = {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    config: { ...state.config },
  };

  switch (event.type) {
    case "createRoom": {
      if (!validateRoomCode(event.code)) return { state, error: "invalidCode" };
      next.code = event.code;
      next.phase = "lobby";
      return { state: next };
    }
    case "joinRoom": {
      if (!validateRoomCode(event.code)) return { state, error: "invalidCode" };
      if (next.phase === "inGame" || next.phase === "countdown") {
        return { state, error: "noLateJoin" };
      }
      next.code = event.code;
      return { state: next };
    }
    case "addLocalPlayer": {
      if (next.phase !== "lobby" && next.phase !== "betweenMatches") {
        return { state, error: "noLateJoin" };
      }
      const locals = next.players.filter((p) => p.kind === "local").length;
      if (locals >= device.maxLocal) return { state, error: "deviceFull" };
      if (next.players.length >= SESSION_CAP) return { state, error: "sessionFull" };
      const id = next.players.length === 0 ? 0 : Math.max(...next.players.map((p) => p.id)) + 1;
      next.players.push({
        id,
        kind: "local",
        name: event.name ?? `Player ${String(next.players.length + 1)}`,
        ready: false,
      });
      return { state: next };
    }
    case "remoteJoined": {
      if (next.phase === "inGame" || next.phase === "countdown") {
        return { state, error: "noLateJoin" };
      }
      if (next.players.length >= SESSION_CAP) return { state, error: "sessionFull" };
      // Between-match joiners start unready; existing players keep state.
      next.players.push({ id: event.guestIndex + 100, kind: "remote", name: event.name, ready: false });
      return { state: next };
    }
    case "remoteLeft": {
      next.players = next.players.filter((p) => !(p.kind === "remote" && p.id === event.guestIndex + 100));
      return { state: next };
    }
    case "removePlayer": {
      const target = next.players.find((p) => p.id === event.playerId);
      if (!target) return { state, error: "playerNotFound" };
      if (target.kind === "remote" && !next.isHost) {
        return { state, error: "notHost" }; // kick is host-only
      }
      next.players = next.players.filter((p) => p.id !== event.playerId);
      return { state: next };
    }
    case "setReady": {
      const p = next.players.find((x) => x.id === event.playerId);
      if (!p) return { state, error: "playerNotFound" };
      p.ready = event.ready;
      return { state: next };
    }
    case "setConfig": {
      if (!next.isHost) return { state, error: "notHost" };
      next.config = { ...next.config, ...event.config };
      // Any config change resets all ready checks (spec §8).
      for (const p of next.players) p.ready = false;
      return { state: next };
    }
    case "startCountdown": {
      if (!next.isHost) return { state, error: "notHost" };
      const modeErr = modeErrorFor(next.config.mode, next.players.length);
      if (modeErr !== null) return { state, error: modeErr };
      if (next.players.some((p) => !p.ready)) return { state, error: "notAllReady" };
      next.phase = "countdown";
      next.countdownRemaining = 3;
      return { state: next };
    }
    case "countdownTick": {
      if (next.phase !== "countdown") return { state };
      next.countdownRemaining = Math.max(0, next.countdownRemaining - 1);
      return { state: next };
    }
    case "matchStarted": {
      next.phase = "inGame";
      next.countdownRemaining = 0;
      return { state: next };
    }
    case "matchEnded": {
      next.phase = "betweenMatches";
      return { state: next };
    }
    case "hostLeft": {
      // ADR 0001: host disconnect → session dies for all. Callers surface
      // the message; the state resets to a fresh local lobby.
      return { state: createLobbyState(true) };
    }
  }
}
