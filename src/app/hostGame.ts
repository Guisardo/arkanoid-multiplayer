// Host-side game session (ticket 45, spec §9): host-authoritative input
// relay + state broadcast over the game channels. Composes whichever sim the
// lobby config picks (Race/Attack/Duel/Shared field/Parallel assist — the
// same seams versus bots uses), runs the uniform tick-D delay queue for
// host-local AND guest players (host skips only the network hop), guards
// guest input structurally, serializes full binary snapshots at 30 Hz
// (60 Hz Duel), and sends each guest only the snapshots for its own local
// players' fields (single-field modes send the one field to everyone).
// Malformed guest frames are dropped; a guest's channel close ends its slot
// via remoteLeft semantics (rejoin is ticket 47).
import {
  createRoundDuel,
  type DuelSim,
} from "sim/duel";
import { createMultiFieldSession, type MatchConfig, type MultiFieldSession } from "sim/multiField";
import { createAttackSession, type AttackSession } from "sim/attackSession";
import { createAssistSession, type AssistSession } from "sim/assistSession";
import { createSharedFieldSim, type SharedFieldSim } from "sim/sharedField";
import { getLevel } from "content/levels";
import type { LobbyConfig, LobbyMode } from "app/lobbyState";
import type { InputFrame, Snapshot } from "shared/protocol";
import { EMPTY_ACTIONS } from "shared/protocol";
import { createDelayQueue } from "net/delayQueue";
import { decodeInputBatch } from "net/inputCodec";
import { createHostInputGuard, guardGuestFrames } from "net/hostGuard";
import { serializeSnapshot } from "net/serializer";
import { packProgress, type ProgressWireRow } from "app/hostProgress";

/** Snapshot broadcast cadence (spec §9). */
export function snapshotHzFor(mode: LobbyMode): 30 | 60 {
  return mode === "duel" ? 60 : 30;
}

/** Input delay ticks (spec §9): competitive remote 3–5 (default 4), coop 0. */
export function delayTicksFor(mode: LobbyMode): number {
  const coop = mode === "sharedField" || mode === "parallelAssist";
  return coop ? 0 : 4;
}

export interface HostGamePlayer {
  /** Player index in the sim (0–3). */
  player: number;
  name: string;
  /** Skin UUID → compact index (assigned via skinSync before session). */
  skinIndex: number;
  /** Guest device that owns this player; -1 = host-local. */
  guestIndex: number;
}

export interface HostGameOptions {
  mode: LobbyMode;
  config: LobbyConfig;
  /** Ordered by player index — the host built this from lobby state. */
  players: HostGamePlayer[];
  /** Player indices local to the host device. */
  hostLocalPlayers: number[];
  seed?: number;
}

export type SendGame = (guestIndex: number, buffer: ArrayBuffer) => void;

export interface HostGameCallbacks {
  /** A guest's game channel produced a binary payload. */
  onGuestBinary?(guestIndex: number, buffer: ArrayBuffer): void;
  /** A guest's connection dropped — remove its players (remoteLeft). */
  onGuestDropped?(guestIndex: number): void;
  /** Match ended — standings handoff to end screens (ticket 50 shapes). */
  onMatchEnd?(end: MatchEndSummary): void;
}

export interface MatchEndSummary {
  mode: LobbyMode;
  /** Snapshot set at match end (for standings computation). */
  snapshots: Snapshot[];
}

export interface HostGameSession {
  /** Advance exactly one sim tick: `localFrames` = host-local input frames. */
  tick(localFrames: readonly InputFrame[]): void;
  /** Feed a binary game-channel payload from a guest. */
  guestBinary(guestIndex: number, buffer: ArrayBuffer): void;
  /** Mark a guest gone (channel closed / heartbeat dead). */
  guestDropped(guestIndex: number): void;
  /**
   * Rebind a dropped guest's players to a new channel index (rejoin,
   * ticket 47): routing + input cutoff resume; a full snapshot ships to
   * the new index immediately so the guest rebuilds. `simPlayers` = the
   * sim indices of the rejoining players (the old routing was deleted at
   * drop time).
   */
  rebindGuest(oldGuestIndex: number, newGuestIndex: number, simPlayers: number[]): void;
  /**
   * Remove players permanently (rejoin expiry / quit, ticket 47):
   * competitive = field eliminated (loss via the sim's own ball-loss
   * path — frozen paddle), coop = slot gone (state "removed", not
   * revivable). Input cutoff + routing drop immediately.
   */
  removePlayers(players: number[]): void;
  /** Ship a full snapshot to one guest NOW (rejoin resync, ticket 47). */
  resyncGuest(guestIndex: number): void;
  /** Latest snapshots (host renders authoritative state). */
  snapshots(): Snapshot[];
  /** Broadcast cadence — callers tick this at the rate. */
  readonly snapshotHz: 30 | 60;
  readonly delayTicks: number;
  /** Match over? */
  readonly over: boolean;
  dispose(): void;
}

