// Guest-side client prediction of the LOCAL paddle only (ticket 46, spec
// §9, prototype-validated): a shadow advance of the paddle from raw input
// history, reconciled against every authoritative snapshot — direct
// per-tick compare at the acked tick, snap to the authoritative position,
// fold the difference into a display offset that decays over ~0.5 s. The
// player sees a tiny correction, never a teleport.
//
// Timeline: the host consumes input frame tick t at sim tick t+D (delay
// queue), so a snapshot at sim tick S reflects input through S−D. The
// shadow keeps a per-tick TRAIL of predicted positions keyed by frame
// tick; reconcile compares the authoritative paddle against the trail
// entry at S−D — the same instant — and shifts the whole predicted
// trajectory (current position included) by the error. Comparing against
// the CURRENT shadow instead would fold the movement of the D+latency
// window into the offset on every snapshot, smothering the prediction.
//
// Prediction clamps to every sim constraint (walls, shared-field slice,
// Duel other-paddle-as-wall) or the display settles short. Remote
// paddles and the ball are NEVER predicted — interpolation-only (45);
// the host renders authoritative state.
import type { InputFrame, Snapshot } from "shared/protocol";
import { FIELD_W, PADDLE_W, PADDLE_VMAX } from "shared/gridConstants";
import { TICK_MS } from "shared/simRates";

/** Fraction of the display offset kept per tick (~95% gone in 0.5 s). */
export const OFFSET_DECAY_PER_TICK = 0.0025 ** (TICK_MS / 1000);
/** Reconcile errors at or below this many field units are not folded. */
export const RECONCILE_EPSILON = 0.5;
/** Per-tick trail entries kept (matches the guest's history window). */
export const TRAIL_CAP = 64;

/** Which sim constraint set clamps the predicted paddle (ticket body). */
export type PredictBoundsKind = "walls" | "sharedSlice" | "duelWall";

export interface PredictOptions {
  /**
   * Player byte the guest's InputFrames carry (device-local index — the
   * codec's per-device numbering, what collect() receives).
   */
  framePlayer: number;
  /**
   * Player id inside the snapshots this predictor reconciles against:
   * parallel modes renumber each field's player to 0 (multiField remap);
   * duel/sharedField carry global sim ids.
   */
  snapPlayer: number;
  /** Constraint set the sim applies to this paddle. */
  bounds: PredictBoundsKind;
  /** Host player count (sharedField slice width). */
  playerCount: number;
  /** Input delay ticks D — input through snap.tick − D is consumed. */
  delayTicks: number;
}

interface TrailEntry {
  /** Input frame tick this position corresponds to (host consumes t at t+D). */
  tick: number;
  /** Predicted center x after applying that frame. */
  x: number;
}

export interface Predictor {
  /** Record a local input frame (the same frame the guest sends upstream). */
  push(frame: InputFrame): void;
  /** Advance the shadow one sim tick applying the newest unconsumed frame. */
  tick(): void;
  /** Reconcile against an authoritative snapshot (per-tick compare + snap). */
  reconcile(snap: Snapshot): void;
  /** Render-time paddle x: prediction + decaying display offset. */
  displayX(): number;
  /** Raw predicted x (no offset) — tests + wiring diagnostics. */
  readonly predictedX: number;
  /** Current display offset magnitude (diagnostic). */
  readonly offset: number;
  /** Wipe input history + prediction (rejoin resync, ticket 47). */
  reset(snap: Snapshot): void;
}

/**
 * Resolve the clamp bounds [lo, hi] for a paddle, mirroring the sim's own
 * movement constraints exactly (spec §5):
 * - walls: roundSim/multiField — full field, half-paddle margins.
 * - sharedSlice: sharedField placement A — this player's FIELD_W/N slice.
 * - duelWall: duel — the OTHER paddle is a wall too (wall-constrained
 *   separation); without this clamp prediction runs ahead into the other
 *   paddle while the sim blocks at flush, and the display settles short.
 */
export function predictBounds(
  kind: PredictBoundsKind,
  player: number,
  playerCount: number,
  snap: Snapshot,
): { lo: number; hi: number } {
  const half = PADDLE_W / 2;
  const me = snap.players.find((p) => p.player === player);
  if (me === undefined) return { lo: half, hi: FIELD_W - half };
  if (kind === "duelWall") {
    const other = snap.players.find((p) => p.player !== player);
    if (other === undefined) return { lo: half, hi: FIELD_W - half };
    const minDist = half + other.paddle.w / 2;
    // Side-edge paddles clamp on y; bottom/top clamp on x.
    const vertical = me.paddle.edge === "left" || me.paddle.edge === "right";
    const mine = vertical ? me.paddle.y : me.paddle.x;
    const theirs = vertical ? other.paddle.y : other.paddle.x;
    const wallLo = half;
    const wallHi = FIELD_W - half;
    return mine < theirs
      ? { lo: wallLo, hi: Math.max(wallLo, theirs - minDist) }
      : { lo: Math.min(wallHi, theirs + minDist), hi: wallHi };
  }
  if (kind === "sharedSlice") {
    // Placement A slices: player i owns [i*N, (i+1)*N) of the field width.
    // hostGame ships placement: "A" — slices are x-only.
    const sliceW = FIELD_W / Math.max(1, playerCount);
    const lo = player * sliceW + half;
    const hi = (player + 1) * sliceW - half;
    return { lo, hi: Math.max(lo, hi) };
  }
  return { lo: half, hi: FIELD_W - half };
}

