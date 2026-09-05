// Multiplayer lobby synchronization (ticket 45, spec §8/§9): the host runs
// the authoritative reduceLobby and broadcasts full lobby state on every
// change; guests replay that state and send intents (ready/name/skin/add
// local). The control channel (reliable, ordered) carries it all. Guests
// keep their local-player ids (assigned by the host at hello) so intents
// target stable slots. Version mismatch on hello → refused, "refresh your
// browser". Transport-agnostic: both sides speak through a send seam so
// tests run loopback without WebRTC.
import {
  createLobbyState,
  reduceLobby,
  DESKTOP_DEVICE,
  type LobbyDevice,
  type LobbyEvent,
  type LobbyState,
} from "app/lobbyState";
import {
  encodeControl,
  parseControl,
  type ControlMsg,
} from "net/control";
import { PROTOCOL_VERSION } from "shared/protocol";

export interface HostLobbyCallbacks {
  /** Guest device joined the lobby (after hello-ok). */
  onGuestJoined?(guestIndex: number, localPlayerIds: number[]): void;
  /** Guest device left (channel close or kick confirmed). */
  onGuestLeft?(guestIndex: number): void;
  /** Lobby state changed (re-broadcast already handled internally). */
  onStateChanged?(state: LobbyState): void;
  /** Countdown reached zero — host starts the game. */
  onCountdownComplete?(state: LobbyState): void;
}

export interface HostLobbySession {
  /** Current authoritative state. */
  state(): LobbyState;
  /** Apply a local (host-device) lobby event — broadcasts when changed. */
  localEvent(event: LobbyEvent, device?: LobbyDevice): void;
  /** Feed a control message from a guest device. */
  guestMessage(guestIndex: number, raw: string): void;
  /** Guest channel closed — remove its players. */
  guestClosed(guestIndex: number): void;
  /** Countdown ticker (call ~1 Hz while in countdown phase). */
  countdownTick(): void;
  /** All connected guest indices. */
  guests(): number[];
  /** Player ids owned by guest device `guestIndex`. */
  playersOfGuest(guestIndex: number): number[];
  /** Host pressed start (validated) — enters countdown + broadcasts. */
  startCountdown(): void;
  /** Kick a guest device: removes its players + notifies it. */
  kickGuest(guestIndex: number): void;
}

/** Map guestIndex → the LobbyPlayer.id used in state (id = guestIndex + 100). */
export function guestPlayerId(guestIndex: number): number {
  return guestIndex + 100;
}