/** Build the MatchConfig the multi-field sims take from LobbyConfig. */
export function matchConfigFromLobby(cfg: LobbyConfig): MatchConfig {
  return {
    structure: cfg.matchStructure,
    bestOf: cfg.bestOf,
    levelSelection: cfg.levelSelection,
    hostPickRound: cfg.hostPickRound,
    timeCapTicks: cfg.timeCapTicks,
  };
}

/** Uniform mode-agnostic sim surface the host game drives. */
interface ModeSim {
  step(inputs: InputFrame[]): void;
  /** Snapshots aligned to player order (single-field: one snapshot). */
  snapshots(): Snapshot[];
  /** Match-over signal; single-field modes watch ticks externally (false). */
  over(): boolean;
}

function buildModeSim(opts: HostGameOptions): ModeSim {
  const names = opts.players.map((p) => p.name);
  const skinIndices = opts.players.map((p) => p.skinIndex);
  const count = opts.players.length;
  switch (opts.mode) {
    case "duel": {
      const sim: DuelSim = createRoundDuel(getLevel(1), {
        ballModel: "shared",
        timeCapTicks: null,
        playerNames: [names[0] ?? "P1", names[1] ?? "P2"],
        skinIndices: [skinIndices[0] ?? 0, skinIndices[1] ?? 1],
      });
      return {
        step: (inputs) => { sim.step(inputs); },
        snapshots: () => [sim.snapshot()],
        // Duel runs continuous points (spec §6.3) — match never auto-ends.
        over: () => false,
      };
    }
    case "sharedField": {
      const sim: SharedFieldSim = createSharedFieldSim(getLevel(1), {
        placement: "A",
        ballModel: "shared",
        playerCount: count as 2 | 3 | 4,
        playerNames: names,
        skinIndices,
      });
      return {
        step: (inputs) => { sim.step(inputs); },
        snapshots: () => [sim.snapshot()],
        // Coop ends when the team finishes the round range (33) or wipes.
        over: () => sim.snapshot().phase === "roundClear" && sim.getTeamState().round >= 33,
      };
    }
    case "parallelAssist": {
      const sim: AssistSession = createAssistSession({
        playerCount: count,
        startRound: 1,
        endRound: 33,
        playerNames: names,
        skinIndices,
        seed: opts.seed,
      });
      return {
        step: (inputs) => { sim.step(inputs); },
        snapshots: () => sim.snapshots(),
        over: () => sim.state().phase !== "playing",
      };
    }
    case "attack": {
      const sim: AttackSession = createAttackSession({
        playerCount: count,
        config: matchConfigFromLobby(opts.config),
        playerNames: names,
        skinIndices,
        seed: opts.seed,
      });
      return {
        step: (inputs) => { sim.step(inputs); },
        snapshots: () => sim.snapshots(),
        over: () => sim.race().state().phase === "matchOver",
      };
    }
    case "race": {
      const sim: MultiFieldSession = createMultiFieldSession({
        playerCount: count,
        config: matchConfigFromLobby(opts.config),
        playerNames: names,
        skinIndices,
        seed: opts.seed,
      });
      return {
        step: (inputs) => { sim.step(inputs); },
        snapshots: () => sim.snapshots(),
        over: () => sim.state().phase === "matchOver",
      };
    }
  }
}

