// Control-channel messages (spec §9): reliable, ordered, JSON. This is the
// typed union both ends speak after the DataChannel opens. Structural
// validation is mandatory both directions (ADR 0003): a malformed message is
// a protocol error — the receiving end surfaces it and ends the session
// cleanly, never a crash. Unknown message types are ignored where harmless,
// refused where they carry state.
import type { LobbyConfig, LobbyMode } from "app/lobbyState";
import { PROTOCOL_VERSION } from "shared/protocol";

export const CONTROL_TYPES = [
  "hello", // guest → host: version + identity (name, skin UUID, playerId)
  "hello-ok", // host → guest: accepted, assigned playerId(s), lobby state
  "hello-refused", // host → guest: version mismatch or room full
  "lobby-state", // host → guest: full lobby state broadcast (on any change)
  "lobby-intent", // guest → host: local ready/name/skin intent
  "lobby-start", // host → guest: countdown started (3-2-1)
  "game-start", // host → guest: match began — mode, players, snapshot rate, D
  "game-end", // host → guest: match ended — standings payload (end screens)
  "to-lobby", // host → guest: back to lobby (between matches window)
  "ping", // either: heartbeat (5 s guest, host echoes)
  "pong", // either: heartbeat echo
  "kick", // host → guest: removed (lobby or mid-session)
  "bye", // either: clean close (quit at end screens)
  "rejoin", // guest → host: re-entering with original player id (ticket 47)
  "rejoin-ok", // host → guest: held slot validated, channels rebound
  "rejoin-refused", // host → guest: no held slot (unknown/expired/live)
  "pause-request", // guest → host: coop pause request (ticket 48)
  "pause-cancel", // guest → host: the pauser cancels its own pause
  "resume", // guest → host: any player resumes a paused coop match
  "paused", // host → all: sim paused for everyone (carries the pauser)
  "resumed", // host → all: sim resumed
  "quit-match", // guest → host: quit from the overlay = removal (48)
] as const;

export type ControlType = (typeof CONTROL_TYPES)[number];

export interface HelloMsg {
  type: "hello";
  version: number;
  name: string;
  skinId: string;
}

export interface HelloOkMsg {
  type: "hello-ok";
  playerId: number;
  guestIndex: number;
}

export interface HelloRefusedMsg {
  type: "hello-refused";
  reason: "version" | "full" | "inGame";
}

export interface LobbyStateMsg {
  type: "lobby-state";
  state: unknown; // LobbyState shape, validated by parseLobbyState
}

export interface LobbyIntentMsg {
  type: "lobby-intent";
  intent:
    | { kind: "ready"; ready: boolean }
    | { kind: "name"; name: string }
    | { kind: "skin"; skinId: string }
    | { kind: "addLocalPlayer"; name?: string; skinId?: string };
}

export interface LobbyStartMsg {
  type: "lobby-start";
  countdown: number;
}

export interface GameStartMsg {
  type: "game-start";
  mode: LobbyMode;
  /** Player indices this guest device renders locally (their fields). */
  localPlayers: number[];
  /** All session players in slot order — index = player index. */
  players: { name: string; skinIndex: number }[];
  themeId: string;
  /** Snapshot broadcast rate. */
  snapshotHz: 30 | 60;
  /** Input delay ticks for remote competitive (0 = coop). */
  delayTicks: number;
  config: LobbyConfig;
}

export interface GameEndMsg {
  type: "game-end";
  /** Mode-specific standings payload (endScreens shapes, ticket 50). */
  standings: unknown;
  coopOutcome: unknown;
  mode: LobbyMode;
}

export interface ToLobbyMsg {
  type: "to-lobby";
}

export interface PingMsg {
  type: "ping";
  atMs: number;
}

export interface PongMsg {
  type: "pong";
  atMs: number;
}

export interface KickMsg {
  type: "kick";
  reason: "lobby" | "midSession";
}

export interface ByeMsg {
  type: "bye";
}

/** Guest → host: re-entering with the original player id (ticket 47). */
export interface RejoinMsg {
  type: "rejoin";
  playerId: number;
}

/** Host → guest: held slot validated, guest index rebound. */
export interface RejoinOkMsg {
  type: "rejoin-ok";
  guestIndex: number;
}

/** Host → guest: no held slot for this player id. */
export interface RejoinRefusedMsg {
  type: "rejoin-refused";
  reason: "unknownPlayer" | "expired" | "alreadyLive";
}

/** Guest → host: coop pause request — any player, downed included (48). */
export interface PauseRequestMsg {
  type: "pause-request";
  /** Sim player index of the requester. */
  player: number;
}

