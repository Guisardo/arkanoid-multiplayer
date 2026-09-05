// Guest-side game session (ticket 45, spec §9): sends 60 Hz Input batches
// with ~10-tick redundancy on the game channel, receives full binary
// snapshots, interpolates remote entities (never the ball extrapolated),
// and exposes render-ready snapshots for the guest's own local fields.
// Guest prediction of its own paddle is ticket 46 — here the guest renders
// authoritative + interpolated state only. Malformed snapshots raise a
// protocol error the caller turns into a clean session end.
import type { InputFrame, Snapshot } from "shared/protocol";
import { EMPTY_ACTIONS } from "shared/protocol";
import {
  encodeInputBatch,
  redundancyWindow,
} from "net/inputCodec";
import { deserializeSnapshot } from "net/serializer";
import { createInterpolator, type Interpolator } from "net/interpolate";
import { unpackMulti } from "app/hostGame";
import { unpackProgress } from "app/hostProgress";

export const GUEST_SEND_HZ = 60;
export const REDUNDANCY_TICKS = 10;

/** Remote progress row (spec §12): numbers only, one per remote player. */
export interface ProgressRow {
  player: number;
  name: string;
  score: number;
  round: number;
  maxRound: number;
  lives: number;
  downed: boolean;
}

export type SendGame = (buffer: ArrayBuffer) => void;

export interface GuestGameCallbacks {
  /** A snapshot batch arrived (already interpolated at render). */
  onSnapshots?(snapshots: Snapshot[]): void;
  /** Remote-player progress rows for the strip (5 Hz cadence internally). */
  onProgress?(rows: ProgressRow[]): void;
  /** Malformed binary on the game channel — protocol error, clean end. */
  onProtocolError?(reason: string): void;
}

export interface GuestGameSession {
  /** Collect a local input frame (call per sim tick per local player). */
  collect(frame: InputFrame): void;
  /** Send the redundancy batch (call at 60 Hz). */
  sendTick(): void;
  /** Feed a binary payload from the host's game channel. */
  hostBinary(buffer: ArrayBuffer): void;
  /** Render-time interpolated snapshots for the guest's local fields. */
  renderSnapshots(nowMs: number): Snapshot[];
  /** Progress rows derived from the latest snapshot. */
  progressRows(): ProgressRow[];
  readonly snapshotHz: 30 | 60;
  /** Last protocol error (drives clean session end). */
  readonly protocolError: string | null;
  dispose(): void;
}

export interface GuestGameOptions {
  snapshotHz: 30 | 60;
  /** Sim player indices this device renders locally (their fields). */
  localPlayers: number[];
  /** Player indices that belong to remote devices (progress strip rows). */
  remotePlayers: number[];
  /** Player names by sim index. */
  names: string[];
  maxRound?: number;
}

export function createGuestGameSession(
  opts: GuestGameOptions,
  sendGame: SendGame,
  callbacks: GuestGameCallbacks = {},
): GuestGameSession {
  const maxRound = opts.maxRound ?? 33;
  const history: InputFrame[] = [];
  const interpolators: Interpolator[] = [];
  const rawLatest: Snapshot[] = [];
  const progressRows: ProgressRow[] = [];
  const localCount = Math.max(1, opts.localPlayers.length);
  for (let i = 0; i < localCount; i++) {
    interpolators.push(createInterpolator({ snapshotHz: opts.snapshotHz }));
  }
  let protocolError: string | null = null;
  let lastProgressEmit = 0;

  function decodeSnapshot(buf: ArrayBuffer): Snapshot {
    // Malformed snapshot = protocol error → clean session end, never crash.
    return deserializeSnapshot(buf);
  }

  return {
    get snapshotHz() {
      return opts.snapshotHz;
    },
    get protocolError() {
      return protocolError;
    },
    collect(frame) {
      history.push(frame);
      if (history.length > 64) history.splice(0, history.length - 64);
    },
    sendTick() {
      if (protocolError !== null || history.length === 0) return;
      sendGame(encodeInputBatch(redundancyWindow(history, REDUNDANCY_TICKS)));
    },
    hostBinary(buffer) {
      if (protocolError !== null) return;
      try {
        const view = new DataView(buffer);
        const kind = view.getUint8(0);
        if (kind === 2) {
          // Multi-snapshot (parallel modes): fields in local-player order.
          const parts = unpackMulti(buffer);
          rawLatest.length = 0;
          for (const part of parts) rawLatest.push(decodeSnapshot(part));
          const now = nowMs();
          for (let i = 0; i < interpolators.length; i++) {
            const snap = rawLatest[i] ?? rawLatest[0];
            const interp = interpolators[i];
            if (snap !== undefined && interp !== undefined) interp.push(snap, now);
          }
          callbacks.onSnapshots?.(rawLatest);
        } else if (kind === 3) {
          // Progress rows (parallel modes): remote players' strip data.
          progressRows.length = 0;
          for (const r of unpackProgress(buffer)) {
            progressRows.push({
              player: r.player,
              name: opts.names[r.player] ?? `P${String(r.player + 1)}`,
              score: r.score,
              round: r.round,
              maxRound,
              lives: r.lives,
              downed: r.state === 1,
            });
          }
          callbacks.onProgress?.(progressRows);
        } else {
          // Single snapshot (duel/sharedField): serializer's own stream.
          rawLatest.length = 0;
          rawLatest.push(decodeSnapshot(buffer));
          const now = nowMs();
          for (const interp of interpolators) {
            const snap = rawLatest[0];
            if (snap !== undefined) interp.push(snap, now);
          }
          callbacks.onSnapshots?.(rawLatest);
          // Single-field snapshots carry every player: derive rows here.
          if (now - lastProgressEmit > 200) {
            lastProgressEmit = now;
            progressRows.length = 0;
            const snap = rawLatest[0];
            for (const rp of opts.remotePlayers) {
              const p = snap?.players.find((x) => x.player === rp);
              if (p === undefined || snap === undefined) continue;
              progressRows.push({
                player: rp,
                name: p.name,
                score: p.score,
                round: snap.round,
                maxRound,
                lives: p.lives,
                downed: p.state === "downed",
              });
            }
            callbacks.onProgress?.(progressRows);
          }
        }
      } catch (err) {
        protocolError = err instanceof Error ? err.message : "malformed snapshot";
        callbacks.onProtocolError?.(protocolError);
      }
    },
    renderSnapshots(nowMs) {
      const out: Snapshot[] = [];
      for (const interp of interpolators) {
        const s = interp.sample(nowMs);
        if (s !== null) out.push(s);
      }
      return out;
    },
    progressRows() {
      return [...progressRows];
    },
    dispose() {
      history.length = 0;
    },
  };
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export { EMPTY_ACTIONS };