export function createHostGameSession(
  opts: HostGameOptions,
  sendGame: SendGame,
  callbacks: HostGameCallbacks = {},
): HostGameSession {
  const snapshotHz = snapshotHzFor(opts.mode);
  const delayTicks = delayTicksFor(opts.mode);
  const sim = buildModeSim(opts);
  const queue = createDelayQueue({ delay: delayTicks });
  const guard = createHostInputGuard();

  // Per-player routing: guestIndex → players of that device.
  const guestPlayers = new Map<number, number[]>();
  for (const p of opts.players) {
    if (p.guestIndex < 0) continue;
    const list = guestPlayers.get(p.guestIndex) ?? [];
    list.push(p.player);
    guestPlayers.set(p.guestIndex, list);
  }
  const playerOf = new Map<number, number>();
  for (const p of opts.players) playerOf.set(p.player, p.guestIndex);

  // Input stall decay (spec §9, ticket 46): a guest that stops sending has
  // its players' axes HELD at the last value for ≤10 missing ticks, then
  // DECAYED to 0 (~0.7× per tick — a stalled paddle stops, it never ghosts
  // on at full axis). Held/decayed axes are injected DIRECTLY into the sim
  // step (not the delay queue): synthetic queue frames would collide with
  // the guest's own frame-tick timeline and the guard would drop real
  // input as duplicates. A due frame resets the miss counter.
  const STALL_HOLD = 10;
  const STALL_DECAY = 0.7;
  const STALL_FLOOR = 0.05;
  const guestPlayerIds = opts.players.filter((p) => p.guestIndex >= 0).map((p) => p.player);
  const missCount = new Map<number, number>();
  const lastAxis = new Map<number, number>();
  let simTick = 0;
  let ended = false;
  // Removed players (ticket 47): input cutoff + snapshot state overlay.
  // The sim keeps its own state (frozen paddle → ball-loss path); the
  // overlay marks the slot "removed" on the wire so guests render the
  // removal, and stall frames stop for them.
  const removedPlayers = new Set<number>();

  /** Held/decayed axes for guest players with no due frame this tick. */
  function stallFrames(due: readonly InputFrame[]): InputFrame[] {
    const out: InputFrame[] = [];
    if (guestPlayerIds.length === 0) return out;
    const seen = new Set(due.map((f) => f.player));
    for (const p of guestPlayerIds) {
      if (removedPlayers.has(p)) continue; // removed: no synthetic input
      if (seen.has(p)) {
        const f = due.find((x) => x.player === p);
        if (f !== undefined) lastAxis.set(p, f.axisX);
        missCount.set(p, 0);
        continue;
      }
      const misses = (missCount.get(p) ?? 0) + 1;
      missCount.set(p, misses);
      const held = lastAxis.get(p) ?? 0;
      if (held === 0) continue; // nothing to hold — idle stays idle
      if (misses <= STALL_HOLD) {
        out.push({ player: p, tick: simTick, axisX: held, axisY: 0, launch: false, actions: EMPTY_ACTIONS });
      } else {
        const decayed = held * STALL_DECAY ** (misses - STALL_HOLD);
        out.push({
          player: p,
          tick: simTick,
          axisX: Math.abs(decayed) < STALL_FLOOR ? 0 : decayed,
          axisY: 0,
          launch: false,
          actions: EMPTY_ACTIONS,
        });
      }
    }
    return out;
  }

  function playerForGuestChannel(guestIndex: number, player: number): number {
    // The codec does not carry player; the channel maps to device players.
    // A guest with 2 locals sends interleaved frames per player — the batch
    // carries per-frame player bytes? No: envelope is per-device. Resolve:
    // decodeInputBatch frames carry the player the guest encoded — the
    // guests sets player = local index (0/1). Map device-local → sim player.
    const players = guestPlayers.get(guestIndex) ?? [];
    return players[player] ?? players[0] ?? 0;
  }

  let lastBroadcastTick = -1;
  let lastProgressTick = -1;

  function progressRowsFor(guestIndex: number, snapshots: readonly Snapshot[]): ArrayBuffer {
    // Remote players of this guest = everyone not on this guest / not host-local
    // visible? Remote strip shows players on OTHER devices (spec §12). Host
    // locals show as remote rows for guests too — any player not local to
    // this guest device.
    const mine = new Set(guestPlayers.get(guestIndex) ?? []);
    const rows: ProgressWireRow[] = [];
    for (const p of opts.players) {
      if (mine.has(p.player)) continue;
      // Parallel modes: per-player snapshot carries their row; single-field
      // modes: the one snapshot carries all players.
      const snap =
        snapshots[p.player] ?? snapshots[0];
      const ps = snap?.players.find((x) => x.player === p.player);
      if (ps === undefined || snap === undefined) continue;
      rows.push({
        player: p.player,
        score: ps.score,
        round: snap.round,
        lives: ps.lives,
        state: ps.state === "downed" ? 1 : ps.state === "removed" ? 2 : 0,
      });
    }
    return packProgress(rows);
  }

  function broadcast(snapshots: readonly Snapshot[]): void {
    for (const [guestIndex, players] of guestPlayers) {
      if (opts.mode === "race" || opts.mode === "attack" || opts.mode === "parallelAssist") {
        // Parallel modes: each guest gets only its own players' fields.
        const bufs: ArrayBuffer[] = [];
        for (const p of players) {
          const snap = snapshots[p];
          if (snap !== undefined) bufs.push(serializeSnapshot(overlayRemoved(snap, p)));
        }
        sendGame(guestIndex, packMulti(bufs));
      } else {
        // Single-field modes (duel/sharedField): everyone gets the field.
        const snap = snapshots[0];
        if (snap !== undefined) sendGame(guestIndex, serializeSnapshot(overlayRemoved(snap)));
      }
    }
  }

  /**
   * Snapshot overlay: removed players carry state "removed" on the wire.
   * Parallel modes renumber each field's player to 0 (multiField remap) —
   * `fieldIndex` = the sim player who owns the field. Single-field modes
   * carry global ids — overlay every removed player directly.
   */
  function overlayRemoved(snap: Snapshot, fieldIndex?: number): Snapshot {
    if (removedPlayers.size === 0) return snap;
    if (fieldIndex !== undefined) {
      if (!removedPlayers.has(fieldIndex)) return snap;
      const players = snap.players.map((p) => ({ ...p, state: "removed" as const }));
      return { ...snap, players };
    }
    if (!snap.players.some((p) => removedPlayers.has(p.player))) return snap;
    const players = snap.players.map((p) =>
      removedPlayers.has(p.player) ? { ...p, state: "removed" as const } : p,
    );
    return { ...snap, players };
  }

  function broadcastProgress(snapshots: readonly Snapshot[]): void {
    for (const guestIndex of guestPlayers.keys()) {
      sendGame(guestIndex, progressRowsFor(guestIndex, snapshots));
    }
  }

  return {
    get snapshotHz() {
      return snapshotHz;
    },
    get delayTicks() {
      return delayTicks;
    },
    get over() {
      return ended;
    },
    tick(localFrames) {
      if (ended) return;
      // Host-local frames enter the same queue (network hop skipped).
      for (const f of localFrames) queue.push(f);
      const due = queue.due(simTick);
      // Guest stall decay: held/decayed axes for silent players, injected
      // beside the due frames (never through the queue — see stallFrames).
      const withStall = [...due, ...stallFrames(due)];
      sim.step(withStall);
      simTick++;
      // Input acks: snapshot inputAcks already carry per-player acked ticks
      // via the delay queue's delivery; the serializer ships them.
      if (simTick % (60 / snapshotHz) === 0 && simTick !== lastBroadcastTick) {
        lastBroadcastTick = simTick;
        broadcast(sim.snapshots());
      }
      // Progress rows at ~5 Hz (12 ticks).
      if (simTick % 12 === 0 && simTick !== lastProgressTick) {
        lastProgressTick = simTick;
        broadcastProgress(sim.snapshots());
      }
      // Match-over: modes report via over(); duel runs continuous.
      if (sim.over()) {
        ended = true;
        broadcast(sim.snapshots());
        callbacks.onMatchEnd?.({ mode: opts.mode, snapshots: sim.snapshots() });
      }
    },
    guestBinary(guestIndex, buffer) {
      // Structural validation: decode may throw on malformed input — drop.
      const players = guestPlayers.get(guestIndex) ?? [];
      if (players.length === 0) return;
      let frames: InputFrame[];
      try {
        frames = decodeInputBatch(buffer);
      } catch {
        return; // Malformed binary input: dropped, never a crash.
      }
      // Map device-local player indices (0/1) → sim player indices.
      const mapped = frames
        .map((f) => ({
          ...f,
          player: playerForGuestChannel(guestIndex, f.player),
        }))
        .filter((f) => !removedPlayers.has(f.player));
      const { accepted } = guardGuestFrames(guard, mapped, simTick);
      for (const f of accepted) queue.push(f);
    },
    guestDropped(guestIndex) {
      guestPlayers.delete(guestIndex);
      callbacks.onGuestDropped?.(guestIndex);
    },
    rebindGuest(oldGuestIndex, newGuestIndex, simPlayers) {
      if (simPlayers.length === 0) return;
      guestPlayers.delete(oldGuestIndex);
      guestPlayers.set(newGuestIndex, simPlayers);
      for (const p of opts.players) {
        if (simPlayers.includes(p.player)) p.guestIndex = newGuestIndex;
      }
      for (const [player, gi] of playerOf) {
        if (gi === oldGuestIndex && simPlayers.includes(player)) {
          playerOf.set(player, newGuestIndex);
        }
      }
      // Fresh full snapshot to the new channel: the guest rebuilds from it
      // (prediction history wiped guest-side via resyncFromSnapshot).
      const snaps = sim.snapshots();
      if (opts.mode === "race" || opts.mode === "attack" || opts.mode === "parallelAssist") {
        const bufs: ArrayBuffer[] = [];
        for (const p of simPlayers) {
          const snap = snaps[p];
          if (snap !== undefined) bufs.push(serializeSnapshot(overlayRemoved(snap, p)));
        }
        sendGame(newGuestIndex, packMulti(bufs));
      } else {
        const snap = snaps[0];
        if (snap !== undefined) sendGame(newGuestIndex, serializeSnapshot(overlayRemoved(snap)));
      }
    },
    removePlayers(players) {
      for (const p of players) {
        removedPlayers.add(p);
        missCount.delete(p);
        lastAxis.delete(p);
      }
      // Input cutoff + wire overlay only — routing stays so the removed
      // player's device (if still connected) keeps receiving snapshots
      // showing the removal. Device departure is guestDropped's job.
    },
    resyncGuest(guestIndex) {
      const snaps = sim.snapshots();
      if (opts.mode === "race" || opts.mode === "attack" || opts.mode === "parallelAssist") {
        const players = guestPlayers.get(guestIndex) ?? [];
        const bufs: ArrayBuffer[] = [];
        for (const p of players) {
          const snap = snaps[p];
          if (snap !== undefined) bufs.push(serializeSnapshot(overlayRemoved(snap, p)));
        }
        if (bufs.length > 0) sendGame(guestIndex, packMulti(bufs));
      } else {
        const snap = snaps[0];
        if (snap !== undefined) sendGame(guestIndex, serializeSnapshot(overlayRemoved(snap)));
      }
    },
    snapshots: () => sim.snapshots(),
    dispose() {
      guestPlayers.clear();
    },
  };
}