/** Guest → host: the pauser cancels its own pause (48). */
export interface PauseCancelMsg {
  type: "pause-cancel";
  /** Sim player index of the canceler (must equal the pauser). */
  player: number;
}

/** Guest → host: any player resumes a paused coop match (48). */
export interface ResumeMsg {
  type: "resume";
  /** Sim player index of the resumer. */
  player: number;
}

/** Host → all: sim paused for everyone (48). */
export interface PausedMsg {
  type: "paused";
  /** Sim player index who requested the pause ("Paused by [name]"). */
  by: number;
}

/** Host → all: sim resumed (48). */
export interface ResumedMsg {
  type: "resumed";
}

/** Guest → host: quit from the overlay = removal, scored as loss (48). */
export interface QuitMatchMsg {
  type: "quit-match";
  /** Sim player index quitting. */
  player: number;
}

export type ControlMsg =
  | HelloMsg
  | HelloOkMsg
  | HelloRefusedMsg
  | LobbyStateMsg
  | LobbyIntentMsg
  | LobbyStartMsg
  | GameStartMsg
  | GameEndMsg
  | ToLobbyMsg
  | PingMsg
  | PongMsg
  | KickMsg
  | ByeMsg
  | RejoinMsg
  | RejoinOkMsg
  | RejoinRefusedMsg
  | PauseRequestMsg
  | PauseCancelMsg
  | ResumeMsg
  | PausedMsg
  | ResumedMsg
  | QuitMatchMsg;

export type ParseResult =
  | { ok: true; msg: ControlMsg }
  | { ok: false; error: "protocol" };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Parse + structurally validate a control message; `protocol` = malformed. */