/**
 * Create a predictor. The first snapshot it sees seeds the baseline
 * (prediction never invents a start position).
 */
export function createPredictor(opts: PredictOptions): Predictor {
  let x = FIELD_W / 2;
  let offsetX = 0;
  let seeded = false;
  /** Highest input frame tick the shadow has applied. */
  let appliedTick = -1;
  const history: InputFrame[] = [];
  const trail: TrailEntry[] = [];
  let bounds: { lo: number; hi: number } = { lo: PADDLE_W / 2, hi: FIELD_W - PADDLE_W / 2 };
  let latestSnap: Snapshot | null = null;

  function clamp(px: number): number {
    return Math.max(bounds.lo, Math.min(bounds.hi, px));
  }

  const predictor: Predictor = {
    get predictedX() {
      return x;
    },
    get offset() {
      return offsetX;
    },
    push(frame) {
      history.push(frame);
      if (history.length > TRAIL_CAP) history.shift();
    },
    tick() {
      if (latestSnap !== null) {
        bounds = predictBounds(opts.bounds, opts.snapPlayer, opts.playerCount, latestSnap);
      }
      // Apply the newest frame this shadow hasn't consumed (its own
      // player's only — multi-local guests run one predictor per player).
      // Idle ticks (input gap) hold position; the trail grows only when a
      // frame is applied, so appliedTick always mirrors a real frame tick.
      for (let i = history.length - 1; i >= 0; i--) {
        const f = history[i];
        if (f === undefined || f.tick <= appliedTick) break;
        if (f.player !== opts.framePlayer) continue;
        const axis = Math.max(-1, Math.min(1, f.axisX));
        x = clamp(x + axis * PADDLE_VMAX * (TICK_MS / 1000));
        appliedTick = f.tick;
        trail.push({ tick: f.tick, x });
        if (trail.length > TRAIL_CAP) trail.shift();
        break;
      }
      // Display offset decay: ~0.5 s to settle (prototype: 0.0025^(dt/1s)).
      offsetX *= OFFSET_DECAY_PER_TICK;
      if (Math.abs(offsetX) < 0.01) offsetX = 0;
    },
    reconcile(snap) {
      latestSnap = snap;
      // Bounds refresh FIRST — reconcile may shift the position into a
      // region the previous snapshot's constraint set forbids (the other
      // paddle moved; stale bounds would clamp the authoritative truth).
      bounds = predictBounds(opts.bounds, opts.snapPlayer, opts.playerCount, snap);
      const me = snap.players.find((p) => p.player === opts.snapPlayer);
      if (me === undefined) return;
      const authX = me.paddle.x;
      if (!seeded) {
        seeded = true;
        x = authX;
        offsetX = 0;
        // The snapshot's state reflects input through snap.tick − D; seed
        // the applied tick there so pending input replays immediately.
        appliedTick = snap.tick - opts.delayTicks;
        trail.length = 0;
        trail.push({ tick: appliedTick, x: authX });
        return;
      }
      // Direct per-tick compare at the acked tick: the host has consumed
      // input through snap.tick − D, so the trail entry at (or nearest
      // below) that tick is the prediction of exactly this instant.
      const consumed = snap.tick - opts.delayTicks;
      let entry: TrailEntry | undefined;
      for (let i = trail.length - 1; i >= 0; i--) {
        const e = trail[i];
        if (e === undefined) continue;
        if (e.tick <= consumed) {
          entry = e;
          break;
        }
      }
      const err = authX - (entry !== undefined ? entry.x : x);
      if (Math.abs(err) > RECONCILE_EPSILON) {
        // Snap to authoritative: shift the whole predicted trajectory —
        // current position and every trail entry — then fold the same
        // difference into the decaying display offset.
        x = clamp(x + err);
        for (const e of trail) e.x = clamp(e.x + err);
        offsetX += err;
      }
    },
    displayX() {
      return clamp(x + offsetX);
    },
    reset(snap) {
      history.length = 0;
      trail.length = 0;
      x = FIELD_W / 2;
      offsetX = 0;
      seeded = false;
      appliedTick = -1;
      latestSnap = null;
      predictor.reconcile(snap);
    },
  };
  return predictor;
}
