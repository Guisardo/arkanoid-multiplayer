// Guest-side game session (ticket 45, spec §9): sends 60 Hz Input batches
// with ~10-tick redundancy on the game channel, receives full binary
// snapshots, interpolates remote entities (never the ball extrapolated),
// and exposes render-ready snapshots for the guest's own local fields.
// Ticket 46: the guest's OWN paddles render through client prediction
// (net/predict — shadow advance from input history, error-offset
// reconcile); remote players + the ball stay interpolation-only.
// Malformed snapshots raise a protocol error the caller turns into a
// clean session end.
import type { InputFrame, Snapshot } from "shared/protocol";
import { EMPTY_ACTIONS } from "shared/protocol";
import {
  encodeInputBatch,
  redundancyWindow,
} from "net/inputCodec";
import { deserializeSnapshot } from "net/serializer";
import { createInterpolator, type Interpolator } from "net/interpolate";
import { createPredictor, type Predictor, type PredictBoundsKind } from "net/predict";
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
  /** Rebuild prediction from a full snapshot (rejoin resync, ticket 47). */
  resyncFromSnapshot(snap: Snapshot): void;
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
  /** Mode + input delay D — drive local-paddle prediction bounds (46). */
  mode?: "race" | "attack" | "duel" | "sharedField" | "parallelAssist";
  delayTicks?: number;
  /** Total session players (sharedField slice width). */
  playerCount?: number;
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

  // ---- Ticket 46: local-paddle prediction ----
  const boundsKind: PredictBoundsKind =
    opts.mode === "sharedField"
      ? "sharedSlice"
      : opts.mode === "duel"
        ? "duelWall"
        : "walls";
  const delayTicks = opts.delayTicks ?? 4;
  const playerCount = opts.playerCount ?? Math.max(1, opts.names.length);
  // Parallel modes renumber each field's player to 0 (multiField remap);
  // single-field modes carry global sim ids. Frames carry the device-local
  // index (codec numbering) — predictors match both spaces.
  const parallelFields =
    opts.mode === "race" || opts.mode === "attack" || opts.mode === "parallelAssist";
  const predictors: Predictor[] = opts.localPlayers.map((player, i) =>
    createPredictor({
      framePlayer: i,
      snapPlayer: parallelFields ? 0 : player,
      bounds: boundsKind,
      playerCount,
      delayTicks,
    }),
  );

  function decodeSnapshot(buf: ArrayBuffer): Snapshot {
    // Malformed snapshot = protocol error → clean session end, never crash.
    return deserializeSnapshot(buf);
  }

  /** Reconcile every predictor against the snapshots a batch delivered. */
  function reconcilePredictions(snapshots: readonly Snapshot[], fieldsPerSnapshot: boolean): void {
    if (predictors.length === 0) return;
    for (let i = 0; i < predictors.length; i++) {
      const interp = predictors[i];
      if (interp === undefined) continue;
      const snap = fieldsPerSnapshot
        ? (snapshots[i] ?? snapshots[0])
        : snapshots[0];
      if (snap !== undefined) interp.reconcile(snap);
    }
  }

  /**
   * Overlay predicted paddle positions onto render snapshots — the guest's
   * OWN paddles only. Remote paddles + the ball are never touched: the
   * interpolated snapshot stays authoritative for them (spec §9).
   * Parallel modes: the field's single player is `players[0]`; the
   * single-field modes carry global ids.
   */
  function overlayPrediction(snap: Snapshot, fieldIndex: number): Snapshot {
    const pred = predictors[fieldIndex];
    if (pred === undefined) return snap;
    const target = parallelFields
      ? snap.players[0]
      : snap.players.find((p) => p.player === opts.localPlayers[fieldIndex]);
    if (target === undefined) return snap;
    const players = snap.players.map((p) =>
      p === target
        ? { ...p, paddle: { ...p.paddle, x: pred.displayX() } }
        : p,
    );
    // Attached balls ride their owner paddle — but only when the owner is
    // this predicted local player (never a remote or the raw ball state).
    const owner = target.player;
    const balls = snap.balls.map((b) =>
      b.attachedTo === owner ? { ...b, x: pred.displayX() } : b,
    );
    return { ...snap, players, balls };
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
      for (const pred of predictors) pred.push(frame);
    },
    sendTick() {
      if (protocolError !== null) return;
      // Advance prediction one sim tick (60 Hz cadence), then send the
      // redundancy batch — prediction runs on the same clock as input.
      for (const pred of predictors) pred.tick();
      if (history.length === 0) return;
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
          reconcilePredictions(rawLatest, true);
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
          reconcilePredictions(rawLatest, false);
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
      for (let i = 0; i < interpolators.length; i++) {
        const interp = interpolators[i];
        if (interp === undefined) continue;
        const s = interp.sample(nowMs);
        if (s !== null) out.push(overlayPrediction(s, i));
      }
      return out;
    },
    progressRows() {
      return [...progressRows];
    },
    resyncFromSnapshot(snap) {
      for (const pred of predictors) pred.reset(snap);
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