export function parseControl(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "protocol" };
  }
  if (!isRecord(parsed)) return { ok: false, error: "protocol" };
  switch (parsed.type) {
    case "hello": {
      const version = num(parsed.version);
      const name = str(parsed.name);
      const skinId = str(parsed.skinId);
      if (version === null || name === null || skinId === null || name.length === 0) {
        return { ok: false, error: "protocol" };
      }
      return { ok: true, msg: { type: "hello", version, name: name.slice(0, 64), skinId } };
    }
    case "hello-ok": {
      const playerId = num(parsed.playerId);
      const guestIndex = num(parsed.guestIndex);
      if (playerId === null || guestIndex === null) return { ok: false, error: "protocol" };
      return { ok: true, msg: { type: "hello-ok", playerId, guestIndex } };
    }
    case "hello-refused": {
      const reason = str(parsed.reason);
      if (reason !== "version" && reason !== "full" && reason !== "inGame") {
        return { ok: false, error: "protocol" };
      }
      return { ok: true, msg: { type: "hello-refused", reason } };
    }
    case "lobby-state": {
      if (!isRecord(parsed.state)) return { ok: false, error: "protocol" };
      return { ok: true, msg: { type: "lobby-state", state: parsed.state } };
    }
    case "lobby-intent": {
      const intent = parsed.intent;
      if (!isRecord(intent)) return { ok: false, error: "protocol" };
      switch (intent.kind) {
        case "ready": {
          if (typeof intent.ready !== "boolean") return { ok: false, error: "protocol" };
          return { ok: true, msg: { type: "lobby-intent", intent: { kind: "ready", ready: intent.ready } } };
        }
        case "name": {
          const name = str(intent.name);
          if (name === null) return { ok: false, error: "protocol" };
          return { ok: true, msg: { type: "lobby-intent", intent: { kind: "name", name: name.slice(0, 64) } } };
        }
        case "skin": {
          const skinId = str(intent.skinId);
          if (skinId === null) return { ok: false, error: "protocol" };
          return { ok: true, msg: { type: "lobby-intent", intent: { kind: "skin", skinId } } };
        }
        case "addLocalPlayer": {
          const name = typeof intent.name === "string" ? intent.name.slice(0, 64) : undefined;
          const skinId = typeof intent.skinId === "string" ? intent.skinId : undefined;
          return {
            ok: true,
            msg: {
              type: "lobby-intent",
              intent: {
                kind: "addLocalPlayer",
                ...(name !== undefined ? { name } : {}),
                ...(skinId !== undefined ? { skinId } : {}),
              },
            },
          };
        }
        default:
          return { ok: false, error: "protocol" };
      }
    }
    case "lobby-start": {
      const countdown = num(parsed.countdown);
      if (countdown === null) return { ok: false, error: "protocol" };
      return { ok: true, msg: { type: "lobby-start", countdown } };
    }
    case "game-start": {
      const mode = str(parsed.mode);
      if (mode !== "race" && mode !== "attack" && mode !== "duel" &&
          mode !== "sharedField" && mode !== "parallelAssist") {
        return { ok: false, error: "protocol" };
      }
      const localPlayers = parsed.localPlayers;
      const players = parsed.players;
      const themeId = str(parsed.themeId);
      const snapshotHz = num(parsed.snapshotHz);
      const delayTicks = num(parsed.delayTicks);
      if (
        !Array.isArray(localPlayers) || localPlayers.length === 0 ||
        !Array.isArray(players) || players.length === 0 || themeId === null ||
        (snapshotHz !== 30 && snapshotHz !== 60) || delayTicks === null ||
        !isRecord(parsed.config)
      ) {
        return { ok: false, error: "protocol" };
      }
      const shapedPlayers: { name: string; skinIndex: number }[] = [];
      for (const p of players) {
        if (!isRecord(p)) return { ok: false, error: "protocol" };
        const name = str(p.name);
        const skinIndex = num(p.skinIndex);
        if (name === null || skinIndex === null) return { ok: false, error: "protocol" };
        shapedPlayers.push({ name, skinIndex });
      }
      return {
        ok: true,
        msg: {
          type: "game-start",
          mode,
          localPlayers: localPlayers.map((p) => Number(p)),
          players: shapedPlayers,
          themeId,
          snapshotHz,
          delayTicks,
          config: parsed.config as unknown as LobbyConfig,
        },
      };
    }
    case "game-end": {
      const mode = str(parsed.mode);
      if (mode !== "race" && mode !== "attack" && mode !== "duel" &&
          mode !== "sharedField" && mode !== "parallelAssist") {
        return { ok: false, error: "protocol" };
      }
      return {
        ok: true,
        msg: { type: "game-end", standings: parsed.standings, coopOutcome: parsed.coopOutcome, mode },
      };
    }
    case "to-lobby":
      return { ok: true, msg: { type: "to-lobby" } };
    case "ping": {
      const atMs = num(parsed.atMs);
      if (atMs === null) return { ok: false, error: "protocol" };
      return { ok: true, msg: { type: "ping", atMs } };
    }
    case "pong": {
      const atMs = num(parsed.atMs);
      if (atMs === null) return { ok: false, error: "protocol" };
      return { ok: true, msg: { type: "pong", atMs } };
    }
    case "kick": {
      const reason = str(parsed.reason);
      if (reason !== "lobby" && reason !== "midSession") {
        return { ok: false, error: "protocol" };
      }
      return { ok: true, msg: { type: "kick", reason } };
    }
    case "bye":
      return { ok: true, msg: { type: "bye" } };
    case "rejoin": {
      const playerId = num(parsed.playerId);
      if (playerId === null) return { ok: false, error: "protocol" };
      return { ok: true, msg: { type: "rejoin", playerId } };
    }
    case "rejoin-ok": {
      const guestIndex = num(parsed.guestIndex);
      if (guestIndex === null) return { ok: false, error: "protocol" };
      return { ok: true, msg: { type: "rejoin-ok", guestIndex } };
    }
    case "rejoin-refused": {
      const reason = str(parsed.reason);
      if (reason !== "unknownPlayer" && reason !== "expired" && reason !== "alreadyLive") {
        return { ok: false, error: "protocol" };
      }
      return { ok: true, msg: { type: "rejoin-refused", reason } };
    }
    case "pause-request":
    case "pause-cancel":
    case "resume":
    case "quit-match": {
      const player = num(parsed.player);
      if (player === null || !Number.isInteger(player) || player < 0 || player > 3) {
        return { ok: false, error: "protocol" };
      }
      return { ok: true, msg: { type: parsed.type, player } as ControlMsg };
    }
    case "paused": {
      const by = num(parsed.by);
      if (by === null || !Number.isInteger(by) || by < 0 || by > 3) {
        return { ok: false, error: "protocol" };
      }
      return { ok: true, msg: { type: "paused", by } };
    }
    case "resumed":
      return { ok: true, msg: { type: "resumed" } };
    default:
      return { ok: false, error: "protocol" };
  }
}

/** Serialize a control message for the wire. */
export function encodeControl(msg: ControlMsg): string {
  return JSON.stringify(msg);
}

/** Version compatibility for the handshake (spec §9: exact major match). */
export function versionsCompatible(guest: number, host: number): boolean {
  return guest === host || (guest === PROTOCOL_VERSION && host === PROTOCOL_VERSION);
}