export function createHostLobbySession(
  send: (guestIndex: number, msg: ControlMsg) => void,
  callbacks: HostLobbyCallbacks = {},
  initial?: LobbyState,
): HostLobbySession {
  let state = initial ?? createLobbyState(true);
  const guestPlayers = new Map<number, number[]>();

  function broadcast(): void {
    const msg: ControlMsg = { type: "lobby-state", state };
    for (const gi of guestPlayers.keys()) send(gi, msg);
    callbacks.onStateChanged?.(state);
  }

  /** Apply + broadcast if the state actually changed. */
  function apply(event: LobbyEvent, device: LobbyDevice = DESKTOP_DEVICE): void {
    const before = JSON.stringify(state);
    const r = reduceLobby(state, event, device);
    state = r.state;
    if (JSON.stringify(state) !== before) broadcast();
  }

  return {
    state: () => state,
    localEvent(event, device) {
      apply(event, device);
    },
    guestMessage(guestIndex, raw) {
      const parsed = parseControl(raw);
      if (!parsed.ok) return; // Malformed guest control: dropped, never crash.
      const msg = parsed.msg;
      switch (msg.type) {
        case "hello": {
          if (msg.version !== PROTOCOL_VERSION) {
            send(guestIndex, { type: "hello-refused", reason: "version" });
            return;
          }
          const r = reduceLobby(state, {
            type: "remoteJoined",
            guestIndex,
            name: msg.name,
            skinId: msg.skinId,
          });
          if (r.error !== undefined) {
            send(guestIndex, {
              type: "hello-refused",
              reason: r.error === "noLateJoin" ? "inGame" : "full",
            });
            return;
          }
          state = r.state;
          const players = [guestPlayerId(guestIndex)];
          guestPlayers.set(guestIndex, players);
          send(guestIndex, { type: "hello-ok", playerId: players[0] ?? 0, guestIndex });
          broadcast();
          callbacks.onGuestJoined?.(guestIndex, players);
          return;
        }
        case "lobby-intent": {
          const players = guestPlayers.get(guestIndex);
          if (players === undefined) return;
          switch (msg.intent.kind) {
            case "ready": {
              // Ready applies to every local player of that guest device.
              for (const pid of players) apply({ type: "setReady", playerId: pid, ready: msg.intent.ready });
              return;
            }
            case "name": {
              const pid = players[0];
              if (pid !== undefined) apply({ type: "setPlayerName", playerId: pid, name: msg.intent.name });
              return;
            }
            case "skin": {
              const pid = players[0];
              if (pid !== undefined) apply({ type: "setPlayerSkin", playerId: pid, skinId: msg.intent.skinId });
              return;
            }
            case "addLocalPlayer": {
              // Second local player on the guest device → virtual guest slot
              // (guestIndex+10) but tracked under this device's key.
              if (players.length !== 1 || state.players.length >= 4) return;
              const second = guestIndex + 10;
              const r = reduceLobby(state, {
                type: "remoteJoined",
                guestIndex: second,
                name: msg.intent.name ?? "Player 2",
                ...(msg.intent.skinId !== undefined ? { skinId: msg.intent.skinId } : {}),
              });
              if (r.error !== undefined) return;
              state = r.state;
              players.push(guestPlayerId(second));
              broadcast();
              return;
            }
          }
          return;
        }
        case "ping":
          send(guestIndex, { type: "pong", atMs: msg.atMs });
          return;
        default:
          return; // Host-only messages from a guest: ignored.
      }
    },
    guestClosed(guestIndex) {
      const players = guestPlayers.get(guestIndex);
      if (players === undefined) return;
      guestPlayers.delete(guestIndex);
      for (const pid of players) apply({ type: "removePlayer", playerId: pid });
      callbacks.onGuestLeft?.(guestIndex);
    },
    countdownTick() {
      if (state.phase !== "countdown") return;
      const before = state.countdownRemaining;
      apply({ type: "countdownTick" });
      if (before > 0 && state.countdownRemaining === 0) {
        apply({ type: "matchStarted" });
        callbacks.onCountdownComplete?.(state);
      }
    },
    guests: () => [...guestPlayers.keys()],
    playersOfGuest: (guestIndex) => [...(guestPlayers.get(guestIndex) ?? [])],
    startCountdown() {
      apply({ type: "startCountdown" });
      for (const gi of guestPlayers.keys()) send(gi, { type: "lobby-start", countdown: 3 });
    },
    kickGuest(guestIndex) {
      send(guestIndex, { type: "kick", reason: "lobby" });
      this.guestClosed(guestIndex);
    },
  };
}

export interface GuestLobbyCallbacks {
  /** Full lobby state arrived (render it). */
  onState?(state: LobbyState): void;
  /** Host refused the join. */
  onRefused?(reason: "version" | "full" | "inGame"): void;
  /** Host started the countdown. */
  onCountdown?(seconds: number): void;
  /** Host kicked this device. */
  onKicked?(): void;
}

export interface GuestLobbySession {
  /** Latest replicated state. */
  state(): LobbyState;
  /** Our first player id on the host (valid after hello-ok). */
  playerId(): number | null;
  /** Send a local intent (ready toggle/name/skin/second local player). */
  intent(intent: Extract<ControlMsg, { type: "lobby-intent" }>["intent"]): void;
  /** Feed a host control message. */
  onHostMessage(raw: string): void;
  /** Send the initial hello. */
  hello(name: string, skinId: string): void;
}

export function createGuestLobbySession(
  sendToHost: (msg: ControlMsg) => void,
  version: number,
  callbacks: GuestLobbyCallbacks = {},
): GuestLobbySession {
  let state: LobbyState = createLobbyState(false);
  let myId: number | null = null;

  return {
    state: () => state,
    playerId: () => myId,
    intent(intent) {
      sendToHost({ type: "lobby-intent", intent });
    },
    hello(name, skinId) {
      sendToHost({ type: "hello", version, name, skinId });
    },
    onHostMessage(raw) {
      const parsed = parseControl(raw);
      if (!parsed.ok) return;
      const msg = parsed.msg;
      switch (msg.type) {
        case "hello-ok":
          myId = msg.playerId;
          return;
        case "hello-refused":
          callbacks.onRefused?.(msg.reason);
          return;
        case "lobby-state": {
          // Structural guard: a malformed lobby-state payload is ignored —
          // the guest keeps its last good replica (never a crash).
          const raw: unknown = msg.state;
          if (
            typeof raw === "object" && raw !== null &&
            Array.isArray((raw as { players?: unknown }).players)
          ) {
            state = raw as LobbyState;
            callbacks.onState?.(state);
          }
          return;
        }
        case "lobby-start":
          callbacks.onCountdown?.(msg.countdown);
          return;
        case "kick":
          callbacks.onKicked?.();
          return;
        default:
          return;
      }
    },
  };
}

/** Serialize a control message for the wire (used by the transport seams). */
export function encodeForWire(msg: ControlMsg): string {
  return encodeControl(msg);
}