/**
 * Multi-snapshot wire packing: [u8 count][u32 len]×count + payloads.
 * Guests unpack their own fields in player order.
 */
export function packMulti(buffers: readonly ArrayBuffer[]): ArrayBuffer {
  const total = 2 + buffers.length * 4 + buffers.reduce((n, b) => n + b.byteLength, 0);
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  view.setUint8(0, 2); // wire kind 2 = multi-snapshot
  view.setUint8(1, buffers.length);
  let o = 2 + buffers.length * 4;
  for (let i = 0; i < buffers.length; i++) {
    const b = buffers[i];
    if (b === undefined) continue;
    view.setUint32(2 + i * 4, b.byteLength, true);
    new Uint8Array(out, o, b.byteLength).set(new Uint8Array(b, 0, b.byteLength));
    o += b.byteLength;
  }
  return out;
}

export function unpackMulti(buffer: ArrayBuffer): ArrayBuffer[] {
  if (buffer.byteLength < 2) throw new Error("malformed multi: truncated header");
  const view = new DataView(buffer);
  const kind = view.getUint8(0);
  if (kind !== 2) throw new Error("malformed multi: unknown kind");
  const count = view.getUint8(1);
  if (buffer.byteLength < 2 + count * 4) throw new Error("malformed multi: truncated lens");
  const out: ArrayBuffer[] = [];
  let o = 2 + count * 4;
  for (let i = 0; i < count; i++) {
    const len = view.getUint32(2 + i * 4, true);
    if (o + len > buffer.byteLength) throw new Error("malformed multi: truncated payload");
    out.push(buffer.slice(o, o + len));
    o += len;
  }
  return out;
}

// ---- Progress wire (kind 3) lives in hostProgress.ts (shared with guest) ----
